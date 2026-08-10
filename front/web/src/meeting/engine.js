// DOTCADE — BMAD 회의 시뮬레이션 오케스트레이터
import { api } from '../api.js'
import { TEAM, PLAYER } from '../data/personas.js'
import { personaSystem, P, PHASES, visitorSystem, chatSystem } from './prompts.js'
import { runSmokeTest, extractCode, syntaxCheck } from '../game/qa.js'
import { useStore } from '../state/store.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const S = () => useStore.getState()

export class MeetingEngine {
  constructor(world) {
    this.world = world
    this.cancelled = false
    this._approval = null
  }

  cancel() { this.cancelled = true; if (this._approval) this._approval('__cancel__') }
  approve(comment) { if (this._approval) this._approval(comment || '') }

  _check() { if (this.cancelled) throw new Error('회의가 취소되었습니다') }

  _phase(key) {
    const ph = PHASES.find(p => p.key === key)
    S().setMeeting({ phase: key, phaseLabel: ph.label, bmad: ph.bmad })
    S().pushTranscript({ agentId: 'system', kind: 'system', phase: key, text: `— ${ph.label} · ${ph.bmad} —` })
  }

  _say(agentId, kind, text, phase) {
    S().pushTranscript({ agentId, kind, phase, text })
  }

  async _streamTurn(member, { system, messages, hint, model = 'fast', search = false, kind = 'talk', bubble = true }) {
    this._check()
    const w = this.world
    w.emote(member.id, true)
    let acc = ''
    S().pushTranscript({ agentId: member.id, kind, text: '', phase: S().meeting?.phase })
    try {
      const out = await api.stream(
        { system, messages, hint, model, search, personaMeta: { name: member.name, idx: TEAM.indexOf(member) } },
        (delta, full) => {
          acc = full
          S().pushTranscript({ agentId: member.id, kind, text: delta, append: true })
          if (bubble) w.bubble(member.id, full.slice(-52), 3000)
        }
      )
      acc = out.text || acc
      if (out.sources?.length) {
        this._say(member.id, 'source', out.sources.map(s => `🔗 ${s.title || s.uri}`).join('\n'))
      }
      return out
    } finally {
      w.emote(member.id, false)
      if (bubble) w.bubble(member.id, acc.slice(-60), 2600)
    }
  }

  _sharedContext() {
    const t = S().meeting.transcript
      .filter(e => ['talk', 'player', 'doc'].includes(e.kind))
      .slice(-40)
      .map(e => {
        const name = e.agentId === 'player' ? `${PLAYER.name}(팀장)` : (TEAM.find(m => m.id === e.agentId)?.name || e.agentId)
        return `${name}: ${e.text.slice(0, e.kind === 'doc' ? 1500 : 400)}`
      }).join('\n')
    return `[지금까지의 회의 트랜스크립트]\n${t}`
  }

  // ============================================================
  async run(agenda, { upgradeGame = null } = {}) {
    const w = this.world
    const store = S()
    this.cancelled = false
    const isUp = !!upgradeGame

    const rec = await api.createMeeting({ agenda, gameId: upgradeGame?.id || null, type: isUp ? 'upgrade' : 'new' }).catch(() => ({ meeting: { id: 'local' + Date.now() } }))
    store.setMeeting({
      id: rec.meeting.id, agenda, phase: 'kickoff', phaseLabel: '킥오프',
      transcript: [], artifacts: {}, status: 'running',
      gameId: upgradeGame?.id || null, upgrade: isUp, approval: null, qaPreview: false
    })
    store.openPanel('meeting')

    // ---- 회의실 착석 연출 ----
    const M = w.maps.office.meeting
    w.meetingMode = true
    TEAM.forEach((m, i) => {
      const seat = M.seats[i]
      w.goTo(m.id, seat, () => w.sit(m.id, seat, M.faces[i]))
    })
    w.freezePlayer = true
    w.playerAutoWalk(M.head, () => w.face('player', M.headFace))
    await sleep(1400)

    try {
      // ---- 1. 킥오프 ----
      this._phase('kickoff')
      this._say('player', 'player', `오늘 안건입니다: "${agenda}"${isUp ? ` — ${upgradeGame.title} ${upgradeGame.version} 업그레이드 회의입니다.` : ' — 신규 게임 제작 회의입니다.'} 각자 조사부터 시작해 주세요.`)
      w.bubble('player', agenda, 4200)
      await sleep(900)

      // ---- 2. 리서치 (개별 컨텍스트: RAG + 웹검색) ----
      this._phase('research')
      let upgradeInfo = ''
      let currentCode = ''
      if (isUp) {
        const bundle = await api.bundle(upgradeGame.id)
        currentCode = bundle.code || ''
        const fb = upgradeGame.feedback?.[upgradeGame.version]
        upgradeInfo = `현재 버전: ${upgradeGame.version}\n최근 오락실 평균: ${fb?.avg ?? '없음'}\n피드백 요약: ${(fb?.summary || '없음').slice(0, 800)}`
      }
      const notes = {}
      await Promise.all(TEAM.map(async m => {
        w.bubble(m.id, '🔍 조사 중...', 6000)
        const rq = await api.ragQuery(`${agenda} ${m.role} 관점`, 3)
        const ragNotes = (rq.results || []).map(r => `- (${r.kind}) ${r.text.slice(0, 160)}`).join('\n')
        // 웹 검색: Tavily 키 로테이션 (서버) — LLM mock 모드에서도 동작, 실패 시 Gemini grounding 폴백
        const wantsSearch = m.id === 'writer' || m.id === 'pm' || m.id === 'designer'
        let webNotes = '', webSources = []
        if (wantsSearch && S().config.webSearch) {
          try {
            const sr = await api.search(`${agenda} 게임 트렌드 ${m.role}`.slice(0, 300), 4)
            webSources = (sr.results || []).map(r => ({ title: r.title, uri: r.url }))
            webNotes = (sr.answer ? `요약: ${sr.answer}\n` : '') +
              (sr.results || []).map(r => `- ${r.title}: ${String(r.content || '').slice(0, 200)} (${r.url})`).join('\n')
            w.bubble(m.id, '🌐 웹 검색 완료', 2500)
          } catch { /* Tavily 전 키 소진/오류 → 아래 grounding 폴백 */ }
        }
        const useSearch = !webNotes && S().config.llm === 'live' && wantsSearch
        try {
          const out = await api.generate({
            system: personaSystem(m, S().games),
            messages: [{ role: 'user', text: P.research(agenda, ragNotes, isUp, upgradeInfo, webNotes) }],
            hint: 'research', model: 'fast', search: useSearch,
            personaMeta: { name: m.name }
          })
          notes[m.id] = out.text
          const allSources = [...webSources, ...(out.sources || [])].slice(0, 6)
          this._say(m.id, 'note', out.text.slice(0, 600) + (allSources.length ? '\n' + allSources.map(s => `🔗 ${s.title || s.uri}`).join('\n') : ''))
          w.bubble(m.id, '조사 완료! ' + out.text.slice(0, 30), 3000)
        } catch (e) {
          notes[m.id] = ''
          this._say('system', 'system', `${m.name} 조사 실패: ${e.message}`)
        }
      }))
      this._check()

      // ---- 3. 컨셉 토론 (공유 컨텍스트 디베이트) ----
      this._phase('concept')
      const rounds = isUp ? 1 : 2
      const order = ['writer', 'designer', 'dev1', 'dev2', 'pm']
      for (let r = 1; r <= rounds; r++) {
        for (const id of order) {
          const m = TEAM.find(t => t.id === id)
          await this._streamTurn(m, {
            system: personaSystem(m, S().games),
            messages: [{ role: 'user', text: `${this._sharedContext()}\n\n${P.debate(agenda, r, notes[id])}` }],
            hint: 'debate'
          })
          await sleep(350)
        }
      }

      // ---- 4~6. PRD / 디자인 / 아키텍처 ----
      const docs = {}
      for (const [key, id, promptFn, hint] of [
        ['prd', 'pm', () => P.prd(agenda), 'prd'],
        ['design', 'designer', () => P.design(), 'design'],
        ['arch', 'dev1', () => P.arch(), 'arch']
      ]) {
        this._phase(key)
        const m = TEAM.find(t => t.id === id)
        w.bubble(m.id, `📝 ${key === 'prd' ? 'PRD' : key === 'design' ? '아트/UX 스펙' : '기술 설계'} 작성 중...`, 8000)
        const out = await this._streamTurn(m, {
          system: personaSystem(m, S().games),
          messages: [{ role: 'user', text: `${this._sharedContext()}\n\n${promptFn()}${isUp ? '\n(업그레이드이므로 기존 대비 바뀌는 부분을 중심으로)' : ''}` }],
          hint, kind: 'doc', model: key === 'prd' ? 'smart' : 'fast', bubble: false
        })
        docs[key] = out.text
        S().setMeeting({ artifacts: { ...S().meeting.artifacts, [key]: out.text } })
        await sleep(300)
      }

      // ---- 7. 리뷰 & 승인 게이트 ----
      this._phase('review')
      for (const id of ['dev2', 'writer']) {
        const m = TEAM.find(t => t.id === id)
        await this._streamTurn(m, {
          system: personaSystem(m, S().games),
          messages: [{ role: 'user', text: `${this._sharedContext()}\n\n${P.review()}` }],
          hint: 'review'
        })
      }
      const comment = await this._waitApproval()
      if (comment === '__cancel__') throw new Error('회의가 취소되었습니다')
      if (comment) {
        this._say('player', 'player', comment)
        const pm = TEAM[0]
        await this._streamTurn(pm, {
          system: personaSystem(pm, S().games),
          messages: [{ role: 'user', text: `${this._sharedContext()}\n\n${P.ack(comment)}` }],
          hint: 'review'
        })
        docs.prd += `\n\n## 팀장 추가 요구사항\n${comment}`
      }

      // ---- 8. 구현 ----
      this._phase('impl')
      const dev = TEAM.find(t => t.id === 'dev2')
      w.bubble(dev.id, '💻 코딩 존 들어갑니다...', 6000)
      const upCtx = isUp ? `\n[기존 코드 — 이 코드를 개선하세요]\n\`\`\`js\n${currentCode.slice(0, 16000)}\n\`\`\`\n[유저 피드백 반영사항]\n${upgradeInfo}` : ''
      let code = ''
      {
        let charCount = 0
        this._say(dev.id, 'talk', '구현 시작합니다. 계약(게임팩 API) 준수해서 작성할게요.')
        S().pushTranscript({ agentId: dev.id, kind: 'progress', text: '⌨️ 코드 작성 중... 0자' })
        const out = await api.stream(
          {
            system: personaSystem(dev, S().games),
            messages: [{ role: 'user', text: P.impl(agenda, docs.prd, docs.design, docs.arch, upCtx) }],
            hint: 'code', model: 'smart', personaMeta: { name: dev.name }
          },
          (d, full) => {
            charCount = full.length
            const t = S().meeting.transcript
            const idx = t.findIndex(e => e.kind === 'progress')
            if (idx >= 0) {
              const copy = [...t]; copy[idx] = { ...copy[idx], text: `⌨️ 코드 작성 중... ${charCount.toLocaleString()}자` }
              S().setMeeting({ transcript: copy })
            }
            if (charCount % 400 < 24) w.bubble(dev.id, `⌨️ ${charCount}자...`, 1500)
          }
        )
        code = extractCode(out.text)
        S().setMeeting({ artifacts: { ...S().meeting.artifacts, code } })
      }
      this._say(dev.id, 'talk', `구현 완료! ${code.split('\n').length}줄입니다. QA 돌려주세요.`)

      // ---- 9. QA (+수리 루프) ----
      this._phase('qa')
      const qaM = TEAM.find(t => t.id === 'dev1')
      let attempt = 0, result = null
      while (attempt <= 2) {
        this._check()
        w.bubble(qaM.id, `🧪 스모크 테스트 ${attempt + 1}차...`, 5000)
        this._say(qaM.id, 'qa', `자동 QA ${attempt + 1}차 실행 — 샌드박스에서 봇 플레이 테스트 중...`)
        S().setMeeting({ qaPreview: true, qaCode: code, qaNonce: Date.now() })
        const mountEl = document.getElementById('qa-preview-slot')
        result = await runSmokeTest(code, { mountEl, durationMs: 9000 })
        S().setMeeting({ qaPreview: false })
        if (result.pass) break
        attempt++
        const diag = result.diagnostics
        this._say(qaM.id, 'qa', `❌ QA 실패: ${diag.fatal || diag.errors?.[0] || (!diag.scoreChanged && !diag.overFired ? '봇 입력에 게임이 반응하지 않음' : '화면 렌더 없음')}${attempt <= 2 ? ' → 수리 요청' : ''}`)
        if (attempt > 2) break
        w.bubble(dev.id, '🔧 버그 수정 중...', 6000)
        const fix = await api.generate({
          system: personaSystem(dev, S().games),
          messages: [{ role: 'user', text: P.repair(code, result.diagnostics) }],
          hint: 'repair', model: 'smart', personaMeta: { name: dev.name }
        })
        code = extractCode(fix.text)
        S().setMeeting({ artifacts: { ...S().meeting.artifacts, code } })
        this._say(dev.id, 'talk', '수정본 나왔습니다. 다시 테스트 부탁해요.')
      }
      const qaOk = result?.pass
      this._say(qaM.id, 'qa', qaOk
        ? `✅ QA 통과 — 봇 플레이 점수 ${result.diagnostics.score}, 오류 0건, 렌더 정상.`
        : `⚠️ QA 미통과 상태로 릴리즈합니다 (진단: ${JSON.stringify(result?.diagnostics || {}).slice(0, 200)}). 다음 버전에서 개선 필요.`)

      // ---- 10. 릴리즈 ----
      this._phase('release')
      const meta = this._parseMeta(docs.prd, agenda, code, isUp ? upgradeGame : null)
      const pm = TEAM[0]
      const version = isUp ? bumpVersion(upgradeGame.version) : 'v1.0.0'
      const cl = await api.generate({
        system: personaSystem(pm, S().games),
        messages: [{ role: 'user', text: `${this._sharedContext().slice(0, 4000)}\n\n${P.changelog(meta.title, version, isUp)}` }],
        hint: 'changelog', model: 'fast', personaMeta: { name: pm.name }
      })
      const now = new Date().toISOString().slice(0, 10)
      const changelogEntry = `## ${version} (${now})\n${cl.text.trim()}\n`
      const files = {
        'game.js': code,
        'meta.json': JSON.stringify({ id: meta.id, title: meta.title, desc: meta.desc, genre: meta.genre, controls: meta.controls, emoji: meta.emoji, color: meta.color, qa: qaOk ? 'pass' : 'unstable' }, null, 2),
        'README.md': `# ${meta.emoji} ${meta.title}\n\n${meta.desc}\n\n- 장르: ${meta.genre}\n- 조작: ${meta.controls.join(', ')}\n- 제작: DOTCADE 스튜디오 (BMAD 멀티에이전트 회의)\n- 안건: ${agenda}\n`,
        'docs/prd.md': docs.prd,
        'docs/design.md': docs.design,
        'docs/architecture.md': docs.arch,
        'CHANGELOG.md': isUp
          ? `# Changelog\n\n${changelogEntry}\n${(await api.files(upgradeGame.id).then(f => (f.files['CHANGELOG.md'] || '').replace(/^# Changelog\n+/, '')).catch(() => ''))}`
          : `# Changelog\n\n${changelogEntry}`
      }
      let saved
      if (isUp) {
        saved = await api.addVersion(upgradeGame.id, { files, message: `${meta.title} ${version} — ${agenda}`.slice(0, 100), version, meetingId: S().meeting.id })
      } else {
        saved = await api.createGame({ ...meta, files, message: `${meta.title} v1.0.0 — ${agenda}`.slice(0, 100), meetingId: S().meeting.id })
      }
      const g = saved.game
      this._say('system', 'system', `🎉 ${g.emoji} 「${g.title}」 ${version} 릴리즈! 게임팩이 진열대에 추가되었습니다.`)
      this._say(pm.id, 'talk', `릴리즈 노트:\n${cl.text.trim()}`)
      TEAM.forEach(m => w.bubble(m.id, pickCheer(m.id), 4200))

      // RAG 적재 + 회의 저장
      api.ragUpsert([
        { id: `prd-${g.id}-${version}`, kind: 'prd', gameId: g.id, text: `${g.title} ${version} PRD: ${docs.prd.slice(0, 1500)}` },
        { id: `meeting-${S().meeting.id}`, kind: 'meeting', gameId: g.id, text: `${agenda} 회의 결론: ${docs.prd.slice(0, 600)}` }
      ])
      api.patchMeeting(S().meeting.id, {
        status: 'done', gameId: g.id, version,
        artifacts: { prd: docs.prd, design: docs.design, arch: docs.arch },
        transcript: S().meeting.transcript.slice(-120)
      })

      const gl = await api.games()
      S().setGames(gl.games)
      w.setShelfGames(gl.games)
      S().setMeeting({ status: 'done', resultGameId: g.id, resultVersion: version })
      S().toast(`🎉 ${g.title} ${version} 릴리즈 완료!`, 'success')
      return { gameId: g.id, version }
    } catch (e) {
      S().setMeeting({ status: 'error', error: String(e.message || e) })
      this._say('system', 'system', `⚠️ 회의 중단: ${e.message}`)
      throw e
    } finally {
      // 자리 복귀
      w.meetingMode = false
      w.freezePlayer = false
      TEAM.forEach(m => {
        const home = w.agent(m.id)?.home
        if (home) w.goTo(m.id, home.desk, () => w.sit(m.id, home.desk, home.face))
      })
    }
  }

  async _waitApproval() {
    const auto = S().settings.autoApprove
    S().setMeeting({ approval: { until: Date.now() + (auto ? 6000 : 90000), auto } })
    const val = await new Promise(res => {
      this._approval = res
      setTimeout(() => res(''), auto ? 6000 : 90000)
    })
    this._approval = null
    S().setMeeting({ approval: null })
    if (val !== '__cancel__') {
      this._say('system', 'system', val ? '팀장 승인 (의견 반영)' : '팀장 승인 — 구현 단계로 진행합니다.')
    }
    return val
  }

  _parseMeta(prd, agenda, code, existing) {
    const pick = re => (prd.match(re) || [])[1]?.trim()
    let title = pick(/제목\s*[:：]\s*(.+)/) || existing?.title
    if (!title) {
      try { title = (code.match(/title\s*:\s*['"`]([^'"`]+)['"`]/) || [])[1] } catch {}
    }
    title = (title || agenda.slice(0, 16)).replace(/["'`*]/g, '').slice(0, 24)
    const emoji = (pick(/이모지\s*[:：]\s*(.+)/) || existing?.emoji || '🎮').split(/\s/)[0].slice(0, 4)
    const genre = pick(/장르\s*[:：]\s*(.+)/) || existing?.genre || '아케이드'
    const desc = pick(/한줄설명\s*[:：]\s*(.+)/) || existing?.desc || agenda.slice(0, 60)
    let controls = []
    try {
      controls = [...new Set((code.match(/'(Arrow(?:Left|Right|Up|Down)|Space)'/g) || []).map(s => s.replace(/'/g, '')))]
    } catch {}
    if (!controls.length) controls = ['ArrowLeft', 'ArrowRight']
    const colors = ['#3ec6a8', '#7dc7ff', '#b78cff', '#f2a25c', '#ff8a9e', '#7de0a0', '#ffd24a']
    const color = existing?.color || colors[Math.floor(Math.random() * colors.length)]
    const id = existing?.id || ('game-' + Date.now().toString(36))
    return { id, title, emoji, genre, desc, controls, color }
  }
}

function bumpVersion(v) {
  const m = String(v || 'v1.0.0').match(/v(\d+)\.(\d+)\.(\d+)/)
  if (!m) return 'v1.1.0'
  return `v${m[1]}.${+m[2] + 1}.0`
}
function pickCheer(id) {
  return {
    pm: '릴리즈 완료! 회고는 오락실 반응 보고 하시죠.',
    dev1: '테스트 통과. 배포 안정성 확인했습니다.',
    dev2: '오예 출시다! 🎉',
    designer: '진열대에 올라간 거 너무 귀여워요.',
    writer: '이름 잘 지은 것 같아요. 반응 기대!'
  }[id] || '수고하셨습니다!'
}

// ---------------- 1:1 대화 ----------------
export async function chatWithAgent(world, member, userText, history) {
  const games = S().games
  const recent = games.slice(-3).map(g => `${g.title} ${g.version}${g.feedback?.[g.version] ? ` (오락실 평균 ${g.feedback[g.version].avg})` : ''}`).join(', ')
  const messages = [
    ...history.slice(-12).map(h => ({ role: h.role === 'user' ? 'user' : 'model', text: h.text })),
    { role: 'user', text: userText }
  ]
  world.emote(member.id, true)
  try {
    const out = await api.stream(
      { system: chatSystem(member, games, recent), messages, hint: 'chat', model: 'fast', personaMeta: { name: member.name } },
      (d, full) => world.bubble(member.id, full.slice(-52), 4000)
    )
    world.bubble(member.id, out.text.slice(0, 60), 5200)
    return out.text
  } finally { world.emote(member.id, false) }
}
