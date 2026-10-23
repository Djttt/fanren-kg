// 语料向量预计算（一次性，需联网机器）：把 corpus.json 的每章切成「滑动窗口」，用 BGE-Small-ZH(512 维) 向量化。
// 输出 public/vectors.bin（Float32 原始字节）+ public/vectors.json（窗口元数据，含窗口文本）。
// 浏览器端只需本地嵌入「查询」再与这里的向量做余弦 → 无需在浏览器跑全库嵌入。
//
// 用法（在 site/ 下，需能访问 npm 与 HuggingFace）：
//   npm install @huggingface/transformers
//   node scripts/download-models.mjs     # 先下载模型（推荐；gen-vectors 优先用本地权重，保证与浏览器一致）
//   node scripts/gen-vectors.mjs
// 环境变量：HF_SOURCE=hub|mirror（仅当本地无模型时从哪下载，默认 hub；国内用 mirror）
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CORPUS = join(root, 'public/corpus.json')
const BIN = join(root, 'public/vectors.bin')
const META = join(root, 'public/vectors.json')

const MODEL = 'Xenova/bge-small-zh-v1.5' // 多语(含中文) · 512 维
const DIM = 512
const EMB_TASK = '为这个句子生成表示以用于检索相关文章：' // 必须与 src/lib/semantic.ts 的 EMB_TASK 一致
const WIN = 320 // 滑动窗口目标长度（~2-3 句；BGE-small 上限 512 token，窗口可完整嵌入）
const OVERLAP = 50 // 相邻窗口重叠，避免在句/词中间硬切
const BATCH = 64
const LOCAL_DIR = join(root, 'public', 'models', MODEL.split('/').join('-')) // 本地模型目录（= download-models.mjs 的 EMB_SLUG）
const HF_SOURCE = process.env.HF_SOURCE || 'hub'

async function main() {
  if (!existsSync(CORPUS)) { console.error('缺 public/corpus.json，先跑: node scripts/gen-corpus.mjs'); process.exit(1) }
  const chapters = JSON.parse(readFileSync(CORPUS, 'utf-8'))

  // 句界收口的滑动窗口
  function windowsOf(text) {
    const sents = text.split(/(?<=[。！？!?])/).filter(Boolean)
    const wins = []
    let buf = ''
    for (const s of sents) {
      buf += s
      if (buf.length >= WIN) {
        wins.push(buf.trim())
        buf = buf.slice(-OVERLAP) // 保留尾部作下一窗口重叠
      }
    }
    if (buf.trim().length >= 12) wins.push(buf.trim())
    return wins
  }

  const windows = []
  for (const c of chapters) for (const t of windowsOf(c.text)) windows.push([c.chapter, t])
  console.log(`切分完成：${windows.length} 个窗口（${chapters.length} 章）`)

  // 载入嵌入模型：优先用本地权重（与浏览器查询嵌入同一份，保证向量同空间）
  // Transformers.js v4：localModelPath 选项已不存在 ——
  //   本地 → 本地目录直接作为模型参数；镜像 → env.remoteHost（库按 {model}/resolve/{revision}/ 从该域名取文件）。
  const hasLocal = existsSync(join(LOCAL_DIR, 'onnx', 'model.onnx'))
  const { pipeline, env } = await import('@huggingface/transformers')
  env.allowLocalModels = true
  let modelId, dtype, src
  if (hasLocal) { modelId = LOCAL_DIR; dtype = 'fp32'; src = '本地 ' + LOCAL_DIR }
  else if (HF_SOURCE === 'local') { console.error('HF_SOURCE=local 但缺本地模型，先跑 download-models.mjs'); process.exit(1) }
  else if (HF_SOURCE === 'mirror') { env.remoteHost = 'https://hf-mirror.com/'; modelId = MODEL; dtype = 'q8'; src = 'mirror · hf-mirror.com' }
  else { modelId = MODEL; dtype = 'q8'; src = 'hub · huggingface.co' }

  console.log(`加载模型 ${MODEL}（来源: ${src}）…`)
  const model = await pipeline('feature-extraction', modelId, { dtype })
  await model(EMB_TASK + 'warmup', { pooling: 'mean', normalization: 'normalized', truncate: true })

  const vecs = new Float32Array(windows.length * DIM)
  const t0 = Date.now()
  for (let i = 0; i < windows.length; i += BATCH) {
    const slice = windows.slice(i, i + BATCH)
    const out = await model(slice.map((w) => EMB_TASK + w[1]), { pooling: 'mean', normalization: 'normalized', batching: true, truncate: true })
    const arr = Array.isArray(out) ? out : [out]
    arr.forEach((t, j) => vecs.set(Array.from(t.data).slice(0, DIM), (i + j) * DIM))
    if (i % (BATCH * 8) === 0) console.log(`  嵌入 ${Math.min(i + BATCH, windows.length)}/${windows.length} 窗口 · ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  }

  writeFileSync(BIN, Buffer.from(vecs.buffer, vecs.byteOffset, vecs.byteLength))
  writeFileSync(META, JSON.stringify({ model: MODEL, dims: DIM, count: windows.length, windows }), 'utf-8')
  console.log(`\n完成 → vectors.bin (${(vecs.byteLength / 1048576).toFixed(1)} MB) + vectors.json`)
  console.log(`  ${windows.length} 窗口 · ${DIM} 维 · 耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  console.log('  浏览器端即可用「语义检索」（查询在浏览器内本地嵌入，与上面向量余弦）。')
}
main().catch((e) => { console.error('生成失败:', e.message || e); console.error('（确认已 npm install @huggingface/transformers 且可访问 huggingface.co / 本地模型已就位）'); process.exit(1) })
