import React from 'react'
import { useStore } from '../state/store.js'

export default function Help() {
  const closePanel = useStore(s => s.closePanel)
  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && closePanel()}>
      <div className="modal">
        <div className="modal-head"><b>🕹️ DOTCADE에 오신 것을 환영합니다!</b><button className="x" onClick={closePanel}>✕</button></div>
        <div className="detail-body help">
          <p>당신은 도트 게임 스튜디오의 <b>팀장</b>입니다. 상단의 마일스톤을 누르면 목적지까지 자동으로 이동하고 <b>제작 → 플레이테스트 → 개선</b>의 다음 단계가 시작됩니다.</p>
          <div className="help-grid">
            <div><b>🚶 이동과 카메라</b><br />방향키 / WASD / 바닥 클릭 · 우측 하단에서 확대와 위치 복귀</div>
            <div><b>🅴 상호작용</b><br />초록 링이 표시된 팀원·진열대·문·소품 가까이에서 <b>E</b></div>
            <div><b>🆁 탈것 전용 조작</b><br />자전거·킥보드 가까이에서 <b>R</b>로 탑승/하차 · 팀원 대화 <b>E</b>와 동시에 표시되어도 독립 작동</div>
            <div><b>📘 집기 → 들기 → 던지기</b><br />책·가벼운 쓰레기통은 첫 <b>E/탭</b>으로 집기 · 든 채 이동 · 언제든 <b>F</b> 또는 던지기 버튼</div>
            <div><b>▣ POCKET 플레이</b><br />사무실 충전 스테이션 가까이에서 <b>E</b> → 게임팩 선택 → 휴대기 모드로 직접 플레이</div>
            <div><b>👆 모바일 조작</b><br />가까운 탈것·소품·POCKET 스테이션을 직접 탭 · 소품을 든 뒤 화면의 던지기/내려놓기 버튼 사용</div>
            <div><b>📋 회의 시작</b><br />회의실 근처에서 <b>E</b> (또는 왼쪽 ✦ 버튼) → 안건 제시 → BMAD 파이프라인으로 게임 자동 제작</div>
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
