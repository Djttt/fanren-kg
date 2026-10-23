# public/vendor

放置 Transformers.js 库本体，供完全离线加载（运行时优先 `fetch('/vendor/transformers.min.js')`）。

- 期望文件：`transformers.min.js`
- 来源：`node_modules/@huggingface/transformers/dist/transformers.min.js`
  （由 `scripts/download-models.mjs` 自动复制；手动则把 Transformers.js 浏览器版放此处并命名为 `transformers.min.js`）。

无网环境下，若此文件缺失，应用会回落 CDN 并在状态栏提示——因此离线部署必须保留该文件。
