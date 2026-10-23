// 语料切块器：把全文按章切分，输出 public/corpus.json（RAG 检索用）
// 章界锚定：行首 "第<中文数字>章 <标题>"；章号/标题对齐权威的 chapter-titles.json（1631 章）。
// 全文实际含 ~1999 章，这里只取 1..MAX_CH 以与知识图谱保持一致。
// 用法: node scripts/gen-corpus.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = join(root, '..')
const TEXT = join(projectRoot, 'data/raw/fanren_full_utf8.txt')
const TITLES = join(projectRoot, 'data/chapter-titles.json')
const OUT = join(root, 'public/corpus.json')

const MAX_CH = 1631 // 与 chapter-titles.json / KG 对齐的章数

// 中文数字（≤1999，形如 一千九百九十九 / 一百 / 十 / 五）→ int
const DN = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const UNITS = { 十: 10, 百: 100, 千: 1000 }
function cnToInt(s) {
  let total = 0, cur = 0
  for (const ch of s) {
    if (DN[ch] !== undefined) cur = DN[ch]
    else if (UNITS[ch]) { total += (cur === 0 ? 1 : cur) * UNITS[ch]; cur = 0 }
  }
  return total + cur
}

const text = readFileSync(TEXT, 'utf-8')
const titles = JSON.parse(readFileSync(TITLES, 'utf-8'))

// 抓所有行首章界标记（含位置）
const re = /^第([零一二三四五六七八九十百千]+)章[ \t]*(.*)$/gm
const marks = []
for (const m of text.matchAll(re)) {
  const num = cnToInt(m[1])
  if (!(num >= 1)) continue
  marks.push({ num, title: m[2].trim(), start: m.index, lineEnd: m.index + m[0].length })
}

// 同一章号若重复，保留最早出现处
const byNum = new Map()
for (const mk of marks) if (!byNum.has(mk.num)) byNum.set(mk.num, mk)

// 按章号排序后，逐章取正文 = 本章界行末 → 下一（更大的）章界行首
const nums = [...byNum.keys()].filter((n) => n <= MAX_CH).sort((a, b) => a - b)
const corpus = []
const missing = []
for (let i = 0; i < nums.length; i++) {
  const n = nums[i]
  const mk = byNum.get(n)
  const nextNum = i + 1 < nums.length ? nums[i + 1] : null
  // 正文下界：下一个"在 byNum 里且 > n 的章"的 start；若没有则到全文末尾
  let endOffset
  if (nextNum !== null) endOffset = byNum.get(nextNum).start
  else {
    // 1631 之后还有 1632+ 的章，需要定位"大于 n 的最小章界"作为边界
    let lo = Infinity
    for (const [k, v] of byNum) if (k > n && v.start < lo) lo = v.start
    endOffset = lo === Infinity ? text.length : lo
  }
  let body = text.slice(mk.lineEnd, endOffset)
  body = body.replace(/\s+/g, ' ').trim()
  const title = titles[n] || mk.title
  if (body.length < 20) missing.push(n) // 过短的视为切分异常
  corpus.push({ chapter: n, title, text: body, chars: body.length })
}

writeFileSync(OUT, JSON.stringify(corpus), 'utf-8')
const totalChars = corpus.reduce((s, c) => s + c.chars, 0)
console.log(`corpus 生成 → public/corpus.json`)
console.log(`  章数: ${corpus.length}（目标 1..${MAX_CH}） · 总字符: ${totalChars} · 平均 ${Math.round(totalChars / corpus.length)} 字/章`)
console.log(`  全文行首章界标记: ${marks.length} 个（去重后 ${byNum.size} 个章号）`)
if (missing.length) console.log(`  ⚠ 正文过短(<20字)的章: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' …' : ''}`)
const gap = []
for (let n = 1; n <= MAX_CH; n++) if (!byNum.has(n)) gap.push(n)
if (gap.length) console.log(`  ⚠ 缺失章号(1..${MAX_CH}): ${gap.slice(0, 20).join(', ')}${gap.length > 20 ? ' …' : ''}`)
else console.log(`  ✓ 1..${MAX_CH} 章号齐全，无缺章`)
