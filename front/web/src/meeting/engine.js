// DOTCADE — BMAD 회의 시뮬레이션 오케스트레이터
import { api } from '../api.js'
import { TEAM, PLAYER } from '../data/personas.js'
import { personaSystem, P, PHASES, visitorSystem, chatSystem } from './prompts.js'
import { runSmokeTest, extractCode, syntaxCheck } from '../game/qa.js'
import { useStore } from '../state/store.js'
import {
  normalizeReferenceDesignContract,
  referenceImplementationMarkdown,
  visualQaRequiredScreens
} from './referenceContract.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const S = () => useStore.getState()

export class MeetingEngine {
  constructor(world) {
    this.world = world
    this.cancelled = false
    this._approval = null
    this._direction = null
  }

  cancel() {
    this.cancelled = true
    this._finishDirection('__cancel__')
    this._finishApproval('__cancel__')
  }
  approve() { this._finishApproval('confirmed') }
  chooseDirection(id) { this._finishDirection(id, false) }

  _check() { if (this.cancelled) throw new Error('회의가 취소되었습니다') }

  _phase(key) {
    const ph = PHASES.find(p => p.key === key)
    S().setMeeting({ phase: key, phaseLabel: ph.label, bmad: ph.bmad })
    S().pushTranscript({ agentId: 'system', kind: 'system', phase: key, text: `— ${ph.label} · ${ph.bmad} —` })
  }

  _updateResearch(agentId, patch) {
    const research = S().meeting?.research
    if (!research) return
    S().setMeeting({
      research: {
        ...research,
        members: {
          ...research.members,
          [agentId]: { ...(research.members?.[agentId] || {}), ...patch }
        }
      }
    })
  }

  _updateReference(patch) {
    const research = S().meeting?.research
    if (!research) return
    S().setMeeting({
      research: {
        ...research,
        reference: { ...(research.reference || {}), ...patch }
      }
    })
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
  async run(agenda, { upgradeGame = null, referenceSearch = false, referenceTarget = '' } = {}) {
    const w = this.world
    const store = S()
    this.cancelled = false
    const isUp = !!upgradeGame

    const rec = await api.createMeeting({ agenda, gameId: upgradeGame?.id || null, type: isUp ? 'upgrade' : 'new' }).catch(() => ({ meeting: { id: 'local' + Date.now() } }))
    const initialResearch = {
      status: 'pending',
      keywords: extractKeywords(agenda, 6),
      reference: {
        enabled: !!referenceSearch,
        status: referenceSearch ? 'pending' : 'disabled',
        keywords: [], queries: [], completedQueries: 0, totalQueries: 0,
        candidates: [], selected: null, uiReferences: [], sources: [], evidence: [],
        reason: '', fallback: false, error: null
      },
      members: Object.fromEntries(TEAM.map(m => [m.id, {
        rag: 'pending', ragHits: 0,
        web: ['writer', 'pm', 'designer'].includes(m.id) ? (store.config.webSearch ? 'pending' : 'unavailable') : 'skipped',
        webHits: 0, note: 'pending'
      }]))
    }
    store.setMeeting({
      id: rec.meeting.id, agenda, phase: 'kickoff', phaseLabel: '킥오프',
      transcript: [], artifacts: {}, status: 'running',
      gameId: upgradeGame?.id || null, upgrade: isUp, approval: null, qaPreview: false,
      research: initialResearch, directionGate: null, direction: null, reward: null
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
      const researchCorpus = [agenda]
      let referenceResult = null
      let referenceContext = ''
      let referenceDesignContract = null

      // 선택형 레퍼런스 탐색: 기획 키워드 -> 병렬 웹검색 -> 후보 비교 -> 타겟 UI 검색.
      // 서버는 중복 요청·타임아웃을 제어하고, 검색 장애 시에도 장르 프로필 기반 결과를 반환한다.
      if (referenceSearch) {
        this._say('system', 'system', '🎯 레퍼런스 탐색 시작 — 기획에서 검색어를 뽑고 후보 게임과 UI 화면을 병렬 조사합니다.')
        TEAM.filter(m => ['writer', 'designer'].includes(m.id)).forEach(m => w.bubble(m.id, '🎯 레퍼런스 스캔 중...', 8000))
        try {
          referenceResult = await api.referenceResearch({
            agenda,
            currentInfo: upgradeInfo,
            preferredTarget: referenceTarget
          }, progress => {
            this._check()
            this._updateReference({ enabled: true, ...progress, error: null })
          })
        } catch (error) {
          this._check()
          referenceResult = localReferenceFallback(agenda, error)
        }
        this._updateReference({ enabled: true, ...referenceResult })
        referenceContext = formatReferenceBrief(referenceResult)
        referenceDesignContract = normalizeReferenceDesignContract(referenceResult)
        if (referenceDesignContract) {
          this._updateReference({
            contractId: referenceDesignContract.contractId,
            designContract: referenceDesignContract,
            contractStatus: { stage: 'planned', attempt: 0, issues: [] }
          })
        }
        researchCorpus.push(referenceContext)
        const target = referenceResult.selected
        const verified = (referenceResult.uiReferences || []).filter(item => item.verified).length
        this._say('system', 'system', target
          ? `✅ 최종 레퍼런스 타겟: ${target.title}\n선정 이유: ${referenceResult.reason || target.why}\nUI 레퍼런스 ${referenceResult.uiReferences?.length || 0}건 (${verified}건 검색 검증) — 캐릭터·아트가 아닌 정보 구조와 피드백 패턴만 차용합니다.`
          : '⚠️ 레퍼런스 타겟을 확정하지 못해 일반 게임 UI 원칙으로 진행합니다.')
        const refLinks = (referenceResult.uiReferences || []).filter(item => item.url).slice(0, 5)
        if (refLinks.length) this._say('system', 'source', refLinks.map(item => `🔗 ${item.title}: ${item.url}`).join('\n'))
        api.ragUpsert([{
          id: `reference-${S().meeting.id}`,
          kind: 'ui-reference',
          text: referenceContext.slice(0, 6500),
          meta: { meetingId: S().meeting.id, target: target?.title || '' }
        }])
      }

      await Promise.all(TEAM.map(async m => {
        w.bubble(m.id, '🔍 조사 중...', 6000)
        const rq = await api.ragQuery(`${agenda} ${m.role} 관점`, 3)
        const ragNotes = (rq.results || []).map(r => `- (${r.kind}) ${r.text.slice(0, 160)}`).join('\n')
        this._updateResearch(m.id, { rag: 'done', ragHits: (rq.results || []).length })
        if (ragNotes) researchCorpus.push(ragNotes)
        // 웹 검색: Tavily 키 로테이션 (서버) — LLM mock 모드에서도 동작, 실패 시 Gemini grounding 폴백
        const wantsSearch = m.id === 'writer' || m.id === 'pm' || m.id === 'designer'
        let webNotes = '', webSources = []
        if (wantsSearch && S().config.webSearch) {
          try {
            const sr = await api.search(`${agenda} 게임 트렌드 ${m.role}`.slice(0, 300), 4)
            webSources = (sr.results || []).map(r => ({ title: r.title, uri: r.url }))
            webNotes = (sr.answer ? `요약: ${sr.answer}\n` : '') +
              (sr.results || []).map(r => `- ${r.title}: ${String(r.content || '').slice(0, 200)} (${r.url})`).join('\n')
            this._updateResearch(m.id, { web: 'done', webHits: (sr.results || []).length })
            researchCorpus.push(sr.answer || '', ...(sr.results || []).map(r => `${r.title} ${r.content || ''}`))
            w.bubble(m.id, '🌐 웹 검색 완료', 2500)
          } catch {
            this._updateResearch(m.id, { web: 'fallback', webHits: 0 })
            /* Tavily 전 키 소진/오류 → 아래 grounding 폴백 */
          }
        }
        const useSearch = !webNotes && S().config.llm === 'live' && wantsSearch
        try {
          const out = await api.generate({
            system: personaSystem(m, S().games),
            messages: [{ role: 'user', text: P.research(agenda, ragNotes, isUp, upgradeInfo, webNotes, referenceContext, referenceDesignContract) }],
            hint: 'research', model: 'fast', search: useSearch,
            personaMeta: { name: m.name }
          })
          notes[m.id] = out.text
          researchCorpus.push(out.text)
          this._updateResearch(m.id, {
            note: 'done',
            ...(useSearch ? { web: 'done', webHits: (out.sources || []).length } : {})
          })
          const allSources = [...webSources, ...(out.sources || [])].slice(0, 6)
          this._say(m.id, 'note', out.text.slice(0, 600) + (allSources.length ? '\n' + allSources.map(s => `🔗 ${s.title || s.uri}`).join('\n') : ''))
          w.bubble(m.id, '조사 완료! ' + out.text.slice(0, 30), 3000)
        } catch (e) {
          notes[m.id] = ''
          this._updateResearch(m.id, { note: 'error' })
          this._say('system', 'system', `${m.name} 조사 실패: ${e.message}`)
        }
      }))
      this._check()

      // ---- 리서치 결과 기반 3개 제작 방향: 플레이어 개입은 이 한 번만 ----
      const keywords = extractKeywords(`${agenda}\n${researchCorpus.join('\n')}`, 7)
      S().setMeeting({ research: { ...S().meeting.research, status: 'done', keywords } })
      const directions = buildDirections({ agenda, keywords, isUpgrade: isUp, upgradeInfo })
      const direction = await this._waitDirectionChoice(directions)
      if (direction === '__cancel__') throw new Error('회의가 취소되었습니다')

      // ---- 3. 컨셉 토론 (공유 컨텍스트 디베이트) ----
      this._phase('concept')
      const rounds = isUp ? 1 : 2
      const order = ['writer', 'designer', 'dev1', 'dev2', 'pm']
      for (let r = 1; r <= rounds; r++) {
        for (const id of order) {
          const m = TEAM.find(t => t.id === id)
          await this._streamTurn(m, {
            system: personaSystem(m, S().games),
            messages: [{ role: 'user', text: `${this._sharedContext()}\n\n${P.debate(agenda, r, notes[id], direction, referenceContext, referenceDesignContract)}` }],
            hint: 'debate'
          })
          await sleep(350)
        }
      }

      // ---- 4~6. PRD / 디자인 / 아키텍처 ----
      const docs = {}
      for (const [key, id, promptFn, hint] of [
        ['prd', 'pm', () => P.prd(agenda, direction, referenceContext, referenceDesignContract), 'prd'],
        ['design', 'designer', () => P.design(direction, referenceContext, referenceDesignContract, docs.prd), 'design'],
        ['arch', 'dev1', () => P.arch(direction, referenceContext, referenceDesignContract, docs.prd, docs.design), 'arch']
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
          messages: [{ role: 'user', text: `${this._sharedContext()}\n\n${P.review(referenceDesignContract)}` }],
          hint: 'review'
        })
      }
      const approval = await this._waitApproval()
      if (approval === '__cancel__') throw new Error('회의가 취소되었습니다')

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
            messages: [{ role: 'user', text: P.impl(agenda, docs.prd, docs.design, docs.arch, upCtx, direction, referenceContext, referenceDesignContract) }],
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
      const referenceTraceFromCode = () => referenceDesignContract ? {
        screens: referenceDesignContract.qa.requiredScreens.filter(id => code.includes(id)),
        implementedPatterns: referenceDesignContract.qa.requiredPatternIds.filter(id => code.includes(id)),
        implementedStates: referenceDesignContract.qa.requiredStates.filter(id => code.includes(id)),
        depthSignals: referenceDesignContract.qa.depthSignals.map(signal => signal.id).filter(id => code.includes(id)),
        feedbackSignals: referenceDesignContract.qa.feedbackSignals.map(signal => signal.id).filter(id => code.includes(id))
      } : {}
      if (referenceDesignContract) {
        this._updateReference({
          contractStatus: {
            stage: 'implemented', attempt: 0, issues: [],
            ...referenceTraceFromCode()
          }
        })
      }
      this._say(dev.id, 'talk', `구현 완료! ${code.split('\n').length}줄입니다. QA 돌려주세요.`)

      // ---- 9. QA (+수리 루프) ----
      this._phase('qa')
      const qaM = TEAM.find(t => t.id === 'dev1')
      const collectionVisual = /포켓몬|몬스터|생물\s*수집|캐릭터\s*수집|도감|creature\s*collection|monster\s*collection/i
        .test(`${agenda}\n${docs.prd}`)
      // A normalized reference contract is the authority for required screens.
      // Genre heuristics are legacy fallback only and must not promote a contract's
      // recommended screens (for example codex) into release-blocking QA work.
      const requiredVisualScreens = visualQaRequiredScreens(referenceDesignContract, {
        collectionFallback: collectionVisual
      })
      let attempt = 0, result = null
      while (attempt <= 2) {
        this._check()
        if (referenceDesignContract) {
          this._updateReference({
            contractStatus: {
              stage: 'testing', attempt: attempt + 1, issues: [],
              ...referenceTraceFromCode()
            }
          })
        }
        w.bubble(qaM.id, `🧪 스모크 테스트 ${attempt + 1}차...`, 5000)
        this._say(qaM.id, 'qa', `자동 QA ${attempt + 1}차 실행 — 샌드박스에서 봇 플레이 테스트 중...`)
        S().setMeeting({ qaPreview: true, qaCode: code, qaNonce: Date.now() })
        const mountEl = document.getElementById('qa-preview-slot')
        result = await runSmokeTest(code, {
          mountEl, durationMs: 9000, strictVisual: true,
          requiredScreens: requiredVisualScreens,
          designContract: referenceDesignContract
        })
        S().setMeeting({ qaPreview: false })
        if (result.pass) break
        attempt++
        const diag = result.diagnostics
        if (referenceDesignContract) {
          const referenceQa = diag.visual?.reference || diag.reference || diag.designContract || {}
          this._updateReference({
            contractStatus: {
              stage: attempt <= 2 ? 'repairing' : 'unstable',
              attempt,
              qa: referenceQa,
              issues: diag.visual?.issues || referenceQa.missing || referenceQa.issues || [],
              ...referenceTraceFromCode()
            }
          })
        }
        this._say(qaM.id, 'qa', `❌ QA 실패: ${diag.fatal || diag.errors?.[0] || diag.visual?.missing?.[0] || (!diag.scoreChanged && !diag.overFired ? '봇 입력에 게임이 반응하지 않음' : '화면 렌더 없음')}${attempt <= 2 ? ' → 수리 요청' : ''}`)
        if (attempt > 2) break
        w.bubble(dev.id, '🔧 버그 수정 중...', 6000)
        const fix = await api.generate({
          system: personaSystem(dev, S().games),
          messages: [{ role: 'user', text: P.repair(code, result.diagnostics, referenceDesignContract, agenda) }],
          hint: 'repair', model: 'smart', personaMeta: { name: dev.name }
        })
        code = extractCode(fix.text)
        S().setMeeting({ artifacts: { ...S().meeting.artifacts, code } })
        this._say(dev.id, 'talk', '수정본 나왔습니다. 다시 테스트 부탁해요.')
      }
      const qaOk = result?.pass
      if (referenceDesignContract) {
        const referenceQa = result?.diagnostics?.visual?.reference || result?.diagnostics?.reference || result?.diagnostics?.designContract || {}
        this._updateReference({
          contractStatus: {
            stage: qaOk ? 'verified' : 'unstable',
            attempt: Math.min(attempt + 1, 3),
            qa: referenceQa,
            issues: result?.diagnostics?.visual?.issues || referenceQa.missing || referenceQa.issues || [],
            ...referenceTraceFromCode()
          }
        })
      }
      this._say(qaM.id, 'qa', qaOk
        ? `✅ QA 통과 — 봇 플레이 점수 ${result.diagnostics.score}, 오류 0건, 2.5D${referenceDesignContract ? '·레퍼런스 디자인 계약' : ' 비주얼 계약'} 충족.`
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
      const referenceBlueprint = referenceResult?.blueprint || referenceResult?.designContract || referenceDesignContract
      const referenceSummary = referenceDesignContract ? {
        contractId: referenceDesignContract.contractId,
        targetId: referenceDesignContract.targetId,
        targetTitle: referenceDesignContract.targetTitle,
        requiredScreens: referenceDesignContract.qa.requiredScreens,
        requiredPatternIds: referenceDesignContract.qa.requiredPatternIds,
        ...referenceTraceFromCode(),
        contractStatus: (() => {
          const status = S().meeting.research?.reference?.contractStatus || {}
          return { stage: status.stage || (qaOk ? 'verified' : 'unstable'), attempt: status.attempt || 0, issues: status.issues || [] }
        })()
      } : null
      const files = {
        'game.js': code,
        'meta.json': JSON.stringify({
          id: meta.id, title: meta.title, desc: meta.desc, genre: meta.genre,
          controls: meta.controls, emoji: meta.emoji, color: meta.color,
          qa: qaOk ? 'pass' : 'unstable',
          ...(referenceSummary ? { reference: referenceSummary } : {})
        }, null, 2),
        'README.md': `# ${meta.emoji} ${meta.title}\n\n${meta.desc}\n\n- 장르: ${meta.genre}\n- 조작: ${meta.controls.join(', ')}\n- 제작: DOTCADE 스튜디오 (BMAD 멀티에이전트 회의)\n- 안건: ${agenda}\n`,
        'docs/prd.md': docs.prd,
        'docs/design.md': docs.design,
        'docs/architecture.md': docs.arch,
        ...(referenceResult ? { 'docs/reference-research.md': referenceMarkdown(referenceResult) } : {}),
        ...(referenceBlueprint ? {
          'docs/reference-blueprint.json': JSON.stringify(referenceBlueprint, null, 2),
          'docs/reference-implementation.md': referenceImplementationMarkdown(referenceDesignContract, {
            code, docs, qaResult: result
          })
        } : {}),
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
        { id: `meeting-${S().meeting.id}`, kind: 'meeting', gameId: g.id, text: `${agenda} 회의 결론: ${docs.prd.slice(0, 600)}` },
        ...(referenceResult ? [{
          id: `reference-${g.id}-${version}`,
          kind: 'ui-reference', gameId: g.id,
          text: `${g.title} ${version} 제작 레퍼런스:\n${referenceContext.slice(0, 4000)}`
        }] : [])
      ])
      api.patchMeeting(S().meeting.id, {
        status: 'done', gameId: g.id, version,
        artifacts: {
          prd: docs.prd, design: docs.design, arch: docs.arch,
          ...(referenceResult ? { reference: referenceResult } : {}),
          ...(referenceDesignContract ? { referenceDesignContract } : {})
        },
        transcript: S().meeting.transcript.slice(-120)
      })

      const gl = await api.games()
      S().setGames(gl.games)
      w.setShelfGames(gl.games)
      const reward = S().awardRelease({
        title: g.title,
        version,
        gameId: g.id,
        qaOk,
        upgrade: isUp,
        directionId: direction?.id,
        mission: direction?.mission
      })
      S().setMeeting({ status: 'done', resultGameId: g.id, resultVersion: version, reward })
      S().toast(`🎉 ${g.title} ${version} 릴리즈 완료!`, 'success')
      return { gameId: g.id, version }
    } catch (e) {
      const message = String(e.message || e)
      const wasCancelled = this.cancelled || message === '회의가 취소되었습니다'
      S().setMeeting({ status: wasCancelled ? 'cancelled' : 'error', error: wasCancelled ? null : message })
      this._say('system', 'system', wasCancelled ? '회의를 안전하게 중단했습니다.' : `⚠️ 회의 중단: ${message}`)
      if (!wasCancelled) throw e
      return null
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

  async _waitDirectionChoice(options) {
    const recommended = options.find(o => o.recommended) || options[0]
    S().setMeeting({
      directionGate: { options, recommendedId: recommended.id, until: Date.now() + 12000 }
    })
    this._say('system', 'system', '🧭 리서치 완료 — 이번 빌드의 제작 방향을 고르세요. 12초 후 추천안으로 진행합니다.')
    const selection = await new Promise(resolve => {
      const timer = setTimeout(() => this._finishDirection(recommended.id, true), 12000)
      this._direction = { resolve, timer }
    })
    this._direction = null
    S().setMeeting({ directionGate: null })
    if (selection.id === '__cancel__') return selection.id
    const picked = options.find(o => o.id === selection.id) || recommended
    const direction = {
      ...picked,
      mission: { ...picked.mission, id: `${S().meeting.id}:${picked.id}` },
      selectedAt: Date.now(),
      autoSelected: selection.auto
    }
    S().setMeeting({ direction })
    this._say('player', 'player', `${direction.icon} 제작 방향은 「${direction.title}」로 갑니다. 이번 빌드 KPI: ${direction.mission.label}`)
    return direction
  }

  _finishDirection(id, auto = false) {
    if (!this._direction) return
    clearTimeout(this._direction.timer)
    const { resolve } = this._direction
    this._direction = null
    resolve({ id, auto })
  }

  _finishApproval(value) {
    if (!this._approval) return
    clearTimeout(this._approval.timer)
    const { resolve } = this._approval
    this._approval = null
    resolve(value)
  }

  async _waitApproval() {
    const auto = S().settings.autoApprove
    S().setMeeting({ approval: { until: Date.now() + (auto ? 6000 : 90000), auto } })
    const val = await new Promise(resolve => {
      const timer = setTimeout(() => this._finishApproval('auto'), auto ? 6000 : 90000)
      this._approval = { resolve, timer }
    })
    this._approval = null
    S().setMeeting({ approval: null })
    if (val !== '__cancel__') {
      this._say('system', 'system', val === 'auto'
        ? '출시 준비 자동 확인 — 구현 단계로 진행합니다.'
        : '팀장이 출시 준비를 확인했습니다. 구현을 시작합니다.')
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

function localReferenceFallback(agenda, error) {
  const signal = String(agenda || '')
  const genre = [
    {
      id: 'collection', test: /수집|포획|도감|파티|collection|capture/i,
      mechanics: ['collect', 'select', 'use', 'review'],
      uiFocus: ['command menu hierarchy', 'party card grid', 'status HUD', 'collection grid']
    },
    {
      id: 'runner', test: /러너|달리|점프|장애물|runner|obstacle/i,
      mechanics: ['read', 'move', 'avoid', 'retry'],
      uiFocus: ['hazard telegraph', 'minimal score HUD', 'input acknowledgement', 'result feedback']
    },
    {
      id: 'rhythm', test: /리듬|박자|음악|rhythm|beat/i,
      mechanics: ['read', 'time', 'judge', 'retry'],
      uiFocus: ['timing lane', 'judgment feedback', 'combo HUD', 'result grading']
    },
    {
      id: 'arcade', test: /.*/,
      mechanics: ['read', 'act', 'score', 'retry'],
      uiFocus: ['instruction cue', 'safe HUD hierarchy', 'input acknowledgement', 'result feedback']
    }
  ].find(item => item.test.test(signal))
  const selected = {
    id: `genre-baseline-${genre.id}`,
    title: `${genre.id.toUpperCase()} 구조 안전 베이스라인`,
    confidence: 0.42,
    mechanics: genre.mechanics,
    uiFocus: genre.uiFocus,
    why: '검색 서비스를 사용할 수 없어 특정 게임을 사실처럼 선택하지 않고, 장르 공통 정보 구조와 피드백 계약으로 계속 제작합니다.',
    sourceUrls: []
  }
  return {
    status: 'fallback',
    keywords: [...extractKeywords(agenda, 5), ...genre.mechanics].slice(0, 8),
    queries: [], queryRuns: [],
    candidates: [selected],
    selected,
    uiReferences: [],
    sources: [], evidence: [], reason: selected.why, selectionMode: 'local-genre-baseline', fallback: true,
    fallbackReason: `레퍼런스 API 연결 실패로 장르 공통 계약을 사용했습니다: ${String(error?.message || error).slice(0, 180)}`,
    error: String(error?.message || error).slice(0, 220), generatedAt: new Date().toISOString()
  }
}

function formatReferenceBrief(reference) {
  if (!reference?.selected) return ''
  const target = reference.selected
  const candidates = (reference.candidates || []).map((item, index) =>
    `${index + 1}. ${item.title} — ${item.why || ''}${item.evidenceCount != null ? ` (검색 근거 ${item.evidenceCount}건)` : ''}`
  ).join('\n')
  const allUiReferences = reference.uiReferences || []
  const modelSafeUiReferences = allUiReferences.filter(item =>
    item.aiInputAllowed !== false && item.usage !== 'human-review-only' && item.policy !== 'manual-review-only'
  )
  const heldForManualReview = allUiReferences.length - modelSafeUiReferences.length
  const ui = modelSafeUiReferences.map(item =>
    `- ${item.title} [${item.verified ? '검색 검증' : '후속 조회'}] ${item.url || ''}\n  참고 화면: ${(item.screens || []).join(', ') || 'HUD, 메뉴, 결과 화면'}${item.apply ? `\n  일반화한 적용 포인트: ${item.apply}` : ''}${item.aiInputAllowed === false ? '\n  사용 제한: 인간 수동 검토만, 원본 픽셀의 AI 입력·다운로드·복제 금지' : ''}`
  ).join('\n')
  return `[게임/UI 레퍼런스 리서치]
검색 키워드: ${(reference.keywords || []).join(', ')}
후보 비교:
${candidates || `1. ${target.title}`}
최종 타겟: ${target.title} (확신도 ${Math.round((target.confidence || 0.5) * 100)}%)
선정 이유: ${reference.reason || target.why}
차용할 메카닉: ${(target.mechanics || []).join(', ')}
차용할 UI 구조: ${(target.uiFocus || []).join(', ')}
UI 출처:
${ui || '- 모델 입력이 허용된 UI 출처 없음 — 결정적 장르 baseline 사용'}
${heldForManualReview ? `- 수동 검토 전용 출처 ${heldForManualReview}건은 이 프롬프트와 RAG에서 제외하고 릴리즈 문서에 메타데이터만 보존` : ''}

[적용 원칙]
- 타겟 게임의 캐릭터·명칭·아트·맵을 복제하지 말고 정보 계층, 입력 흐름, 피드백 타이밍만 추상화한다.
- DOTCADE 게임팩 제약과 이번 안건의 핵심 루프에 맞춰 기능 수를 줄인다.
- 검색 근거가 없는 세부 사항은 사실처럼 단정하지 않는다.`
}

function referenceMarkdown(reference) {
  if (!reference?.selected) return '# 게임/UI 레퍼런스 리서치\n\n레퍼런스 없음\n'
  const evidence = (reference.sources || []).slice(0, 20).map(item =>
    `- [${item.title || item.url}](${item.url || '#'}) — ${item.excerpt || ''}`
  ).join('\n')
  const manualOnly = (reference.uiReferences || []).filter(item =>
    item.aiInputAllowed === false || item.usage === 'human-review-only' || item.policy === 'manual-review-only'
  ).map(item => `- [${item.title || item.source || '수동 검토 링크'}](${item.url || '#'}) — 원본 픽셀·본문은 모델/RAG 입력에서 제외`).join('\n')
  return `# 게임/UI 레퍼런스 리서치

${formatReferenceBrief(reference)}

## 검색 쿼리

${(reference.queries || []).map(query => `- \`${query}\``).join('\n') || '- 오프라인 폴백'}

## 검색 근거

${evidence || '- 웹 검색을 사용할 수 없어 UI 데이터베이스 조회 링크만 저장했습니다.'}

## 수동 검토 전용 UI 출처

${manualOnly || '- 없음'}
`
}

const KEYWORD_STOP = new Set([
  '게임', '이번', '안건', '회의', '개인', '조사', '메모', '관점', '제안', '최근', '과거',
  '관련', '핵심', '방향', '버전', '도트', '하세요', '합니다', '하는', '있는', '반영',
  'https', 'http', 'www', 'com', 'html', 'title', 'content'
])

// 리서치 문장에 자주 섞이는 게임명·수식어보다 실제 구현 결정을 바꾸는
// 기술 신호를 먼저 노출한다. 매칭되지 않는 자리는 일반 빈도 키워드로 채운다.
const TECH_KEYWORD_PATTERNS = [
  ['원버튼 입력', /한\s*버튼|원\s*버튼|one[-\s]?button/gi],
  ['입력 지연', /입력\s*(?:지연|레이턴시)|input\s*(?:lag|latency)/gi],
  ['Fixed Timestep', /고정\s*(?:스텝|타임스텝)|fixed\s*time\s*step/gi],
  ['히트박스', /히트\s*박스|hit\s*box/gi],
  ['충돌 판정', /충돌\s*(?:판정|감지)|collision\s*(?:check|detection)?/gi],
  ['코요테 타임', /코요테\s*타임|coyote\s*time/gi],
  ['히트스톱', /히트\s*스톱|hit\s*stop/gi],
  ['상태 머신', /상태\s*머신|finite\s*state\s*machine|\bfsm\b/gi],
  ['오브젝트 풀링', /오브젝트\s*풀링|object\s*pool(?:ing)?/gi],
  ['경로 탐색', /경로\s*탐색|path\s*find(?:ing)?|\ba\*\b/gi],
  ['절차 생성', /절차적?\s*생성|procedural\s*generation/gi],
  ['결정적 Seed', /결정적|deterministic|고정\s*seed|시드/gi],
  ['텔레메트리', /텔레메트리|telemetry|semantic\s*event/gi],
  ['Canvas', /html5\s*canvas|canvas\s*2d|\bcanvas\b/gi],
  ['WebGL', /\bwebgl\b|\bshader\b|셰이더/gi]
]

function extractKeywords(text, limit = 7) {
  const source = String(text || '')
  const technical = TECH_KEYWORD_PATTERNS
    .map(([label, pattern], order) => ({ label, order, hits: (source.match(pattern) || []).length }))
    .filter(item => item.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.order - b.order)
    .map(item => item.label)

  const counts = new Map()
  const words = source.match(/[A-Za-z][A-Za-z0-9+-]{1,20}|[가-힣]{2,12}/g) || []
  for (const raw of words) {
    const word = raw.toLowerCase()
    if (KEYWORD_STOP.has(word) || /^\d+$/.test(word)) continue
    counts.set(word, (counts.get(word) || 0) + 1)
  }
  const fallback = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .map(([word]) => word)
    .filter(word => !technical.some(label => label.toLowerCase().includes(word)))
  return [...technical, ...fallback].slice(0, limit)
}

function buildDirections({ agenda, keywords, isUpgrade, upgradeInfo }) {
  const signal = `${agenda} ${upgradeInfo || ''}`
  const subject = keywords.slice(0, 2).join(' · ') || '핵심 루프'
  let recommendedId = 'stable'
  if (/실험|독창|참신|새로|반전|혁신|변주/.test(signal)) recommendedId = 'experiment'
  else if (/손맛|조작|타격|리듬|콤보|파티클|이펙트|몰입/.test(signal)) recommendedId = 'feel'

  const options = [
    {
      id: 'stable', icon: '🛡️', title: '안정 완성', tag: '낮은 리스크',
      summary: `${subject}의 핵심만 남겨 첫 판부터 명확하게 만듭니다.`,
      focus: '단순한 조작, 공정한 충돌, 읽히기 쉬운 점수 규칙',
      directive: '기능 수를 줄이고 버그·애매한 판정·급격한 난이도 스파이크를 우선 제거한다.',
      risk: '차별성과 화려함이 약해질 수 있음',
      mission: {
        metric: 'errors', operator: 'lte', target: 0,
        label: '오락실 20명 플레이 오류 0건',
        description: '전체 플레이 텔레메트리의 런타임 오류 합계를 0으로 유지',
        reward: { xp: 120, coins: 35 }
      }
    },
    {
      id: 'feel', icon: '⚡', title: '손맛 집중', tag: '중간 리스크',
      summary: `${subject}에 즉각적인 피드백과 콤보 리듬을 더합니다.`,
      focus: '입력 반응, 피격·획득 연출, 콤보와 난이도 템포',
      directive: '조작 즉시 보이는 반응과 득실의 리듬을 최우선으로 하고 juice를 핵심 루프와 연결한다.',
      risk: '연출 구현이 늘어나 QA 시간이 빡빡해질 수 있음',
      mission: {
        metric: 'controls', operator: 'gte', target: 7,
        label: '오락실 조작감 7.0 이상',
        description: '손님 평가 6축 중 조작감 평균 7.0 달성',
        reward: { xp: 135, coins: 40 }
      }
    },
    {
      id: 'experiment', icon: '🧪', title: '실험적 변주', tag: '높은 리스크',
      summary: `${subject}을 예상 밖 규칙 하나로 뒤집어 기억에 남겁니다.`,
      focus: '한 문장으로 설명되는 차별 메카닉, 의미 있는 리스크·보상',
      directive: '기존 회피·획득 문법을 그대로 복제하지 말고 플레이어의 판단을 바꾸는 규칙 하나를 구현한다.',
      risk: '첫 플레이 이해도와 밸런스가 흔들릴 수 있음',
      mission: {
        metric: 'originality', operator: 'gte', target: 7,
        label: '오락실 독창성 7.0 이상',
        description: '손님 평가 6축 중 독창성 평균 7.0 달성',
        reward: { xp: 150, coins: 45 }
      }
    }
  ]
  return options.map(o => ({ ...o, recommended: o.id === recommendedId, isUpgrade }))
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
