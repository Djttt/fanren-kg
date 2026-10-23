# public/models

模型权重目录（`scripts/download-models.mjs` 自动填充，运行后生成 `manifest.md`）。

文件夹名 = 仓库 id 的「/」换成「-」（Transformers.js v3 `localModelPath` 约定）：

```
Xenova-bge-small-zh-v1.5/  {config.json, tokenizer.json, onnx/model.onnx}   嵌入（512 维，int8）
onnx-community-Qwen3-0.6B/ {config.json, tokenizer.json, onnx/model.onnx}   生成（q4f16）
```

运行时 `env.localModelPath = '/models/'`、`allowRemoteModels=false`，即从本地读权重，断网可用。
