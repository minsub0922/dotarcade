import React, { useState } from 'react'
import { useStore } from '../state/store.js'

const IDEAS = [
  '점프로 장애물을 피하는 고양이 러너 게임',
  '떨어지는 붕어빵을 받는 겨울 간식 게임',
  '좀비를 피해 옥상을 탈출하는 회피 게임',
  '리듬에 맞춰 버튼을 누르는 타이밍 게임',
  '벽돌을 깨는 클래식 아케이드',
  '슬라임을 튕겨서 별을 모으는 게임'
]

export default function MeetingStart({ onStart }) {
  const { panelData, closePanel } = useStore()
  const games = useStore(s => s.games)
  const [agenda, setAgenda] = useState('')
  const [upId, setUpId] = useState(panelData?.upgradeGame?.id || '')
  const [referenceSearch, setReferenceSearch] = useState(true)
  const up = games.find(g => g.id === upId)

  function go() {
    if (!agenda.trim()) return
    onStart(agenda.trim(), up || null, { referenceSearch })
  }

  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && closePanel()}>
      <div className="modal meeting-start-modal">
        <div className="modal-head meeting-start-head">
          <div className="modal-title-block"><span className="modal-kicker">NEW PROJECT</span><b>📋 회의 안건 제출</b></div>
          <button className="x" onClick={closePanel}>✕</button>
        </div>
        <div className="detail-body">
          <div className="meeting-intro">팀장으로서 안건을 제시하면 팀원 5명이 회의실에 모여 BMAD 파이프라인(리서치→토론→PRD→디자인→설계→구현→QA→릴리즈)으로 <b>실제 동작하는 도트 게임</b>을 만들어냅니다.</div>
          <div className="field">
            <label>회의 종류</label>
            <select value={upId} onChange={e => setUpId(e.target.value)}>
              <option value="">🆕 신규 게임 제작</option>
              {games.map(g => <option key={g.id} value={g.id}>⬆️ 업그레이드 — {g.emoji} {g.title} {g.version}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{up ? '업그레이드 방향' : '어떤 게임을 만들까요?'}</label>
            <textarea
              rows={3} value={agenda} autoFocus
              onChange={e => setAgenda(e.target.value)}
              placeholder={up ? `예: 오락실 피드백을 반영해 콤보 시스템과 파워업을 추가하자` : `예: ${IDEAS[0]}`}
              onKeyDown={e => e.key === 'Enter' && e.metaKey && go()}
            />
          </div>
          <label className={`reference-search-toggle ${referenceSearch ? 'on' : ''}`} htmlFor="reference-search">
            <input
              id="reference-search"
              type="checkbox"
              checked={referenceSearch}
              onChange={e => setReferenceSearch(e.target.checked)}
            />
            <span className="reference-check" aria-hidden="true">{referenceSearch ? '✓' : ''}</span>
            <span className="reference-toggle-copy">
              <strong>🔎 레퍼런스 탐색</strong>
              <small>현재 기획에서 검색어를 만들고, 웹을 병렬 조사해 타겟 게임과 UI 화면을 자동 선정합니다.</small>
              <span className="reference-flow" aria-hidden="true">
                <i>키워드</i><b>→</b><i>병렬 검색</i><b>→</b><i>게임 선정</i><b>→</b><i>UI 레퍼런스</i>
              </span>
            </span>
            <em>{referenceSearch ? '추천 · ON' : 'OFF'}</em>
          </label>
          {!up && (
            <div className="idea-chips">
              {IDEAS.map(i => <button key={i} className="chip" onClick={() => setAgenda(i)}>{i}</button>)}
            </div>
          )}
          {up?.feedback?.[up.version] && (
            <div className="sys-line">💡 {up.title} {up.version} 오락실 평균 {up.feedback[up.version].avg}/10 — 피드백이 회의 컨텍스트에 자동 반영됩니다.</div>
          )}
          <div className="actions meeting-submit">
            <button className="primary" onClick={go} disabled={!agenda.trim()}>
              🚀 {referenceSearch ? '레퍼런스 탐색 후 회의 소집' : '회의 소집'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
