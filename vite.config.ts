import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 适配：
//   项目站点 https://<user>.github.io/<repo>/  →  VITE_BASE=/<repo>/ npm run build
//   用户站点 https://<user>.github.io/          →  npm run build（默认 base '/'）
// base 同时注入 import.meta.env.BASE_URL，src/lib/idb.ts 的 asset() 会据此解析站内资源，
// 因此模型 / 运行时 / 向量等 public/ 资源无需逐个改路径。
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 5199, host: true },
  preview: { port: 4173, host: true },
})
