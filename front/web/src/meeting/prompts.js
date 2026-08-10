// DOTCADE — 회의/대화/피드백 프롬프트 빌더
import { TEAM, PLAYER } from '../data/personas.js'

export const CONTRACT = `[게임팩 계약 — 반드시 준수]
window.game = {
  meta: {
    title: '게임 제목', desc: '한 줄 설명',
    controls: ['ArrowLeft','ArrowRight','Space'],   // 실제 사용하는 키만 (ArrowLeft/Right/Up/Down/Space 중)
    viewport: { w: 360, h: 480 }                     // 최대 480×480
  },
  start(canvas, api) { /* 여기서 게임 시작. requestAnimationFrame 루프 */ },
  stop() { /* rAF 취소 + 이벤트 리스너 해제 */ }
}
규칙:
- api.reportScore(점수): 점수가 바뀔 때마다 호출. api.gameOver(최종점수): 게임 종료 시 정확히 1회 호출.
- 난수는 Math.random 대신 api.rng() 사용 (재현 가능한 테스트를 위해).
- 입력: window.addEventListener('keydown'/'keyup')으로 meta.controls의 키만 사용. stop()에서 반드시 해제.
- 외부 리소스/네트워크/fetch/import/localStorage/오디오 파일 금지. 그래픽은 canvas 2D fillRect 중심의 픽셀아트.
- 단일 파일, 즉시 실행 가능한 완결 코드. 주석은 한국어로 간단히.
- 게임오버 시 캔버스에 GAME OVER와 최종 점수를 표시.
- 반드시 시작 직후부터 화면에 무언가 그려져야 함(검은 화면 금지).`

export function studioContext(games, extra = '') {
  const list = games.slice(0, 8).map(g => `- ${g.emoji} ${g.title} ${g.version} (${g.genre})`).join('\n')
  return `[스튜디오 현황]
당신은 도트 게임 스튜디오 "DOTCADE"의 팀원입니다. 팀장은 ${PLAYER.name}님.
팀원: ${TEAM.map(t => `${t.name}(${t.role})`).join(', ')}
보유 게임팩:\n${list || '- (아직 없음)'}
${extra}`
}

export function personaSystem(member, games, extra = '') {
  return `${member.persona}

BMAD 역할: ${member.bmad}

${studioContext(games, extra)}

[대화 규칙]
- 항상 한국어. 자신의 페르소나 말투 유지. 자신을 "${member.name}"으로 인식.
- 회의에서는 간결하게(2~5문장). 문서 작성 요청 시에만 마크다운 문서 작성.
- 다른 팀원 의견에 동의/반박을 분명히. 근거 제시.`
}

export const PHASES = [
  { key: 'kickoff', label: '킥오프', bmad: '안건 공유' },
  { key: 'research', label: '리서치', bmad: 'Analyst — 개별 조사(웹검색·RAG)' },
  { key: 'concept', label: '컨셉 토론', bmad: '브레인스토밍 · 멀티에이전트 디베이트' },
  { key: 'prd', label: 'PRD 작성', bmad: 'PM — create-prd' },
  { key: 'design', label: '아트/UX 스펙', bmad: 'UX — ux-spec' },
  { key: 'arch', label: '아키텍처', bmad: 'Architect — create-architecture' },
  { key: 'review', label: '리뷰 & 승인', bmad: 'PO — implementation readiness' },
  { key: 'impl', label: '구현', bmad: 'Dev — dev-story' },
  { key: 'qa', label: 'QA', bmad: 'TEA — 자동 스모크 테스트' },
  { key: 'release', label: '릴리즈', bmad: 'retrospective + release' }
]

export const P = {
  research: (agenda, ragNotes, isUpgrade, currentInfo, webNotes) =>
    `팀장이 새 회의 안건을 냈습니다: "${agenda}"
${isUpgrade ? `이번 회의는 기존 게임의 업그레이드입니다.\n${currentInfo}` : '이번 회의는 신규 도트 미니게임 제작입니다.'}
${ragNotes ? `\n[과거 기록 검색 결과(RAG)]\n${ragNotes}` : ''}
${webNotes ? `\n[웹 검색 결과(Tavily)]\n${webNotes}` : ''}
당신의 페르소나 관점에서 이 안건에 대한 조사 메모를 작성하세요 (불릿 4~6개, 200자 내외).
트렌드, 유사 사례, 과거 피드백 교훈, 그리고 당신이 밀고 싶은 방향 1가지를 포함하세요.`,

  debate: (agenda, round, notes) =>
    `안건: "${agenda}" — 컨셉 토론 ${round}라운드입니다.
${notes ? `[당신의 개인 조사 메모]\n${notes}\n` : ''}
지금까지의 회의 내용을 읽고 당신 차례의 발언을 하세요.
- 2~4문장, 페르소나 말투. 앞선 의견에 구체적으로 동의/반박하고 자기 제안을 덧붙일 것.
- ${round === 1 ? '핵심 메카닉/컨셉을 제안하세요.' : '스코프를 좁히고 최종 방향에 수렴하세요. 이번 버전에서 뺄 것도 말하세요.'}`,

  prd: agenda =>
    `안건 "${agenda}"의 회의 내용을 종합해 PRD를 작성하세요. 마크다운 형식:
# PRD — (게임 제목)
## 게임 정보 (첫 줄에 "제목: ..." / "장르: ..." / "이모지: (게임을 나타내는 이모지 1개)" / "한줄설명: ...")
## 핵심 루프 (번호 목록 3~5개)
## 조작 (사용할 키를 정확히: ArrowLeft/ArrowRight/ArrowUp/ArrowDown/Space 중에서)
## 점수와 난이도 (점수 규칙, 시간에 따른 난이도 상승 방식)
## 실패 조건
## 성공 기준 (플레이테스트 관점 3개)
문서만 출력하세요.`,

  design: () =>
    `방금 확정된 PRD를 바탕으로 아트/UX 스펙을 작성하세요. 마크다운 형식:
# 아트/UX 스펙
## 팔레트 (배경/주인공/아이템/위험/UI — hex 코드 5~6개, 도트 감성)
## 화면 구성 (viewport 크기 제안 포함, 세로 360×480 또는 가로 480×320 권장)
## 주요 오브젝트 도트 묘사 (각 오브젝트를 fillRect 몇 개로 그릴지 간단히)
## 피드백 연출 (획득/피격/게임오버 시 화면 연출)
문서만 출력하세요.`,

  arch: () =>
    `PRD와 디자인 스펙을 바탕으로 기술 설계를 작성하세요. 마크다운 형식:
# 기술 설계
## 상태 모델 (주요 변수/배열)
## 게임 루프 (업데이트 순서)
## 충돌 판정 (방식과 히트박스 크기, 관용치)
## 난이도 곡선 (수식 수준으로 구체적으로)
## 게임팩 계약 체크리스트 (reportScore 호출 시점, gameOver 보장, rng 사용, 리스너 해제)
문서만 출력하세요.`,

  review: () =>
    `PRD·디자인·아키텍처가 공유되었습니다. 당신의 페르소나 관점에서 구현 전 마지막 리뷰 의견을 1~3문장으로 말하세요. 치명적 문제가 없으면 "승인"을 포함하세요.`,

  impl: (agenda, prd, design, arch, upgradeCtx) =>
    `당신은 구현 담당 개발자입니다. 아래 문서에 따라 완전히 동작하는 게임을 구현하세요.

[안건] ${agenda}

[PRD]
${prd}

[아트/UX 스펙]
${design}

[기술 설계]
${arch}
${upgradeCtx || ''}
${CONTRACT}

출력: 설명 없이 \`\`\`js 코드블록 하나만. 코드는 250~500줄 수준의 완결된 게임.`,

  repair: (code, diagnostics) =>
    `방금 구현한 게임이 자동 QA에서 실패했습니다.

[QA 진단]
${JSON.stringify(diagnostics, null, 2)}

[현재 코드]
\`\`\`js
${code}
\`\`\`

${CONTRACT}

원인을 파악해 수정한 **전체 코드**를 \`\`\`js 코드블록 하나로만 출력하세요. 진단 항목: fatal=치명적 오류, errors=런타임 오류, lit<15=화면에 그려지는 게 없음, scoreChanged=false && overFired=false=점수도 안 오르고 게임오버도 없음(봇 입력에도 반응 없음).`,

  changelog: (title, version, isUpgrade) =>
    `게임 "${title}" ${version} 릴리즈 노트를 작성하세요. ${isUpgrade ? '이번 업그레이드에서 바뀐 점 중심으로' : '최초 릴리즈입니다'}. 불릿 3~5개, 간결한 한국어. 불릿만 출력.`,

  ack: comment =>
    `팀장이 리뷰 의견을 남겼습니다: "${comment}"\n이 의견을 반영하겠다고 짧게(1~2문장) 답하고, 구현 시 반영할 핵심을 요약하세요.`
}

// ---------------- 오락실 피드백 ----------------
export const FEEDBACK_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 1, maximum: 10 },
    oneLiner: { type: 'string' },
    detail: {
      type: 'object',
      properties: {
        fun: { type: 'string' }, difficulty: { type: 'string' },
        controls: { type: 'string' }, graphics: { type: 'string' }
      },
      required: ['fun', 'difficulty', 'controls', 'graphics']
    },
    bugs: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } }
  },
  required: ['score', 'oneLiner', 'detail', 'bugs', 'suggestions']
}

export function visitorSystem(v) {
  return `당신은 오락실 "DOTCADE"에 방문한 손님입니다.
${v.persona}
이름: ${v.name}, 나이: ${v.age}세, 직업/신분: ${v.job}
당신의 시점에서, 페르소나의 말투와 기준을 유지하며 게임을 평가합니다. 점수는 페르소나 기준으로 엄격하게 (평범한 게임은 5~6점, 매우 좋아야 8+).`
}

export function visitorFeedbackPrompt(game, prdSummary, codeExcerpt, telemetry) {
  return `방금 오락실에서 신작 게임을 플레이했습니다.

[게임 정보]
제목: ${game.title} (${game.version}) / 장르: ${game.genre}
설명: ${game.desc}
조작: ${(game.controls || []).join(', ')}

[기획 요약]
${prdSummary || '(없음)'}

[게임 코드 발췌 — 구조 참고용]
\`\`\`js
${codeExcerpt}
\`\`\`

[당신의 실제 플레이 기록(자동 측정)]
${JSON.stringify(telemetry)}
- score: 최종 점수, ms: 플레이 시간, presses: 입력 횟수, errors: 게임 오류 횟수, overFired: 게임오버 도달 여부

플레이 경험과 코드에서 파악한 게임성을 바탕으로, 당신 페르소나의 시선으로 평가 JSON을 작성하세요.
- oneLiner: 페르소나 말투가 살아있는 한줄평 (40자 이내)
- detail.fun/difficulty/controls/graphics: 각 1~2문장, 구체적으로
- bugs: 플레이 기록의 errors>0이거나 코드에서 의심되는 문제가 있으면 기술, 없으면 []
- suggestions: 다음 버전 제안 1~2개`
}

export function chatSystem(member, games, recentEvents) {
  return personaSystem(member, games, recentEvents ? `[최근 스튜디오 소식]\n${recentEvents}` : '') + `

지금은 사무실에서 팀장 ${PLAYER.name}님과 1:1 잡담/업무 대화 중입니다. 2~4문장으로 자연스럽게 대화하세요. 필요하면 회의 안건을 제안해도 좋습니다.`
}
