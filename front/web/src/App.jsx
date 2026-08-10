import React, { useEffect, useRef, useState } from 'react'
import { useStore } from './state/store.js'
import { api } from './api.js'
import { Engine } from './engine/world.js'
import { MeetingEngine } from './meeting/engine.js'
import { ArcadeSim } from './arcade/sim.js'
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

export default function App() {
  const cvRef = useRef(null)
  const engRef = useRef(null)
  const meetRef = useRef(null)
  const simRef = useRef(null)
  const [ready, setReady] = useState(false)
  const { panel, map, hint } = useStore()

  // ---------- boot ----------
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [maps, manifest, cfg, gl] = await Promise.all([
        fetch('/assets/maps.json').then(r => r.json()),
        fetch('/assets/sprites/sprites.json').then(r => r.json()),
        api.config().catch(() => ({ llm: 'unknown', models: {} })),
        api.games().catch(() => ({ games: [] }))
      ])
      if (!alive) return
      useStore.getState().setConfig(cfg)
      useStore.getState().setGames(gl.games)

      const eng = new Engine(cvRef.current, {
        maps: { office: maps.office, arcade: maps.arcade },
        manifest,
        onHint: h => useStore.getState().setHint(h),
        onInteract: () => {}
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
      eng.setShelfGames(gl.games)
      eng.start()
      setReady(true)

      if (!localStorage.getItem('dotcade-visited')) {
        useStore.getState().openPanel('help')
        localStorage.setItem('dotcade-visited', '1')
      }
    })()
    return () => { alive = false; engRef.current?.stop() }
  }, [])

  // ---------- keyboard ----------
  useEffect(() => {
    const eng = () => engRef.current
    const kd = e => {
      const st = useStore.getState()
      const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
      if (!typing) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
          eng()?.keys.add(e.code)
          if (e.code.startsWith('Arrow')) e.preventDefault()
        }
        if (e.code === 'KeyE' || e.code === 'Enter') {
          if (st.hint && !st.panel) interact(st.hint)
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
    if (h.type === 'agent') {
      const e = eng.agent(h.id)
      if (e) { e.meta.chatting = true; e.path = []; e.dir = eng.player.x < e.x ? 'left' : 'right' }
      st.openPanel('chat', { agentId: h.id })
    } else if (h.type === 'shelf') {
      st.openPanel('library')
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
  async function startMeeting(agenda, upgradeGame) {
    const st = useStore.getState()
    if (st.meeting?.status === 'running') return st.toast('이미 회의가 진행 중입니다', 'warn')
    if (st.map === 'arcade') switchMap()
    st.closePanel()
    try { await meetRef.current.run(agenda, { upgradeGame }) } catch (e) { console.error(e) }
  }

  async function deployToArcade(game) {
    const st = useStore.getState()
    if (st.arcade?.status === 'running') return st.toast('오락실 시뮬레이션이 이미 진행 중입니다', 'warn')
    const eng = engRef.current
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

  return (
    <div className="app">
      <HUD
        onLibrary={() => useStore.getState().openPanel('library')}
        onMeeting={() => useStore.getState().openPanel('meetingStart')}
        onArcade={switchMap}
        onSettings={() => useStore.getState().openPanel('settings')}
        onHelp={() => useStore.getState().openPanel('help')}
      />
      <div className="stage">
        <div className="canvas-wrap">
          <canvas ref={cvRef} width={1440} height={960} />
          {!ready && <div className="boot">DOTCADE 로딩 중<span className="dots">...</span></div>}
          {hint && !panel && <div className="hint-bar"><b>E</b> {hint.label}</div>}
          <div className="map-badge">{map === 'office' ? '🏢 사무실' : '🕹️ 오락실'}</div>
        </div>
      </div>

      {/* 시뮬 라이브 뷰 풀 (봇 플레이 실시간 화면) */}
      <div id="sim-slot-pool" className={`sim-pool ${arcade?.status === 'running' ? '' : 'off'}`}>
        {arcade?.status === 'running' && (
          <div className="sim-pool-label">🔴 LIVE 봇 플레이 · {(arcade.playing || []).length}명 플레이 중</div>
        )}
        {arcade?.status === 'running' && (arcade.playing || []).map(id => {
          const v = VISITORS.find(x => x.id === id)
          return v ? (
            <div key={id} className="sim-slot">
              <div className="sim-name"><img src={`/assets/sprites/${v.id}/face.png`} alt="" />{v.name}({v.age})</div>
              <div id={`sim-slot-${v.id}`} className="sim-frame" />
            </div>
          ) : null
        })}
      </div>

      {/* 오락실 종합 리포트 팝업 (스트리밍) */}
      {arcade && !arcade.reportSeen && ['summarizing', 'done'].includes(arcade.status) && (
        <ReportModal onReturnOffice={returnToOffice} />
      )}

      {panel === 'chat' && <ChatPanel world={engRef.current} />}
      {panel === 'meeting' && <MeetingPanel meet={meetRef.current} onDeploy={deployToArcade} onPlay={id => useStore.getState().openPanel('play', { gameId: id })} />}
      {panel === 'arcade' &&
        <ArcadePanel sim={simRef.current} onBack={() => { useStore.getState().closePanel(); if (useStore.getState().map === 'arcade') switchMap() }} />}
      {panel === 'library' && <Library onPlay={(id, v) => useStore.getState().openPanel('play', { gameId: id, version: v })} onUpgrade={g => useStore.getState().openPanel('meetingStart', { upgradeGame: g })} onDeploy={deployToArcade} />}
      {panel === 'play' && <PlayModal />}
      {panel === 'settings' && <Settings />}
      {panel === 'meetingStart' && <MeetingStart onStart={startMeeting} />}
      {panel === 'help' && <Help />}
      <Toasts />
    </div>
  )
}
