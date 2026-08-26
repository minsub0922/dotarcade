import React from 'react'
import { useStore } from '../state/store.js'
import { TEAM } from '../data/personas.js'
import { PHASES } from '../meeting/prompts.js'

export default function HUD({ onLibrary, onMeeting, onArcade, onSettings, onHelp }) {
  const config = useStore(s => s.config)
  const games = useStore(s => s.games)
  const map = useStore(s => s.map)
  const meeting = useStore(s => s.meeting)
  const arcade = useStore(s => s.arcade)
  const meetingActive = meeting?.status === 'running'
  const arcadeActive = arcade && ['running', 'summarizing'].includes(arcade.status)
  const pendingGame = games.find(g => !g.feedback?.[g.version])
  const phaseIndex = Math.max(0, PHASES.findIndex(p => p.key === meeting?.phase))
  const objective = meetingActive
    ? { icon: '✦', eyebrow: 'STUDIO BUILD', title: `${meeting.phaseLabel || '제작'} · ${meeting.agenda || '새 게임 제작'}`, progress: ((phaseIndex + 1) / PHASES.length) * 100, count: `${phaseIndex + 1}/${PHASES.length}`, tone: 'building' }
    : arcadeActive
      ? { icon: '◆', eyebrow: arcade.status === 'summarizing' ? 'REPORTING' : 'PLAYTEST LIVE', title: `${arcade.title || '게임'} · AI 손님 평가`, progress: ((arcade.progress || 0) / 20) * 100, count: `${arcade.progress || 0}/20`, tone: 'testing' }
      : games.length === 0
        ? { icon: '＋', eyebrow: 'NEXT MILESTONE', title: '첫 게임팩을 제작하세요', progress: 8, count: '1/3', tone: 'idle' }
        : pendingGame
          ? { icon: '▶', eyebrow: 'NEXT MILESTONE', title: `${pendingGame.title} 오락실 배포`, progress: 52, count: '2/3', tone: 'idle' }
          : { icon: '↻', eyebrow: 'STUDIO LOOP', title: '피드백을 반영해 다음 버전 출시', progress: 100, count: '3/3', tone: 'ready' }

  return (
    <div className="hud-layer">
      <header className="hud">
        <div className="logo" aria-label="DOTCADE">
          <span className="logo-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="logo-type"><b>DOTCADE</b><small>GAME STUDIO</small></span>
        </div>

        <div className={`studio-objective ${objective.tone}`} role="status" aria-label={`${objective.eyebrow}: ${objective.title}`}>
          <span className="objective-icon" aria-hidden="true">{objective.icon}</span>
          <span className="objective-copy">
            <small>{map === 'office' ? 'DOTCADE STUDIO' : 'DOTCADE ARCADE'} · {objective.eyebrow}</small>
            <b title={objective.title}>{objective.title}</b>
            <span className="objective-track" aria-hidden="true"><i style={{ width: `${Math.max(3, Math.min(100, objective.progress))}%` }} /></span>
          </span>
          <span className="objective-count">{objective.count}</span>
        </div>

        <div className="hud-right">
          <div className="presence" aria-label={`온라인 ${TEAM.length + 1}명`}>
            <div className="presence-faces">
              {TEAM.slice(0, 4).map(member => (
                <img key={member.id} src={`/assets/sprites_v2/${member.sprite}/face.png`} alt={member.name} title={`${member.name} · ${member.role}`} />
              ))}
              <span>+{Math.max(1, TEAM.length - 3)}</span>
            </div>
            <small>{TEAM.length + 1} online</small>
          </div>
          <span className={`llm-badge ${config.llm}`} title={config.llmError || ''}>
            <i />{config.llm === 'live' ? 'AI 연결됨' : config.llm === 'mock' ? '모의 모드' : '연결 중'}
          </span>
          <button className="icon-btn" onClick={onHelp} title="도움말" aria-label="도움말">?</button>
          <button className="icon-btn" onClick={onSettings} title="설정" aria-label="설정">⚙</button>
        </div>
      </header>

      <nav className="hud-btns" aria-label="스튜디오 메뉴">
        <button className="hud-action" onClick={onMeeting} disabled={meeting?.status === 'running'} title="팀원들과 BMAD 회의로 게임 제작" aria-label="새 회의 · 게임 만들기">
          <span className="action-icon meeting-icon">✦</span><span className="action-label"><b>새 회의</b><small>게임 만들기</small></span>
        </button>
        <button className="hud-action" onClick={onLibrary} title="게임팩 열기" aria-label={`게임팩 · ${games.length}개 보관 중`}>
          <span className="action-icon library-icon">▤</span><span className="action-label"><b>게임팩</b><small>{games.length}개 보관 중</small></span><span className="badge">{games.length}</span>
        </button>
        <button className="hud-action" onClick={onArcade} title={map === 'office' ? '오락실로 이동' : '사무실로 이동'} aria-label={map === 'office' ? '오락실로 이동' : '사무실로 이동'}>
          <span className="action-icon arcade-icon">{map === 'office' ? '♢' : '▦'}</span><span className="action-label"><b>{map === 'office' ? '오락실' : '사무실'}</b><small>공간 이동</small></span>
        </button>
        {(meetingActive || arcadeActive) && <span className="rail-divider" />}
        {meetingActive && (
          <button className="hud-action activity" onClick={() => useStore.getState().openPanel('meeting')} aria-label={`회의 진행 중 · ${meeting.phaseLabel}`}>
            <span className="activity-dot" /><span className="action-label"><b>회의 진행 중</b><small>{meeting.phaseLabel}</small></span>
          </button>
        )}
        {arcadeActive && (
          <button className="hud-action activity" onClick={() => useStore.getState().openPanel('arcade')} aria-label={`플레이 테스트 · ${arcade.progress}/20명 완료`}>
            <span className="activity-dot" /><span className="action-label"><b>플레이 테스트</b><small>{arcade.progress}/20명 완료</small></span>
          </button>
        )}
      </nav>
    </div>
  )
}
