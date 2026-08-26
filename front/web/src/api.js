// DOTCADE — 서버 API 클라이언트 (+SSE 스트리밍 리더)
const J = r => {
  if (!r.ok) return r.json().catch(() => ({})).then(b => { throw new Error(b.error || `HTTP ${r.status}`) })
  return r.json()
}

export const api = {
  config: () => fetch('/api/config').then(J),
  redetect: () => fetch('/api/config/redetect', { method: 'POST' }).then(J),

  generate: body => fetch('/api/llm/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(J),

  // SSE stream → onDelta(text) 콜백, 최종 {text, sources} 반환
  async stream(body, onDelta) {
    const r = await fetch('/api/llm/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
    if (!r.ok || !r.body) throw new Error(`stream HTTP ${r.status}`)
    const reader = r.body.getReader(); const dec = new TextDecoder()
    let buf = '', final = { text: '', sources: [] }
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\n\n'); buf = parts.pop()
      for (const p of parts) {
        const line = p.split('\n').find(l => l.startsWith('data:'))
        if (!line) continue
        try {
          const d = JSON.parse(line.slice(5))
          if (d.delta) { final.text += d.delta; onDelta && onDelta(d.delta, final.text) }
          if (d.done) { final.text = d.text ?? final.text; final.sources = d.sources || [] }
          if (d.error) throw new Error(d.error)
        } catch (e) { if (e.message && !String(e.message).includes('JSON')) throw e }
      }
    }
    return final
  },

  // Tavily 웹 검색 (서버가 키 로테이션 처리)
  search: (query, maxResults = 5) => fetch('/api/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, maxResults })
  }).then(J),

  // 기획 기반 게임/UI 레퍼런스 탐색. SSE로 키워드·병렬 검색·타겟 선정 진행 상황을 전달한다.
  async referenceResearch(body, onProgress) {
    const r = await fetch('/api/reference-research/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
    if (!r.ok || !r.body) throw new Error(`reference research HTTP ${r.status}`)
    const reader = r.body.getReader(); const dec = new TextDecoder()
    let buf = '', final = null
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\n\n'); buf = parts.pop()
      for (const part of parts) {
        const line = part.split('\n').find(item => item.startsWith('data:'))
        if (!line) continue
        let event
        try { event = JSON.parse(line.slice(5)) } catch { continue }
        if (event.type === 'progress') onProgress?.(event.progress)
        if (event.type === 'done') final = event.result
        if (event.type === 'error') throw new Error(event.error || 'reference research failed')
      }
    }
    if (!final) throw new Error('reference research 결과가 없습니다')
    return final
  },

  ragUpsert: docs => fetch('/api/rag/upsert', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs })
  }).then(J).catch(() => ({})),
  ragQuery: (text, k = 4, filter = {}) => fetch('/api/rag/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, k, filter })
  }).then(J).catch(() => ({ results: [] })),

  games: () => fetch('/api/games').then(J),
  game: id => fetch(`/api/games/${id}`).then(J),
  createGame: body => fetch('/api/games', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(J),
  addVersion: (id, body) => fetch(`/api/games/${id}/versions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(J),
  files: (id, ref) => fetch(`/api/games/${id}/files${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`).then(J),
  gitlog: id => fetch(`/api/games/${id}/log`).then(J),
  diff: (id, from, to) => fetch(`/api/games/${id}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then(J),
  bundle: (id, v) => fetch(`/api/games/${id}/bundle${v ? `?v=${encodeURIComponent(v)}` : ''}`).then(J),
  saveFeedback: (id, body) => fetch(`/api/games/${id}/feedback`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(J),

  createMeeting: body => fetch('/api/meetings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(J),
  patchMeeting: (id, body) => fetch(`/api/meetings/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(J).catch(() => ({})),

  chatHistory: agent => fetch(`/api/chats/${agent}`).then(J),
  chatAppend: (agent, messages) => fetch(`/api/chats/${agent}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages })
  }).then(J).catch(() => ({}))
}
