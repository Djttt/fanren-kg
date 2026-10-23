// 纯 JS 中文关键词检索（BM25 + 单字/双字）。无 DOM、无模型、无网络 → 离线秒出，作语义检索的兜底。
// 可被 Node 直接 require/import 测试，也被浏览器 bundle。

const CJK = /[一-鿿㐀-䶿]/g

/** 分词：CJK 单字 + 相邻双字（双字信息量更高，二者一并作为词条参与 BM25） */
export function tokenize(text) {
  const c = String(text).match(CJK) || []
  const out = []
  for (let i = 0; i < c.length; i++) {
    out.push(c[i])
    if (i + 1 < c.length) out.push(c[i] + c[i + 1])
  }
  return out
}

/** 建倒排/词频索引。chapters: [{chapter,title,text,chars}] */
export function buildIndex(chapters) {
  const k1 = 1.5, b = 0.75, N = chapters.length
  const df = new Map()
  const docs = []
  let totalLen = 0
  for (const ch of chapters) {
    const terms = tokenize(ch.text)
    const tf = new Map()
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1)
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1)
    docs.push({ tf, len: terms.length })
    totalLen += terms.length
  }
  const avgdl = N ? totalLen / N : 1
  const idf = new Map()
  for (const [t, f] of df) idf.set(t, Math.log(1 + (N - f + 0.5) / (f + 0.5)))
  return { docs, idf, avgdl, k1, b, N }
}

/** BM25 打分，返回 [{i, score}]（按分降序，取前 k） */
export function search(idx, query, k = 10) {
  const qterms = tokenize(query)
  const scores = new Array(idx.N).fill(0)
  for (const t of qterms) {
    const idf = idx.idf.get(t)
    if (idf === undefined) continue
    for (let i = 0; i < idx.N; i++) {
      const tf = idx.docs[i].tf.get(t)
      if (!tf) continue
      const dl = idx.docs[i].len
      scores[i] += idf * (tf * (idx.k1 + 1)) / (tf + idx.k1 * (1 - idx.b + (idx.b * dl) / idx.avgdl))
    }
  }
  return scores
    .map((s, i) => ({ i, s }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
}

/** 按句切分 */
export function sentences(text) {
  return String(text).split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean)
}

/** 从一章里挑与查询最相关的一句作"命中片段"（按词条重叠） */
export function bestSentence(text, query, maxLen = 110) {
  const qset = new Set(tokenize(query))
  const sents = sentences(text)
  if (!sents.length) return text.slice(0, maxLen)
  let best = sents[0], bs = -1
  for (const s of sents) {
    const st = new Set(tokenize(s))
    let ov = 0
    for (const t of qset) if (st.has(t)) ov++
    if (ov > bs) { bs = ov; best = s }
  }
  return best.length > maxLen ? best.slice(0, maxLen) + '…' : best
}

/** 以最佳句为中心向外扩，取一段 ~budget 字的上下文（喂给 LLM 用） */
export function contextAround(text, query, budget = 900) {
  const sents = sentences(text)
  if (!sents.length) return text.slice(0, budget)
  const qset = new Set(tokenize(query))
  let bestIdx = 0, bs = -1
  sents.forEach((s, i) => {
    const st = new Set(tokenize(s))
    let ov = 0
    for (const t of qset) if (st.has(t)) ov++
    if (ov > bs) { bs = ov; bestIdx = i }
  })
  let lo = bestIdx, hi = bestIdx
  let len = sents[bestIdx].length
  while (len < budget) {
    const lc = lo > 0 ? sents[lo - 1].length : Infinity
    const rc = hi < sents.length - 1 ? sents[hi + 1].length : Infinity
    if (lc === Infinity && rc === Infinity) break
    if (lc <= rc) { lo--; len += sents[lo].length } else { hi++; len += sents[hi].length }
  }
  return sents.slice(lo, hi + 1).join('')
}
