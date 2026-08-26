// DOTCADE — 회의/대화/피드백 프롬프트 빌더
import { TEAM } from '../data/personas.js'
import { CRITERIA } from '../data/criteria.js'
import { referenceContractPrompt } from './referenceContract.js'

export const VISUAL_CONTRACT = `[2.5D 비주얼 계약 — 기능을 늘리지 않고 화면 완성도를 확보]
- viewport는 장르에 맞춰 가로 480×320(3:2), 세로 360×480(3:4), 정방형 400×400(1:1) 중 하나만 고른다. 수집·파티 UI처럼 정보량이 많으면 480×320을 우선하고 meta.visual.aspect에 실제 비율을 정확히 쓴다.
- meta.visual을 반드시 선언한다:
  visual: {
    aspect: '3:2',
    depthLayers: ['far','mid','near'],
    perspective: true,
    screens: ['title','gameplay','result','collection']
  }
- drawFarLayer / drawMidLayer / drawNearLayer 분리를 권장하고 항상 이 순서로 그린다. 작은 게임이 단일 drawWorld를 쓰면 함수 내부를 far/mid/near 블록으로 명확히 나누고 동일 순서를 지킨다.
  · far: 하늘·벽·먼 실루엣·저속 패럴랙스. 낮은 대비와 작은 디테일.
  · mid: 실제 플레이 공간·지형·상호작용 오브젝트. horizon 아래에서 y가 커질수록 0.65→1.15로 커지는 depthScale을 사용하고 y순 정렬한다.
  · near: 큰 전경 프레임·가까운 파티클·가장자리 비네트. 플레이 영역을 가리지 않게 제한한다.
- 캐릭터/중요 오브젝트 아래에는 반투명 타원형 접지 그림자를 그리고, 배경에는 선형/방사형 그라디언트나 반투명 조명 오버레이를 최소 1개 사용한다.
- title/gameplay/result와 최소 1개의 장르 적합 보조 화면 renderer를 실제로 구현한다(drawBattle·drawGameOver 같은 장르명도 허용). 보조 화면은 party/loadout/collection/codex/help/map 중 하나를 고르거나 drawOverlayScreen으로 일반화하며, title 메뉴에서 방향키+Space로 진입하고 result에서 다시 시작할 수 있어야 한다.
- 구조화된 designContract가 있으면 qa.requiredScreens만 출시 필수로 구현하고 recommended 화면은 예산이 남을 때만 추가한다. 계약이 없는 수집형 fallback은 party 1개를 기본 보조 화면으로 두고 codex는 선택한다. 그 외 장르는 기존 상태를 읽는 loadout/collection/help 중 하나만 둔다.
- HUD와 메뉴는 배경 사각형 하나에 텍스트만 얹지 않는다. panel(fill+stroke+작은 그림자), 선택 강조, 아이콘/미니 게이지, 제목-값-도움말의 3단 위계를 쓴다.
- 모든 핵심 텍스트와 게이지는 **실제 글자 바운드**가 가장자리 12px safe area 안에 들게 한다. 제목·설명처럼 길이가 가변인 문자열은 raw fillText로 그리지 말고 measureText 기반 helper로 최대 2줄 wrap → max부터 min 폰트까지 축소 → grapheme-safe ellipsis 순서로 맞춘다. fillText maxWidth로 원래 폭의 68% 미만까지 억지 압축하지 않는다. 상단 HUD는 높이 38px 이내, 플레이 중 UI는 화면의 30% 이하로 제한한다.
- meta.visual.screens 선언만으로 화면 구현을 증명할 수 없다. 실제 상태 전환 뒤 해당 화면을 한 프레임 그린 시점에 \`api.emit('screen', { id: screenId })\`을 화면별 1회 보낸다. title의 기본 선택은 Start, 그 아래에는 meta.visual.screens의 보조 화면을 선언 순서대로 둔다. QA는 ArrowDown×순번 → Space로 각 보조 화면에 진입하고 Escape로 title(선택 0) 복귀한 뒤 Space로 gameplay를 시작한다. result는 그린 뒤 screen 이벤트를 보내고 api.gameOver를 호출한다.
- title/gameplay/각 보조 화면은 같은 배경에 텍스트만 바꾸지 말고, 패널 배치·정보 밀도·플레이필드 중 최소 하나가 저해상도 프레임에서도 분명히 달라야 한다.
- Canvas 2D 도형만 사용한다. 가짜 3D 엔진, 외부 에셋, 복잡한 타일맵은 만들지 말고 작은 draw helper와 동일 팔레트로 구현한다.`

export const CONTRACT = `[게임팩 계약 — 반드시 준수]
window.game = {
  meta: {
    title: '게임 제목', desc: '한 줄 설명',
    controls: ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','Escape'], // 실제 사용하는 키만
    viewport: { w: 480, h: 320 },                    // 허용: 480×320, 360×480, 400×400
    visual: {
      aspect: '3:2',                                 // viewport와 정확히 일치
      depthLayers: ['far','mid','near'],
      perspective: true,
      screens: ['title','gameplay','result','collection'] // 보조 화면 1개 이상
    }
  },
  start(canvas, api) { /* 여기서 게임 시작. requestAnimationFrame 루프 */ },
  stop() { /* rAF 취소 + 이벤트 리스너 해제 */ }
}
규칙:
- api.reportScore(점수): 점수가 바뀔 때마다 호출. api.gameOver(최종점수): 게임 종료 시 정확히 1회 호출.
- 난수는 Math.random 대신 api.rng() 사용 (재현 가능한 테스트를 위해).
- api.rng()는 스폰·게임 규칙처럼 상태를 결정할 때만 호출한다. 배경 애니메이션/반짝임/렌더 파티클은 매 프레임 rng를 소비하지 말고 시간 기반 sin/cos 또는 생성 시 저장한 고정 난수를 사용한다(FPS와 무관한 재현성).
- api.emit(type, payload)로 주요 이벤트와 실제 화면 도달을 보낼 것. 게임 이벤트 type은 collect|hit|damage|combo|level|checkpoint|miss|death|restart 중 선택하고 payload에 reward/value/label 정도의 작은 값만 담는다. 화면 전환 type은 screen, payload는 { id: meta.visual.screens에 선언한 ID }만 사용한다.
- 가능하면 게임 루프에서 api.observe({ suggestedActions, avoidActions, danger, progress, state })로 봇이 판단할 최소 상태를 제공한다. 배열은 실제 조작키, danger/progress는 0~1 값을 쓴다.
- emit/observe는 선택 API이므로 없어도 게임은 동작해야 하며 개인정보·대형 객체를 넘기지 말 것.
- 입력: window.addEventListener('keydown'/'keyup')으로 meta.controls의 키만 사용. stop()에서 반드시 해제.
- 외부 리소스/네트워크/fetch/import/localStorage/오디오 파일 금지. 그래픽은 Canvas 2D 도형(fillRect/path/ellipse/gradient)으로 만든 독자적 픽셀아트.
- 단일 파일, 즉시 실행 가능한 완결 코드. 주석은 한국어로 간단히.
- 게임오버 시 캔버스에 GAME OVER와 최종 점수를 표시.
- 반드시 시작 직후부터 타이틀 화면을 그릴 것(검은 화면 금지).

${VISUAL_CONTRACT}`

export function directionBrief(direction) {
  if (!direction) return ''
  return `[팀장이 선택한 제작 방향]
- 방향: ${direction.icon || ''} ${direction.title}
- 제작 원칙: ${direction.directive}
- 집중 포인트: ${direction.focus}
- 감수할 리스크: ${direction.risk}
이 선택은 참고사항이 아니라 이번 버전의 핵심 의사결정입니다. 토론·문서·구현에 구체적으로 반영하세요.`
}

function referenceBrief(referenceContext, designContract = null, contractMode = 'full') {
  const legacy = referenceContext ? `\n${referenceContext}\n
[레퍼런스 번역 규칙]
- 레퍼런스의 고유 캐릭터·이름·로고·맵·팔레트·픽셀/이미지를 복제하거나 코드/AI 입력으로 가져오지 않는다.
- 수동 검토에서 정리된 정보 계층, 입력 흐름, 화면 전환, 피드백 타이밍만 이번 게임의 독자적 테마로 재설계한다.\n` : ''
  return `${legacy}${referenceContractPrompt(designContract, { summary: contractMode === 'summary' })}`
}

function currentCodeTitle(code) {
  const match = String(code || '').match(/\bmeta\s*:\s*\{[\s\S]{0,1200}?\btitle\s*:\s*(['"`])([^'"`\r\n]{1,120})\1/)
  return match?.[2]?.trim() || ''
}

export function studioContext(games, extra = '') {
  const list = games.slice(0, 8).map(g => `- ${g.emoji} ${g.title} ${g.version} (${g.genre})`).join('\n')
  return `[스튜디오 현황]
당신은 도트 게임 스튜디오 "DOTCADE"의 팀원입니다. 당신의 상사는 팀장님(사용자)입니다. 호칭은 항상 "팀장님".
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
  research: (agenda, ragNotes, isUpgrade, currentInfo, webNotes, referenceContext = '', designContract = null) =>
    `팀장이 새 회의 안건을 냈습니다: "${agenda}"
${isUpgrade ? `이번 회의는 기존 게임의 업그레이드입니다.\n${currentInfo}` : '이번 회의는 신규 도트 미니게임 제작입니다.'}
${ragNotes ? `\n[과거 기록 검색 결과(RAG)]\n${ragNotes}` : ''}
${webNotes ? `\n[웹 검색 결과(Tavily)]\n${webNotes}` : ''}
${referenceBrief(referenceContext, designContract, 'summary')}
당신의 페르소나 관점에서 이 안건에 대한 조사 메모를 작성하세요 (불릿 4~6개, 200자 내외).
트렌드, 유사 사례, 과거 피드백 교훈, 그리고 당신이 밀고 싶은 방향 1가지를 포함하세요.`,

  debate: (agenda, round, notes, direction, referenceContext = '', designContract = null) =>
    `안건: "${agenda}" — 컨셉 토론 ${round}라운드입니다.
${notes ? `[당신의 개인 조사 메모]\n${notes}\n` : ''}
${directionBrief(direction)}
${referenceBrief(referenceContext, designContract, 'summary')}
지금까지의 회의 내용을 읽고 당신 차례의 발언을 하세요.
- 2~4문장, 페르소나 말투. 앞선 의견에 구체적으로 동의/반박하고 자기 제안을 덧붙일 것.
- ${round === 1 ? '핵심 메카닉/컨셉을 제안하세요.' : '스코프를 좁히고 최종 방향에 수렴하세요. 이번 버전에서 뺄 것도 말하세요.'}`,

  prd: (agenda, direction, referenceContext = '', designContract = null) =>
    `안건 "${agenda}"의 회의 내용을 종합해 PRD를 작성하세요.
${directionBrief(direction)}
${referenceBrief(referenceContext, designContract)}
마크다운 형식:
# PRD — (게임 제목)
## 게임 정보 (첫 줄에 "제목: ..." / "장르: ..." / "이모지: (게임을 나타내는 이모지 1개)" / "한줄설명: ...")
## 핵심 루프 (번호 목록 3~5개)
## 조작 (사용할 키를 정확히: ArrowLeft/ArrowRight/ArrowUp/ArrowDown/Space 중에서)
## 화면 흐름 (title → gameplay → result와 ${designContract ? 'qa.requiredScreens의 필수 화면. recommended 화면은 선택' : '장르에 맞는 보조 화면 1개. 수집형 fallback은 party'})
## 점수와 난이도 (점수 규칙, 시간에 따른 난이도 상승 방식)
## 실패 조건
## 성공 기준 (플레이테스트 관점 3개)
${designContract ? '## 레퍼런스 요구사항 추적 (designContract의 screen/pattern ID별 PRD 요구사항·성공 기준 표)' : ''}
문서만 출력하세요.`,

  design: (direction, referenceContext = '', designContract = null, prd = '') =>
    `아래 확정 PRD 전체를 빠짐없이 소비해 아트/UX 스펙을 작성하세요.
${directionBrief(direction)}
${referenceBrief(referenceContext, designContract)}
${prd ? `[확정 PRD — 이 문서의 요구사항을 생략하거나 회의 요약으로 대체하지 말 것]\n${prd}\n` : ''}
마크다운 형식:
# 아트/UX 스펙
## 팔레트 (원경/중경/전경/주인공/위험/UI — hex 코드 7~9개, 명도·채도 대비까지 명시)
## 화면 구성 (480×320=3:2 / 360×480=3:4 / 400×400=1:1 중 선택 이유와 실제 비율, 12px safe area, HUD/플레이필드/도움말의 정확한 좌표)
## 2.5D 깊이 설계 (far/mid/near별 오브젝트, 패럴랙스 속도, horizon, y 기반 depthScale 범위, y-sort 규칙을 표로)
## 화면별 UI (title/gameplay/result+${designContract ? 'qa.requiredScreens' : '장르 적합 보조 화면 1개'}의 정보 위계·선택 상태·방향키+Space 전환을 표로)
## 레퍼런스 UX 전환표 (레퍼런스의 일반화된 패턴 → 이번 게임의 독자적 UI 적용, 3~5개. 원본 픽셀/캐릭터 복제 금지)
## 주요 오브젝트 도트 묘사 (실루엣, y에 따른 크기, 접지 그림자 포함)
## 조명과 깊이 단서 (그라디언트 광원, 먼 레이어의 저대비, 가까운 레이어의 고대비·큰 디테일)
## 피드백 연출 (획득/피격/선택/화면 전환/게임오버의 플래시·셰이크·파티클)
${designContract ? '## 레퍼런스 구현 추적 (각 pattern ID → 적용 화면 ID → 좌표/정보 위계/선택·피드백 상태 → 검증 기준 표)' : ''}
${VISUAL_CONTRACT}
문서만 출력하세요.`,

  arch: (direction, referenceContext = '', designContract = null, prd = '', design = '') =>
    `아래 확정 PRD와 디자인 스펙 전체를 빠짐없이 소비해 기술 설계를 작성하세요.
${directionBrief(direction)}
${referenceBrief(referenceContext, designContract)}
${prd ? `[확정 PRD]\n${prd}\n` : ''}
${design ? `[확정 아트/UX 스펙]\n${design}\n` : ''}
마크다운 형식:
# 기술 설계
## 상태 모델 (주요 변수/배열)
## 게임 루프 (업데이트 순서)
## 렌더 파이프라인 (drawFarLayer → drawMidLayer → y-sort 오브젝트+그림자 → drawNearLayer → HUD/화면 UI)
## 화면 상태 머신 (title/gameplay/result+${designContract ? 'qa.requiredScreens' : '장르 적합 보조 화면 1개'} 전환과 입력 소유권)
## 충돌 판정 (방식과 히트박스 크기, 관용치)
## 난이도 곡선 (수식 수준으로 구체적으로)
## 성능 상한 (오브젝트/파티클 개수 상한, 그라디언트 캐시, 프레임당 배열 할당 최소화)
## 게임팩 계약 체크리스트 (reportScore 호출 시점, gameOver 보장, rng 사용, 리스너 해제)
${designContract ? '## 레퍼런스 구현 추적 (각 pattern ID → 상태/renderer/helper → 키 입력 도달 경로 → QA 검증 방법 표)' : ''}
${VISUAL_CONTRACT}
문서만 출력하세요.`,

  review: (designContract = null) =>
    `PRD·디자인·아키텍처가 공유되었습니다. 구현 전 마지막 리뷰 의견을 1~3문장으로 말하세요.
선택한 viewport의 실제 비율, far/mid/near, y 원근 스케일·접지 그림자·조명, title/gameplay/result+장르 적합 보조 화면이 모두 구체화되었는지 확인하세요.${designContract ? ' 레퍼런스 계약은 qa.requiredScreens와 필수 pattern ID만 PRD→디자인→아키텍처 추적표에서 이어지는지 확인하고 recommended 화면을 강제하지 마세요.' : ' 계약 없는 수집형이면 party 보조 화면을 확인하세요.'} 하나라도 빠졌으면 승인하지 말고, 문제가 없을 때만 "승인"을 포함하세요.`,

  impl: (agenda, prd, design, arch, upgradeCtx, direction, referenceContext = '', designContract = null) =>
    `당신은 구현 담당 개발자입니다. 아래 문서에 따라 완전히 동작하는 게임을 구현하세요.

[안건] ${agenda}

${directionBrief(direction)}
${referenceBrief(referenceContext, designContract)}

[PRD]
${prd}

[아트/UX 스펙]
${design}

[기술 설계]
${arch}
${upgradeCtx || ''}
${CONTRACT}

구현 순서: 먼저 화면 상태·공통 패널·fitText/wrapText helper를 만들고, 3개 depth layer와 title/gameplay/result+장르 적합 보조 화면 renderer를 채운 뒤 게임 로직을 연결하세요. ${designContract ? 'designContract의 qa.requiredScreens만 출시 필수로 구현하고 recommended 화면은 코드 예산이 남을 때만 추가하세요.' : '계약 없는 수집형은 party 1개를 기본 보조 화면으로 구현하세요.'} 같은 도형·색·텍스트 스타일은 helper로 재사용해 복잡도를 억제하세요. title의 표준 메뉴 이동과 실제 전환 시 screen 이벤트를 구현해 자동 QA가 각 화면의 도달·시각 구분·텍스트 safe area를 런타임에서 확인할 수 있게 하세요.${designContract ? ' 마지막으로 meta.reference/meta.designContract 선언의 contractId·implementedPatterns·screens·implementedStates·depthSignals·feedbackSignals가 실제 renderer/state/feedback 코드와 정확히 일치하는지 대조하세요.' : ''}
출력: 설명 없이 \`\`\`js 코드블록 하나만. 코드는 450~800줄 수준의 완결된 게임.`,

  repair: (code, diagnostics, designContract = null, agenda = '') => {
    const currentTitle = currentCodeTitle(code)
    return `[수리 대상 게임 정체성 — 기능 수리와 무관하게 유지]
[안건] ${agenda || '(원안 안건 미제공 — 현재 코드의 세계관과 핵심 루프를 기준으로 유지)'}
현재 제목: ${currentTitle || '(meta.title을 현재 코드에서 확인)'}
- QA 진단이 제목 자체를 문제로 지목하지 않는 한 window.game.meta.title은 위 현재 제목과 한 글자도 다르게 바꾸지 마세요.
- 원안의 주인공·세계관·핵심 루프·아이템·위험 요소를 일반 캐처 템플릿으로 교체하지 마세요. 진단된 부분만 최소 수정하세요.

방금 구현한 게임이 자동 QA에서 실패했습니다.

[QA 진단]
${JSON.stringify(diagnostics, null, 2)}

[현재 코드]
\`\`\`js
${code}
\`\`\`

${referenceBrief('', designContract)}
${CONTRACT}

원인을 파악해 수정한 **전체 코드**를 \`\`\`js 코드블록 하나로만 출력하세요. 진단 항목: fatal=치명적 오류, errors=런타임 오류, lit<15=화면에 그려지는 게 없음, scoreChanged=false && overFired=false=점수도 안 오르고 게임오버도 없음(봇 입력에도 반응 없음), visual.missing=2.5D 레이어·원근·조명·핵심/보조 화면 계약 누락, visual.issues의 VIS_TEXT_CLIPPED/VIS_TEXT_SAFE_AREA/VIS_TEXT_SQUASHED=실제 Canvas 텍스트 fit·12px 여백·과압축 실패, VIS_SCREEN_UNREACHABLE=표준 QA 입력으로 화면 미도달 또는 screen 이벤트 누락, VIS_SCREEN_NOT_DISTINCT=화면 프레임이 title과 사실상 동일, REF_*=레퍼런스 계약 추적/구현 누락. visual/reference 누락은 기능을 늘리지 말고 공통 draw/helper와 기존 상태를 재사용해 모두 보완하고, meta 선언은 실제 보완한 ID만 기록하세요.`
  },

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
    ratings: {
      type: 'object',
      properties: Object.fromEntries(CRITERIA.map(c => [c.key, { type: 'integer', minimum: 1, maximum: 10 }])),
      required: CRITERIA.map(c => c.key)
    },
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
  required: ['score', 'oneLiner', 'ratings', 'detail', 'bugs', 'suggestions']
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
- ratings: 아래 6개 기준을 각각 1~10 정수로 채점. 페르소나 기준으로 엄격하게, 잘한 축과 못한 축의 점수 차이가 분명하게 (전 축 동일 점수 금지):
${CRITERIA.map(c => `  · ${c.key} = ${c.label} (${c.desc})`).join('\n')}
- detail.fun/difficulty/controls/graphics: 각 1~2문장, 구체적으로 (ratings 점수와 논리적으로 일치할 것)
- graphics는 원경/중경/전경 구분, y 원근·스케일, 조명·접지 그림자, HUD 정보 위계, title/gameplay/result+보조 화면 완성도를 각각 확인하세요. 단색 배경+평면 사각형 UI라면 4점 이하로 평가하세요.
- bugs: 플레이 기록의 errors>0이거나 코드에서 의심되는 문제가 있으면 기술, 없으면 []
- suggestions: 다음 버전 제안 1~2개 (가장 낮게 준 기준을 개선하는 방향 포함)`
}

export function chatSystem(member, games, recentEvents) {
  return personaSystem(member, games, recentEvents ? `[최근 스튜디오 소식]\n${recentEvents}` : '') + `

지금은 사무실에서 팀장님과 1:1 잡담/업무 대화 중입니다. 상대는 "팀장님"이라고 부르세요. 2~4문장으로 자연스럽게 대화하세요. 필요하면 회의 안건을 제안해도 좋습니다.`
}
