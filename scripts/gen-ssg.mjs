// SSG 百科详情页生成器 v3：读取合并后的图谱数据，为每个实体生成静态 wiki 页
// 视觉统一：宣纸水墨（与前端 src/styles.css 知识图谱完全一致）
//   · 宣纸底 / 墨字 / 朱砂只用于「印」/ 黛蓝题字 / 国画颜料色编码实体类型
//   · 类型色与印章字符对齐 src/data/graph.ts 的 TYPE_META
//   · 关系区复用前端「关系时间线」样式（.tl-item 彩色圆点）
// 用法: node scripts/gen-ssg.mjs   （输出到 dist/entities/，不依赖 vite build 产物）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src/data/extraction.json')
const outDir = join(root, 'dist/entities')

// 类型元数据：与前端 src/data/graph.ts 的 TYPE_META 保持一致（色 / 印 / 名）
const TYPE_META = {
  character: { label: '人物', color: '#b23b2c', seal: '人' },
  faction:   { label: '势力', color: '#3a557d', seal: '门' },
  location:  { label: '地点', color: '#4d7a6a', seal: '地' },
  treasure:  { label: '法宝', color: '#a98545', seal: '宝' },
  pill:      { label: '丹药', color: '#b56a86', seal: '丹' },
  beast:     { label: '灵兽', color: '#527ea8', seal: '灵' },
  formation: { label: '阵法', color: '#5a5f9e', seal: '阵' },
  technique: { label: '功法', color: '#8a5a9e', seal: '功' },
  event:     { label: '事件', color: '#6b7280', seal: '事' },
}
const REL_LABEL = {
  master_of: '师徒', friend_of: '好友', enemy_of: '敌对', family_of: '血亲', in_law_of: '姻亲',
  member_of: '从属', affiliated_with: '分属', founded_by: '创立', located_in: '位于', owns: '所有',
  practices: '修炼', found: '拾获', rescued: '救', named: '命名', arranged: '安排', other: '其他',
}
const ATTR_LABEL = { appearance: '登场方式', sex: '性别', age: '年龄', role: '身份', status: '状态', kind: '类别', subtype: '细分' }

const d = JSON.parse(readFileSync(src, 'utf-8'))
const meta = d.meta || {}
const ents = new Map()
const edges = []
const chapters = d.chapters || []
for (const ch of chapters) {
  for (const e of ch.entities || []) if (!ents.has(e.id)) ents.set(e.id, { ...e })
  for (const r of ch.relations || []) edges.push(r)
}
const byId = ents
const nameOf = (id) => byId.get(id)?.name || id

// ---------- 节点指标 ----------
const adj = {}       // id -> Set(邻居)
const relCnt = {}    // id -> 关系实例数（含跨章重复证据）
const active = {}    // id -> Set(章号)：实体定义章 + reappears 章 + 关系证据章
const touch = (id, ch) => { (active[id] ||= new Set()).add(ch) }
for (const ch of chapters) {
  for (const e of ch.entities || []) touch(e.id, ch.chapter)
  for (const id of ch.reappears || []) touch(id, ch.chapter)
  for (const r of ch.relations || []) {
    (adj[r.from] ||= new Set()).add(r.to);
    (adj[r.to] ||= new Set()).add(r.from);
    relCnt[r.from] = (relCnt[r.from] || 0) + 1
    relCnt[r.to] = (relCnt[r.to] || 0) + 1
    touch(r.from, ch.chapter)
    touch(r.to, ch.chapter)
  }
}
const stat = {}
for (const [id, e] of ents) {
  const deg = adj[id]?.size || 0
  const rc = relCnt[id] || 0
  const chs = active[id] ? [...active[id]] : [e.first_seen_chapter]
  stat[id] = {
    deg, rc,
    span: chs.length,
    firstSeen: e.first_seen_chapter,
    lastSeen: Math.max(...chs),
  }
}
const mx = {
  deg: Math.max(1, ...Object.values(stat).map((s) => s.deg)),
  rc: Math.max(1, ...Object.values(stat).map((s) => s.rc)),
  span: Math.max(1, ...Object.values(stat).map((s) => s.span)),
}
// 重要性 = 45% 关系度 + 25% 关系实例 + 30% 活跃章数（各归一化到 0-100 后加权）
for (const id in stat) {
  const s = stat[id]
  s.score = Math.round(100 * (0.45 * s.deg / mx.deg + 0.25 * s.rc / mx.rc + 0.3 * s.span / mx.span))
}
// 类型内排名（按重要性）
const rankOf = {}
for (const t of Object.keys(TYPE_META)) {
  const ids = [...ents.values()].filter((e) => e.type === t).map((e) => e.id)
  ids.sort((a, b) => stat[b].score - stat[a].score || stat[b].deg - stat[a].deg || a.localeCompare(b, 'zh-Hans-CN'))
  ids.forEach((id, i) => (rankOf[id] = i + 1))
}
const totalOf = (t) => [...ents.values()].filter((e) => e.type === t).length

// ---------- 输出 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const CSS = `
:root{
  --paper:#f2efe8;--paper-2:#f7f4ec;--paper-3:#eae5d8;
  --ink:#22252b;--ink-70:rgba(34,37,43,.7);--ink-40:rgba(34,37,43,.4);
  --line:rgba(34,37,43,.14);--line-2:rgba(34,37,43,.22);
  --zhu:#b23b2c;--zhu-ink:#9c2f22;--dai:#3a557d;--dim:#8a8f99;
  --serif:"Songti SC","STSong","Noto Serif SC","SimSun",serif;
  --sans:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0}
body{
  background:
    radial-gradient(1100px 700px at 78% -8%,rgba(122,116,98,.10),transparent 62%),
    radial-gradient(900px 640px at 12% 108%,rgba(92,104,128,.08),transparent 60%),
    var(--paper);
  color:var(--ink);font-family:var(--sans);line-height:1.7;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:880px;margin:0 auto;padding:6px 24px 56px}
/* 顶部题签：朱印 + 书体题字 + 黛蓝题签 */
nav.top{display:flex;justify-content:space-between;align-items:center;padding:18px 0 14px;border-bottom:1px solid var(--line-2);margin-bottom:30px;font-size:13px}
.brand{display:flex;align-items:center;gap:11px}
.seal{display:grid;place-items:center;width:38px;height:38px;flex-shrink:0;background:var(--zhu);color:#f7f2ea;font-family:var(--serif);font-size:20px;border-radius:3px;box-shadow:inset 0 0 0 1.5px rgba(247,242,234,.35)}
.brand .t{font-family:var(--serif);font-size:16px;letter-spacing:4px;color:var(--ink)}
.brand .s{font-family:var(--serif);font-size:11px;letter-spacing:3px;color:var(--dai)}
nav.top a{color:var(--dai);text-decoration:none;margin-left:14px;font-size:12.5px;border-bottom:1px solid rgba(58,85,125,.35)}
nav.top a:hover{border-bottom-color:var(--dai)}
/* 条目头：朱印 + 类型 + 大字名 */
.entry{padding-top:6px}
.type-row{display:flex;align-items:center;gap:10px}
.type-seal{display:grid;place-items:center;width:34px;height:34px;flex-shrink:0;background:var(--zhu);color:#f7f2ea;font-family:var(--serif);font-size:16px;border-radius:3px}
.type-label{font-size:12px;letter-spacing:3px;color:var(--dai)}
h1{margin:12px 0 4px;font-family:var(--serif);font-weight:600;font-size:34px;letter-spacing:2px;color:var(--ink);line-height:1.3}
.chip-row{margin:12px 0 2px}
.chip{display:inline-block;font-size:11.5px;color:var(--dai);border:1px solid var(--line-2);border-radius:2px;padding:2px 9px;margin:2px 6px 0 0}
.chip.gold{color:var(--zhu-ink);border-color:rgba(178,59,44,.35);background:rgba(178,59,44,.06)}
.alias-row{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 4px}
.alias{font-size:12px;color:#5c6470;border:1px dashed var(--line-2);padding:2px 8px;border-radius:2px}
.kv{margin:16px 0 4px}
.kv-row{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:7px 0;border-bottom:1px dashed var(--line)}
.kv-row span:first-child{color:var(--dai);flex-shrink:0}
.kv-row span:last-child{text-align:right;color:var(--ink)}
.notes{font-size:14px;line-height:1.85;color:#3a3f47;margin:14px 0 4px}
.dim{color:var(--dim);font-size:12px;line-height:1.7}
/* 小节标题：朱砂点 + 黛蓝字 */
.sec-title{margin:28px 0 14px;font-size:13px;color:var(--dai);font-weight:500;letter-spacing:1px;display:flex;align-items:center;gap:9px}
.sec-title::before{content:'';width:8px;height:8px;background:var(--zhu);border-radius:1px;display:inline-block;flex-shrink:0}
/* 关系时间线（与前端 .tl-item 一致） */
.tl-item{border-left:1.5px solid rgba(34,37,43,.24);margin:0 0 14px 5px;padding:2px 0 2px 15px;position:relative}
.tl-item::before{content:'';position:absolute;left:-4.5px;top:5px;width:8px;height:8px;border-radius:50%;background:var(--tl-dot,#6b7280)}
.tl-head{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}
.tl-ch{color:#5c6470;font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums}
.tl-more{color:var(--dim);font-size:10.5px}
.tl-chaps{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.tl-chap{font-style:normal;font-size:10.5px;background:#efece2;border:1px solid var(--line);border-radius:2px;padding:1px 6px;color:#6a7280;font-variant-numeric:tabular-nums}
.tl-type{flex-shrink:0;font-size:11px;color:#5c6470;border:1px solid var(--line-2);padding:1px 7px;border-radius:2px}
.tl-dir{color:var(--dim);font-size:11px}
.tl-name{font-weight:500}
.tl-name a{color:inherit;text-decoration:none}
.tl-name a:hover{text-decoration:underline}
.tl-note{margin-top:5px;font-size:11.5px;color:var(--dim);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* 总览页 */
.idx h1{font-size:26px}
.sortbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:2px 0 22px;font-size:12.5px;color:var(--dim)}
.sortbar label{display:flex;align-items:center;gap:8px}
.sortbar select{background:var(--paper-2);color:var(--ink);border:1px solid var(--line-2);border-radius:3px;padding:5px 10px;font-size:12.5px;cursor:pointer;font-family:var(--sans)}
.trunc-note{font-size:12.5px;color:var(--dim);margin:0 0 16px;line-height:1.6}
.trunc-note b{color:var(--zhu-ink);font-weight:600}
section.sec{margin:0 0 34px}
.cards{display:block}
.card{display:inline-block;width:calc(25% - 12px);margin:6px;padding:12px;position:relative;border:1px solid var(--line-2);border-radius:4px;text-decoration:none;color:inherit;vertical-align:top;background:var(--paper-2);transition:border-color .15s,box-shadow .15s}
.card:hover{border-color:rgba(178,59,44,.5);box-shadow:0 2px 10px rgba(146,134,104,.18)}
.card b{font-size:14px;display:block;margin-bottom:5px;padding-right:30px;font-family:var(--serif)}
.card i{font-style:normal;font-size:11px;color:var(--dim);line-height:1.5}
.card .rank{position:absolute;top:8px;right:10px;font-size:10.5px;color:var(--dim);font-family:ui-monospace,monospace}
.card .tt{font-size:10px;border:1px solid currentColor;border-radius:3px;padding:0 4px;margin-left:6px;opacity:.72;vertical-align:2px}
/* 分类导航条 */
.tnav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 20px;padding-bottom:14px;border-bottom:1px solid var(--line-2)}
.tn{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink-70);text-decoration:none;border:1px solid var(--line-2);border-radius:3px;padding:5px 11px;transition:border-color .15s,background .15s,color .15s}
.tn:hover{border-color:var(--dai);color:var(--ink)}
.tn.on{border-color:var(--zhu);color:var(--zhu-ink);background:rgba(178,59,44,.06)}
.tn .dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
/* 入口 hub · 分类瓦片 */
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin-top:10px}
.tile{display:block;border:1px solid var(--line-2);border-left-width:3px;border-radius:5px;padding:14px 14px 13px;text-decoration:none;color:inherit;background:var(--paper-2);transition:border-color .15s,box-shadow .15s,transform .15s}
.tile:hover{box-shadow:0 3px 14px rgba(146,134,104,.22);transform:translateY(-1px)}
.tile .trow{display:flex;align-items:center;gap:10px}
.tile .tseal{width:30px;height:30px;display:grid;place-items:center;background:var(--zhu);color:#f7f2ea;font-family:var(--serif);font-size:15px;border-radius:3px;flex-shrink:0}
.tile .tname{font-family:var(--serif);font-size:17px;letter-spacing:2px;color:var(--ink)}
.tile .tcount{font-size:11.5px;color:var(--dim);margin:11px 0 8px}
.tile .ttops{display:flex;flex-wrap:wrap;gap:5px}
.tile .ttop{font-size:12px;border:1px solid var(--line);border-radius:3px;padding:1px 7px;background:#efece2}
/* 底部 */
footer{padding:14px 0 0;margin-top:40px;border-top:1px solid var(--line);font-size:11px;color:var(--dim);line-height:1.7}
@media (max-width:640px){
  .wrap{padding:6px 16px 48px}
  h1{font-size:28px}
  .card{width:calc(50% - 8px)}
  nav.top a:first-of-type{display:none}
}
`

// CSS 抽到单个 style.css（原先每页内联 ~12KB，4318 页合计 ~45MB 冗余）
const head = (title) => `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · 凡人修仙传知识图谱</title><link rel="stylesheet" href="style.css"></head><body>`
const nav = `<nav class="top"><div class="brand"><span class="seal">凡</span><span class="t">凡人修仙传</span><span class="s">知识图谱</span></div><div><a href="../">← 返回图谱</a><a href="index.html">实体总览</a></div></nav>`
const chMin = chapters.length ? Math.min(...chapters.map((c) => c.chapter)) : 1
const chMax = chapters.length ? Math.max(...chapters.map((c) => c.chapter)) : 1
const foot = `<footer>数据：LLM 抽取流水线（${esc(meta.prompt_version || 'v0.1')}，第${chMin}-${chMax}章 · ${ents.size} 实体 / ${edges.length} 关系 · flywheel ${esc(meta.flywheel_round ? 'v' + meta.flywheel_round : 'v1')}）· 重要性 = 45% 关系度 + 25% 关系实例 + 30% 活跃章数（归一化 0-100）· 内容为事实性条目整理，不含原文摘录 · 图片策略 L0（纯文字，无位图）</footer></div></body></html>`

// 关系时间线：按 (对方, 关系类型) 分组，按首次出现章排序（与前端 DetailPanel 一致）
function buildTimeline(id, edges) {
  const gMap = new Map()
  for (const r of edges) {
    const other = r.from === id ? r.to : r.from
    const out = r.from === id
    const key = other + '|' + r.type
    const g = gMap.get(key)
    if (g) { g.chapters.push(r.evidence_chapter); if (!g.note && r.note) g.note = r.note }
    else gMap.set(key, { other, type: r.type, dir: out ? '→' : '←', chapters: [r.evidence_chapter], note: r.note || '' })
  }
  return [...gMap.values()]
    .map((g) => ({ ...g, chapters: [...new Set(g.chapters)].sort((a, b) => a - b) }))
    .sort((a, b) => a.chapters[0] - b.chapters[0])
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'style.css'), CSS)

// ---------- 实体详情页 ----------
let count = 0
for (const [id, e] of ents) {
  const m = TYPE_META[e.type] || { label: e.type, color: '#8a93a6', seal: '印' }
  const s = stat[id]
  const rels = edges.filter((r) => r.from === id || r.to === id)

  const attrs = Object.entries(e.attributes || {}).map(([k, v]) =>
    `<div class="kv-row"><span>${esc(ATTR_LABEL[k] || k)}</span><span>${esc(v)}</span></div>`
  ).join('')
  const kv2 =
    `<div class="kv">${attrs}` +
    `<div class="kv-row"><span>首次出现</span><span>第 ${s.firstSeen} 章</span></div>` +
    `<div class="kv-row"><span>重要性</span><span>${s.score} 分 · ${esc(m.label)}内第 ${rankOf[id]} / ${totalOf(e.type)} 名</span></div>` +
    `<div class="kv-row"><span>关系度</span><span>${s.deg} 个节点（${s.rc} 条证据）</span></div>` +
    `<div class="kv-row"><span>活跃章节</span><span>${s.span} 章（第 ${s.firstSeen}–${s.lastSeen} 章）</span></div>` +
    `</div>`

  const timeline = buildTimeline(id, rels)
  const tlHtml = timeline.map((g) => {
    const o = byId.get(g.other)
    const om = o ? (TYPE_META[o.type] || { color: '#6b7280' }) : { color: '#6b7280' }
    const name = o ? o.name : g.other
    const chapPills = g.chapters.length > 1
      ? `<div class="tl-chaps">${g.chapters.slice(0, 10).map((c) => `<i class="tl-chap">${c}</i>`).join('')}${g.chapters.length > 10 ? '<i class="tl-chap">…</i>' : ''}</div>`
      : ''
    return `<div class="tl-item" style="--tl-dot:${om.color}">` +
      `<div class="tl-head"><span class="tl-ch">第 ${g.chapters[0]} 章</span>` +
      (g.chapters.length > 1 ? `<span class="tl-more">×${g.chapters.length} 次</span>` : '') +
      `<span class="tl-type">${REL_LABEL[g.type] || g.type}</span><span class="tl-dir">${g.dir}</span>` +
      `<span class="tl-name" style="color:${om.color}"><a href="${g.other}.html">${esc(name)}</a></span></div>` +
      chapPills +
      (g.note ? `<div class="tl-note" title="${esc(g.note)}">${esc(g.note)}</div>` : '') +
      `</div>`
  }).join('')

  const chips = (s.score >= 80 ? `<span class="chip gold">重要节点 ${s.score}</span>` : '')
  const aliases = (e.aliases || []).length
    ? `<div class="alias-row">${(e.aliases || []).map((a) => `<span class="alias">${esc(a)}</span>`).join('')}</div>`
    : ''

  const html = head(e.name) + `<div class="wrap">` + nav +
    `<div class="entry">` +
    `<div class="type-row"><span class="type-seal">${m.seal}</span><span class="type-label">${esc(m.label)}</span></div>` +
    `<h1>${esc(e.name)}</h1>` +
    (chips ? `<div class="chip-row">${chips}</div>` : '') +
    aliases +
    kv2 +
    (e.notes ? `<p class="notes">${esc(e.notes)}</p>` : '') +
    `<h2 class="sec-title">关系时间线（${timeline.length} 组 · ${rels.length} 条）</h2>` +
    (tlHtml || '<p class="dim">暂无关联（孤立节点，待后续章节补边）</p>') +
    `</div>` +
    foot
  writeFileSync(join(outDir, `${id}.html`), html)
  count++
}

// ---------- 分类总览：入口 hub + 全部页 + 每类独立页 ----------
// 排序模式: score 重要性 | deg 关系数 | span 活跃章数 | first 首现章节(早→晚) | last 最近活跃(新→旧) | name 名称序
const SORT_JS = [
  'function resort(key){',
  'var dir={score:-1,deg:-1,span:-1,first:1,last:-1,name:0};',
  'document.querySelectorAll(".sec").forEach(function(sec){',
  'var box=sec.querySelector(".cards");if(!box)return;',
  'var cards=Array.prototype.slice.call(box.querySelectorAll(".card"));',
  'cards.sort(function(a,b){',
  'if(key==="name"){return a.dataset.name.localeCompare(b.dataset.name,"zh-Hans-CN")}',
  'return (+a.dataset[key]-+b.dataset[key])*dir[key] || (+b.dataset.score-+a.dataset.score) || a.dataset.name.localeCompare(b.dataset.name,"zh-Hans-CN");',
  '});',
  'cards.forEach(function(c){box.appendChild(c)});',
  'cards.forEach(function(c,i){c.querySelector(".rank").textContent="#"+(i+1)});',
  '});',
  '}',
].join('\n')

const byType = {}
for (const [id, e] of ents) (byType[e.type] ||= []).push(e)
const cmpScore = (a, b) => stat[b.id].score - stat[a.id].score || stat[b.id].deg - stat[a.id].deg || a.name.localeCompare(b.name, 'zh-Hans-CN')

const TYPE_ORDER = ['character', 'faction', 'location', 'treasure', 'pill', 'beast', 'formation', 'technique', 'event']
const presentTypes = TYPE_ORDER.filter((t) => byType[t])

// 分类导航条（横向，当前页高亮；相对路径，均位于 entities/ 内）
const typeNav = (active) => {
  const items = [`<a class="tn${active === 'all' ? ' on' : ''}" href="all.html">全部（${ents.size}）</a>`]
  for (const t of presentTypes) {
    const m = TYPE_META[t]
    items.push(`<a class="tn${active === t ? ' on' : ''}" href="${t}.html"><span class="dot" style="background:${m.color}"></span>${m.label}（${byType[t].length}）</a>`)
  }
  return `<div class="tnav">${items.join('')}</div>`
}

const sortBar = () => `<div class="sortbar"><label>排序方式 <select onchange="resort(this.value)"><option value="score" selected>重要性（默认）</option><option value="deg">关系数（度）</option><option value="span">活跃章数</option><option value="first">首现章节（早→晚）</option><option value="last">最近活跃（新→旧）</option><option value="name">名称序</option></select></label><span>重要性 = 45% 关系度 + 25% 关系实例 + 30% 活跃章数（0-100 分）· 序号随排序实时更新</span></div>`

const cardsHtml = (list) => list.map((e, i) => {
  const s = stat[e.id]
  const tm = TYPE_META[e.type] || { label: e.type, color: '#6b7280' }
  const aliasLine = (e.aliases || []).slice(0, 2).join(' / ')
  return `<a class="card" href="${e.id}.html" data-score="${s.score}" data-deg="${s.deg}" data-span="${s.span}" data-first="${s.firstSeen}" data-last="${s.lastSeen}" data-name="${esc(e.name)}"><span class="rank">#${i + 1}</span><b style="color:${tm.color}">${esc(e.name)}<span class="tt">${esc(tm.label)}</span></b><i>${esc(aliasLine || '首现第' + e.first_seen_chapter + '章')} · 关系${s.deg} · 活跃${s.span}章</i></a>`
}).join('')

// 全部实体页（跨类型全局排序）
// 按重要性截断到 Top ALL_LIMIT：4308 卡同页（~1.3MB）观感差且渲染慢；
// 完整集合经上方分类导航（typeNav）逐类浏览，分类页保留全量。
{
  const ALL_LIMIT = 500
  const allSorted = [...ents.values()].sort(cmpScore)
  const shown = allSorted.slice(0, ALL_LIMIT)
  const page = head('全部实体 · 实体总览') + `<div class="wrap idx">` + nav +
    `<h1>全部实体（${ents.size}）</h1>` +
    typeNav('all') +
    (allSorted.length > shown.length
      ? `<p class="trunc-note">按重要性显示前 <b>${shown.length}</b> 个 · 完整 ${allSorted.length} 个实体经上方分类入口逐类浏览（各分类页含全量）</p>`
      : '') +
    sortBar() +
    `<section class="sec" data-type="all"><div class="cards">${cardsHtml(shown)}</div></section>` +
    `<script>${SORT_JS}</script>` + foot
  writeFileSync(join(outDir, 'all.html'), page)
}

// 各分类独立页
for (const t of presentTypes) {
  const m = TYPE_META[t]
  const list = byType[t]
  const sorted = [...list].sort(cmpScore)
  const page = head(`${m.label} · 实体总览`) + `<div class="wrap idx">` + nav +
    `<div class="type-row"><span class="type-seal">${m.seal}</span><span class="type-label">${esc(m.label)} · 分类</span></div>` +
    `<h1>${esc(m.label)}（${list.length}）</h1>` +
    typeNav(t) + sortBar() +
    `<section class="sec" data-type="${t}"><div class="cards">${cardsHtml(sorted)}</div></section>` +
    `<script>${SORT_JS}</script>` + foot
  writeFileSync(join(outDir, `${t}.html`), page)
}

// 入口 hub：分类瓦片 + 全部
{
  const tiles = [`<a class="tile" href="all.html" style="border-left-color:var(--dai)"><div class="trow"><span class="tseal" style="background:var(--dai)">图</span><span class="tname">全部实体</span></div><div class="tcount">${ents.size} 个实体 · 跨类型全局排序</div><div class="ttops"><span class="ttop" style="color:var(--dai)">点击查看全部 →</span></div></a>`]
  for (const t of presentTypes) {
    const m = TYPE_META[t]
    const top = [...byType[t]].sort(cmpScore).slice(0, 4).map((e) => `<span class="ttop" style="color:${m.color}">${esc(e.name)}</span>`).join('')
    tiles.push(`<a class="tile" href="${t}.html" style="border-left-color:${m.color}"><div class="trow"><span class="tseal">${m.seal}</span><span class="tname">${esc(m.label)}</span></div><div class="tcount">${byType[t].length} 个实体</div><div class="ttops">${top}</div></a>`)
  }
  const page = head('实体总览') + `<div class="wrap idx">` + nav +
    `<h1>实体总览</h1>` +
    `<p class="dim" style="margin:6px 0 4px;font-size:12.5px">按类型分类浏览 · 点击进入分类页 · 全部 ${ents.size} 个实体</p>` +
    `<div class="tiles">${tiles.join('')}</div>` + foot
  writeFileSync(join(outDir, 'index.html'), page)
}
console.log(`SSG 生成完成: ${count} 实体页 + ${presentTypes.length} 分类页 + 全部页 + 入口 hub → dist/entities/`)
console.log(`Top5 人物(重要性): ${[...ents.values()].filter(e=>e.type==='character').map(e=>e.id).sort((a,b)=>stat[b].score-stat[a].score).slice(0,5).map(id=>byId.get(id).name+'('+stat[id].score+')').join(' ')}`)
