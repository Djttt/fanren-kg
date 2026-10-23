// LLM Worker：在 Web Worker 里跑 Qwen3-0.6B 生成，避免主线程在长生成期间卡死（验收：长文档不冻 UI）。
// 库/运行时/模型全部走本地 public/；库来源由宿主(主线程)解析好后经消息注入，Worker 本身不决定来源。
declare const self: any

const LLM_MODEL = 'onnx-community/Qwen3-0.6B-ONNX' // 2026-10：onnx-community 仓库改名（原 Qwen3-0.6B）

let _model: Promise<any> | null = null
let _key = '' // device|ortBase|libUrl|allowRemote 组合，变化即重载

function applyEnv(T: any, ortBase: string, allowRemote: boolean, localModelPath: string) {
  const e = T.env
  if (!e) return
  e.allowRemoteModels = allowRemote
  e.allowLocalModels = true
  e.useBrowserCache = true
  try { e.localModelPath = localModelPath } catch {} // v4：模型 id 传「/ 换 -」的文件夹名，从此路径解析
  try {
    if (e.backends?.onnx?.wasm) {
      e.backends.onnx.wasm.wasmPaths = ortBase
      e.backends.onnx.wasm.numThreads = 1
    }
  } catch {}
}

async function ensureModel(opts: { device: string; libUrl: string; ortBase: string; allowRemote: boolean; localModelPath: string }) {
  const key = [opts.device, opts.ortBase, opts.libUrl, opts.allowRemote].join('|')
  if (_model && _key === key) return _model
  _model = null
  _key = key
  _model = (async () => {
    const w: any = globalThis
    const T =
      (w.transformers && w.transformers.pipeline)
        ? w.transformers
        : await import(/* @vite-ignore */ opts.libUrl)
    if (!T || !T.pipeline) throw new Error('Worker 内 Transformers.js 加载失败（确认 public/vendor/transformers.min.js 存在）')
    applyEnv(T, opts.ortBase, opts.allowRemote, opts.localModelPath)
    // Transformers.js v4：localModelPath 选项已不存在（env.localModelPath 已在上方指向 /models/）。
    // 离线模式传「/ 换 -」的 id（= public/models/ 下文件夹名）；远端回落模式用原始仓库 id。
    // 本地 q4f16 权重是自包含单文件，需关掉 config 里声明的 external data，否则库会去要不存在的 model.onnx_data。
    const modelId = opts.allowRemote ? LLM_MODEL : LLM_MODEL.split('/').join('-')
    const tryLoad = (device: string) => T.pipeline('text-generation', modelId, {
      device,
      ...(opts.allowRemote ? {} : { dtype: 'fp32', use_external_data_format: false }),
    })
    try {
      return await tryLoad(opts.device)
    } catch (e) {
      // WebGPU 存在但拿不到 adapter（驱动失败/无 GPU/浏览器限制）→ 回落 WASM 重试
      if (opts.device === 'webgpu' && /webgpu|GPU adapter|no available backend/i.test(String(e?.message || e))) {
        self.postMessage({ id: -1, note: 'WebGPU 不可用，回落 WASM' })
        return await tryLoad('wasm')
      }
      throw e
    }
  })().catch((e) => { _model = null; throw e })
  return _model
}

self.onmessage = async (ev: any) => {
  const { cmd, id } = ev.data || {}
  try {
    if (cmd === 'init') {
      const m = await ensureModel(ev.data)
      await m('你好', { max_new_tokens: 1 }) // 预热（触发权重解码/图编译）
      self.postMessage({ id, ok: true, device: ev.data.device })
    } else if (cmd === 'generate') {
      const m = await ensureModel(ev.data)
      const out = await m(ev.data.prompt, {
        max_new_tokens: ev.data.max_new_tokens ?? 150,
        do_sample: true,
        temperature: 0.7,
        top_k: 40,
        return_full_text: false,
      })
      const text = (Array.isArray(out) ? out[0]?.generated_text : out?.generated_text) || ''
      self.postMessage({ id, ok: true, text: String(text).trim() })
    }
  } catch (e: any) {
    self.postMessage({ id, ok: false, error: e?.message || String(e) })
  }
}
