# 完全离线 RAG — 部署与验收

目标：把《凡人修仙传》全文检索做成 **纯浏览器、完全离线** 的轻量 RAG：
- 生成模型 `Qwen3-0.6B`（onnx，q4f16）
- 嵌入模型 `BGE-Small-ZH-v1.5`（512 维）
- 运行时 Transformers.js，**WASM/CPU 为基线**，检测到 WebGPU 时自动用它加速
- 模型/运行时/库本体全部打进 `public/`，`allowRemoteModels=false`，**无网可运行**
- IndexedDB 持久化 + Web Worker 生成，长文档不冻 UI

## 一、在能联网的机器上准备（一次性）

```bash
cd site
npm install @huggingface/transformers   # 装运行时（库本体 + ORT wasm 来源）
node scripts/download-models.mjs          # 下载模型 + 复制库/ORT → public/{models,vendor,ort}
node scripts/gen-vectors.mjs              # 用同一嵌入模型离线预计算语料向量 → public/vectors.{bin,json}
npm run build && npm run preview          # 打包并本地预览
```

> 国内访问 HF 受限：`HF_SOURCE=mirror node scripts/download-models.mjs`（走 hf-mirror.com）。
> 若仓库名有变：`EMB_REPO=<仓库> LLM_REPO=<仓库> node scripts/download-models.mjs`。
> 生成模型量化可改：默认取 `onnx/model_q4f16.onnx`，缺失时自动回退 `model_q8.onnx` / `model.onnx`。

产物布局（`scripts/download-models.mjs` 会生成 `public/models/manifest.md` 列出实际文件）：

```
public/vendor/transformers.min.js      Transformers.js 库本体
public/ort/ort-wasm*.wasm[.js]         ONNX Runtime Web wasm 运行时
public/models/Xenova-bge-small-zh-v1.5/{config.json,tokenizer.json,onnx/model.onnx}   嵌入（512 维）
public/models/onnx-community-Qwen3-0.6B/{config.json,tokenizer.json,onnx/model.onnx}  生成（q4f16）
public/corpus.json    1631 章正文（关键词检索 + 章节标题 + 引用上下文）
public/vectors.json   语料窗口向量元数据（含窗口文本）
public/vectors.bin    语料窗口向量（Float32 原始字节，512 维）
```

## 二、离线验收（8 项）

把 `dist/`（含上述 `public/` 文件）整目录拷到**无网**机器，用静态服务起起来（或 `python3 -m http.server`），逐项核对：

1. **离线能打开**：断开网络 / 无痕模式 + 禁网，页面与图谱正常加载。
2. **嵌入模型离线加载**：进「全文检索」，状态栏显示「语义就绪 · N 窗口」，不再出现任何 `huggingface.co` / `jsdelivr` 请求。
3. **生成模型离线加载**：开「AI 生成」，状态显示「LLM 就绪 · wasm/webgpu」，无网络模型请求。
4. **Network 无模型请求**：全程只有本地 `/models/ /vendor/ /ort/ /corpus.json /vectors.*`，无任何外部模型/运行时请求。
5. **知识库持久化**：刷新页面后无需重新下载（IndexedDB 命中），检索立即可用。
6. **结果显示来源+文本**：每条结果有「第X章 标题 + 关键词/语义」徽标 + 命中片段；AI 答案带（第X章）引用，且下方恒显示检索依据（即使模型答非所问）。
7. **长文档不冻 UI**：检索/生成期间页面仍可交互（生成在 Web Worker 内跑，主线程只更新进度）。
8. **出错有明确提示**：模型/运行时缺失时，状态栏给出「缺 public/…（请先在联网机运行 download-models.mjs / gen-vectors.mjs）」之类可读错误，并自动回落关键词检索，不白屏。

## 三、常见问题

- **提示缺 `vectors.bin`**：先在有网机跑 `node scripts/gen-vectors.mjs`。
- **WASM 生成很慢**：属正常（0.6B 在 CPU）。右上设备选 `WebGPU`（若浏览器支持）可显著加速；`WASM` 为兼容基线。
- **`allowRemoteModels=false` 报错**：说明本地 `public/vendor` 或 `public/ort` 未备齐，回到第一步补齐。
- **换更大的模型**：改 `src/lib/semantic.ts` 的 `SEM_MODEL`、`src/workers/llm.worker.ts` 的 `LLM_REPO/LLM_MODEL`，并同步 `scripts/download-models.mjs`、`scripts/gen-vectors.mjs` 与 `public/models/` 布局。
