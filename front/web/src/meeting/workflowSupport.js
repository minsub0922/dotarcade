const KEYWORD_STOP = new Set([
  '게임', '이번', '안건', '회의', '개인', '조사', '메모', '관점', '제안', '최근', '과거',
  '관련', '핵심', '방향', '버전', '도트', '하세요', '합니다', '하는', '있는', '반영',
  'https', 'http', 'www', 'com', 'html', 'title', 'content'
])

const TECH_KEYWORD_PATTERNS = [
  ['원버튼 입력', /한\s*버튼|원\s*버튼|one[-\s]?button/gi],
  ['입력 지연', /입력\s*(?:지연|레이턴시)|input\s*(?:lag|latency)/gi],
  ['Fixed Timestep', /고정\s*(?:스텝|타임스텝)|fixed\s*time\s*step/gi],
  ['히트박스', /히트\s*박스|hit\s*box/gi],
  ['충돌 판정', /충돌\s*(?:판정|감지)|collision\s*(?:check|detection)?/gi],
  ['코요테 타임', /코요테\s*타임|coyote\s*time/gi],
  ['히트스톱', /히트\s*스톱|hit\s*stop/gi],
  ['상태 머신', /상태\s*머신|finite\s*state\s*machine|\bfsm\b/gi],
  ['오브젝트 풀링', /오브젝트\s*풀링|object\s*pool(?:ing)?/gi],
  ['경로 탐색', /경로\s*탐색|path\s*find(?:ing)?|\ba\*\b/gi],
  ['절차 생성', /절차적?\s*생성|procedural\s*generation/gi],
  ['결정적 Seed', /결정적|deterministic|고정\s*seed|시드/gi],
  ['텔레메트리', /텔레메트리|telemetry|semantic\s*event/gi],
  ['Canvas', /html5\s*canvas|canvas\s*2d|\bcanvas\b/gi],
  ['WebGL', /\bwebgl\b|\bshader\b|셰이더/gi]
]

export function extractKeywords(text, limit = 7) {
  const source = String(text || '')
  const technical = TECH_KEYWORD_PATTERNS
    .map(([label, pattern], order) => ({ label, order, hits: (source.match(pattern) || []).length }))
    .filter(item => item.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.order - b.order)
    .map(item => item.label)

  const counts = new Map()
  const words = source.match(/[A-Za-z][A-Za-z0-9+-]{1,20}|[가-힣]{2,12}/g) || []
  for (const raw of words) {
    const word = raw.toLowerCase()
    if (KEYWORD_STOP.has(word) || /^\d+$/.test(word)) continue
    counts.set(word, (counts.get(word) || 0) + 1)
  }
  const fallback = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .map(([word]) => word)
    .filter(word => !technical.some(label => label.toLowerCase().includes(word)))
  return [...technical, ...fallback].slice(0, limit)
}

export function localReferenceFallback(agenda, error) {
  const signal = String(agenda || '')
  const genre = [
    {
      id: 'collection', test: /수집|포획|도감|파티|collection|capture/i,
      mechanics: ['collect', 'select', 'use', 'review'],
      uiFocus: ['command menu hierarchy', 'party card grid', 'status HUD', 'collection grid']
    },
    {
      id: 'runner', test: /러너|달리|점프|장애물|runner|obstacle/i,
      mechanics: ['read', 'move', 'avoid', 'retry'],
      uiFocus: ['hazard telegraph', 'minimal score HUD', 'input acknowledgement', 'result feedback']
    },
    {
      id: 'rhythm', test: /리듬|박자|음악|rhythm|beat/i,
      mechanics: ['read', 'time', 'judge', 'retry'],
      uiFocus: ['timing lane', 'judgment feedback', 'combo HUD', 'result grading']
    },
    {
      id: 'arcade', test: /.*/,
      mechanics: ['read', 'act', 'score', 'retry'],
      uiFocus: ['instruction cue', 'safe HUD hierarchy', 'input acknowledgement', 'result feedback']
    }
  ].find(item => item.test.test(signal))
  const selected = {
    id: `genre-baseline-${genre.id}`,
    title: `${genre.id.toUpperCase()} 구조 안전 베이스라인`,
    confidence: 0.42,
    mechanics: genre.mechanics,
    uiFocus: genre.uiFocus,
    why: '검색 서비스를 사용할 수 없어 특정 게임을 사실처럼 선택하지 않고, 장르 공통 정보 구조와 피드백 계약으로 계속 제작합니다.',
    sourceUrls: []
  }
  return {
    status: 'fallback',
    keywords: [...extractKeywords(agenda, 5), ...genre.mechanics].slice(0, 8),
    queries: [], queryRuns: [], candidates: [selected], selected, uiReferences: [],
    sources: [], evidence: [], reason: selected.why, selectionMode: 'local-genre-baseline', fallback: true,
    fallbackReason: `레퍼런스 API 연결 실패로 장르 공통 계약을 사용했습니다: ${String(error?.message || error).slice(0, 180)}`,
    error: String(error?.message || error).slice(0, 220), generatedAt: new Date().toISOString()
  }
}

export function formatReferenceBrief(reference) {
  if (!reference?.selected) return ''
  const target = reference.selected
  const candidates = (reference.candidates || []).map((item, index) =>
    `${index + 1}. ${item.title} — ${item.why || ''}${item.evidenceCount != null ? ` (검색 근거 ${item.evidenceCount}건)` : ''}`
  ).join('\n')
  const allUiReferences = reference.uiReferences || []
  const modelSafeUiReferences = allUiReferences.filter(item =>
    item.aiInputAllowed !== false && item.usage !== 'human-review-only' && item.policy !== 'manual-review-only'
  )
  const heldForManualReview = allUiReferences.length - modelSafeUiReferences.length
  const ui = modelSafeUiReferences.map(item =>
    `- ${item.title} [${item.verified ? '검색 검증' : '후속 조회'}] ${item.url || ''}\n  참고 화면: ${(item.screens || []).join(', ') || 'HUD, 메뉴, 결과 화면'}${item.apply ? `\n  일반화한 적용 포인트: ${item.apply}` : ''}`
  ).join('\n')
  return `[게임/UI 레퍼런스 리서치]
검색 키워드: ${(reference.keywords || []).join(', ')}
후보 비교:
${candidates || `1. ${target.title}`}
최종 타겟: ${target.title} (확신도 ${Math.round((target.confidence || 0.5) * 100)}%)
선정 이유: ${reference.reason || target.why}
차용할 메카닉: ${(target.mechanics || []).join(', ')}
차용할 UI 구조: ${(target.uiFocus || []).join(', ')}
UI 출처:
${ui || '- 모델 입력이 허용된 UI 출처 없음 — 결정적 장르 baseline 사용'}
${heldForManualReview ? `- 수동 검토 전용 출처 ${heldForManualReview}건은 모델/RAG 입력에서 제외` : ''}

[적용 원칙]
- 고유 캐릭터·명칭·아트·맵은 복제하지 않고 정보 계층, 입력 흐름, 피드백 타이밍만 추상화한다.
- 검색 근거가 없는 세부 사항은 사실처럼 단정하지 않는다.`
}

export function referenceMarkdown(reference) {
  if (!reference?.selected) return '# 게임/UI 레퍼런스 리서치\n\n레퍼런스 없음\n'
  const evidence = (reference.sources || []).slice(0, 20).map(item =>
    `- [${item.title || item.url}](${item.url || '#'}) — ${item.excerpt || ''}`
  ).join('\n')
  const manualOnly = (reference.uiReferences || []).filter(item =>
    item.aiInputAllowed === false || item.usage === 'human-review-only' || item.policy === 'manual-review-only'
  ).map(item => `- [${item.title || item.source || '수동 검토 링크'}](${item.url || '#'}) — 원본 픽셀·본문은 모델/RAG 입력에서 제외`).join('\n')
  return `# 게임/UI 레퍼런스 리서치

${formatReferenceBrief(reference)}

## 검색 쿼리

${(reference.queries || []).map(query => `- \`${query}\``).join('\n') || '- 오프라인 폴백'}

## 검색 근거

${evidence || '- 웹 검색을 사용할 수 없어 UI 데이터베이스 조회 링크만 저장했습니다.'}

## 수동 검토 전용 UI 출처

${manualOnly || '- 없음'}
`
}

export function buildDirections({ agenda, keywords, isUpgrade, upgradeInfo }) {
  const signal = `${agenda} ${upgradeInfo || ''}`
  const subject = keywords.slice(0, 2).join(' · ') || '핵심 루프'
  let recommendedId = 'stable'
  if (/실험|독창|참신|새로|반전|혁신|변주/.test(signal)) recommendedId = 'experiment'
  else if (/손맛|조작|타격|리듬|콤보|파티클|이펙트|몰입/.test(signal)) recommendedId = 'feel'
  const options = [
    {
      id: 'stable', icon: '🛡️', title: '안정 완성', tag: '낮은 리스크',
      summary: `${subject}의 핵심만 남겨 첫 판부터 명확하게 만듭니다.`,
      focus: '단순한 조작, 공정한 충돌, 읽히기 쉬운 점수 규칙',
      directive: '기능 수를 줄이고 버그·애매한 판정·급격한 난이도 스파이크를 우선 제거한다.',
      risk: '차별성과 화려함이 약해질 수 있음',
      mission: { metric: 'errors', operator: 'lte', target: 0, label: '오락실 20명 플레이 오류 0건', description: '전체 플레이 텔레메트리의 런타임 오류 합계를 0으로 유지', reward: { xp: 120, coins: 35 } }
    },
    {
      id: 'feel', icon: '⚡', title: '손맛 집중', tag: '중간 리스크',
      summary: `${subject}에 즉각적인 피드백과 콤보 리듬을 더합니다.`,
      focus: '입력 반응, 피격·획득 연출, 콤보와 난이도 템포',
      directive: '조작 즉시 보이는 반응과 득실의 리듬을 최우선으로 하고 juice를 핵심 루프와 연결한다.',
      risk: '연출 구현이 늘어나 QA 시간이 빡빡해질 수 있음',
      mission: { metric: 'controls', operator: 'gte', target: 7, label: '오락실 조작감 7.0 이상', description: '손님 평가 6축 중 조작감 평균 7.0 달성', reward: { xp: 135, coins: 40 } }
    },
    {
      id: 'experiment', icon: '🧪', title: '실험적 변주', tag: '높은 리스크',
      summary: `${subject}을 예상 밖 규칙 하나로 뒤집어 기억에 남깁니다.`,
      focus: '한 문장으로 설명되는 차별 메카닉, 의미 있는 리스크·보상',
      directive: '기존 회피·획득 문법을 그대로 복제하지 말고 플레이어의 판단을 바꾸는 규칙 하나를 구현한다.',
      risk: '첫 플레이 이해도와 밸런스가 흔들릴 수 있음',
      mission: { metric: 'originality', operator: 'gte', target: 7, label: '오락실 독창성 7.0 이상', description: '손님 평가 6축 중 독창성 평균 7.0 달성', reward: { xp: 150, coins: 45 } }
    }
  ]
  return options.map(option => ({ ...option, recommended: option.id === recommendedId, isUpgrade }))
}

export function bumpVersion(version) {
  const match = String(version || 'v1.0.0').match(/v(\d+)\.(\d+)\.(\d+)/)
  return match ? `v${match[1]}.${+match[2] + 1}.0` : 'v1.1.0'
}

export function pickCheer(id) {
  return {
    pm: '릴리즈 완료! 회고는 오락실 반응 보고 하시죠.',
    dev1: '테스트 통과. 배포 안정성 확인했습니다.',
    dev2: '오예 출시다! 🎉',
    designer: '진열대에 올라간 거 너무 귀여워요.',
    writer: '이름 잘 지은 것 같아요. 반응 기대!'
  }[id] || '수고하셨습니다!'
}
