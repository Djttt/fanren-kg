// 生成紧凑 graph.json（供前端 fetch，替代整包内联 4.7MB 的 extraction.json）
// 输出: public/graph.json  —— 节点 first-wins 去重 + 全部关系实例（供时间线 ×N 次 / 客户端按需去重）
// 用法: node scripts/gen-graph-data.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src/data/extraction.json')
const outDir = join(root, 'public')
const out = join(outDir, 'graph.json')

const d = JSON.parse(readFileSync(src, 'utf-8'))
const chapters = d.chapters || []

// 节点：first-wins 去重（与前端/SSG 一致）
const nodeMap = new Map()
for (const ch of chapters) {
  for (const e of ch.entities || []) {
    if (nodeMap.has(e.id)) continue
    nodeMap.set(e.id, {
      id: e.id, name: e.name, type: e.type,
      first: e.first_seen_chapter,
      al: e.aliases || [],
      note: e.notes || '',
      attrs: e.attributes || {},
    })
  }
}

// 边：保留全部关系实例（客户端对显示层去重，时间线保留 ×N 次证据）
const edges = []
for (const ch of chapters) {
  for (const r of ch.relations || []) {
    edges.push({ s: r.from, t: r.to, type: r.type, c: r.evidence_chapter, n: r.note || '' })
  }
}

const chNums = chapters.map((c) => c.chapter)
const file = {
  meta: {
    chars: d.meta?.chars || 0,
    prompt_version: d.meta?.prompt_version || '',
    flywheel_round: d.meta?.flywheel_round || 0,
    chapters: [chNums.length ? Math.min(...chNums) : 1, chNums.length ? Math.max(...chNums) : 1],
    entities: nodeMap.size,
    relations: edges.length,
  },
  nodes: [...nodeMap.values()],
  edges,
}

mkdirSync(outDir, { recursive: true })
const bytes = Buffer.byteLength(JSON.stringify(file))
writeFileSync(out, JSON.stringify(file))
console.log(`graph.json 生成 → public/graph.json  · ${file.meta.entities} 节点 / ${file.meta.relations} 关系 · ${(bytes / 1e6).toFixed(2)} MB`)
