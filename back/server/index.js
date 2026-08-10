// DOTCADE 서버 — Gemini 프록시 · git 게임 레포 · 공유 플레이어 · 브라우저별 독립 JSON DB
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import express from 'express'
import { ensureSeed, seedCtx, profileMiddleware } from './lib/profiles.js'
import { provider, llmState, detectLLM, models } from './lib/gemini.js'
import { tavily } from './lib/tavily.js'
import { seedDefaults } from './lib/seed.js'

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

app.get('/api/games', (req, res) => res.json({ games: req.p.db.data.games.map(publicGame) }))

app.get('/api/games/:id', (req, res) => {
  const g = req.p.db.game(req.params.id)
  if (!g) return res.status(404).json({ error: 'not found' })
  res.json({ game: publicGame(g) })
})

app.post('/api/games', async (req, res) => {
  try {
    const { db, repos } = req.p
    const { id, title, desc, genre, emoji, color, controls, files, message, meetingId } = req.body
    if (db.game(id)) return res.status(409).json({ error: '이미 존재하는 id' })
    if (!files?.['game.js']) return res.status(400).json({ error: 'game.js 필요' })
    await repos.create(id, files, message || `${title} v1.0.0`, 'v1.0.0')
    const now = new Date().toISOString()
    const g = {
      id, title: title || id, desc: desc || '', genre: genre || '아케이드',
      emoji: emoji || '🎮', color: color || '#b78cff', controls: controls || [],
      version: 'v1.0.0', versions: [{ v: 'v1.0.0', date: now, message: message || '최초 릴리즈' }],
      source: 'meeting', createdAt: now, updatedAt: now, feedback: {}, meetings: meetingId ? [meetingId] : []
    }
    db.data.games.push(g); db.save()
    res.json({ game: g })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.post('/api/games/:id/versions', async (req, res) => {
  try {
    const { db, repos } = req.p
    const g = db.game(req.params.id)
    if (!g) return res.status(404).json({ error: 'not found' })
    const { files, message, version, meetingId } = req.body
    if (!version) return res.status(400).json({ error: 'version 필요' })
    await repos.addVersion(g.id, files || {}, message || `release ${version}`, version)
    const now = new Date().toISOString()
    g.version = version
    g.versions.push({ v: version, date: now, message: message || '' })
    if (meetingId) g.meetings.push(meetingId)
    if (files?.['meta.json']) {
      try {
        const m = JSON.parse(files['meta.json'])
        Object.assign(g, { title: m.title ?? g.title, desc: m.desc ?? g.desc, controls: m.controls ?? g.controls })
      } catch {}
    }
    g.updatedAt = now; db.save()
    res.json({ game: g })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
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
  const { version, reports, summary, avg } = req.body
  g.feedback[version || g.version] = { reports: reports || [], summary: summary || '', avg: avg ?? null, at: new Date().toISOString() }
  db.save()
  res.json({ ok: true })
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
app.post('/api/meetings', (req, res) => {
  const { db } = req.p
  const m = { id: 'm' + Date.now(), ...req.body, startedAt: new Date().toISOString() }
  db.data.meetings.push(m); db.save()
  res.json({ meeting: m })
})
app.patch('/api/meetings/:id', (req, res) => {
  const { db } = req.p
  const m = db.data.meetings.find(x => x.id === req.params.id)
  if (!m) return res.status(404).json({ error: 'not found' })
  Object.assign(m, req.body); db.save()
  res.json({ meeting: m })
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
