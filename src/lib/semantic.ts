// 浏览器端语义检索（完全离线）：BGE-Small-ZH-v1.5（512 维）在本地嵌入「查询」，
// 与离线预计算的语料窗口向量（public/vectors.bin）做余弦 → top-K 窗口 → 按章聚合。
// 语料向量由 scripts/gen-vectors.mjs 用同一模型离线预计算（在联网机跑一次）。
// 库/运行时/模型全部走本地 public/；任一步失败由 UI 回落到关键词检索（lexical）。
import { hasLocalLib, hasLocalOrt, computeEnv, pickDevice, loadTJ, TJ_CDN, type DevPref } from './tj'
import { loadBlob, asset } from './idb'

export const SEM_MODEL = 'Xenova/bge-small-zh-v1.5'
export const SEM_DIM = 512
// BGE 检索需加任务前缀；必须与 scripts/gen-vectors.mjs 的 EMB_TASK 完全一致
export const EMB_TASK = '为这个句子生成表示以用于检索相关文章：'

export type SemStage = 'idle' | 'model' | 'ready' | 'error'
export interface SemStatus { stage: SemStage; pct?: number; note?: string }

let _model: Promise<any> | null = null
let _modelDev = ''
let _ctx: Promise<Ctx> | null = null
let _devPref: DevPref = 'auto'
export function setSemDevicePref(p: DevPref) { _devPref = p }

/** 用指定设备加载嵌入模型（v4：离线传 slug，本地权重文件名为 model.onnx）。 */
async function loadOn(device: 'webgpu' | 'wasm'): Promise<any> {
  const [hasLib, hasOrt] = await Promise.all([hasLocalLib(), hasLocalOrt()])
  const env = computeEnv(hasLib, hasOrt)
  const libUrl = hasLib ? asset('vendor/transformers.min.js') : TJ_CDN
  const T = await loadTJ(libUrl, env)
  // Transformers.js v4：localModelPath 选项已不存在（env.localModelPath 已在 tj.ts 指向 /models/）。
  // 离线模式传「/ 换 -」的 id（= public/models/ 下文件夹名）；远端回落模式用原始仓库 id。
  const modelId = env.allowRemoteModels ? SEM_MODEL : SEM_MODEL.split('/').join('-')
  const model = await T.pipeline('feature-extraction', modelId, {
    device,
    ...(env.allowRemoteModels ? {} : { dtype: 'fp32' }), // 本地权重文件名为 model.onnx（内部实为 q8）
  })
  await model(EMB_TASK + '预热', { pooling: 'mean', normalization: 'normalized', truncate: true })
  return model
}

/** 是否为 WebGPU 后端不可用（GPU 驱动失败 / 无 GPU / 浏览器限制）。 */
function isWebGpuFail(e: any): boolean {
  return /webgpu|GPU adapter|no available backend/i.test(String(e?.message || e))
}

async function ensureModel(): Promise<any> {
  const device = pickDevice(_devPref)
  if (_model && _modelDev === device) return _model
  _model = null
  _modelDev = device
  _model = (async () => {
    try {
      return await loadOn(device)
    } catch (e) {
      // navigator.gpu 存在但拿不到 adapter 时，自动回落 WASM 重试，避免语义检索整体不可用
      if (device === 'webgpu' && isWebGpuFail(e)) {
        console.warn('[semantic] WebGPU 不可用，回落 WASM：', e)
        _modelDev = 'wasm'
        return await loadOn('wasm')
      }
      throw e
    }
  })().catch((e) => { _model = null; throw e })
  return _model
}

export interface Ctx { vecs: Float32Array; count: number; windows: number[][] }

/** 加载模型 + 载入语料向量（IndexedDB 缓存优先；ctx 幂等缓存，避免重复载入）。 */
export async function initSemantic(onStatus?: (s: SemStatus) => void): Promise<Ctx> {
  const emit = (s: SemStatus) => onStatus?.(s)
  if (_ctx) { emit({ stage: 'ready', note: '语义已就绪' }); return _ctx }
  _ctx = (async () => {
    emit({ stage: 'model', pct: 0, note: '加载嵌入模型（本地 BGE-Small-ZH）…' })
    await ensureModel()
    emit({ stage: 'ready', pct: 100, note: '载入语料向量…' })
    const meta = await loadBlob<{ model: string; dims: number; count: number; windows: number[][] }>('vecmeta', asset('vectors.json'), 'json')
    const binRes = await fetch(asset('vectors.bin'))
    if (!binRes.ok) throw new Error('缺 vectors.bin（请先在联网机运行 gen-vectors.mjs）')
    const bin = new Uint8Array(await binRes.arrayBuffer())
    if (meta.dims !== SEM_DIM) throw new Error(`vectors 维度不符（期望 ${SEM_DIM}，实得 ${meta.dims}；请重跑 gen-vectors.mjs）`)
    const vecs = new Float32Array(bin.buffer, bin.byteOffset, meta.count * SEM_DIM)
    if (vecs.length < meta.count * SEM_DIM) throw new Error('vectors.bin 与 vectors.json 长度不一致（请重跑 gen-vectors.mjs）')
    emit({ stage: 'ready', note: `语义就绪 · ${meta.count} 窗口 · ${_modelDev}` })
    return { vecs, count: meta.count, windows: meta.windows }
  })().catch((e) => { _ctx = null; throw e })
  return _ctx
}

/** 嵌入单个查询（加任务前缀，512 维，归一化）。 */
export async function embedQuery(text: string): Promise<Float32Array> {
  const model = await ensureModel()
  const out = await model(EMB_TASK + text, { pooling: 'mean', normalization: 'normalized', truncate: true })
  return new Float32Array(Array.from(out.data).slice(0, SEM_DIM))
}

/** 语义检索：嵌入查询 → 与全部窗口余弦 → 按章取最优 → top-K。 */
export async function semanticSearch(query: string, k: number, onStatus?: (s: SemStatus) => void): Promise<{ chapter: number; score: number; text: string }[]> {
  const ctx = await initSemantic(onStatus)
  const qv = await embedQuery(query)
  const { vecs, count, windows } = ctx
  // 暴力余弦（向量已归一化 → 点积即余弦）
  const scores = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const off = i * SEM_DIM
    let dot = 0
    for (let d = 0; d < SEM_DIM; d++) dot += qv[d] * vecs[off + d]
    scores[i] = dot
  }
  const order = Array.from({ length: count }, (_, i) => i)
  order.sort((a, b) => scores[b] - scores[a])
  // 扫描前若干窗口，聚合到「每章最优」，再取前 k 章
  const scan = Math.min(count, Math.max(k * 4, 48))
  const byChapter = new Map<number, { score: number; text: string }>()
  for (let j = 0; j < scan; j++) {
    const i = order[j]
    const c = windows[i][0]
    const cur = byChapter.get(c)
    if (!cur || scores[i] > cur.score) byChapter.set(c, { score: scores[i], text: windows[i][1] })
  }
  return [...byChapter.entries()]
    .map(([chapter, v]) => ({ chapter, score: v.score, text: v.text }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}
