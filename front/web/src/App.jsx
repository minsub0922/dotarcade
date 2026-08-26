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
import { PHASES } from './meeting/prompts.js'
import { PHASE_ICONS } from './ui/PhaseStepper.jsx'

export default function App() {
  const cvRef = useRef(null)
  const engRef = useRef(null)
  const meetRef = useRef(null)
  const simRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [zoom, setZoom] = useState(1)
  const { panel, panelData, map, hint } = useStore()

  // ---------- boot ----------
  useEffect(() => {
    let alive = true
    let resizeObserver = null
    let stopHandheldAmbience = null
    ;(async () => {
      // 프로필 쿠키 발급을 위해 config를 먼저 (첫 접속 시 브라우저별 DB 생성)
      const cfg = await api.config().catch(() => ({ llm: 'unknown', models: {}, offline: true }))
      const [maps, manifest, gl] = await Promise.all([
        fetch('/assets/maps.json').then(r => r.json()),
        fetch('/assets/sprites_v2/sprites.json').then(r => r.json()),
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
        onHint: h => useStore.getState().setHint(h),
        onInteract: event => {
          if (event?.type === 'handheld' || event?.type === 'portable') interact(event)
        }
      })
      // 타일 상수 공유
      eng.maps.office.collision = maps.office.collision
      eng.maps.arcade.collision = maps.arcade.collision
      engRef.current = eng
      meetRef.current = new MeetingEngine(eng)
      simRef.current = new ArcadeSim(eng)
      window.__dotcade = { eng, meet: meetRef.current, sim: simRef.current, store: useStore } // 디버그/E2E용

      await eng.load(['player', ...TEAM.map(t => t.id), ...VISITORS.map(v => v.id)])
      eng.player.label = `${PLAYER.name} (팀장)`

      // 오피스 팀 배치
      const seats = maps.office.seats
      TEAM.forEach(m => {
        const s = seats[m.id]
        const e = eng.addAgent(m.id, m.sprite, s.desk, { label: `${m.name} · ${m.role}`, color: m.color, home: { desk: s.desk, face: s.face } })
        e.ambient = m.ambient
        e.meta.shortName = m.name
        eng.sit(m.id, s.desk, s.face)
      })
      stopHandheldAmbience = startOfficeHandheldAmbience(eng, TEAM, () => useStore.getState())
      eng.setShelfGames(gl.games)
      eng.setZoom(1)
      eng.start()
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
      if (!localStorage.getItem(visitedKey)) {
        useStore.getState().openPanel('help')
        localStorage.setItem(visitedKey, '1')
      }
    })()
    return () => { alive = false; resizeObserver?.disconnect(); stopHandheldAmbience?.(); engRef.current?.stop() }
  }, [])

  // ---------- keyboard ----------
  useEffect(() => {
    const eng = () => engRef.current
    const kd = e => {
      const st = useStore.getState()
      const active = document.activeElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName) || active?.isContentEditable
      if (!typing && !st.panel) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
          eng()?.keys.add(e.code)
          if (e.code.startsWith('Arrow')) e.preventDefault()
        }
        if (!e.repeat && (e.code === 'KeyE' || e.code === 'Enter') && active?.tagName !== 'BUTTON') {
          if (st.hint) interact(st.hint)
        }
        if (!e.repeat && e.code === 'KeyF') {
          if (eng()?.throwHeld()) e.preventDefault()
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
      st.openPanel('chat', { agentId: h.id })
    } else if (h.type === 'shelf') {
      st.openPanel('library')
    } else if (h.type === 'meeting') {
      // 회의실 근처 E — HUD '회의 시작' 버튼과 동일 동작
      if (st.meeting?.status === 'running') st.openPanel('meeting')
      else st.openPanel('meetingStart')
    } else if (h.type === 'door') {
      switchMap()
    } else if (h.type === 'cabinet') {
      const g = st.games.find(x => x.title === eng.cabinetLabels[h.id]?.title) || st.games[0]
      if (g) st.openPanel('play', { gameId: g.id })
    }
  }

  function switchMap() {
    const st = useStore.getState()
    const eng = engRef.current
    if (st.map === 'office') {
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
    } else {
      eng.setMap('office', [26, 17])
      st.setMap('office')
    }
  }

  // ---------- 회의/배포 액션 ----------
  async function startMeeting(agenda, upgradeGame, options = {}) {
    const st = useStore.getState()
    if (st.meeting?.status === 'running') return st.toast('이미 회의가 진행 중입니다', 'warn')
    if (st.map === 'arcade') switchMap()
    engRef.current?.settleFreeRoam({ silent: true })
    st.closePanel()
    try { await meetRef.current.run(agenda, { upgradeGame, referenceSearch: !!options.referenceSearch }) } catch (e) { console.error(e) }
  }

  async function deployToArcade(game) {
    const st = useStore.getState()
    if (st.arcade?.status === 'running') return st.toast('오락실 시뮬레이션이 이미 진행 중입니다', 'warn')
    const eng = engRef.current
    eng.settleFreeRoam({ silent: true })
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

  const arcade = useStore(s => s.arcade)
  const meeting = useStore(s => s.meeting)
  const mIdx = meeting ? Math.max(0, PHASES.findIndex(p => p.key === meeting.phase)) : 0
  const meetingActive = meeting?.status === 'running'
  const arcadeActive = arcade && ['running', 'summarizing'].includes(arcade.status)

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

  return (
    <div className={`app map-${map} ${panel ? 'has-panel' : ''} ${meetingActive ? 'mode-meeting' : ''} ${arcadeActive ? 'mode-sim' : ''}`} data-phase={meeting?.phase || ''}>
      <HUD
        onLibrary={() => useStore.getState().openPanel('library')}
        onMeeting={() => useStore.getState().openPanel('meetingStart')}
        onArcade={switchMap}
        onSettings={() => useStore.getState().openPanel('settings')}
        onHelp={() => useStore.getState().openPanel('help')}
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
            aria-label={`${map === 'office' ? '도트케이드 사무실' : '도트케이드 오락실'} 월드. WASD, 방향키 또는 클릭으로 이동하고 E로 상호작용, F로 소품을 던집니다.`}
          />
          {!ready && <div className="boot">DOTCADE 로딩 중<span className="dots">...</span></div>}
          {hint && !panel && <div className="hint-bar"><b>{hint.key || 'E'}</b> {hint.label}</div>}
          <div className="map-badge"><span>{map === 'office' ? '▦' : '◆'}</span><div><b>{map === 'office' ? '사무실' : '오락실'}</b><small>{map === 'office' ? '팀원 5명과 함께' : '플레이 테스트 공간'}</small></div></div>
          {meeting?.status === 'running' && panel !== 'meeting' && (
            <button className="meeting-float" onClick={() => useStore.getState().openPanel('meeting')} title="회의 패널 열기">
              <span className="mf-dot" />
              <span>회의 진행 중</span>
              <b>{PHASE_ICONS[PHASES[mIdx].key]} {PHASES[mIdx].label}</b>
              <span className="mf-count">{mIdx + 1}/{PHASES.length}</span>
              <span className="mf-bar"><span style={{ width: (mIdx / (PHASES.length - 1)) * 100 + '%' }} /></span>
            </button>
          )}
        </div>
      </div>

      <div className={`player-card ${meetingActive ? 'busy' : arcadeActive ? 'testing' : ''}`}>
        <span className="player-avatar"><img src="/assets/sprites_v2/player/face.png" alt="내 아바타" /><i /></span>
        <span className="player-copy"><b>나</b><small>{meetingActive ? '제작 지휘 중' : arcadeActive ? '플레이테스트 관전 중' : '스튜디오 팀장'}</small></span>
        <span className="move-help"><kbd>WASD · E · F</kbd><small>이동 · 상호작용 · 던지기</small></span>
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
      {panel === 'meeting' && <MeetingPanel meet={meetRef.current} onDeploy={deployToArcade} onPlay={id => useStore.getState().openPanel('play', { gameId: id })} />}
      {panel === 'arcade' &&
        <ArcadePanel sim={simRef.current} onBack={() => { useStore.getState().closePanel(); if (useStore.getState().map === 'arcade') switchMap() }} />}
      {panel === 'library' && <Library portable={!!panelData?.portable} onPlay={(id, v) => useStore.getState().openPanel('play', { gameId: id, version: v, portable: !!panelData?.portable, sourceId: panelData?.sourceId })} onUpgrade={g => useStore.getState().openPanel('meetingStart', { upgradeGame: g })} onDeploy={deployToArcade} />}
      {panel === 'play' && <PlayModal />}
      {panel === 'settings' && <Settings />}
      {panel === 'meetingStart' && <MeetingStart onStart={startMeeting} />}
      {panel === 'help' && <Help />}
      <Toasts />
    </div>
  )
}
