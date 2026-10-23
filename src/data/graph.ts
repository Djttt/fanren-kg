// 图谱数据层
// 数据来自构建期生成的紧凑 public/graph.json（不再整包内联 4.7MB 的 extraction.json）。
//   构建: node scripts/gen-graph-data.mjs  →  public/graph.json（节点去重 + 全部关系实例）
//   运行时: loadGraph() fetch 该文件 → buildGraph() 纯转换（无副作用、可测试）
// 类型配色：国画颜料色（宣纸底）—— 朱砂/黛蓝/石绿/赭金/玫瑰/石青/靛蓝/藕紫/墨灰

export type EntityType = 'character' | 'faction' | 'location' | 'treasure' | 'pill' | 'beast' | 'formation' | 'technique' | 'event' | 'cluster'

export const TYPE_META: Record<string, { label: string; color: string; seal: string }> = {
  cluster:   { label: '集群', color: '#7a8299', seal: '簇' },
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

export const REL_LABEL: Record<string, string> = {
  master_of: '师徒', friend_of: '好友', enemy_of: '敌对', family_of: '血亲',
  in_law_of: '姻亲', member_of: '从属', affiliated_with: '分属', founded_by: '创立',
  located_in: '位于', owns: '所有', practices: '修炼', found: '拾获',
  rescued: '救', named: '命名', arranged: '安排', other: '其他',
}

export interface KGNode {
  id: string
  name: string
  type: EntityType
  degree: number
  firstSeen: number
  aliases: string[]
  notes: string
  attrs: Record<string, string>
  r?: number // 集群节点渲染半径
}
export interface KGE {
  id: string
  source: string
  target: string
  type: string
  note: string
  chapter: number
  weight?: number // 集群间聚合边权
}

// ---- 社区聚类（确定性标签传播，宏观浏览用） ----
export interface Cluster {
  id: string          // 'cl:' + centerId
  center: string
  members: string[]
  size: number
}
export interface ClusterView {
  clusters: Cluster[]
  metaNodes: { id: string; name: string; size: number; label: string; r: number }[]
  metaEdges: { id: string; source: string; target: string; weight: number }[]
}

export function buildClusters(nodes: KGNode[], edges: KGE[]): ClusterView {
  const n = nodes.length
  const idx = new Map<string, number>(nodes.map((x, i) => [x.id, i]))
  const adj: number[][] = nodes.map(() => [])
  for (const e of edges) {
    const a = idx.get(e.source)
    const b = idx.get(e.target)
    if (a === undefined || b === undefined) continue
    adj[a].push(b)
    adj[b].push(a)
  }
  // 多源 BFS：以关系数 Top-K 枢纽为种子，各节点归入最近种子（按跳数），
  // 形成"主角世界 + 各大故事圈"的宏观结构（K=20 经 4308 节点实测调参）
  const order = nodes.map((_, i) => i).sort((x, y) => nodes[y].degree - nodes[x].degree)
  const K = 20
  const label = new Array<number>(n).fill(-1)
  const queue: number[] = []
  for (let s = 0; s < Math.min(K, n); s++) {
    label[order[s]] = s
    queue.push(order[s])
  }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]
    for (const j of adj[i]) {
      if (label[j] < 0) {
        label[j] = label[i]
        queue.push(j)
      }
    }
  }
  for (let i = 0; i < n; i++) if (label[i] < 0) label[i] = i
  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const arr = groups.get(label[i])
    if (arr) arr.push(i)
    else groups.set(label[i], [i])
  }
  const clusters: Cluster[] = []
  const labelCenter = new Map<number, number>()
  groups.forEach((mem, l) => {
    if (mem.length < 2) return
    const center = mem.reduce((a, b) => (nodes[a].degree >= nodes[b].degree ? a : b))
    labelCenter.set(l, center)
    clusters.push({
      id: 'cl:' + nodes[center].id,
      center: nodes[center].id,
      members: mem.map((i) => nodes[i].id),
      size: mem.length,
    })
  })
  clusters.sort((a, b) => b.size - a.size)
  const metaNodes: ClusterView['metaNodes'] = clusters.map((c) => ({
    id: c.id,
    name: nodes[idx.get(c.center)!].name,
    size: c.size,
    label: `${nodes[idx.get(c.center)!].name}（${c.size}）`,
    r: 10 + Math.min(44, Math.sqrt(c.size) * 5.5),
  }))
  const wmap = new Map<string, number>()
  for (const e of edges) {
    const ia = idx.get(e.source)
    const ib = idx.get(e.target)
    if (ia === undefined || ib === undefined) continue
    const la = label[ia]
    const lb = label[ib]
    if (la === lb) continue
    const x = labelCenter.get(la)
    const y = labelCenter.get(lb)
    if (x === undefined || y === undefined) continue
    const [cx, cy] = cx2(x, y)
    const k = cx + '|' + cy
    wmap.set(k, (wmap.get(k) || 0) + 1)
  }
  const metaEdges: ClusterView['metaEdges'] = []
  wmap.forEach((w, k) => {
    const [a, b] = k.split('|').map(Number)
    metaEdges.push({
      id: 'ce:' + a + ':' + b,
      source: 'cl:' + nodes[a].id,
      target: 'cl:' + nodes[b].id,
      weight: w,
    })
  })
  return { clusters, metaNodes, metaEdges }
}
function cx2(x: number, y: number): [number, number] {
  return x < y ? [x, y] : [y, x]
}

// ---- 紧凑数据契约（public/graph.json） ----
interface CNode { id: string; name: string; type: string; first: number; al: string[]; note: string; attrs: Record<string, unknown> }
interface CEdge { s: string; t: string; type: string; c: number; n: string }
export interface CompactFile {
  meta: { chars: number; prompt_version: string; flywheel_round: number; chapters: [number, number]; entities: number; relations: number }
  nodes: CNode[]
  edges: CEdge[]
}

export interface GraphData {
  nodes: KGNode[]
  edges: KGE[]      // 显示层：每 from|to|type 一条（供图 / 集群 / 聚焦）
  allEdges: KGE[]   // 全部关系实例（供 DetailPanel 时间线 ×N 次）
  chapters: [number, number]
  chars: number
  task: string
}

/** 纯转换：紧凑数据 → G6 可用的节点/边（无 I/O，可单测）。 */
export function buildGraph(file: CompactFile): GraphData {
  const idSet = new Set(file.nodes.map((n) => n.id))
  const degree: Record<string, number> = {}
  const allEdges: KGE[] = []
  for (const r of file.edges) {
    if (!idSet.has(r.s) || !idSet.has(r.t)) continue
    allEdges.push({ id: 'e' + allEdges.length, source: r.s, target: r.t, type: r.type, note: r.n || '', chapter: r.c })
    degree[r.s] = (degree[r.s] || 0) + 1
    degree[r.t] = (degree[r.t] || 0) + 1
  }
  const nodes: KGNode[] = file.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type as EntityType,
    degree: degree[n.id] || 0,
    firstSeen: n.first,
    aliases: n.al || [],
    notes: n.note || '',
    attrs: Object.fromEntries(Object.entries(n.attrs || {}).map(([k, v]) => [k, String(v)])),
  }))
  // 显示层去重：同 from|to|type 只留最早一条（数据层 allEdges 保留全部证据）
  const seen = new Set<string>()
  const display: KGE[] = []
  for (const e of allEdges) {
    const k = e.source + '|' + e.target + '|' + e.type
    if (seen.has(k)) continue
    seen.add(k)
    display.push(e)
  }
  return {
    nodes,
    edges: display,
    allEdges,
    chapters: file.meta.chapters,
    chars: file.meta.chars,
    task: file.meta.prompt_version,
  }
}

/** 运行时加载：fetch 紧凑 graph.json 并转换。失败会抛出，由上层展示兜底 UI。 */
export async function loadGraph(): Promise<GraphData> {
  const base = import.meta.env.BASE_URL || '/'
  const res = await fetch(base + 'graph.json')
  if (!res.ok) throw new Error('加载图谱数据失败（HTTP ' + res.status + '）')
  const file = (await res.json()) as CompactFile
  return buildGraph(file)
}
