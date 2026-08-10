// DOTCADE — Tavily 웹서치 클라이언트 (무료 키 로테이션)
// 라운드로빈 부하 분산 + 실패 시 다음 키로 자동 전환 + 쿼터 초과 쿨다운 + 무효 키 영구 비활성
const parseKeys = () =>
  (process.env.BACK_TAVILY_API_KEYS || process.env.BACK_TAVILY_API_KEY || '')
    .split(/[,\s]+/).map(s => s.trim()).filter(Boolean)

let ring = null   // [{ key, ok, fails, dead, cooldownUntil, lastError }]
let cursor = 0

function ensureRing() {
  const keys = parseKeys()
  if (!ring || ring.length !== keys.length || ring.some((r, i) => r.key !== keys[i])) {
    ring = keys.map(key => ({ key, ok: 0, fails: 0, dead: false, cooldownUntil: 0, lastError: null }))
    cursor = 0
  }
  return ring
}

const mask = k => (k.length > 14 ? `${k.slice(0, 9)}…${k.slice(-4)}` : '***')
const now = () => Date.now()

async function callTavily(entry, query, { maxResults = 5, includeAnswer = true, timeoutMs = 12000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${entry.key}` },
      body: JSON.stringify({
        api_key: entry.key,
        query: String(query).slice(0, 380),
        max_results: Math.max(1, Math.min(8, maxResults)),
        include_answer: includeAnswer,
        search_depth: 'basic'
      }),
      signal: ctl.signal
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      const err = new Error(`Tavily ${r.status}: ${body.slice(0, 160)}`)
      err.status = r.status
      throw err
    }
    const data = await r.json()
    return {
      answer: data.answer || '',
      results: (data.results || []).map(x => ({ title: x.title, url: x.url, content: x.content, score: x.score }))
    }
  } finally { clearTimeout(t) }
}

function recordFail(entry, e) {
  entry.fails++
  entry.lastError = String(e.message || e).slice(0, 200)
  if (e.status === 401 || e.status === 403) entry.dead = true                                  // 무효 키 → 영구 제외
  else if (e.status === 429 || e.status === 432 || e.status === 433)
    entry.cooldownUntil = now() + Math.min(60, 5 * entry.fails) * 60 * 1000                     // 쿼터/속도 초과 → 5~60분 쿨다운
  else entry.cooldownUntil = now() + 30 * 1000                                                  // 네트워크 등 일시 오류 → 30초
}

export const tavily = {
  enabled: () => ensureRing().length > 0,

  state() {
    return ensureRing().map((r, i) => ({
      idx: i + 1, key: mask(r.key), ok: r.ok, fails: r.fails, dead: r.dead,
      coolingSec: Math.max(0, Math.round((r.cooldownUntil - now()) / 1000)), lastError: r.lastError
    }))
  },

  // 로테이션 검색: 살아있는 키부터 라운드로빈, 실패하면 즉시 다음 키로
  async search(query, opts = {}) {
    const R = ensureRing()
    if (!R.length) throw new Error('BACK_TAVILY_API_KEYS 미설정')
    let lastErr
    for (let hop = 0; hop < R.length; hop++) {
      const entry = R[(cursor + hop) % R.length]
      if (entry.dead || entry.cooldownUntil > now()) continue
      try {
        const out = await callTavily(entry, query, opts)
        entry.ok++; entry.fails = 0; entry.lastError = null
        cursor = (R.indexOf(entry) + 1) % R.length      // 다음 요청은 다음 키부터 (부하 분산)
        return { ...out, keyIdx: R.indexOf(entry) + 1, key: mask(entry.key) }
      } catch (e) { lastErr = e; recordFail(entry, e) }
    }
    const usable = R.filter(r => !r.dead && r.cooldownUntil <= now()).length
    throw lastErr || new Error(`사용 가능한 Tavily 키 없음 (총 ${R.length}개, 활성 ${usable}개)`)
  },

  // 전체 키 헬스체크 — 키당 초소형 검색 1회 (성공 시 쿨다운 해제)
  async health() {
    const R = ensureRing()
    return Promise.all(R.map(async (entry, i) => {
      try {
        await callTavily(entry, 'dotcade ping', { maxResults: 1, includeAnswer: false, timeoutMs: 9000 })
        entry.ok++; entry.fails = 0; entry.cooldownUntil = 0; entry.dead = false; entry.lastError = null
        return { idx: i + 1, key: mask(entry.key), status: 'ok' }
      } catch (e) {
        recordFail(entry, e)
        return { idx: i + 1, key: mask(entry.key), status: 'fail', error: entry.lastError }
      }
    }))
  }
}
