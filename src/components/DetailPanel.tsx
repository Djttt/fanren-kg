import { TYPE_META, REL_LABEL, type KGNode, type GraphData } from '../data/graph'

interface Props {
  selectedId: string | null
  onSelect: (id: string | null) => void
  graph: GraphData
  byId: Map<string, KGNode>
}

export default function DetailPanel({ selectedId, onSelect, graph, byId }: Props) {
  const sel = selectedId ? byId.get(selectedId) : null

  if (!sel) {
    return (
      <aside className="panel">
        <button className="panel-close" aria-label="关闭词条" onClick={() => onSelect(null)}>✕</button>
        <div className="panel-empty">
          <div className="seal"><span>图谱</span></div>
          <p>点击图中节点查看条目</p>
          <p className="dim">
            {graph.nodes.length} 个实体 · {graph.allEdges.length} 条关系
            <br />
            正文第 {graph.chapters[0]}-{graph.chapters[1]} 章全量数据
          </p>
        </div>
      </aside>
    )
  }

  const meta = TYPE_META[sel.type]
  // 用全部关系实例（含跨章重复）构建时间线 → 显示 ×N 次 与章节小票
  const related = graph.allEdges.filter((e) => e.source === sel.id || e.target === sel.id)

  // 时间线：按 (对方, 关系类型) 分组，按首次出现章排序
  interface TLItem {
    otherId: string
    other: KGNode | undefined
    type: string
    chapters: number[]
    dir: '→' | '←'
    note: string
  }
  const tlMap = new Map<string, TLItem>()
  for (const e of related) {
    const otherId = e.source === sel.id ? e.target : e.source
    const key = otherId + '|' + e.type
    const g = tlMap.get(key)
    if (g) {
      g.chapters.push(e.chapter)
      if (!g.note && e.note) g.note = e.note
    } else {
      tlMap.set(key, {
        otherId,
        other: byId.get(otherId),
        type: e.type,
        chapters: [e.chapter],
        dir: e.source === sel.id ? '→' : '←',
        note: e.note || '',
      })
    }
  }
  const timeline = [...tlMap.values()]
    .map((g) => ({ ...g, chapters: [...new Set(g.chapters)].sort((a, b) => a - b) }))
    .sort((a, b) => a.chapters[0] - b.chapters[0])

  return (
    <aside className="panel">
      <button className="panel-close" aria-label="关闭词条" onClick={() => onSelect(null)}>✕</button>
      <div className="panel-head">
        <div className="type-row">
          <span className="type-seal">{meta?.seal}</span>
          <span className="type-label">{meta?.label}</span>
        </div>
        <h2>{sel.name}</h2>
      </div>
      {sel.aliases.length > 0 && (
        <div className="alias-row">
          {sel.aliases.map((a) => (
            <span key={a} className="alias">{a}</span>
          ))}
        </div>
      )}
      <a className="wiki-link" href={`entities/${sel.id}.html`} target="_blank" rel="noreferrer">
        查看百科页
      </a>
      <div className="kv">
        <div className="kv-row"><span>首次出现</span><span>第 {sel.firstSeen} 章</span></div>
        {Object.entries(sel.attrs).map(([k, v]) => (
          <div className="kv-row" key={k}><span>{attrLabel(k)}</span><span>{v}</span></div>
        ))}
      </div>
      {sel.notes && <p className="notes">{sel.notes}</p>}
      <div className="rel-section">
        <h3>关系时间线（{timeline.length} 组 · {related.length} 条）</h3>
        {timeline.map((g) => (
          <div
            className="tl-item"
            key={g.otherId + g.type}
            style={{ ['--tl-dot' as string]: g.other ? TYPE_META[g.other.type]?.color : undefined } as React.CSSProperties}
          >
            <div className="tl-head">
              <span className="tl-ch">第 {g.chapters[0]} 章</span>
              {g.chapters.length > 1 && (
                <span className="tl-more">×{g.chapters.length} 次</span>
              )}
              <span className="rel-type">{REL_LABEL[g.type] || g.type}</span>
              <span className="rel-dir">{g.dir}</span>
              <span
                className="rel-name"
                style={{ color: g.other ? TYPE_META[g.other.type]?.color : undefined }}
                onClick={() => g.other && onSelect(g.otherId)}
              >
                {g.other ? g.other.name : g.otherId}
              </span>
            </div>
            {g.chapters.length > 1 && (
              <div className="tl-chaps">
                {g.chapters.slice(0, 10).map((c) => (
                  <i key={c} className="tl-chap">{c}</i>
                ))}
                {g.chapters.length > 10 && <i className="tl-chap dim">…</i>}
              </div>
            )}
            {g.note && <div className="tl-note" title={g.note}>{g.note}</div>}
          </div>
        ))}
        {related.length === 0 && <p className="dim">暂无关联（孤立节点，待后续章节补边）</p>}
      </div>
    </aside>
  )
}

function attrLabel(k: string): string {
  const map: Record<string, string> = {
    appearance: '登场方式', sex: '性别', age: '年龄', role: '身份',
    status: '状态', kind: '类别', subtype: '细分',
  }
  return map[k] || k
}
