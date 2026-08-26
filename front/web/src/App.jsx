import React, { useEffect, useRef, useState } from 'react'
import { useStore } from './state/store.js'
import { api } from './api.js'
import { Engine } from './engine/world.js'
import { MeetingEngine } from './meeting/engine.js'
import { ArcadeSim } from './arcade/sim.js'
import { startOfficeHandheldAmbience } from './arcade/portable.js'
import { TEAM, PLAYER, VISITORS } from './data/personas.js'
import HUD from './ui/HUD.jsx'
import ChatPanel from './ui/ChatPanel.jsx'
import MeetingPanel from './ui/MeetingPanel.jsx'
import ArcadePanel from './ui/ArcadePanel.jsx'
import Library from './ui/Library.jsx'
import PlayModal from './ui/PlayModal.jsx'
import Settings from './ui/Settings.jsx'
import MeetingStart from './ui/MeetingStart.jsx'
import Help from './ui/Help.jsx'
import Toasts from './ui/Toasts.jsx'
import ReportModal from './ui/ReportModal.jsx'
import MilestoneConfirm from './ui/MilestoneConfirm.jsx'
import AvatarProfile from './ui/AvatarProfile.jsx'
import TaskGuideChip from './ui/TaskGuideChip.jsx'
import { PHASES } from './meeting/prompts.js'
import { isMeetingActive, isMeetingPaused, meetingStatusCopy } from './meeting/status.js'
import { PHASE_ICONS } from './ui/PhaseStepper.jsx'
import { getMilestoneConflict, getStudioMilestone, MILESTONE_ACTION } from './ui/milestone.js'

const TRAVEL_CANCELLED = 'milestone-travel-cancelled'
const TASK_ACTIVITY_KEY = 'dotcade-studio-task-activity'

const readTaskActivity = () => {
  try {
    const value = JSON.parse(localStorage.getItem(TASK_ACTIVITY_KEY) || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch { return {} }
}

const abortablePause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(new Error(TRAVEL_CANCELLED))
  const timer = window.setTimeout(done, ms)
  function done() {
    signal.removeEventListener('abort', cancel)
    resolve()
  }
  function cancel() {
    window.clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
    reject(new Error(TRAVEL_CANCELLED))
  }
  signal.addEventListener('abort', cancel, { once: true })
})

const nearestWalkableTile = (grid, target) => {
  if (!grid?.length || !target) return target
  const [tx, ty] = target
  for (let radius = 0; radius <= 3; radius++) {
    const candidates = []
    for (let y = ty - radius; y <= ty + radius; y++) {
      for (let x = tx - radius; x <= tx + radius; x++) {
        if (Math.abs(x - tx) + Math.abs(y - ty) > radius) continue
        if (grid[y]?.[x] === '.') candidates.push([x, y])
      }
    }
    if (candidates.length) return candidates.sort((a, b) => (Math.abs(a[0] - tx) + Math.abs(a[1] - ty)) - (Math.abs(b[0] - tx) + Math.abs(b[1] - ty)))[0]
  }
  return target
}

function autoWalk(world, target, { signal, timeoutMs = 9000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!world || signal?.aborted) return reject(new Error(TRAVEL_CANCELLED))
    const tile = nearestWalkableTile(world.grid(), target)
    const player = world.player
    const wasFrozen = world.freezePlayer
    let settled = false
    let timer = null

    const stop = (error = null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      world.freezePlayer = wasFrozen
      if (error) {
        player.path = []
        player.cb = null
        reject(error)
      } else resolve(tile)
    }
    const cancel = () => stop(new Error(TRAVEL_CANCELLED))

    world.keys.clear()
    world.freezePlayer = true
    signal?.addEventListener('abort', cancel, { once: true })
    timer = window.setTimeout(() => stop(new Error('자동 이동 시간이 초과되었습니다.')), timeoutMs)
    world.playerAutoWalk(tile, () => {
      const arrived = Math.hypot(player.x - (tile[0] * 48 + 24), player.y - (tile[1] * 48 + 42)) < 30
      stop(arrived ? null : new Error('목적지까지 안전한 경로를 찾지 못했습니다.'))
    })
  })
}

export default function App() {
  const cvRef = useRef(null)
  const engRef = useRef(null)
  const meetRef = useRef(null)
  const simRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [milestoneFlow, setMilestoneFlow] = useState(null)
  const [taskActivity, setTaskActivity] = useState(readTaskActivity)
  const [taskGuide, setTaskGuide] = useState(null)
  const [avatarProfileId, setAvatarProfileId] = useState(null)
  const journeyRef = useRef(null)
  const taskGuideRef = useRef(null)
  const { panel, panelData, map, hint } = useStore()

  // ---------- boot ----------
  useEffect(() => {
    let alive = true
    let resizeObserver = null
    let stopHandheldAmbience = null
    ;(async () => {
      // 프로필 쿠키 발급을 위해 config를 먼저 (첫 접속 시 브라우저별 DB 생성)
      const cfg = await api.config().catch(() => ({ llm: 'unknown', models: {}, offline: true }))
      const [maps, manifest, walkManifest, gl] = await Promise.all([
        fetch('/assets/maps.json').then(r => r.json()),
        fetch('/assets/sprites_v2/sprites.json').then(r => r.json()),
        fetch('/assets/sprites_v2/walk.json', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        api.games().catch(() => ({ games: [] }))
      ])
      if (!alive) return
      useStore.getState().setConfig(cfg)
      useStore.getState().setGames(gl.games)
      if (cfg.offline) {
        useStore.getState().toast('⚠️ 백엔드(:5175)에 연결할 수 없어요 — 게임팩이 비어 보입니다. START_DOTCADE를 다시 실행해 주세요.', 'warn')
      }

      const eng = new Engine(cvRef.current, {
        maps: { office: maps.office, arcade: maps.arcade },
        manifest,
        walkManifest,
        onHint: h => useStore.getState().setHint(h),
        onInteract: event => {
          if (event?.type === 'handheld' || event?.type === 'portable') interact(event)
          if (event?.type === 'propHit' || event?.type === 'vehicleHit') markTaskActivity('socialized')
        }
      })
      // 타일 상수 공유
      eng.maps.office.collision = maps.office.collision
      eng.maps.arcade.collision = maps.arcade.collision
      engRef.current = eng
      meetRef.current = new MeetingEngine(eng)
      simRef.current = new ArcadeSim(eng)
      window.__dotcade = { eng, meet: meetRef.current, sim: simRef.current, store: useStore } // 디버그/E2E용

      const avatarSpriteIds = [PLAYER, ...TEAM, ...VISITORS].map(avatar => avatar.sprite || avatar.id)
      await eng.load([...new Set(avatarSpriteIds)])
      eng.player.label = `${PLAYER.name} (팀장)`
      eng.player.color = PLAYER.color
      eng.player.meta.shortName = PLAYER.name
      eng.player.meta.role = PLAYER.role

      // 오피스 팀 배치
      const seats = maps.office.seats
      TEAM.forEach(m => {
        const s = seats[m.id]
        const e = eng.addAgent(m.id, m.sprite, s.desk, { label: `${m.name} · ${m.role}`, color: m.color, home: { desk: s.desk, face: s.face } })
        e.ambient = m.ambient
        e.meta.shortName = m.name
        e.meta.role = m.role
        eng.sit(m.id, s.desk, s.face)
      })
      stopHandheldAmbience = startOfficeHandheldAmbience(eng, TEAM, () => useStore.getState())
      eng.setShelfGames(gl.games)
      eng.setZoom(1)
      eng.start()
      if (typeof meetRef.current?.restoreLatest === 'function') {
        try {
          const restoring = meetRef.current.restoreLatest()
          Promise.resolve(restoring).then(restored => {
            if (!alive || !restored) return
            const st = useStore.getState()
            if (isMeetingActive(st.meeting)) {
              st.openPanel('meeting')
              st.toast('↻ 저장된 회의를 전체 팀 컨텍스트와 함께 복원했습니다.')
            }
          }).catch(error => {
            if (alive) useStore.getState().toast(`회의 복원 실패: ${error?.message || error}`, 'warn')
          })
        } catch (error) {
          useStore.getState().toast(`회의 복원 실패: ${error?.message || error}`, 'warn')
        }
      }
      const resizeWorld = () => {
        const rect = cvRef.current?.getBoundingClientRect()
        if (rect?.width && rect?.height) eng.resizeViewport(rect.width, rect.height, window.devicePixelRatio || 1)
      }
      resizeWorld()
      if ('ResizeObserver' in window) {
        resizeObserver = new ResizeObserver(resizeWorld)
        resizeObserver.observe(cvRef.current)
      } else {
        window.addEventListener('resize', resizeWorld)
        resizeObserver = { disconnect: () => window.removeEventListener('resize', resizeWorld) }
      }
      setReady(true)

      // 첫 접속(브라우저 프로필 기준) 시 도움말 가이드 표시
      const visitedKey = 'dotcade-visited-' + (cfg.profile || 'local')
      if (!isMeetingActive(useStore.getState().meeting) && !localStorage.getItem(visitedKey)) {
        useStore.getState().openPanel('help')
        localStorage.setItem(visitedKey, '1')
      }
    })()
    return () => { alive = false; resizeObserver?.disconnect(); stopHandheldAmbience?.(); engRef.current?.stop() }
  }, [])

  useEffect(() => () => journeyRef.current?.abort(), [])

  useEffect(() => {
    if (taskGuideRef.current && (panel || map !== 'office')) clearTaskGuide()
  }, [panel, map])

  // ---------- keyboard ----------
  useEffect(() => {
    const eng = () => engRef.current
    const kd = e => {
      const st = useStore.getState()
      const active = document.activeElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName) || active?.isContentEditable
      if (journeyRef.current) {
        if (e.code === 'Escape') cancelMilestone()
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyR', 'Enter', 'Escape'].includes(e.code)) e.preventDefault()
        return
      }
      if (!typing && !st.panel) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
          eng()?.keys.add(e.code)
          if (e.code.startsWith('Arrow')) e.preventDefault()
        }
        if (!e.repeat && (e.code === 'KeyE' || e.code === 'Enter') && active?.tagName !== 'BUTTON') {
          if (st.hint && st.hint.key !== 'R') {
            e.preventDefault()
            interact(st.hint)
          }
          else if (e.code === 'Enter' && eng()?.performWorldAction?.('ride')) e.preventDefault()
        }
        if (!e.repeat && e.code === 'KeyF') {
          const world = eng()
          const threw = world?.performWorldAction ? world.performWorldAction('throw') : world?.throwHeld()
          if (threw) e.preventDefault()
        }
        if (!e.repeat && e.code === 'KeyR') {
          if (eng()?.performWorldAction?.('ride')) e.preventDefault()
        }
      }
      if (e.code === 'Escape') {
        if (st.panel && !['meeting', 'arcade'].includes(st.panel)) st.closePanel()
        else if (st.panel) st.closePanel()
      }
    }
    const ku = e => eng()?.keys.delete(e.code)
    const blur = () => eng()?.keys.clear()
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur) }
  }, [])

  // ---------- 상호작용 ----------
  function showTaskGuide(guide) {
    clearTaskGuide()
    if (guide?.agentId) engRef.current?.setGuideTarget?.({ type: 'agent', id: guide.agentId })
    taskGuideRef.current = guide
    setTaskGuide(guide)
  }

  function clearTaskGuide() {
    const current = taskGuideRef.current
    engRef.current?.setGuideTarget?.(null)
    if (current?.agentId && current?.suspensionReason) engRef.current?.resumeAutonomy?.(current.agentId, current.suspensionReason)
    taskGuideRef.current = null
    setTaskGuide(null)
  }

  function markTaskActivity(key) {
    if (!key) return
    if (key === 'socialized') clearTaskGuide()
    setTaskActivity(previous => {
      if (previous[key]) return previous
      const next = { ...previous, [key]: Date.now() }
      try { localStorage.setItem(TASK_ACTIVITY_KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
      return next
    })
  }

  function openGame(gameId, options = {}) {
    if (!gameId) return
    markTaskActivity('playedGame')
    useStore.getState().openPanel('play', { gameId, ...options })
  }

  function interact(h) {
    const st = useStore.getState()
    const eng = engRef.current
    if (h.type === 'handheld' || h.type === 'portable') {
      st.openPanel('library', { portable: true, sourceId: h.id || 'office-pocket' })
      st.toast('▣ DOTCADE POCKET — 플레이할 게임팩을 선택하세요')
      return
    }
    if (eng?.interactWorld(h)) return
    if (h.type === 'agent') {
      const e = eng.agent(h.id)
      if (e) { e.meta.chatting = true; e.path = []; e.dir = eng.player.x < e.x ? 'left' : 'right' }
      markTaskActivity('socialized')
      st.openPanel('chat', { agentId: h.id })
    } else if (h.type === 'shelf') {
      st.openPanel('library')
    } else if (h.type === 'meeting') {
      // 회의실 근처 E — HUD '회의 시작' 버튼과 동일 동작
      if (isMeetingActive(st.meeting)) st.openPanel('meeting')
      else if (st.arcade && ['running', 'summarizing'].includes(st.arcade.status)) st.toast('플레이테스트가 끝난 뒤 새 회의를 시작할 수 있습니다', 'warn')
      else st.openPanel('meetingStart')
    } else if (h.type === 'door') {
      switchMap()
    } else if (h.type === 'cabinet') {
      const g = st.games.find(x => x.title === eng.cabinetLabels[h.id]?.title) || st.games[0]
      if (g) openGame(g.id)
    }
  }

  function setWorldMap(targetMap) {
    const st = useStore.getState()
    const eng = engRef.current
    if (!eng || st.map === targetMap) return
    clearTaskGuide()
    if (targetMap === 'arcade') {
      eng.setMap('arcade', eng.maps.arcade.spawn)
      st.setMap('arcade')
      // 배포된 게임이 있으면 캐비닛 어트랙트 유지, 없으면 기본 게임 진열
      if (!Object.keys(eng.cabinetLabels).length && st.games.length) {
        eng.maps.arcade.cabinets.forEach((c, i) => {
          const g = st.games[i % st.games.length]
          eng.cabinetLabels[c.id] = { title: g.title, emoji: g.emoji, color: g.color, playing: false }
        })
      }
      // 시뮬레이션이 없어도 오락실에 손님들이 놀고 있게
      if (st.arcade?.status !== 'running') {
        eng.ensureArcadeAmbient([...VISITORS].sort(() => Math.random() - 0.5).slice(0, 9))
      }
    } else if (targetMap === 'office') {
      eng.setMap('office', [26, 17])
      st.setMap('office')
    }
  }

  function switchMap() {
    clearTaskGuide()
    settleForActivity('공간 이동')
    setWorldMap(useStore.getState().map === 'office' ? 'arcade' : 'office')
  }

  // ---------- 회의/배포 액션 ----------
  function settleForActivity(label) {
    const st = useStore.getState()
    const eng = engRef.current
    const freeRoam = eng?.getWorldInteractionState()
    if (!freeRoam?.held && !freeRoam?.mounted) return false
    eng.settleFreeRoam({ silent: false })
    const item = freeRoam.held?.label || freeRoam.mounted?.label
    st.toast(`✋ ${label} 전에 「${item}」을 현재 위치에 안전하게 두었습니다.`)
    return true
  }

  async function startMeeting(agenda, upgradeGame, options = {}) {
    const st = useStore.getState()
    if (isMeetingActive(st.meeting)) return st.toast('진행 중이거나 일시정지된 회의를 먼저 마쳐 주세요', 'warn')
    if (st.arcade && ['running', 'summarizing'].includes(st.arcade.status)) return st.toast('플레이테스트가 끝난 뒤 새 회의를 시작할 수 있습니다', 'warn')
    clearTaskGuide()
    if (st.map === 'arcade') switchMap()
    settleForActivity('회의 시작')
    st.closePanel()
    try { await meetRef.current.run(agenda, { upgradeGame, referenceSearch: !!options.referenceSearch }) } catch (e) { console.error(e) }
  }

  async function deployToArcade(game) {
    const st = useStore.getState()
    if (st.arcade && ['running', 'summarizing'].includes(st.arcade.status)) return st.toast('오락실 시뮬레이션이 이미 진행 중입니다', 'warn')
    if (isMeetingActive(st.meeting)) return st.toast('제작 회의를 마친 뒤 배포할 수 있습니다', 'warn')
    const eng = engRef.current
    clearTaskGuide()
    settleForActivity('오락실 배포')
    if (st.map !== 'arcade') { eng.setMap('arcade', eng.maps.arcade.spawn); st.setMap('arcade') }
    st.openPanel('arcade')
    st.toast(`🕹️ 「${game.title}」 오락실 배포 — 손님 20명 입장!`)
    try { await simRef.current.run(game) } catch (e) { console.error(e); st.toast('시뮬레이션 오류: ' + e.message, 'warn') }
  }

  // 리포트 팝업 → 회의실(사무실) 복귀 + 업그레이드 회의 자연 연결
  function returnToOffice() {
    const st = useStore.getState()
    if (st.map === 'arcade') switchMap()
    const g = st.games.find(x => x.id === st.arcade?.gameId)
    if (g) st.openPanel('meetingStart', { upgradeGame: g })
  }

  function milestoneConflict(action) {
    const st = useStore.getState()
    return getMilestoneConflict(st, action)
  }

  function requestMilestone(objective) {
    if (!ready || !objective || journeyRef.current) return
    const conflict = milestoneConflict(objective.action)
    if (conflict) return useStore.getState().toast(conflict, 'warn')
    const freeRoam = engRef.current?.getWorldInteractionState()
    const carry = freeRoam?.held
      ? { label: freeRoam.held.label, verb: '들고 있는' }
      : freeRoam?.mounted
        ? { label: freeRoam.mounted.label, verb: '타고 있는' }
        : null
    clearTaskGuide()
    setMilestoneFlow({ objective, status: 'confirm', label: '', carry })
  }

  function requestGameDeployment(game) {
    if (!game) return
    const st = useStore.getState()
    const recommended = getStudioMilestone({
      games: st.games,
      meeting: st.meeting,
      arcade: st.arcade,
      studio: st.studio,
      map: st.map
    })
    const objective = recommended?.action === MILESTONE_ACTION.START_PLAYTEST && recommended.gameId === game.id
      ? recommended
      : {
          action: MILESTONE_ACTION.START_PLAYTEST,
          gameId: game.id,
          icon: '▶',
          tone: 'ready',
          kicker: '신규 게임 제작 완료',
          title: `「${game.title}」 신규 게임 배포`,
          detail: '오락실에 배포하고 AI 손님 20명의 플레이 반응을 확인합니다.',
          confirmTitle: `「${game.title} ${game.version || ''}」을 오락실에 배포할까요?`,
          destination: '오락실 테스트 캐비닛',
          actionLabel: '이동하고 20명 평가 시작',
          arrivalNote: '도착하면 배포 시뮬레이션이 자동으로 시작됩니다.'
        }
    requestMilestone(objective)
  }

  function cancelMilestone() {
    const moving = !!journeyRef.current
    journeyRef.current?.abort()
    journeyRef.current = null
    setMilestoneFlow(null)
    if (moving) useStore.getState().toast('자동 이동을 취소했습니다')
  }

  function updateJourneyLabel(label) {
    setMilestoneFlow(flow => flow ? { ...flow, status: 'moving', label } : flow)
  }

  async function travelTo(targetMap, targetTile, destination, signal) {
    const eng = engRef.current
    const st = useStore.getState()
    if (!eng) throw new Error('월드가 아직 준비되지 않았습니다.')

    const carried = eng.getWorldInteractionState()
    if (carried.held || carried.mounted) {
      eng.settleFreeRoam({ silent: false })
      const item = carried.held?.label || carried.mounted?.label
      useStore.getState().toast(`✋ 자동 이동 전에 「${item}」을 현재 위치에 안전하게 두었습니다.`)
    }

    if (st.map !== targetMap) {
      const door = eng.maps[st.map]?.door?.approach?.[0]
      if (door) {
        updateJourneyLabel(`${st.map === 'office' ? '사무실' : '오락실'} 출입구로 이동 중…`)
        await autoWalk(eng, door, { signal, timeoutMs: 9000 })
      }
      setWorldMap(targetMap)
      await abortablePause(260, signal)
    }

    updateJourneyLabel(`${destination} · 자동 이동 중…`)
    await autoWalk(eng, targetTile, { signal, timeoutMs: 10000 })
    eng.centerCamera(true)
  }

  async function confirmMilestone() {
    const objective = milestoneFlow?.objective
    if (!objective || journeyRef.current) return
    const conflict = milestoneConflict(objective.action)
    if (conflict) {
      setMilestoneFlow(null)
      return useStore.getState().toast(conflict, 'warn')
    }

    const controller = new AbortController()
    journeyRef.current = controller
    setMilestoneFlow(flow => flow ? { ...flow, status: 'moving', label: '다음 행동을 준비 중…' } : flow)
    useStore.getState().closePanel()

    try {
      const eng = engRef.current
      const st = useStore.getState()
      const meetingTile = eng.maps.office.meeting?.head || [2, 5]
      // 캐비닛 spot은 플레이 에이전트가 점유하므로 중앙 관전 통로에 멈춘다.
      const arcadeObserverTile = [5, 6]

      switch (objective.action) {
        case MILESTONE_ACTION.TEAM_INTERACTION: {
          const members = TEAM.map(member => ({ member, entity: eng.agent(member.id) })).filter(item => item.entity)
          const nearest = members.sort((a, b) => {
            const da = Math.hypot(a.entity.x - eng.player.x, a.entity.y - eng.player.y)
            const db = Math.hypot(b.entity.x - eng.player.x, b.entity.y - eng.player.y)
            return da - db
          })[0]
          if (!nearest) throw new Error('대화할 팀원을 찾지 못했습니다.')
          const tx = Math.floor(nearest.entity.x / 48)
          const ty = Math.floor(nearest.entity.y / 48)
          const approach = [[tx - 1, ty], [tx + 1, ty], [tx, ty + 1], [tx, ty - 1]]
            .find(([x, y]) => eng.maps.office.collision[y]?.[x] === '.') || [tx, ty]
          const suspensionReason = `task-guide:${objective.id || objective.action}`
          const autonomySuspended = eng.suspendAutonomy?.(nearest.member.id, suspensionReason) === true
          nearest.entity.path = []
          nearest.entity.cb = null
          try {
            await travelTo('office', approach, `${nearest.member.name} 자리`, controller.signal)
          } catch (error) {
            if (autonomySuspended) eng.resumeAutonomy?.(nearest.member.id, suspensionReason)
            throw error
          }
          eng.player.dir = eng.player.x < nearest.entity.x ? 'right' : 'left'
          eng._computeHint()
          showTaskGuide({
            id: objective.id,
            icon: objective.icon || '💬',
            title: `${nearest.member.name}에게 직접 상호작용해 보세요`,
            text: objective.guide || 'E로 대화하거나, 주변 소품을 E로 집은 뒤 F로 던져 맞혀 보세요.',
            agentId: nearest.member.id,
            suspensionReason: autonomySuspended ? suspensionReason : null
          })
          break
        }
        case MILESTONE_ACTION.PLAY_GAME: {
          const currentMap = useStore.getState().map
          const targetMap = currentMap === 'arcade' ? 'arcade' : 'office'
          const gameSpot = targetMap === 'arcade'
            ? arcadeObserverTile
            : (eng.maps.office.shelf?.front?.[1] || [3, 15])
          await travelTo(targetMap, gameSpot, targetMap === 'arcade' ? '게임 캐비닛' : '게임팩 진열대', controller.signal)
          useStore.getState().openPanel('library', targetMap === 'office' ? null : { source: 'arcade-task' })
          break
        }
        case MILESTONE_ACTION.RESUME_MEETING:
          st.openPanel('meeting')
          break
        case MILESTONE_ACTION.INTERRUPT_MEETING: {
          updateJourneyLabel('회의 컨텍스트를 안전하게 저장하는 중…')
          st.openPanel('meeting')
          const pause = meetRef.current?.pause
          if (typeof pause !== 'function') throw new Error('현재 회의는 일시정지를 지원하지 않습니다.')
          const paused = await pause.call(meetRef.current)
          if (paused === false) throw new Error('회의를 일시정지할 수 있는 단계가 아닙니다.')
          markTaskActivity('pausedMeeting')
          useStore.getState().toast('Ⅱ 회의를 안전하게 일시정지했습니다. 언제든 지시를 추가하고 재개할 수 있습니다.')
          break
        }
        case MILESTONE_ACTION.WATCH_PLAYTEST:
          await travelTo('arcade', arcadeObserverTile, '오락실 테스트 현장', controller.signal)
          useStore.getState().openPanel('arcade')
          break
        case MILESTONE_ACTION.VIEW_REPORT:
          await travelTo('arcade', arcadeObserverTile, '오락실 평가 데스크', controller.signal)
          useStore.getState().setArcade({ reportSeen: false })
          break
        case MILESTONE_ACTION.NEW_MEETING:
          await travelTo('office', meetingTile, '회의실', controller.signal)
          useStore.getState().openPanel('meetingStart')
          break
        case MILESTONE_ACTION.UPGRADE_MEETING: {
          await travelTo('office', meetingTile, '회의실', controller.signal)
          const game = useStore.getState().games.find(candidate => candidate.id === objective.gameId)
          useStore.getState().openPanel('meetingStart', game ? { upgradeGame: game } : null)
          break
        }
        case MILESTONE_ACTION.START_PLAYTEST: {
          await travelTo('arcade', arcadeObserverTile, '테스트 관전 위치', controller.signal)
          const latest = useStore.getState()
          const newConflict = milestoneConflict(objective.action)
          if (newConflict) throw new Error(newConflict)
          const game = latest.games.find(candidate => candidate.id === objective.gameId)
          if (!game) throw new Error('배포할 게임팩을 찾지 못했습니다.')
          void deployToArcade(game)
          break
        }
        default:
          throw new Error('지원하지 않는 마일스톤입니다.')
      }
    } catch (error) {
      if (error.message !== TRAVEL_CANCELLED) useStore.getState().toast(error.message || '자동 이동을 완료하지 못했습니다.', 'warn')
    } finally {
      if (journeyRef.current === controller) {
        journeyRef.current = null
        setMilestoneFlow(null)
      }
    }
  }

  const arcade = useStore(s => s.arcade)
  const meeting = useStore(s => s.meeting)
  const mIdx = meeting ? Math.max(0, PHASES.findIndex(p => p.key === meeting.phase)) : 0
  const meetingActive = isMeetingActive(meeting)
  const meetingRuntime = meetingStatusCopy(meeting)
  const arcadeActive = arcade && ['running', 'summarizing'].includes(arcade.status)
  const avatarProfile = avatarProfileId
    ? [PLAYER, ...TEAM, ...VISITORS].find(avatar => avatar.id === avatarProfileId) || null
    : null

  useEffect(() => {
    if (isMeetingPaused(meeting)) markTaskActivity('pausedMeeting')
  }, [meeting?.status])

  function canvasPoint(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (e.currentTarget.width / rect.width),
      y: (e.clientY - rect.top) * (e.currentTarget.height / rect.height)
    }
  }

  function moveToPointer(e) {
    const eng = engRef.current
    if (e.button !== 0 || !ready || panel || !eng || eng.freezePlayer) return
    const { x, y } = canvasPoint(e)
    e.currentTarget.focus({ preventScroll: true })
    if (eng.interactAtPoint(x, y)) return
    eng.walkPlayerToPoint(x, y)
  }

  function trackPointer(e) {
    const eng = engRef.current
    if (!eng || e.pointerType !== 'mouse') return
    const { x, y } = canvasPoint(e)
    eng.setPointerPosition(x, y)
  }

  function changeZoom(delta) {
    const eng = engRef.current
    if (!eng) return
    setZoom(eng.setZoom(eng.camera.zoom + delta))
  }

  const rideHint = hint?.rideAction || (hint && ['vehicle', 'vehicleMounted'].includes(hint.type) ? hint : null)
  const primaryHint = hint && !['vehicle', 'vehicleMounted'].includes(hint.type) ? hint : null

  return (
    <div className={`app map-${map} ${panel ? 'has-panel' : ''} ${meetingActive ? 'mode-meeting' : ''} ${arcadeActive ? 'mode-sim' : ''}`} data-phase={meeting?.phase || ''}>
      <HUD
        onLibrary={() => useStore.getState().openPanel('library')}
        onMeeting={() => {
          const st = useStore.getState()
          if (isMeetingActive(st.meeting)) st.openPanel('meeting')
          else if (st.arcade && ['running', 'summarizing'].includes(st.arcade.status)) st.toast('플레이테스트가 끝난 뒤 새 회의를 시작할 수 있습니다', 'warn')
          else st.openPanel('meetingStart')
        }}
        onArcade={switchMap}
        onSettings={() => useStore.getState().openPanel('settings')}
        onHelp={() => useStore.getState().openPanel('help')}
        onMilestone={requestMilestone}
        onAvatarProfile={setAvatarProfileId}
        taskActivity={taskActivity}
        journeyActive={!!milestoneFlow}
        suppressTaskCoach={!!milestoneFlow || !!taskGuide}
        worldReady={ready}
      />
      <div className={`stage ${map}`}>
        <div className="canvas-wrap">
          <canvas
            ref={cvRef}
            width={1440}
            height={960}
            onPointerDown={moveToPointer}
            onPointerMove={trackPointer}
            onPointerLeave={() => engRef.current?.setPointerPosition(null, null)}
            tabIndex={0}
            aria-label={`${map === 'office' ? '도트케이드 사무실' : '도트케이드 오락실'} 월드. WASD, 방향키 또는 클릭으로 이동하고 E로 대화와 상호작용, R로 탈것 탑승과 하차, F로 소품을 던집니다.`}
          />
          {!ready && <div className="boot">DOTCADE 로딩 중<span className="dots">...</span></div>}
          {primaryHint && !panel && (primaryHint.type === 'heldProp' ? (
            <div className="hint-bar held-actions" data-interaction-kind="primary" aria-label={`${primaryHint.label} 소품 행동`}>
              <span className="held-action-label">✋ {primaryHint.objectLabel || primaryHint.label?.split(' 들고 있음')[0] || '소품'} 들고 있음</span>
              <button className="throw-action" onClick={() => engRef.current?.performWorldAction?.('throw')}><kbd>F</kbd> 던지기</button>
              <button onClick={() => engRef.current?.performWorldAction?.('drop')}><kbd>E</kbd> 내려놓기</button>
            </div>
          ) : <div className="hint-bar" data-interaction-kind="primary"><b>{primaryHint.key || 'E'}</b> {primaryHint.label}</div>)}
          {rideHint && !panel && (
            <button
              className={`ride-action-chip ${rideHint.type === 'vehicleMounted' ? 'mounted' : ''}`}
              data-interaction-kind="ride"
              onClick={() => engRef.current?.performWorldAction?.('ride')}
              aria-label={`${rideHint.label}. R키`}
            >
              <kbd>R</kbd><span><b>{rideHint.label}</b><small>{rideHint.detail || '빠른 이동'}</small></span>
            </button>
          )}
          {taskGuide && !panel && <TaskGuideChip guide={taskGuide} onClose={clearTaskGuide} />}
          <div className="map-badge"><span>{map === 'office' ? '▦' : '◆'}</span><div><b>{map === 'office' ? '사무실' : '오락실'}</b><small>{map === 'office' ? '팀원 5명과 함께' : '플레이 테스트 공간'}</small></div></div>
          {meetingActive && panel !== 'meeting' && (
            <button className={`meeting-float ${meetingRuntime.tone}`} onClick={() => useStore.getState().openPanel('meeting')} title="회의 패널 열기" aria-label={`${meetingRuntime.label} · 회의 패널 열기`}>
              <span className="mf-dot" />
              <span>{meetingRuntime.label}</span>
              <b>{PHASE_ICONS[PHASES[mIdx].key]} {PHASES[mIdx].label}</b>
              <span className="mf-count">{mIdx + 1}/{PHASES.length}</span>
              <span className="mf-bar"><span style={{ width: (mIdx / (PHASES.length - 1)) * 100 + '%' }} /></span>
            </button>
          )}
        </div>
      </div>

      <div className={`player-card ${meetingActive ? 'busy' : arcadeActive ? 'testing' : ''}`}>
        <span className="player-avatar"><img src="/assets/sprites_v2/player/face.png" alt="내 아바타" /><i /></span>
        <span className="player-copy"><b>나</b><small>{meeting?.status === 'paused' ? '팀장 개입 대기' : meetingActive ? '제작 지휘 중' : arcadeActive ? '플레이테스트 관전 중' : '스튜디오 팀장'}</small></span>
        <span className="move-help"><kbd>WASD · E · R · F</kbd><small>이동 · 대화 · 탑승 · 던지기</small></span>
      </div>

      <div className="map-controls" aria-label="화면 배율">
        <button onClick={() => changeZoom(-.12)} title="축소" aria-label="축소">−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => changeZoom(.12)} title="확대" aria-label="확대">＋</button>
        <button className="locate" onClick={() => engRef.current?.centerCamera(true)} title="내 위치로 이동" aria-label="내 위치로 이동">◎</button>
      </div>

      {/* 시뮬 라이브 뷰 풀 (봇 플레이 실시간 화면) */}
      <div id="sim-slot-pool" className={`sim-pool ${arcade?.status === 'running' ? '' : 'off'}`}>
        {arcade?.status === 'running' && (
          <div className="sim-pool-label">🔴 LIVE 봇 플레이 · {(arcade.playing || []).length}명 플레이 중</div>
        )}
        {arcade?.status === 'running' && (arcade.playing || []).map(id => {
          const v = VISITORS.find(x => x.id === id)
          const live = arcade.liveAgents?.[id]
          return v ? (
            <div key={id} className={`sim-slot venue-${live?.venue || 'cabinet'}`}>
              <div className="sim-name"><img src={`/assets/sprites_v2/${v.id}/face.png`} alt="" />{live?.venue === 'handheld' ? '▣' : '🕹'} {v.name}({v.age})</div>
              <div id={`sim-slot-${v.id}`} className="sim-frame" />
            </div>
          ) : null
        })}
      </div>

      {/* 오락실 종합 리포트 팝업 (스트리밍) */}
      {arcade && !arcade.reportSeen && ['summarizing', 'done', 'report_error'].includes(arcade.status) && (
        <ReportModal onReturnOffice={returnToOffice} />
      )}

      {panel === 'chat' && <ChatPanel world={engRef.current} />}
      {panel === 'meeting' && <MeetingPanel meet={meetRef.current} onDeploy={requestGameDeployment} onPlay={id => openGame(id)} />}
      {panel === 'arcade' &&
        <ArcadePanel sim={simRef.current} onBack={() => { useStore.getState().closePanel(); if (useStore.getState().map === 'arcade') switchMap() }} />}
      {panel === 'library' && <Library portable={!!panelData?.portable} onPlay={(id, v) => openGame(id, { version: v, portable: !!panelData?.portable, sourceId: panelData?.sourceId })} onUpgrade={g => useStore.getState().openPanel('meetingStart', { upgradeGame: g })} onDeploy={deployToArcade} />}
      {panel === 'play' && <PlayModal />}
      {panel === 'settings' && <Settings />}
      {panel === 'meetingStart' && <MeetingStart onStart={startMeeting} />}
      {panel === 'help' && <Help />}
      {avatarProfile && <AvatarProfile avatar={avatarProfile} onClose={() => setAvatarProfileId(null)} />}
      {milestoneFlow && (
        <MilestoneConfirm
          milestone={milestoneFlow.objective}
          journey={milestoneFlow}
          carry={milestoneFlow.carry}
          onConfirm={confirmMilestone}
          onCancel={cancelMilestone}
        />
      )}
      <Toasts />
    </div>
  )
}
