// IndexedDB 持久层：缓存 corpus.json / vectors.json / vectors.bin，
// 实现「刷新后知识库仍在、离线重载入得进」（验收项之一）。仅浏览器端使用。
export const BASE = ((import.meta as any).env?.BASE_URL || '/').replace(/\/$/, '') || ''

/** 站内的绝对资源路径（供 fetch 与 Worker 内的 import() 使用，避免相对路径解析错）。 */
export function asset(p: string): string {
  const b = BASE ? (BASE.endsWith('/') ? BASE : BASE + '/') : '/'
  return b + p
}

const DB_NAME = 'fr-rag'
const DB_VER = 1
const STORE = 'kv'

let _db: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  if (_db) return _db
  _db = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('当前环境不支持 IndexedDB'))
    const rq = indexedDB.open(DB_NAME, DB_VER)
    rq.onupgradeneeded = () => {
      const db = rq.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    rq.onsuccess = () => res(rq.result)
    rq.onerror = () => rej(rq.error || new Error('打开 IndexedDB 失败'))
  })
  return _db
}

export async function idbGet<T = any>(key: string): Promise<T | undefined> {
  const db = await open()
  return new Promise((res, rej) => {
    const rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    rq.onsuccess = () => res(rq.result as T)
    rq.onerror = () => rej(rq.error)
  })
}

export async function idbSet(key: string, value: any): Promise<void> {
  const db = await open()
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readwrite')
    t.objectStore(STORE).put(value, key)
    t.oncomplete = () => res()
    t.onerror = () => rej(t.error)
  })
}

/** 优先 IndexedDB 缓存；缺失则 fetch 并写入缓存。缓存不可用时直接返回 fetch 结果。 */
export async function loadBlob<T = any>(key: string, url: string, type: 'json' | 'array' = 'json'): Promise<T> {
  try {
    const cached = await idbGet<T>(key)
    if (cached) return cached
  } catch {}
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载 ${url} 失败（HTTP ${res.status}）`)
  const value = type === 'json' ? (await res.json()) : new Uint8Array(await res.arrayBuffer())
  try { await idbSet(key, value) } catch {}
  return value as T
}
