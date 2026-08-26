// DOTCADE 서버 — Gemini 프록시 · git 게임 레포 · 공유 플레이어 · 브라우저별 독립 JSON DB
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import express from 'express'
import { ensureSeed, seedCtx, profileMiddleware } from './lib/profiles.js'
import { provider, llmState, detectLLM, models } from './lib/gemini.js'
import { tavily } from './lib/tavily.js'
import { runReferenceResearch } from './lib/reference-research.js'
import { seedDefaults } from './lib/seed.js'
import {
  cancelMeetingRecord,
  commitMeetingMutation,
  createMeetingInStore,
  getActiveMeetingRecord,
  getMeetingRecord,
  inspectGameCreation,
  inspectVersionRelease,
  interruptMeetingRecord,
  patchMeetingRecord,
  putMeetingCheckpoint,
  resumeMeetingRecord
} from './lib/meeting-checkpoints.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
config({ path: path.join(ROOT, '..', '.env') })

const app = express()
app.use(express.json({ limit: '4mb' }))

// 브라우저별 프로필 (쿠키 → data/profiles/<id>, 최초 접속 시 seed 복제)
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/play')) return profileMiddleware(req, res, next)
  next()
})

// ---------------- config ----------------
app.get('/api/config', (req, res) => {
  res.json({
    llm: llmState.mode, llmError: llmState.lastError, workingModel: llmState.workingModel,
    models: { smart: models.smart(), fast: models.fast(), embed: models.embed() },
    hasKey: !!process.env.BACK_GEMINI_API_KEY,
    webSearch: tavily.enabled(),
    profile: req.p.id
  })
})
app.post('/api/config/redetect', async (req, res) => res.json(await detectLLM()))

// ---------------- LLM proxy ----------------
app.post('/api/llm/generate', async (req, res) => {
  try {
    const out = await provider().generate(req.body || {})
    res.json(out)
  } catch (e) { res.status(502).json({ error: String(e.message || e) }) }
})

app.post('/api/llm/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`)
  try {
    const out = await provider().stream(req.body || {}, delta => send({ delta }))
    send({ done: true, text: out.text, sources: out.sources || [], model: out.model })
  } catch (e) {
    send({ error: String(e.message || e) })
  }
  res.end()
})

app.post('/api/llm/embed', async (req, res) => {
  try {
    res.json({ vectors: await provider().embed(req.body?.texts || []) })
  } catch (e) { res.status(502).json({ error: String(e.message || e) }) }
})

// ---------------- web search (Tavily 키 로테이션) ----------------
app.post('/api/search', async (req, res) => {
  try {
    const { query, maxResults } = req.body || {}
    if (!query || !String(query).trim()) return res.status(400).json({ error: 'query 필요' })
    if (!tavily.enabled()) return res.status(503).json({ error: 'BACK_TAVILY_API_KEYS 미설정' })
    res.json(await tavily.search(String(query), { maxResults: maxResults || 5 }))
  } catch (e) { res.status(502).json({ error: String(e.message || e) }) }
})
app.get('/api/search/health', async (req, res) => {
  if (!tavily.enabled()) return res.status(503).json({ error: 'BACK_TAVILY_API_KEYS 미설정' })
  res.json({ keys: await tavily.health() })
})
app.get('/api/search/state', (req, res) => res.json({ enabled: tavily.enabled(), state: tavily.state() }))

// ---------------- game/UI reference research ----------------
// 일반 JSON 응답과 진행 상황이 필요한 SSE 응답을 함께 제공한다.
const referenceDeps = emit => ({
  emit,
  search: tavily.enabled() ? (query, options) => tavily.search(query, options) : null,
  generate: llmState.mode === 'live' ? options => provider().generate(options) : null
})

app.post('/api/reference-research', async (req, res) => {
  try {
    res.json(await runReferenceResearch(req.body || {}, referenceDeps()))
  } catch (e) {
    const message = String(e.message || e)
    res.status(message === 'agenda 필요' ? 400 : 502).json({ error: message })
  }
})

app.post('/api/reference-research/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  let closed = false
  res.on('close', () => { closed = true })
  const send = payload => {
    if (!closed && !res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }
  try {
    const result = await runReferenceResearch(req.body || {}, referenceDeps(progress => send({ type: 'progress', progress })))
    send({ type: 'done', result })
  } catch (e) {
    send({ type: 'error', error: String(e.message || e) })
  }
  if (!res.writableEnded) res.end()
})

// ---------------- RAG ----------------
app.post('/api/rag/upsert', async (req, res) => {
  try { res.json(await req.p.rag.upsert(req.body?.docs || [])) }
  catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})
app.post('/api/rag/query', async (req, res) => {
  try { res.json({ results: await req.p.rag.query(req.body?.text || '', req.body?.k || 4, req.body?.filter || {}) }) }
  catch (e) { res.json({ results: [], error: String(e.message || e) }) }
})

// ---------------- games ----------------
const publicGame = g => ({ ...g })
const releaseInflight = new Map()

const httpError = (status, message, code = null) => {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

const withReleaseLock = (key, task) => {
  if (releaseInflight.has(key)) return releaseInflight.get(key)
  const promise = Promise.resolve().then(task).finally(() => {
    if (releaseInflight.get(key) === promise) releaseInflight.delete(key)
  })
  releaseInflight.set(key, promise)
  return promise
}

const sendRouteError = (res, error, fallbackStatus = 500) => {
  const status = Number(error?.status) || fallbackStatus
  const body = { error: String(error?.message || error) }
  if (error?.code) body.code = error.code
  if (error?.details) body.details = error.details
  return res.status(status).json(body)
}

app.get('/api/games', (req, res) => res.json({ games: req.p.db.data.games.map(publicGame) }))

app.get('/api/games/:id', (req, res) => {
  const g = req.p.db.game(req.params.id)
  if (!g) return res.status(404).json({ error: 'not found' })
  res.json({ game: publicGame(g) })
})

app.post('/api/games', async (req, res) => {
  try {
    const { db, repos } = req.p
    const { id, title, desc, genre, emoji, color, controls, files, message, meetingId } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id 필요' })
    if (!files?.['game.js']) return res.status(400).json({ error: 'game.js 필요' })
    // Every release mutates a git repository and the profile DB. Serialize those
    // effects per profile so two meetings cannot both pass preflight and race on
    // the same repository/tag (or create vs. version operations).
    const key = `${req.p.id}:release`
    const result = await withReleaseLock(key, async () => {
      // A lost HTTP response must not make one meeting publish a second game.
      const decision = inspectGameCreation(db.data.games, { meetingId, gameId: id })
      if (decision.action === 'existing') return { game: decision.game, idempotent: true }
      if (decision.action === 'conflict') {
        throw httpError(409, '이미 존재하는 id', 'GAME_ID_CONFLICT')
      }

      await repos.create(id, files, message || `${title} v1.0.0`, 'v1.0.0')
      const now = new Date().toISOString()
      const version = { v: 'v1.0.0', date: now, message: message || '최초 릴리즈' }
      if (meetingId) version.meetingId = meetingId
      const game = {
        id, title: title || id, desc: desc || '', genre: genre || '아케이드',
        emoji: emoji || '🎮', color: color || '#b78cff', controls: controls || [],
        version: 'v1.0.0', versions: [version],
        source: 'meeting', createdAt: now, updatedAt: now, feedback: {}, meetings: meetingId ? [meetingId] : []
      }
      db.data.games.push(game)
      db.flush()
      return { game, idempotent: false }
    })
    res.json(result)
  } catch (e) { sendRouteError(res, e) }
})

app.post('/api/games/:id/versions', async (req, res) => {
  try {
    const { db, repos } = req.p
    const { files, message, version, meetingId } = req.body || {}
    if (!version) return res.status(400).json({ error: 'version 필요' })
    const key = `${req.p.id}:release`
    const result = await withReleaseLock(key, async () => {
      const game = db.game(req.params.id)
      if (!game) throw httpError(404, 'not found', 'GAME_NOT_FOUND')
      game.versions ||= []
      game.meetings ||= []

      const decision = inspectVersionRelease(game, { meetingId, version })
      if (decision.action === 'existing') {
        // Older records did not put meetingId on the version entry. The game-level
        // meeting ledger is enough to safely backfill that identity once.
        if (decision.reason === 'legacy-meeting-ledger') {
          decision.version.meetingId ||= meetingId
          db.flush()
        }
        return { game, idempotent: true, releasedVersion: decision.version.v }
      }
      if (decision.action === 'conflict') {
        throw httpError(409, '이미 존재하는 버전', 'GAME_VERSION_CONFLICT')
      }

      await repos.addVersion(game.id, files || {}, message || `release ${version}`, version)
      const now = new Date().toISOString()
      game.version = version
      game.versions.push({ v: version, date: now, message: message || '', ...(meetingId ? { meetingId } : {}) })
      if (meetingId && !game.meetings.includes(meetingId)) game.meetings.push(meetingId)
      if (files?.['meta.json']) {
        try {
          const meta = JSON.parse(files['meta.json'])
          Object.assign(game, { title: meta.title ?? game.title, desc: meta.desc ?? game.desc, controls: meta.controls ?? game.controls })
        } catch {}
      }
      game.updatedAt = now
      db.flush()
      return { game, idempotent: false, releasedVersion: version }
    })
    res.json(result)
  } catch (e) { sendRouteError(res, e) }
})

app.get('/api/games/:id/files', async (req, res) => {
  try { res.json({ files: await req.p.repos.filesAt(req.params.id, req.query.ref || 'HEAD') }) }
  catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.get('/api/games/:id/log', async (req, res) => {
  try { res.json({ tags: await req.p.repos.versions(req.params.id), commits: await req.p.repos.log(req.params.id) }) }
  catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.get('/api/games/:id/diff', async (req, res) => {
  try { res.json(await req.p.repos.diff(req.params.id, req.query.from, req.query.to)) }
  catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.get('/api/games/:id/bundle', async (req, res) => {
  try {
    const { db, repos } = req.p
    const g = db.game(req.params.id)
    if (!g) return res.status(404).json({ error: 'not found' })
    const ref = req.query.v
    const code = ref ? await repos.fileAt(g.id, ref, 'game.js') : repos.latestCode(g.id)
    res.json({ meta: { id: g.id, title: g.title, desc: g.desc, controls: g.controls, version: ref || g.version, emoji: g.emoji, color: g.color }, code })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.post('/api/games/:id/feedback', (req, res) => {
  const { db } = req.p
  const g = db.game(req.params.id)
  if (!g) return res.status(404).json({ error: 'not found' })
  const { runId, version, reports, summary, avg, ratings } = req.body
  const now = new Date().toISOString()
  const feedbackVersion = version || g.version
  g.feedback ||= {}
  const previous = g.feedback[feedbackVersion]
  if (runId && previous?.runId === runId) {
    return res.json({ ok: true, version: feedbackVersion, feedback: previous, stats: g.stats || null, duplicate: true })
  }
  const feedback = { runId: runId || null, reports: reports || [], summary: summary || '', avg: avg ?? null, ratings: ratings || null, at: now }
  g.feedback[feedbackVersion] = feedback

  // ---- 6축 평가 누적 통계: 시뮬레이션을 돌릴수록 합산 (합계/표본수 보존 → 정확한 누적 평균) ----
  const rated = (reports || []).map(r => r && r.ratings).filter(r => r && typeof r === 'object')
  if (rated.length) {
    const st = g.stats = g.stats || { runs: 0, reports: 0, sums: {}, counts: {}, scoreSum: 0, scoreN: 0, history: [] }
    st.runs += 1
    st.reports += rated.length
    for (const r of rated) {
      for (const [k, v] of Object.entries(r).slice(0, 12)) {
        const num = Number(v)
        if (!Number.isFinite(num)) continue
        st.sums[k] = (st.sums[k] || 0) + Math.max(1, Math.min(10, num))
        st.counts[k] = (st.counts[k] || 0) + 1
      }
    }
    for (const r of reports || []) {
      const s = Number(r?.score)
      if (Number.isFinite(s)) { st.scoreSum += Math.max(0, Math.min(10, s)); st.scoreN += 1 }
    }
    st.ratings = Object.fromEntries(Object.keys(st.sums).map(k => [k, +(st.sums[k] / (st.counts[k] || 1)).toFixed(1)]))
    st.avgScore = st.scoreN ? +(st.scoreSum / st.scoreN).toFixed(1) : null
    st.history = [...(st.history || []), { at: now, version: feedbackVersion, n: rated.length, avg: avg ?? null, ratings: ratings || null }].slice(-20)
  }

  // 저장 완료 응답 전에 디스크까지 반영한다. 클라이언트는 이 ACK 뒤에만 run을 done으로 전환한다.
  db.flush()
  res.json({ ok: true, version: feedbackVersion, feedback, stats: g.stats || null })
})

app.delete('/api/games/:id', (req, res) => {
  const { db } = req.p
  const i = db.data.games.findIndex(g => g.id === req.params.id)
  if (i < 0) return res.status(404).json({ error: 'not found' })
  db.data.games.splice(i, 1); db.save()
  res.json({ ok: true })
})

// ---------------- meetings & chats ----------------
app.get('/api/meetings', (req, res) => res.json({ meetings: req.p.db.data.meetings.slice(-30) }))

app.get('/api/meetings/active', (req, res) => {
  res.json({ meeting: getActiveMeetingRecord(req.p.db.data.meetings) })
})

app.post('/api/meetings', (req, res) => {
  try {
    const { db } = req.p
    const meeting = commitMeetingMutation(db, meetings =>
      createMeetingInStore(meetings, req.body || {}, {
        id: `m${randomUUID().replaceAll('-', '')}`
      })
    )
    res.json({ meeting })
  } catch (error) { sendRouteError(res, error) }
})

app.get('/api/meetings/:id', (req, res) => {
  try {
    res.json({ meeting: getMeetingRecord(req.p.db.data.meetings, req.params.id) })
  } catch (error) { sendRouteError(res, error) }
})

app.get('/api/meetings/:id/checkpoint', (req, res) => {
  try {
    const meeting = getMeetingRecord(req.p.db.data.meetings, req.params.id)
    res.json({ meeting, checkpoint: meeting.checkpoint || null })
  } catch (error) { sendRouteError(res, error) }
})

app.put('/api/meetings/:id/checkpoint', (req, res) => {
  try {
    const { db } = req.p
    const meeting = commitMeetingMutation(db, meetings => putMeetingCheckpoint(
      meetings,
      req.params.id,
      req.body || {}
    ))
    res.json({ meeting, checkpoint: meeting.checkpoint })
  } catch (error) { sendRouteError(res, error) }
})

app.post('/api/meetings/:id/interrupt', (req, res) => {
  try {
    const { db } = req.p
    const meeting = commitMeetingMutation(db, meetings => interruptMeetingRecord(
      meetings,
      req.params.id,
      req.body || {}
    ))
    res.json({ meeting, checkpoint: meeting.checkpoint })
  } catch (error) { sendRouteError(res, error) }
})

app.post('/api/meetings/:id/resume', (req, res) => {
  try {
    const { db } = req.p
    const meeting = commitMeetingMutation(db, meetings => resumeMeetingRecord(
      meetings,
      req.params.id,
      req.body || {}
    ))
    res.json({ meeting, checkpoint: meeting.checkpoint })
  } catch (error) { sendRouteError(res, error) }
})

app.post('/api/meetings/:id/cancel', (req, res) => {
  try {
    const { db } = req.p
    const meeting = commitMeetingMutation(db, meetings => cancelMeetingRecord(
      meetings,
      req.params.id,
      req.body || {}
    ))
    res.json({ meeting, checkpoint: meeting.checkpoint })
  } catch (error) { sendRouteError(res, error) }
})

app.patch('/api/meetings/:id', (req, res) => {
  try {
    const { db } = req.p
    const { expectedRevision, ...patch } = req.body || {}
    const meeting = commitMeetingMutation(db, meetings => patchMeetingRecord(
      meetings,
      req.params.id,
      patch,
      { expectedRevision }
    ))
    res.json({ meeting })
  } catch (error) { sendRouteError(res, error) }
})

app.get('/api/chats/:agent', (req, res) => res.json({ history: req.p.db.data.chats[req.params.agent] || [] }))
app.post('/api/chats/:agent', (req, res) => {
  const { db } = req.p
  const h = db.data.chats[req.params.agent] = db.data.chats[req.params.agent] || []
  h.push(...(req.body?.messages || []))
  while (h.length > 200) h.shift()
  db.save()
  res.json({ ok: true })
})

// ---------------- 공유 플레이어 ----------------
app.get('/play/:id', (req, res) => {
  const g = req.p.db.game(req.params.id)
  const title = g ? `${g.emoji} ${g.title} — DOTCADE` : 'DOTCADE'
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>${title}</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#0b0d16;color:#e8eaf6;font-family:'Segoe UI',system-ui,sans-serif;display:flex;flex-direction:column;height:100dvh}
  header{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#141830;border-bottom:2px solid #262b45}
  header b{font-size:15px} header .sc{margin-left:auto;font-family:monospace;color:#ffd24a;font-size:15px}
  #stage{flex:1;position:relative;min-height:0}
  iframe{width:100%;height:100%;border:0}
  #pads{display:none;gap:8px;padding:10px;justify-content:center;background:#141830}
  #pads button{width:56px;height:56px;border-radius:12px;border:2px solid #3a4166;background:#1e2340;color:#e8eaf6;font-size:20px;touch-action:none}
  #pads button:active{background:#3a4166}
  #over{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:12px;background:rgba(10,10,20,.72)}
  #over button{padding:10px 22px;border-radius:10px;border:2px solid #7de0a0;background:#12351f;color:#7de0a0;font-size:15px;font-weight:700}
  .brand{color:#8a93c6;font-size:11px}
</style></head><body>
<header><b id="t">${title}</b><span class="sc" id="score">SCORE 0</span></header>
<div id="stage"><div id="host" style="position:absolute;inset:0"></div>
  <div id="over"><div style="font-size:22px;font-weight:800;color:#ff5a7a">GAME OVER</div>
  <div id="fs" style="font-family:monospace;font-size:16px"></div><button onclick="boot()">다시 하기</button>
  <div class="brand">made with DOTCADE — 멀티에이전트 게임 스튜디오</div></div>
</div>
<div id="pads"></div>
<script src="/harness.js"></script>
<script>
var GID=${JSON.stringify(req.params.id)}, V=${JSON.stringify(req.query.v || '')};
var bundle=null, token=null;
function pad(code,label){ var b=document.createElement('button'); b.textContent=label;
  var send=function(down){ var f=document.querySelector('#host iframe'); f&&f.contentWindow.postMessage({gp:token,type:'key',code:code,down:down},'*') }
  b.addEventListener('pointerdown',function(e){e.preventDefault();send(true)})
  b.addEventListener('pointerup',function(e){e.preventDefault();send(false)})
  b.addEventListener('pointerleave',function(){send(false)})
  return b }
function boot(){
  document.getElementById('over').style.display='none'
  document.getElementById('score').textContent='SCORE 0'
  var built=window.buildGameSrcdoc(bundle.code,{mode:'play'})
  token=built.token
  var host=document.getElementById('host'); host.innerHTML=''
  var f=document.createElement('iframe'); f.setAttribute('sandbox','allow-scripts'); f.srcdoc=built.srcdoc
  host.appendChild(f); setTimeout(function(){ f.focus() },300)
}
window.addEventListener('message',function(ev){
  var d=ev.data||{}; if(d.gp!==token)return
  if(d.type==='score') document.getElementById('score').textContent='SCORE '+d.score
  if(d.type==='ready'&&('ontouchstart' in window)){
    var pads=document.getElementById('pads'); pads.innerHTML=''; pads.style.display='flex'
    var L={ArrowLeft:'◀',ArrowRight:'▶',ArrowUp:'▲',ArrowDown:'▼',Space:'⭘'}
    ;(d.meta.controls||[]).forEach(function(c){ pads.appendChild(pad(c,L[c]||c)) })
  }
  if(d.type==='over'||d.type==='timeout'){
    document.getElementById('fs').textContent='SCORE '+d.score
    document.getElementById('over').style.display='flex'
  }
})
fetch('/api/games/'+GID+'/bundle'+(V?'?v='+encodeURIComponent(V):'')).then(r=>r.json()).then(function(b){
  if(!b.code){ document.getElementById('t').textContent='게임을 찾을 수 없습니다'; return }
  bundle=b; document.getElementById('t').textContent=(b.meta.emoji||'🎮')+' '+b.meta.title+' '+(b.meta.version||'')
  boot()
})
</script></body></html>`)
})

// ---------------- static (prod) + harness ----------------
app.use(express.static(path.join(ROOT, 'web', 'public')))
const dist = path.join(ROOT, 'web', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api|play).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')))
}

// ---------------- boot ----------------
const PORT = process.env.BACK_PORT || 5175
async function boot() {
  await detectLLM()
  ensureSeed() // 현재 데이터 → data/seed 스냅샷 (브라우저별 프로필의 초기 상태)
  const seeded = await seedDefaults(seedCtx()).catch(e => { console.error('시드 실패:', e.message); return 0 })
  app.listen(PORT, () => {
    console.log(`\n🕹  DOTCADE 서버  http://localhost:${PORT}`)
    console.log(`   LLM 모드: ${llmState.mode}${llmState.lastError ? ' (' + llmState.lastError + ')' : ''}`)
    console.log(`   모델: smart=${models.smart()} fast=${models.fast()}`)
    console.log(`   웹서치: ${tavily.enabled() ? `Tavily 키 ${tavily.state().length}개 로테이션` : '비활성 (BACK_TAVILY_API_KEYS 미설정)'}`)
    console.log(`   DB: 브라우저(쿠키)별 독립 프로필 — data/seed 복제`)
    if (seeded) console.log(`   기본 게임 ${seeded}종 시드 완료`)
  })
}
boot()
