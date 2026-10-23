import { useEffect, useRef, useState } from 'react'
import { Graph } from '@antv/g6'
import { TYPE_META, type KGNode, type KGE } from '../data/graph'

interface Props {
  nodes: KGNode[]
  edges: KGE[]
  focusId: string | null
  dataKey: string
  query: string
  selectedId: string | null
  onSelect: (id: string | null) => void
  onBlank?: () => void
}

/** G6 v5 把节点/边数据里的 `type` 字段当作"图形类型注册键"，
 *  业务分类必须用其它字段名（entityType / relType）。 */
type G6Any = any

const STRONG_RELS = new Set([
  'master_of', 'family_of', 'in_law_of', 'enemy_of',
  'member_of', 'founded_by', 'friend_of',
])

export default function GraphView({ nodes, edges, focusId, dataKey, query, selectedId, onSelect, onBlank }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<G6Any>(null)
  const [version, setVersion] = useState(0)
  // 搜索防抖：输入框即时，重算过滤/高亮延迟 120ms（避免每击键都对数千节点 substring 过滤 + 触发 G6 状态更新）
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 120)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const w = el.clientWidth || 800
    const h = el.clientHeight || 560

    const degById = new Map(nodes.map((n) => [n.id, n.degree]))
    // 小图（≤250 节点）全量标签；大图只给高重要度节点标签，其余靠缩放 LOD 显示
    const smallGraph = nodes.length <= 250
    const labelThreshold = smallGraph ? 0 : 8

    const graph: G6Any = new Graph({
      container: el,
      width: w,
      height: h,
      padding: 40,
      data: {
        nodes: nodes.map((n: KGNode) => ({
          id: n.id,
          name: n.name,
          entityType: n.type,
          degree: n.degree,
          r: n.r,
        })),
        edges: edges.map((e: KGE) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          relType: e.type,
          weight: e.weight,
        })),
      },
      node: {
        style: (d: G6Any) => {
          const deg = degById.get(d.id) || 0
          return {
            size: d.r || 10 + Math.min(34, Math.sqrt(deg || 1) * 7),
            fill: TYPE_META[d.entityType]?.color || '#8a93a6',
            stroke: d.id === focusId ? '#b23b2c' : 'rgba(34,37,43,0.30)',
            lineWidth: d.id === focusId ? 2.5 : 1,
            fillOpacity: 0.92,
            labelText: d.name,
            labelFill: d.id === focusId ? '#9c2f22' : '#3a3f47',
            labelFontSize: d.id === focusId ? 14 : 11.5,
            labelFontFamily: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
            labelOpacity: deg >= labelThreshold ? 1 : 0,
            labelOffsetY: 6,
            cursor: 'pointer',
          }
        },
        state: {
          selected: { stroke: '#b23b2c', lineWidth: 2.5 },
          inactive: { opacity: 0.12, labelOpacity: 0.06 },
        },
      },
      edge: {
        style: (d: G6Any) => {
          if (d.weight) {
            // 集群聚合边
            return {
              stroke: 'rgba(58,85,125,0.28)',
              lineWidth: 1 + Math.min(4, d.weight * 0.06),
            }
          }
          const strong = STRONG_RELS.has(d.relType)
          return {
            stroke: strong ? 'rgba(34,37,43,0.32)' : 'rgba(34,37,43,0.10)',
            lineWidth: strong ? 1.2 : 0.8,
          }
        },
      },
      layout: {
        type: 'force',
        // 大图（>600 节点，如"全部"）关闭防重叠：其碰撞解算是数千节点下的主要 CPU 热点；
        // 小图保留以防标签/节点重叠
        preventOverlap: nodes.length <= 600,
        linkDistance: nodes.length > 600 ? 90 : 110,
      },
      behaviors: ['zoom-canvas', 'drag-canvas'],
      animation: false,
    })

    Promise.resolve(graph.render()).then(() => {
      requestAnimationFrame(() => {
        try { graph.fitView() } catch { /* noop */ }
      })
      setVersion((v) => v + 1) // 布局就绪后触发一次高亮/选中态
    })

    const ro = new ResizeObserver(() => {
      const nw = el.clientWidth
      const nh = el.clientHeight
      if (nw > 0 && nh > 0) {
        try { graph.resize(nw, nh) } catch { /* noop */ }
      }
    })
    ro.observe(el)

    // 标签 LOD：缩放放大时逐步显示次要节点标签（轮询 zoom，避免依赖 v5 事件名差异）
    let lastZoom = 0
    const lodTimer = window.setInterval(() => {
      try {
        const zoom = graph.getZoom?.() ?? 1
        if (Math.abs(zoom - lastZoom) < 0.05) return
        lastZoom = zoom
        const items: G6Any[] = graph.getElementData?.('node') || []
        for (const d of items) {
          const deg = degById.get(d.id) || 0
          const show = deg >= labelThreshold || zoom >= 1.15 || d.id === focusId
          try { graph.setElementStyle?.(d.id, { labelOpacity: show ? 1 : 0 }, 'node') } catch { /* noop */ }
        }
      } catch { /* noop */ }
    }, 600)

    graph.on('node:click', (e: G6Any) => {
      const id: string | undefined = e.target?.id ?? e.item?.id
      if (id) onSelect(id)
    })
    graph.on('canvas:click', () => (onBlank ? onBlank() : onSelect(null)))

    graphRef.current = graph
    return () => {
      window.clearInterval(lodTimer)
      ro.disconnect()
      try { graph.destroy() } catch { /* noop */ }
      graphRef.current = null
    }
  }, [dataKey])

  // 类型过滤 + 搜索高亮 + 选中态
  useEffect(() => {
    const g = graphRef.current
    if (!g) return
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const q = debouncedQuery.trim()
    const hit = q ? nodes.filter((n) => n.name.includes(q) || n.aliases.some((a) => a.includes(q))) : null

    try { g.clearElementStates?.() } catch { /* noop */ }

    if (focusId) {
      try { g.setElementState?.(focusId, 'selected', true) } catch { /* noop */ }
    }

    if (hit && hit.length > 0 && !focusId) {
      try {
        if (hit.length > 1) g.setElementStates?.(hit.slice(1).map((h) => h.id), 'inactive', true)
        g.focusElement?.(hit[0].id, { duration: 300 })
      } catch { /* 聚焦失败可忽略 */ }
    }
  }, [version, debouncedQuery, focusId, selectedId, nodes])

  return <div ref={containerRef} className="graph-canvas" />
}
