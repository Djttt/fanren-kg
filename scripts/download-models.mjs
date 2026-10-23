// 一次性在「能联网的机器」上运行：把完全离线 RAG 需要的全部文件放进 public/，
// 之后即可把整个构建产物（含 public/ 的 models/ vendor/ ort/）拷到无网机器纯离线运行。
//
// 用法（在 site/ 下，先装好 Transformers.js 运行时）：
//   npm install @huggingface/transformers
//   node scripts/download-models.mjs
//
// 可用环境变量覆盖（应对 HF 访问受限 / 仓库改名）：
//   HF_SOURCE=hub|mirror    模型来源（默认 hub；国内用 mirror 走 hf-mirror.com）
//   EMB_REPO=...            嵌入模型仓库（默认 Xenova/bge-small-zh-v1.5）
//   LLM_REPO=...            生成模型仓库（默认 onnx-community/Qwen3-0.6B）
// 产物布局（运行时期望）。注意：文件夹名 = 模型仓库 id 的「/」换成「-」（Transformers.js v3 本地模型约定）：
//   public/vendor/transformers.min.js      Transformers.js 库本体
//   public/ort/ort-wasm*.wasm[.js]         ONNX Runtime Web wasm 运行时
//   public/models/Xenova-bge-small-zh-v1.5/{config.json,tokenizer.json,onnx/model.onnx}
//   public/models/onnx-community-Qwen3-0.6B/{config.json,tokenizer.json,onnx/model.onnx}
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(root, 'public')
const EMB_REPO = process.env.EMB_REPO || 'Xenova/bge-small-zh-v1.5'
const LLM_REPO = process.env.LLM_REPO || 'onnx-community/Qwen3-0.6B-ONNX'
// 本地模型文件夹名 = 仓库 id 的「/」换成「-」（Transformers.js v3 的 localModelPath 约定）
const EMB_SLUG = EMB_REPO.split('/').join('-')   // Xenova-bge-small-zh-v1.5
const LLM_SLUG = LLM_REPO.split('/').join('-')   // onnx-community-Qwen3-0.6B
const HF_BASE = (process.env.HF_SOURCE === 'mirror') ? 'https://hf-mirror.com' : 'https://huggingface.co'
const tfDir = join(root, 'node_modules', '@huggingface', 'transformers')

const log = (...a) => console.log(...a)
const ensureDir = (p) => mkdirSync(p, { recursive: true })

async function dl(url, dest) {
  ensureDir(dirname(dest))
  log(`  ↓ ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}  ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(dest, buf)
  log(`        → ${(buf.length / 1048576).toFixed(2)} MB`)
  return buf.length
}
async function dlOpt(url, dest) {
  try { await dl(url, dest) } catch (e) { log(`    （跳过 ${url.split('/').pop()}：${e.message}）`) }
}
function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.git')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
function findOrt() {
  const roots = [tfDir, join(root, 'node_modules', 'onnxruntime-web')]
  const all = roots.flatMap((r) => walk(r))
  return all.filter((p) => /ort-wasm.*\.(wasm(\.js)?|mjs)$/.test(p.split('/').pop() || ''))
}
function getOrtVersion() {
  const candidates = [
    join(root, 'node_modules', '@huggingface', 'transformers', 'node_modules', 'onnxruntime-web', 'package.json'),
    join(root, 'node_modules', 'onnxruntime-web', 'package.json'),
  ]
  for (const c of candidates) {
    try { if (existsSync(c)) return JSON.parse(readFileSync(c, 'utf-8')).version } catch {}
  }
  return '1.19.2' // 兜底版本（可按实际 onnxruntime-web 版本调整）
}

async function main() {
  log(`=== 0/4 模型来源：${HF_BASE} ===`)
  log(`    嵌入模型 EMB_REPO=${EMB_REPO}`)
  log(`    生成模型 LLM_REPO=${LLM_REPO}\n`)

  // 1) 库本体 + ORT 运行时（优先从已安装的 npm 包里复制，保证版本一致）
  log('=== 1/4 从 node_modules 复制 Transformers.js 库 + ORT 运行时 ===')
  if (!existsSync(tfDir)) {
    log('  ✗ 未找到 node_modules/@huggingface/transformers → 先运行: npm install @huggingface/transformers')
    process.exit(1)
  }
  const libCandidates = [
    join(tfDir, 'dist', 'transformers.min.js'),
    join(tfDir, 'dist', 'transformers.js'),
  ]
  const lib = libCandidates.find((p) => existsSync(p))
  if (lib) {
    ensureDir(join(PUB, 'vendor'))
    copyFileSync(lib, join(PUB, 'vendor', 'transformers.min.js'))
    log(`  库 → public/vendor/transformers.min.js（来自 ${lib}）`)
  } else {
    log('  ! 包内未找到 dist/transformers.min.js；请手动把 Transformers.js 浏览器版放到 public/vendor/transformers.min.js')
  }
  const ortFiles = findOrt() // 含 .wasm 与 .mjs（WebGPU 后端动态导入 ort-wasm-simd-threaded.asyncify.mjs，缺一不可）
  if (ortFiles.length) {
    ensureDir(join(PUB, 'ort'))
    for (const f of ortFiles) {
      const name = f.split('/').pop()
      copyFileSync(f, join(PUB, 'ort', name))
      log(`  ORT → public/ort/${name}`)
    }
  } else {
    log('  包内未找到 ORT wasm → 从 CDN 下载（需联网）…')
    const ortVer = getOrtVersion()
    const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVer}/dist/`
    for (const f of ['ort-wasm-simd-release.wasm', 'ort-wasm-simd-release.wasm.js', 'ort-wasm-simd-threaded-release.wasm', 'ort-wasm-simd-threaded-release.wasm.js']) {
      await dlOpt(base + f, join(PUB, 'ort', f))
    }
  }

  // 2) 嵌入模型（BGE-Small-ZH，512 维）
  const embDir = join(PUB, 'models', EMB_SLUG)
  log(`\n=== 2/4 下载嵌入模型 ${EMB_REPO} ===`)
  await dl(`${HF_BASE}/${EMB_REPO}/resolve/main/onnx/model_quantized.onnx`, join(embDir, 'onnx', 'model.onnx'))
    .catch(() => dl(`${HF_BASE}/${EMB_REPO}/resolve/main/onnx/model.onnx`, join(embDir, 'onnx', 'model.onnx')))
  await dl(`${HF_BASE}/${EMB_REPO}/resolve/main/config.json`, join(embDir, 'config.json'))
  await dl(`${HF_BASE}/${EMB_REPO}/resolve/main/tokenizer.json`, join(embDir, 'tokenizer.json'))
  await dlOpt(`${HF_BASE}/${EMB_REPO}/resolve/main/tokenizer_config.json`, join(embDir, 'tokenizer_config.json'))
  await dlOpt(`${HF_BASE}/${EMB_REPO}/resolve/main/special_tokens_map.json`, join(embDir, 'special_tokens_map.json'))

  // 3) 生成模型（Qwen3-0.6B，q4f16 优先，逐级回退）
  const llmDir = join(PUB, 'models', LLM_SLUG)
  log(`\n=== 3/4 下载生成模型 ${LLM_REPO} ===`)
  const llmWeights = ['onnx/model_q4f16.onnx', 'onnx/model_q8.onnx', 'onnx/model.onnx']
  let picked = null
  for (const w of llmWeights) {
    try { await dl(`${HF_BASE}/${LLM_REPO}/resolve/main/${w}`, join(llmDir, 'onnx', 'model.onnx')); picked = w; break } catch {}
  }
  if (!picked) throw new Error(`未能从 ${LLM_REPO} 下载模型权重（尝试过 ${llmWeights.join(' / ')}）；请确认仓库名或改用 EMB_REPO/LLM_REPO 环境变量指定`)
  log(`  生成模型权重：使用 ${picked}`)
  await dl(`${HF_BASE}/${LLM_REPO}/resolve/main/config.json`, join(llmDir, 'config.json'))
  await dl(`${HF_BASE}/${LLM_REPO}/resolve/main/tokenizer.json`, join(llmDir, 'tokenizer.json'))
  await dlOpt(`${HF_BASE}/${LLM_REPO}/resolve/main/tokenizer_config.json`, join(llmDir, 'tokenizer_config.json'))
  await dlOpt(`${HF_BASE}/${LLM_REPO}/resolve/main/special_tokens_map.json`, join(llmDir, 'special_tokens_map.json'))
  await dlOpt(`${HF_BASE}/${LLM_REPO}/resolve/main/generation_config.json`, join(llmDir, 'generation_config.json'))

  // 4) 汇总清单
  log('\n=== 4/4 生成清单 ===')
  const lines = ['# public/models 与运行时清单', '', `生成时间：${new Date().toISOString()}`, '',
    `模型来源：${HF_BASE}`, `嵌入模型：${EMB_REPO}`, `生成模型：${LLM_REPO}（权重 ${picked}）`, '']
  for (const f of findOrt().length ? [] : []) {} // no-op
  const summary = (dir) => walk(dir).map((p) => `  - ${p.split('public/')[1] || p}`).sort()
  lines.push('public/vendor/', ...(existsSync(join(PUB, 'vendor')) ? summary(join(PUB, 'vendor')) : ['  （空）']), '')
  lines.push('public/ort/', ...(existsSync(join(PUB, 'ort')) ? summary(join(PUB, 'ort')) : ['  （空）']), '')
  lines.push('public/models/', ...(existsSync(join(PUB, 'models')) ? summary(join(PUB, 'models')) : ['  （空）']), '')
  writeFileSync(join(PUB, 'models', 'manifest.md'), lines.join('\n') + '\n', 'utf-8')
  log('  已写入 public/models/manifest.md')
  log('\n完成。下一步：')
  log('  node scripts/gen-vectors.mjs   # 用同一嵌入模型离线预计算语料向量（需联网）')
  log('  npm run build && npm run preview   # 打包后按 docs/offline-checklist.md 验收离线 8 项')
}

main().catch((e) => {
  console.error('\n下载失败:', e.message || e)
  console.error('（确认已 npm install @huggingface/transformers 且可访问 huggingface.co；国内可设 HF_SOURCE=mirror）')
  process.exit(1)
})
