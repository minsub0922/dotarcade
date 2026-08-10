// DOTCADE — RAG store (임베딩 업서트 + 코사인 검색) — 프로필별 vectors.json
import fs from 'node:fs'
import path from 'node:path'
import { provider } from './gemini.js'

const cos = (a, b) => {
  if (!a || !b || a.length !== b.length) return -1
  let s = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return s / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

export function makeRag(vecPath) {
  fs.mkdirSync(path.dirname(vecPath), { recursive: true })
  let store = []
  try { store = JSON.parse(fs.readFileSync(vecPath, 'utf8')) } catch { store = [] }

  let t = null
  const save = () => { clearTimeout(t); t = setTimeout(() => fs.writeFileSync(vecPath, JSON.stringify(store)), 300) }

  return {
    async upsert(docs) { // [{id, kind, gameId?, text}]
      const vecs = await provider().embed(docs.map(d => d.text))
      docs.forEach((d, i) => {
        store = store.filter(s => s.id !== d.id)
        store.push({ ...d, text: String(d.text).slice(0, 4000), vec: vecs[i], dim: vecs[i]?.length })
      })
      save()
      return { count: store.length }
    },
    async query(text, k = 4, filter = {}) {
      if (!store.length) return []
      const [qv] = await provider().embed([text])
      return store
        .filter(s => (!filter.kind || s.kind === filter.kind) && (!filter.gameId || s.gameId === filter.gameId) && s.dim === qv.length)
        .map(s => ({ ...s, score: cos(qv, s.vec) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(({ vec, dim, ...rest }) => rest)
    },
    count: () => store.length
  }
}
