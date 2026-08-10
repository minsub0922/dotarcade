import React from 'react'
import { useStore } from '../state/store.js'

export default function Help() {
  const closePanel = useStore(s => s.closePanel)
  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && closePanel()}>
      <div className="modal">
        <div className="modal-head"><b>🕹️ DOTCADE에 오신 것을 환영합니다!</b><button className="x" onClick={closePanel}>✕</button></div>
        <div className="detail-body help">
          <p>당신은 도트 게임 스튜디오의 <b>팀장</b>입니다. AI 팀원들과 회의로 진짜 게임을 만들고, 오락실에 배포해 20명의 AI 손님에게 평가받으세요.</p>
          <div className="help-grid">
            <div><b>🚶 이동</b><br />방향키 / WASD</div>
            <div><b>🅴 상호작용</b><br />팀원 대화 · 진열대 · 문</div>
            <div><b>📋 회의 시작</b><br />안건 제시 → BMAD 파이프라인으로 게임 자동 제작</div>
            <div><b>🗄️ 게임팩</b><br />플레이 · git 코드 · 버전 · 공유 링크</div>
            <div><b>🕹️ 오락실 배포</b><br />20명 손님이 실제 플레이 → 점수·피드백</div>
            <div><b>⬆️ 업그레이드</b><br />피드백 반영 회의 → 버전 업</div>
          </div>
          <p className="tiny muted">제작 흐름(BMAD): 리서치(웹검색+RAG) → 컨셉 토론 → PRD → 아트/UX → 아키텍처 → 팀장 승인 → 구현 → 자동 QA → 릴리즈(git 태그)</p>
          <div className="actions"><button className="primary" onClick={closePanel}>시작하기</button></div>
        </div>
      </div>
    </div>
  )
}
