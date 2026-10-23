import { useEffect, useMemo, useRef, useState } from 'react'
import { buildIndex, search, bestSentence, contextAround } from '../lib/lexical.mjs'
import { initSemantic, semanticSearch, setSemDevicePref, type SemStatus } from '../lib/semantic'
import { initLLM, generateAnswer, setGenDevicePref, type GenStatus } from '../lib/llm'
import { loadBlob, asset } from '../lib/idb'

interface Chapter { chapter: number; title: string; text: string; chars: number }
interface Res { chapter: number; title: string; text: string; src: 'lex' | 'sem'; score: number }

const C = { paper: '#f2efe8', ink: '#22252b', dai: '#3a557d', zhu: '#b23b2c', dim: '#8a8f99', line: 'rgba(34,37,43,.14)' }
const SERIF = '"Songti SC","STSong","Noto Serif SC",serif'

// 完全离线 RAG 面板：关键词(BM25, 离线即时) 恒可用；语义(本地 BGE-512 + 预存向量) 就绪即并入；
// AI 生成(浏览器内 Qwen3-0.6B, Worker) 对 top-3 依据作答并标章节。模型/运行时全在 public/，无网可跑。
export default function SearchPanel() {
  const [chapters, setChapters] = useState<Chapter[] | null>(null)
  const [lexIdx, setLexIdx] = useState<any>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Res[]>([])
  const [sem, setSem] = useState<SemStatus>({ stage: 'idle' })
  const [ai, setAi] = useState(false)
  const [gen, setGen] = useState<GenStatus>({ stage: 'idle' })
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [dev, setDev] = useState<'auto' | 'webgpu' | 'wasm'>('auto')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const cs = await loadBlob<Chapter[]>('corpus', asset('corpus.json'), 'json')
        if (!alive) return
        setChapters(cs)
        setLexIdx(buildIndex(cs))
        // 预热语义（本地嵌入模型 + 语料向量，写 IndexedDB 缓存）；失败回落关键词
        initSemantic((s) => { if (alive) setSem(s) })
          .catch((e) => { if (alive) setSem({ stage: 'error', note: e?.message || String(e) }) })
      } catch (e: any) {
        if (alive) setLoadErr('加载语料失败：' + (e?.message || e))
      }
    })()
    return () => { alive = false }
  }, [])

  const titleOf = (chapter: number) => chapters?.find((c) => c.chapter === chapter)?.title || `第${chapter}章`

  const runLexical = (q: string): Res[] => {
    if (!lexIdx || !chapters) return []
    return search(lexIdx, q, 12).map((h) => ({
      chapter: chapters[h.i].chapter,
      title: chapters[h.i].title,
      text: bestSentence(chapters[h.i].text, q, 130),
      src: 'lex' as const,
      score: h.s,
    }))
  }

  const chapterContext = (chapter: number, q: string) => {
    const ch = chapters?.find((c) => c.chapter === chapter)
    return ch ? contextAround(ch.text, q, 900) : ''
  }

  const doSearch = async (raw?: string) => {
    const q = (raw ?? query).trim()
    if (!q || !chapters) return
    setQuery(q)
    setAnswer('')
    const lex = runLexical(q)
    let semRes: Res[] = []
    if (sem.stage !== 'error') {
      try {
        setBusy(true)
        const hits = await semanticSearch(q, 12, setSem)
        semRes = hits.map((h) => ({ chapter: h.chapter, title: titleOf(h.chapter), text: h.text, src: 'sem' as const, score: h.score }))
      } catch (e: any) {
        setSem({ stage: 'error', note: e?.message || String(e) })
      } finally {
        setBusy(false)
      }
    }
    const merged = mergeResults(semRes, lex)
    setResults(merged)
    if (ai && merged.length) runAI(q, merged)
  }

  const runAI = async (q: string, res: Res[]) => {
    if (!ai || !chapters) return
    try {
      await initLLM(setGen)
      const passages = res.slice(0, 3).map((r) => ({ chapter: r.chapter, title: r.title, context: chapterContext(r.chapter, q) }))
      const t = await generateAnswer(q, passages, setGen)
      setAnswer(t || '（模型未返回有效内容，见下方依据）')
    } catch (e: any) {
      setGen({ stage: 'error', note: e?.message || String(e) })
    }
  }

  const toggleAI = () => {
    const next = !ai
    setAi(next)
    if (next) initLLM(setGen).catch((e) => setGen({ stage: 'error', note: e?.message || String(e) }))
    else setAnswer('')
  }

  const onDev = (v: 'auto' | 'webgpu' | 'wasm') => {
    setDev(v)
    setSemDevicePref(v)
    setGenDevicePref(v)
  }

  const maxBy = useMemo(() => {
    const m: Record<'lex' | 'sem', number> = { lex: 1, sem: 1 }
    for (const r of results) m[r.src] = Math.max(m[r.src], r.score)
    return m
  }, [results])

  if (loadErr) return <div style={box}><p style={{ color: C.zhu }}>{loadErr}</p></div>
  if (!chapters) return <div style={box}><p style={{ color: C.dim }}>研墨中… 载入 1631 章语料并建索引</p></div>

  const semText =
    sem.stage === 'error' ? '语义不可用（已用关键词）' + (sem.note ? '：' + sem.note : '')
      : sem.stage === 'ready' ? `语义就绪 · ${sem.note}`
      : (sem.note || '') + (sem.pct != null ? ` ${sem.pct}%` : '')

  const genActive = ai && (answer || gen.stage === 'model' || gen.stage === 'gen')
  const genText =
    gen.stage === 'error' ? 'AI 生成失败：' + (gen.note || '')
      : gen.stage === 'gen' ? gen.note
      : gen.stage === 'model' ? (gen.note || '')
      : gen.stage === 'ready' ? '已生成（基于下方依据）'
      : ai ? 'AI 生成待加载…' : ''

  return (
    <div style={{ ...box, maxWidth: 880, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <span style={{ ...seal, background: C.zhu }}>检</span>
        <div>
          <h1 style={{ margin: 0, fontFamily: SERIF, fontSize: 24, letterSpacing: 2, color: C.ink }}>全文检索</h1>
          <div style={{ fontSize: 12, color: C.dai, letterSpacing: 1 }}>1631 章 · {chapters.reduce((s, c) => s + c.chars, 0).toLocaleString()} 字 · 浏览器内离线 RAG</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }}
          placeholder="问一句，例如：韩立的师傅是谁 / 青竹蜂云剑的来历 / 飞升灵界"
          style={{ flex: '2 1 240px', padding: '11px 14px', fontSize: 15, border: `1px solid ${C.line}`, borderRadius: 4, background: '#fff', color: C.ink, fontFamily: 'inherit', outline: 'none' }}
        />
        <button onClick={() => doSearch()} disabled={busy} style={btn(C.ink, C.paper)}>检索</button>
        <select
          value={dev}
          onChange={(e) => onDev(e.target.value as any)}
          title="推理设备：WASM/CPU 为基线（兼容性最好），检测到 WebGPU 时自动用它加速"
          style={{ padding: '9px 10px', fontSize: 13, border: `1px solid ${C.line}`, borderRadius: 4, background: '#fff', color: C.ink, fontFamily: 'inherit' }}
        >
          <option value="auto">设备：自动（WASM 基线 / WebGPU 加速）</option>
          <option value="webgpu">设备：WebGPU</option>
          <option value="wasm">设备：WASM / CPU</option>
        </select>
        <button onClick={toggleAI} title="用浏览器内 Qwen3-0.6B 对 top-3 依据生成带章节引用的自然语言答案" style={btn(ai ? C.dai : C.dim, ai ? 'rgba(58,85,125,.08)' : 'transparent')}>
          {ai ? '◉ AI 生成' : '○ AI 生成'}
        </button>
      </div>

      <div style={{ fontSize: 12, color: (busy || gen.stage === 'gen') ? C.zhu : C.dim, marginBottom: 12, minHeight: 16 }}>
        {busy ? '检索中… ' : ''}{semText}{ai ? '  ·  ' + genText : ''}
      </div>

      {genActive && (
        <div style={{ marginBottom: 16, padding: '14px 16px', border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.dai}`, borderRadius: 4, background: 'rgba(58,85,125,.04)' }}>
          <div style={{ fontSize: 12, color: C.dai, letterSpacing: 1, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, background: C.dai, borderRadius: '50%' }} />AI 生成答案
          </div>
          {gen.stage === 'gen' || gen.stage === 'model'
            ? <p style={{ margin: 0, fontSize: 13.5, color: C.dim }}>{genText}</p>
            : <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.85, color: C.ink, whiteSpace: 'pre-wrap' }}>{answer}</p>}
        </div>
      )}

      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 6 }}>
        {results.length === 0 && (
          <p style={{ color: C.dim, fontSize: 13 }}>
            {sem.stage === 'ready'
              ? '输入问题后点「检索」或回车。'
              : '语义未就绪（可能缺本地模型/向量）；关键词检索随时可用——点「检索」或回车。'}
          </p>
        )}
        {results.map((r, i) => (
          <div key={r.chapter + r.src + i} style={card}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontFamily: SERIF, fontSize: 20, color: i === 0 ? C.zhu : C.dai, minWidth: 30 }}>#{i + 1}</span>
              <span style={{ fontFamily: SERIF, fontSize: 16, color: C.ink, fontWeight: 600 }}>第{r.chapter}章　{r.title}</span>
              <span style={badge(r.src)}>{r.src === 'sem' ? '语义' : '关键词'}</span>
              <span style={{ flex: 1, height: 4, background: 'rgba(34,37,43,.06)', borderRadius: 2, overflow: 'hidden', minWidth: 40 }}>
                <span style={{ display: 'block', height: '100%', width: `${Math.max(6, Math.min(100, (r.score / maxBy[r.src]) * 100))}%`, background: r.src === 'sem' ? C.dai : C.zhu, opacity: 0.7 }} />
              </span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 13.5, lineHeight: 1.7, color: '#3a3f47' }}>{r.text}</p>
          </div>
        ))}
      </div>

      <p style={{ marginTop: 18, fontSize: 11, color: C.dim, lineHeight: 1.7 }}>
        完全离线 RAG：语义 = BGE-Small-ZH(512 维) 本地嵌入 + 预存向量余弦 · AI 生成 = 浏览器内 Qwen3-0.6B（Web Worker，WASM 基线 / WebGPU 加速），仅依据 top-3 片段作答并标章节 · 模型/运行时/库本体都在 public/（断网也能跑）· 缺模型时自动回落关键词(BM25)，并给出可读错误
      </p>
    </div>
  )
}

function mergeResults(sem: Res[], lex: Res[]): Res[] {
  const seen = new Set<number>()
  const out: Res[] = []
  for (const r of [...sem, ...lex]) {
    if (seen.has(r.chapter)) continue
    seen.add(r.chapter)
    out.push(r)
    if (out.length >= 12) break
  }
  return out
}

const box: React.CSSProperties = { padding: '22px 24px 48px', color: C.ink }
const seal: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 40, height: 40, color: '#f7f2ea', fontFamily: SERIF, fontSize: 20, borderRadius: 3, flexShrink: 0 }
const card: React.CSSProperties = { padding: '12px 4px', borderBottom: `1px dashed ${C.line}` }
function btn(fg: string, bg: string): React.CSSProperties {
  return { padding: '10px 16px', fontSize: 14, border: `1px solid ${fg}`, borderRadius: 4, background: bg, color: fg, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
}
function badge(src: 'lex' | 'sem'): React.CSSProperties {
  const sem = src === 'sem'
  return { fontSize: 10.5, padding: '1px 7px', borderRadius: 3, border: `1px solid ${sem ? C.dai : C.zhu}`, color: sem ? C.dai : C.zhu, flexShrink: 0 }
}
