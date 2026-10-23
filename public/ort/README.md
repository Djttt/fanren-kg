# public/ort

放置 ONNX Runtime Web 的 wasm 运行时，供 `env.backends.onnx.wasm.wasmPaths = '/ort/'` 离线加载。

- 期望文件（`scripts/download-models.mjs` 会自动从 npm 包复制，或从 jsdelivr 下载）：
  - `ort-wasm-simd-release.wasm` / `ort-wasm-simd-release.wasm.js`
  - `ort-wasm-simd-threaded-release.wasm` / `ort-wasm-simd-threaded-release.wasm.js`
- 运行时 `numThreads=1`（默认走非线程版，避免无 cross-origin-headers 时 SharedArrayBuffer 报错）。

无网环境下，若此目录缺失，应用会回落 CDN 并在状态栏提示。
