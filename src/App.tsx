import { useEffect, useMemo, useState } from 'react'
import GraphView from './components/GraphView'
import DetailPanel from './components/DetailPanel'
import SearchPanel from './components/SearchPanel'
import { loadGraph, buildClusters, TYPE_META, type KGNode, type KGE, type GraphData } from './data/graph'

const TYPE_ORDER = ['character', 'faction', 'location', 'treasure', 'pill', 'beast', 'formation', 'technique', 'event']

/** 按正文真实剧情弧划分（分界经原文核实：1270 章"刚刚飞升到灵界韩立"等） */
const PRESETS: Record<string, { r: [number, number]; label: string }> = {
  all: { r: [1, 1631], label: '全部 · 1-1631 章' },
  h1: { r: [1, 357], label: '人界 · 前期（1-357 青牛镇→天南）' },
  luan: { r: [358, 639], label: '乱星海篇（358-639 星宫/虚天殿）' },
  h2: { r: [640, 927], label: '回归天南篇（640-927 坠魔谷/落云宗）' },
  jin: { r: [928, 1167], label: '大晋篇（928-1167 晋京/昆吾山）' },
  h3: { r: [1168, 1264], label: '人界 · 末期（1168-1264 飞升前夜）' },
  spirit: { r: [1265, 1631], label: '灵界篇（1265-1631 天元→黑冥雾海）' },
}
const PRESET_KEYS = Object.keys(PRESETS)

type Mode = 'graph' | 'cluster' | 'cluster-open'

/** 顶层：负责数据加载 + 加载/错误兜底。数据就绪后挂载 <Main/>。 */
export default function App() {
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadGraph()
      .then((g) => { if (alive) setGraph(g) })
      .catch((e) => { if (alive) setError(e?.message || String(e)) })
    return () => { alive = false }
  }, [])

  if (error) return <Boot tone="error" title="无法加载图谱" body={error} />
  if (!graph) return <Boot tone="loading" title="研墨中…" body={`正在加载 ${'4308'} 实体 · 9506 关系（graph.json）`} />
  return <Main graph={graph} />
}

function Boot({ tone, title, body }: { tone: 'loading' | 'error'; title: string; body: string }) {
  return (
    <div className="boot">
      <div className="seal big"><span>{tone === 'error' ? '止' : '凡'}</span></div>
      <p className="boot-title">{title}</p>
      <p className={'boot-body' + (tone === 'error' ? ' err' : '')}>{body}</p>
      {tone === 'error' && (
        <button className="boot-retry" onClick={() => location.reload()}>重试</button>
      )}
    </div>
  )
}

function Main({ graph }: { graph: GraphData }) {
  const clusterView = useMemo(() => buildClusters(graph.nodes, graph.edges), [graph])
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    () => new Set(graph.nodes.map((n) => n.type)),
  )
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null) // 修复：原为 'han-li'（TEMP-SHOT 截图残留）
  const [range, setRange] = useState<[number, number]>(PRESETS.all.r)
  const [cap, setCap] = useState<number>(100) // 总览默认只显示前 100 核心节点（按关系数排序）；0 = 全部显示
  const [mode, setMode] = useState<Mode>('graph') // 默认节点视图（配合 cap=100 只显示核心，避免 4308 节点过密）；点"集群视图"可看宏观聚合
  const [openCluster, setOpenCluster] = useState<string | null>(null)
  const [view, setView] = useState<'graph' | 'search'>('graph') // 图谱 / 全文检索

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])

  // 1) 章节区间 + 类型过滤后的"基础图"（节点图模式）
  const base = useMemo(() => {
    const [a, b] = range
    const inR = new Set<string>()
    for (const n of graph.nodes) if (n.firstSeen >= a && n.firstSeen <= b) inR.add(n.id)
    for (const e of graph.edges) if (e.chapter >= a && e.chapter <= b) {
      inR.add(e.source); inR.add(e.target)
    }
    const nodes = graph.nodes.filter((n) => inR.has(n.id) && activeTypes.has(n.type))
    const ids = new Set(nodes.map((n) => n.id))
    const edges = graph.edges.filter((e) =>
      e.chapter >= a && e.chapter <= b && ids.has(e.source) && ids.has(e.target),
    )
    return { nodes, edges }
  }, [graph, range, activeTypes])

  // 2) 聚焦模式：选中节点 + 其直接邻居（仅节点图模式生效）
  const focus = useMemo(() => {
    if (mode !== 'graph' || !selectedId || !byId.has(selectedId)) return null
    const keep = new Set<string>([selectedId])
    for (const e of graph.edges) {
      if (e.source === selectedId) keep.add(e.target)
      if (e.target === selectedId) keep.add(e.source)
    }
    const nodes = graph.nodes.filter((n) => keep.has(n.id))
    const edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target))
    return { nodes, edges, count: keep.size }
  }, [selectedId, mode, graph, byId])

  // 3) 集群图模式：宏觀视图（聚合簇）/ 展开单簇
  const clusterShown = useMemo<{ nodes: KGNode[]; edges: KGE[] } | null>(() => {
    if (mode === 'cluster') {
      return {
        nodes: clusterView.metaNodes.map((m) => ({
          id: m.id,
          name: m.name,
          type: 'cluster' as const,
          degree: m.size,
          firstSeen: 0,
          aliases: [],
          notes: '',
          attrs: {},
          r: m.r,
        })),
        edges: clusterView.metaEdges.map((m) => ({
          id: m.id,
          source: m.source,
          target: m.target,
          type: '',
          note: '',
          chapter: 0,
          weight: m.weight,
        })),
      }
    }
    if (mode === 'cluster-open' && openCluster) {
      const c = clusterView.clusters.find((x) => x.id === openCluster)
      if (c) {
        const ids = new Set(c.members)
        return {
          nodes: graph.nodes.filter((n) => ids.has(n.id)),
          edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
        }
      }
    }
    return null
  }, [mode, openCluster, clusterView, graph])

  // 4) 显示数量档位（仅总览模式生效）
  const shown = useMemo<{ nodes: KGNode[]; edges: KGE[] }>(() => {
    if (clusterShown) return clusterShown
    if (focus) return focus
    let { nodes, edges } = base
    if (cap > 0 && nodes.length > cap) {
      const ranked = [...nodes].sort((x, y) => y.degree - x.degree).slice(0, cap)
      const ids = new Set(ranked.map((n) => n.id))
      return {
        nodes: ranked,
        edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
      }
    }
    return { nodes, edges }
  }, [base, focus, cap, clusterShown])

  const dataKey = useMemo(
    () =>
      [
        mode,
        openCluster ?? '-',
        range[0],
        range[1],
        cap,
        selectedId ?? '-',
        [...activeTypes].sort().join(','),
      ].join('|'),
    [mode, openCluster, range, cap, selectedId, activeTypes],
  )

  const toggleType = (t: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  // 节点点击：集群图里点簇 → 展开该簇；节点图里 → 详情 + 聚焦
  const handleSelect = (id: string | null) => {
    if (id && mode === 'cluster' && id.startsWith('cl:')) {
      setOpenCluster(id)
      setMode('cluster-open')
      return
    }
    if (mode === 'cluster') return
    setSelectedId(id)
  }
  // 空白点击：展开态 → 回集群图；集群图 → 无操作；节点图 → 退出聚焦
  const handleBlank = () => {
    if (mode === 'cluster-open') {
      setOpenCluster(null)
      setMode('cluster')
      return
    }
    if (mode === 'cluster') return
    setSelectedId(null)
  }

  const selName = selectedId ? byId.get(selectedId)?.name : null
  const openInfo = mode === 'cluster-open' && openCluster
    ? clusterView.clusters.find((c) => c.id === openCluster)
    : null
  const presetKey =
    PRESET_KEYS.find((k) => JSON.stringify(PRESETS[k].r) === JSON.stringify(range)) ?? 'custom'

  // 全文检索视图（RAG 阶段 0：关键词即时 + 浏览器内语义可选）
  if (view === 'search') {
    return (
      <div className="app">
        <aside className="title-strip" aria-label="标题">
          <div className="strip-head">
            <span className="strip-title">凡人修仙传</span>
            <span className="strip-sub">全文检索</span>
          </div>
          <span className="strip-stats">1631 章 · 浏览器内离线 RAG</span>
          <div className="strip-seal">检</div>
        </aside>
        <div className="app-col">
          <div className="control-bar">
            <button className="chip chip-on" style={{ borderColor: 'rgba(58,85,125,0.55)', color: '#3a557d', background: 'rgba(58,85,125,0.07)' }} onClick={() => setView('graph')} title="返回知识图谱">
              <i className="dot" style={{ background: '#7a8299' }} />
              返回图谱
            </button>
          </div>
          <main className="main" style={{ display: 'block' }}>
            <SearchPanel />
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <aside className="title-strip" aria-label="标题">
        <div className="strip-head">
          <span className="strip-title">凡人修仙传</span>
          <span className="strip-sub">修真图谱</span>
        </div>
        <span className="strip-stats">
          {graph.nodes.length} 实体 · {graph.edges.length} 关系 · 第 {graph.chapters[0]}-{graph.chapters[1]} 章
        </span>
        <div className="strip-seal">凡</div>
      </aside>

      <div className="app-col">
        <div className="control-bar">
          <button className="chip" style={{ borderColor: 'rgba(178,59,44,0.4)', color: '#9c2f22', background: 'rgba(178,59,44,0.05)' }} onClick={() => setView('search')} title="打开全文检索">
            <i className="dot" style={{ background: '#b23b2c' }} />
            全文检索
          </button>
          <button
            className={'chip' + (mode !== 'graph' ? ' chip-on' : '')}
            style={{
              borderColor: mode !== 'graph' ? 'rgba(58,85,125,0.55)' : 'rgba(34,37,43,0.22)',
              color: mode !== 'graph' ? '#3a557d' : '#8a8f99',
              background: mode !== 'graph' ? 'rgba(58,85,125,0.07)' : 'transparent',
            }}
            onClick={() => {
              if (mode === 'graph') {
                setMode('cluster')
                setOpenCluster(null)
                setSelectedId(null)
              } else {
                setMode('graph')
                setOpenCluster(null)
              }
            }}
            title="在 节点图 / 集群图 之间切换"
          >
            <i className="dot" style={{ background: '#7a8299', opacity: mode !== 'graph' ? 1 : 0.45 }} />
            {mode === 'graph' ? '集群视图' : '节点视图'}
          </button>
          {mode === 'graph' &&
            TYPE_ORDER.filter((t) => graph.nodes.some((n) => n.type === t)).map((t) => {
              const on = activeTypes.has(t)
              const m = TYPE_META[t]
              return (
                <button
                  key={t}
                  className={'chip' + (on ? ' chip-on' : '')}
                  style={{
                    borderColor: m.color + (on ? '99' : '44'),
                    color: on ? '#3a3f47' : '#9aa0a8',
                    background: on ? m.color + '14' : 'transparent',
                  }}
                  onClick={() => toggleType(t)}
                >
                  <i className="dot" style={{ background: m.color, opacity: on ? 1 : 0.35 }} />
                  {m.label}
                </button>
              )
            })}
          <span className="sep" />
          {mode === 'graph' && (
            <>
              <select className="ctl" value={presetKey} onChange={(e) => {
                const k = e.target.value
                if (k !== 'custom' && PRESETS[k]) setRange(PRESETS[k].r)
              }}>
                {PRESET_KEYS.map((k) => (
                  <option key={k} value={k}>{PRESETS[k].label}</option>
                ))}
                <option value="custom">自定义区间…</option>
              </select>
              <input
                className="ctl num"
                type="number" min={1} max={1631} value={range[0]}
                title="起始章"
                onChange={(e) => setRange([(+e.target.value || 1), range[1]])}
              />
              <span className="dash">—</span>
              <input
                className="ctl num"
                type="number" min={1} max={1631} value={range[1]}
                title="结束章"
                onChange={(e) => setRange([range[0], +e.target.value || 1631])}
              />
              <select
                className="ctl"
                value={cap}
                onChange={(e) => setCap(+e.target.value)}
                title="总览模式下最多显示的节点数（按关系数排序）"
              >
                <option value={0}>节点：全部（{shown.nodes.length}）</option>
                <option value={100}>节点：前 100（核心）</option>
                <option value={300}>节点：前 300（推荐）</option>
                <option value={800}>节点：前 800</option>
              </select>
            </>
          )}
          <span className="spacer" />
          {mode === 'cluster' && (
            <span className="toolbar-hint">
              集群图：{clusterView.clusters.length} 个簇（点簇展开 · 圈越大成员越多 · 线越粗往来越多）
            </span>
          )}
          {mode === 'cluster-open' && openInfo && (
            <span className="focus-badge">
              集群：{byId.get(openInfo.center)?.name} · {openInfo.size} 节点
              <button onClick={() => { setMode('cluster'); setOpenCluster(null) }}>返回集群图 ✕</button>
            </span>
          )}
          {mode === 'graph' && focus && (
            <span className="focus-badge">
              聚焦「{selName}」· {focus.count} 节点
              <button onClick={() => setSelectedId(null)}>返回总览 ✕</button>
            </span>
          )}
          {mode === 'graph' && !focus && (
            <span className="toolbar-hint">
              点击节点 → 聚焦其直接关系 · 空处点击 → 返回总览
            </span>
          )}
          <input
            className="search"
            placeholder="搜索人物 / 法宝 / 地点"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <a className="entities-entry" href="entities/" title="可访问的实体列表（按类型分类）" aria-label="打开实体列表">
            实体列表
          </a>
        </div>

        <main className="main">
          <GraphView
            nodes={shown.nodes}
            edges={shown.edges}
            focusId={focus ? selectedId : null}
            dataKey={dataKey}
            query={query}
            selectedId={selectedId}
            onSelect={handleSelect}
            onBlank={handleBlank}
          />
          <DetailPanel graph={graph} byId={byId} selectedId={selectedId} onSelect={setSelectedId} />
        </main>

        <footer className="footer">
          数据源：LLM 抽取流水线（prompt v0.2）· 内容仅事实性条目整理，不含原文摘录 · 图片策略 L0（纯文字，无位图）
        </footer>
      </div>
    </div>
  )
}
