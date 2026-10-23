# GitHub Pages 部署版

本目录是 `site/` 的 GitHub Pages 适配版（代码相同，仅部署相关的三处差异）：

| 文件 | 差异 |
|---|---|
| `vite.config.ts` | 新增 `base: process.env.VITE_BASE \|\| '/'`，所有站内资源路径（`asset()` 读 `BASE_URL`）自动适配子路径 |
| `scripts/gen-ssg.mjs` | 实体页「返回图谱」链接由 `href="/"` 改为相对 `href="../"`（在 `/` 与 `/repo/` 下都正确） |
| `.github/workflows/deploy-pages.yml` | 自动判断站点类型（`user.github.io` → base `/`；项目站点 → base `/repo/`），构建 `dist/` 并部署 |

其余（模型、ORT 运行时、向量、SSG 实体页、Worker）与原项目完全一致，部署后**完全离线可用**（无需任何后端）。

## 方式 A：GitHub Actions 自动部署（推荐）

1. 新建仓库（例如 `fanren-kg`），把**本目录内容**推上去：

   ```bash
   cd site-ghpages
   git lfs install                          # 一次性；.onnx 模型文件走 LFS
   git init && git add -A && git commit -m "deploy: GitHub Pages version"
   git branch -M main
   git remote add origin git@github.com:<你>/fanren-kg.git
   git push -u origin main                  # LFS 对象随 push 一并上传
   ```

2. 仓库 **Settings → Pages**：Source 保持 “GitHub Actions”（workflow 会自动触发构建+部署）。
3. 首次构建约 10–15 分钟（仓库含 ~700MB 模型文件，checkout 较慢）。
4. 完成后访问：
   - 项目站点：`https://<你>.github.io/fanren-kg/`
   - 若仓库名是 `<你>.github.io`（用户站点）：`https://<你>.github.io/`

## 方式 B：本地构建后手动上传

```bash
npm install
VITE_BASE=/fanren-kg/ npm run build   # 仓库名换你的；用户站点省略 VITE_BASE
# 产物在 dist/，整目录上传到仓库的 gh-pages 分支（仓库根 = 站点根）
```

本地自测（base 生效后的预览）：

```bash
VITE_BASE=/fanren-kg/ npm run build
npm run preview        # 访问 http://localhost:4173/fanren-kg/
```

## 已知限制

- **大文件（Git LFS）**：两个 `.onnx` 模型（Qwen3-0.6B 约 543MB、bge-small-zh-v1.5 约 24MB）
  通过 **Git LFS** 存储（规则见 `.gitattributes` 的 `*.onnx`），避免触发 GitHub 100MB 大文件保护。
  - 克隆/拉取需要在本机安装 git-lfs（`git lfs install`，一次性）。
  - CI 的 `actions/checkout` 默认**不拉取** LFS 对象（`lfs` 输入默认 `false`，会留下 134 字节指针文件）；
    workflow 里已显式配置 `lfs: true`，构建产物里才是真实模型文件。
    Pages 部署走 **Actions 工件**（`upload-pages-artifact` + `deploy-pages`），伺服的是真实文件而非 LFS 指针。
  - GitHub LFS 免费额度：1GB 存储 + 1GB 下载带宽；当前 LFS 占用约 0.57GB，够用。
  - 若将来把部署方式改成"dist/ 直接推分支"，必须让分支里是真实文件，
    LFS 指针会导致模型 404（分支模式下 Pages 只伺服 git 仓库内的原始文件）。
- 若将来想给仓库瘦身：把 `public/models/`、`public/ort/`、`public/vectors.*` 移出仓库，
  改为部署后从发布附件下载放入（站点缺模型时会自动回落到关键词检索，不会白屏）。
