// Transformers.js 加载与「完全离线」环境配置（主线程与 Worker 共用，无 DOM 依赖）。
// 模型 / 运行时 / 库本体全部走本地 public/：models 在 /models/，ORT wasm 在 /ort/，库在 /vendor/。
// 只有当本地运行时缺失时才回落 CDN（并提示），以保证无网部署可用。
import { asset } from './idb'

export type DevPref = 'auto' | 'webgpu' | 'wasm'

export const TJ_VERSION = '4.3.1' // 与 package.json 的 @huggingface/transformers 保持一致（vendor 库 + CDN 回落）
export const TJ_CDN = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TJ_VERSION}/dist/transformers.min.js`

/** 设备选择：WASM/CPU 为基线（兼容性最好），检测到 WebGPU 时可用它加速。 */
export function pickDevice(pref: DevPref = 'auto'): 'webgpu' | 'wasm' {
  const hasGPU = typeof navigator !== 'undefined' && !!(navigator as any).gpu
  if (pref === 'wasm') return 'wasm'
  if (pref === 'webgpu') return hasGPU ? 'webgpu' : 'wasm'
  return hasGPU ? 'webgpu' : 'wasm' // auto：有 GPU 用 GPU，否则 WASM
}

/** 本地是否已打包 Transformers.js 库（/vendor/transformers.min.js）。 */
export async function hasLocalLib(): Promise<boolean> {
  try {
    const res = await fetch(asset('vendor/transformers.min.js'), { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

/** 本地是否有 ORT wasm 运行时（/ort/ 目录下的 .wasm；v4 的 onnxruntime-web 文件名为 ort-wasm-simd-threaded.wasm）。 */
export async function hasLocalOrt(): Promise<boolean> {
  try {
    const res = await fetch(asset('ort/ort-wasm-simd-threaded.wasm'), { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

export interface TJEnv {
  allowRemoteModels: boolean
  allowLocalModels: boolean
  useBrowserCache: boolean
  localModelPath: string
  ortBase: string // ORT wasm 文件根目录（含尾/）
}

/** 依据本地运行时是否齐全计算 env：齐全→完全离线(allowRemoteModels=false)；否则回落 CDN(临时)。 */
export function computeEnv(hasLib: boolean, hasOrt: boolean): TJEnv {
  const local = hasLib && hasOrt
  const ortBase = local
    ? asset('ort') + '/'
    : `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TJ_VERSION}/onnx/`
  return {
    allowRemoteModels: !local,
    allowLocalModels: true,
    useBrowserCache: true,
    localModelPath: asset('models') + '/',
    ortBase,
  }
}

function applyEnv(T: any, env: TJEnv) {
  const e = T.env
  if (!e) return
  e.allowRemoteModels = env.allowRemoteModels
  e.allowLocalModels = env.allowLocalModels
  e.useBrowserCache = env.useBrowserCache
  try { e.localModelPath = env.localModelPath } catch {} // v4：模型 id 传「/ 换 -」的文件夹名，库从该路径解析本地模型
  try {
    if (e.backends?.onnx?.wasm) {
      e.backends.onnx.wasm.wasmPaths = env.ortBase
      e.backends.onnx.wasm.numThreads = 1 // 无 cross-origin isolation 时禁多线程，避免 SharedArrayBuffer 报错
    }
  } catch {}
}

/** 加载 Transformers.js（本地 vendor 优先，其次给定 URL），并配置 env。返回模块。 */
export async function loadTJ(libUrl: string, env: TJEnv): Promise<any> {
  const w: any = globalThis
  if (w.transformers && w.transformers.pipeline) {
    applyEnv(w.transformers, env)
    return w.transformers
  }
  // v4 的 dist/transformers.min.js 是 ES module（具名导出，不挂全局）：
  // 用 import() 的模块命名空间；兼容旧版 UMD（default 导出 / 全局变量）。
  const ns: any = await import(/* @vite-ignore */ libUrl)
  const T = ns?.default ?? ns
  if (T && T.pipeline) {
    applyEnv(T, env)
    return T
  }
  if (w.transformers && w.transformers.pipeline) {
    applyEnv(w.transformers, env)
    return w.transformers
  }
  throw new Error('Transformers.js 加载失败（模块命名空间与全局均未得到 pipeline；确认 public/vendor/transformers.min.js 存在）')
}
