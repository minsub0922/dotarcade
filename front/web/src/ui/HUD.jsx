import React from 'react'
import { useStore } from '../state/store.js'

export default function HUD({ onLibrary, onMeeting, onArcade, onSettings, onHelp }) {
  const config = useStore(s => s.config)
  const games = useStore(s => s.games)
  const map = useStore(s => s.map)
  const meeting = useStore(s => s.meeting)
  const arcade = useStore(s => s.arcade)

  return (
    <header className="hud">
      <div className="logo">🕹️ <b>DOTCADE</b><span className="sub">멀티에이전트 게임 스튜디오</span></div>
      <div className="hud-btns">
        <button onClick={onMeeting} disabled={meeting?.status === 'running'} title="팀원들과 BMAD 회의로 게임 제작">
          📋 회의 시작
        </button>
        <button onClick={onLibrary}>🗄️ 게임팩 <span className="badge">{games.length}</span></button>
        <button onClick={onArcade}>{map === 'office' ? '🕹️ 오락실' : '🏢 사무실'}</button>
        {meeting?.status === 'running' && (
          <button className="pulse" onClick={() => useStore.getState().openPanel('meeting')}>🔴 회의 중 — {meeting.phaseLabel}</button>
        )}
        {arcade?.status === 'running' && (
          <button className="pulse" onClick={() => useStore.getState().openPanel('arcade')}>🔴 시뮬레이션 {arcade.progress}/20</button>
        )}
      </div>
      <div className="hud-right">
        <span className={`llm-badge ${config.llm}`} title={config.llmError || ''}>
          {config.llm === 'live' ? `⚡ Gemini (${config.models?.fast?.replace('gemini-', '')})` : config.llm === 'mock' ? '🧪 모의 모드' : '…'}
        </span>
        <button onClick={onHelp} title="도움말">❓</button>
        <button onClick={onSettings} title="설정">⚙️</button>
      </div>
    </header>
  )
}
