// DOTCADE — game-reference discovery pipeline
// agenda -> search keywords -> parallel web evidence -> target game -> executable design blueprint

const CACHE_TTL_MS = 15 * 60 * 1000
const cache = new Map()
const inflight = new Map()

const BLUEPRINT_SCHEMA_VERSION = 'reference-blueprint/v1'
const PIPELINE_CACHE_VERSION = 'reference-research/v2'
const MANUAL_ONLY_HOSTS = new Set(['gameuidatabase.com'])

const STOP_WORDS = new Set([
  '게임', '제작', '만들기', '만들어', '기획', '기반', '처럼', '같은', '하고', '하는',
  '있는', '없는', '추가', '개선', '신규', '이번', '현재', '진행', '해줘', '해주세요',
  'the', 'and', 'game', 'with', 'from', 'into', 'make', 'create'
])

const REFERENCE_PROFILES = [
  {
    id: 'pokemon-poc-seed',
    test: /포켓몬|pokemon/i,
    keywords: ['Pokémon', 'creature collection', 'turn-based battle', 'party management', 'overworld exploration', 'JRPG UI'],
    candidates: [
      {
        id: 'pokemon-lets-go', title: "Pokémon: Let’s Go, Pikachu! / Eevee!",
        aliases: ["Pokémon Let's Go", 'Pokemon Lets Go', "Let's Go Pikachu", 'Lets Go Pikachu'],
        implementationFit: 0.94,
        mechanics: ['creature collection', 'turn-based battle', 'simple party management', 'overworld exploration'],
        uiFocus: ['large color-coded command menu', '2×3 party card grid', 'corner HP status', 'Pokédex grid', '16:9 source HUD → 3:2 POC safe-area adaptation'],
        why: '큰 버튼과 단순한 파티·전투 HUD로 진입 복잡도가 낮고, 원본 16:9 정보 구조를 480×320(3:2) POC safe area에 재배치하기 쉽습니다.'
      },
      {
        id: 'pokemon-emerald', title: 'Pokémon Emerald',
        aliases: ['Pokemon Emerald', 'Pokémon Ruby Sapphire Emerald', 'Pokemon Ruby Sapphire Emerald'],
        implementationFit: 0.82,
        mechanics: ['creature collection', 'turn-based battle', 'party management', 'overworld exploration'],
        uiFocus: ['overworld encounter', 'battle command menu', 'battle entrance feedback', 'PokéNav menu', 'dialogue box'],
        why: '작은 2D 픽셀 화면으로 변환할 때 필요한 밀도와 전투 진입 연출을 보조 비교하기 좋습니다.'
      },
      {
        id: 'pokemon-sword-shield', title: 'Pokémon Sword / Shield',
        aliases: ['Pokemon Sword Shield', 'Pokémon Sword and Shield', 'Pokemon Sword and Shield'],
        implementationFit: 0.7,
        mechanics: ['creature collection', 'turn-based battle', 'party management'],
        uiFocus: ['battle command wheel', 'party screen', 'status feedback'],
        why: '현대적인 16:9 원본 전투 HUD의 선택 피드백을 3:2 POC에 재배치해 비교하는 보조 레퍼런스로 적합합니다.'
      }
    ]
  },
  {
    id: 'creature-collection',
    test: /(?:몬스터|크리처|생물|캐릭터)(?:들)?(?:을|를)?\s*(?:수집|포획|모으)|creature\s*collection|monster\s*collection/i,
    keywords: ['creature collection', 'team building', 'short turn-based encounters', 'collection progression', 'party management UI'],
    candidates: [
      {
        id: 'monster-sanctuary', title: 'Monster Sanctuary',
        mechanics: ['creature collection', 'team building', 'turn-based encounters'],
        uiFocus: ['party comparison', 'battle status hierarchy', 'collection progress'],
        why: '수집·팀 구성·전투 정보를 2D 화면에 배치하는 구조를 비교하기 좋습니다.'
      },
      {
        id: 'cassette-beasts', title: 'Cassette Beasts',
        mechanics: ['creature collection', 'party choice', 'turn-based battle'],
        uiFocus: ['command hierarchy', 'party status', 'result feedback'],
        why: '현대적인 2D 수집형 RPG의 명령·상태·결과 흐름을 비교하기 좋습니다.'
      },
      {
        id: 'temtem', title: 'Temtem',
        mechanics: ['creature collection', 'party management', 'turn-based battle'],
        uiFocus: ['battle command grouping', 'team status', 'collection navigation'],
        why: '수집형 규칙을 유지하면서 다른 정보 계층과 입력 흐름을 비교할 수 있습니다.'
      }
    ]
  },
  {
    test: /러너|runner|달리|점프|장애물/i,
    keywords: ['endless runner', 'one-button controls', 'obstacle telegraphing', 'score chase', 'difficulty curve'],
    candidates: [
      { id: 'canabalt', title: 'Canabalt', mechanics: ['one-button jump', 'endless runner'], uiFocus: ['score HUD', 'obstacle readability'], why: '원버튼 러너의 최소 UI와 즉시 읽히는 장애물 설계를 비교하기 좋습니다.' },
      { id: 'super-mario-run', title: 'Super Mario Run', mechanics: ['auto-run', 'timed jump'], uiFocus: ['run HUD', 'result screen'], why: '자동 이동과 터치 타이밍을 단계적으로 가르치는 구조가 명확합니다.' },
      { id: 'alto-odyssey', title: "Alto's Odyssey", mechanics: ['endless run', 'trick combo'], uiFocus: ['minimal HUD', 'combo feedback'], why: '낮은 UI 밀도와 강한 시각 피드백의 균형을 참고할 수 있습니다.' }
    ]
  },
  {
    test: /리듬|rhythm|음악|박자|비트/i,
    keywords: ['rhythm game', 'timing window', 'note highway', 'combo feedback', 'latency calibration'],
    candidates: [
      { id: 'rhythm-heaven', title: 'Rhythm Heaven', mechanics: ['timing cues', 'one-button rhythm'], uiFocus: ['timing feedback', 'result grading'], why: '복잡한 HUD 없이 애니메이션과 사운드 큐로 타이밍을 전달합니다.' },
      { id: 'taiko-no-tatsujin', title: 'Taiko no Tatsujin', mechanics: ['note highway', 'combo'], uiFocus: ['note lane', 'combo HUD'], why: '노트 판독성과 콤보 피드백이 매우 명확합니다.' },
      { id: 'a-dance-of-fire-and-ice', title: 'A Dance of Fire and Ice', mechanics: ['one-button timing', 'visual rhythm path'], uiFocus: ['timing path', 'fail feedback'], why: '원버튼 입력과 공간적 박자 표시를 작은 스코프로 구현하기 좋습니다.' }
    ]
  },
  {
    test: /벽돌|브레이크아웃|breakout|arkanoid/i,
    keywords: ['brick breaker', 'paddle physics', 'power-up readability', 'score HUD', 'difficulty curve'],
    candidates: [
      { id: 'arkanoid', title: 'Arkanoid', mechanics: ['brick breaker', 'paddle control'], uiFocus: ['playfield hierarchy', 'score HUD'], why: '클래식 벽돌깨기의 정보 계층과 플레이필드 비율을 직접 참고할 수 있습니다.' },
      { id: 'shatter', title: 'Shatter', mechanics: ['brick breaker', 'push pull'], uiFocus: ['power feedback', 'score presentation'], why: '고전 규칙에 단일 변주를 더하는 방법을 비교하기 좋습니다.' },
      { id: 'holedown', title: 'holedown', mechanics: ['aimed brick breaker', 'limited shots'], uiFocus: ['aim preview', 'remaining hit labels'], why: '모바일용 조준과 숫자 피드백의 단순화가 뛰어납니다.' }
    ]
  }
]

const GENERIC_PROFILE = {
  keywords: ['arcade core loop', 'game feel', 'score feedback', 'difficulty curve', 'pixel game UI'],
  candidates: [
    { id: 'wario-ware', title: 'WarioWare, Inc.', mechanics: ['microgame', 'instant onboarding'], uiFocus: ['instruction cue', 'timer HUD', 'result feedback'], why: '짧은 세션에서 규칙을 즉시 전달하는 UI 문법을 참고하기 좋습니다.' },
    { id: 'downwell', title: 'Downwell', mechanics: ['arcade action', 'combo'], uiFocus: ['minimal HUD', 'combo feedback'], why: '제한된 팔레트와 강한 액션 피드백을 작은 스코프로 구현한 사례입니다.' },
    { id: 'vampire-survivors', title: 'Vampire Survivors', mechanics: ['survival loop', 'upgrade choice'], uiFocus: ['level-up choice', 'combat HUD'], why: '단순 조작에 성장 선택을 더해 반복 플레이를 만드는 구조가 명확합니다.' }
  ]
}

const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
const unique = values => [...new Set(values.filter(Boolean))]
const safeUrl = value => {
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? url.toString() : ''
  } catch { return '' }
}

const sourceHost = value => {
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}

const isManualOnlyHost = host => [...MANUAL_ONLY_HOSTS].some(domain =>
  host === domain || host.endsWith(`.${domain}`)
)

const isManualOnlySource = source => isManualOnlyHost(sourceHost(source?.url))

// Stable FNV-1a is sufficient here: contract ids are cache/trace keys, not security tokens.
function stableContractId(parts) {
  let hash = 0x811c9dc5
  for (const char of parts.join('|')) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return `ref-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

const stableEvidenceId = source => stableContractId([
  safeUrl(source?.url), clean(source?.title).toLowerCase()
]).replace(/^ref-/, 'src-')

function normalizeAgendaTerm(term) {
  const value = String(term || '').toLowerCase()
  if (!/[가-힣]/.test(value)) return value
  return value.replace(/(?:으로|에서|에게|부터|까지|처럼|같은|하고|하며|해서|를|을|이|가|은|는)$/u, '') || value
}

function agendaTerms(agenda) {
  const terms = clean(agenda).match(/[A-Za-z][A-Za-z0-9+-]{1,24}|[가-힣]{2,12}/g) || []
  return unique(terms.map(normalizeAgendaTerm).filter(x => x.length > 1 && !STOP_WORDS.has(x))).slice(0, 5)
}

const VISIBLE_REFERENCE_STOP = new Set([
  'game', '게임', 'arcade', 'rpg', 'runner', '러너', 'rhythm', '리듬', 'reference', '레퍼런스'
])

function forbiddenVisibleTerms(agenda, selected) {
  const agendaMatches = []
  const text = clean(agenda)
  for (const pattern of [
    /([A-Za-z0-9À-ɏ][A-Za-z0-9À-ɏ&+:'’.\-]*(?:\s+[A-Za-z0-9À-ɏ&+:'’.\-]+){0,5})\s*(?:처럼|같은)/gi,
    /([가-힣A-Za-z0-9&+:'’.\-·]{2,48})\s*(?:처럼|같은)/g,
    /(?:like|inspired\s+by)\s+([A-Za-z0-9À-ɏ][A-Za-z0-9À-ɏ&+:'’.\-]*(?:\s+[A-Za-z0-9À-ɏ&+:'’.\-]+){0,5})/gi
  ]) {
    for (const match of text.matchAll(pattern)) agendaMatches.push(clean(match[1]).slice(0, 100))
  }
  const selectedTerms = [selected?.title, ...(selected?.aliases || [])].map(value => clean(value).slice(0, 100))
  const titleRoot = clean(selected?.title).split(/\s*[:/|\u2014\u2013]\s*/)[0]
  const terms = []
  const normalized = new Set()
  for (const term of [...agendaMatches, ...selectedTerms, titleRoot]) {
    const key = foldText(term)
    if (key.length < 3 || VISIBLE_REFERENCE_STOP.has(key) || normalized.has(key)) continue
    normalized.add(key)
    terms.push(term)
  }
  return terms.slice(0, 12)
}

export function deriveReferencePlan({ agenda, currentInfo = '', preferredTarget = '' }) {
  const signal = `${clean(agenda)} ${clean(currentInfo)} ${clean(preferredTarget)}`
  const profile = REFERENCE_PROFILES.find(item => item.test.test(signal)) || GENERIC_PROFILE
  const preferred = clean(preferredTarget)
  const keywords = unique([
    ...(preferred ? [preferred] : []),
    ...agendaTerms(agenda),
    ...profile.keywords
  ]).slice(0, 8)
  // 화면에는 안건 키워드를 함께 보여 주되, 검색 엔진에는 장르·루프·UX 신호를 먼저 준다.
  const profileKeywords = profile.keywords || GENERIC_PROFILE.keywords
  const mechanic = profileKeywords[1] || profileKeywords[0] || 'arcade game'
  const loop = profileKeywords[2] || profileKeywords[1] || 'core loop'
  const uiFocus = [profileKeywords[0], profileKeywords[3], profileKeywords[5] || profileKeywords[4], 'HUD menu UX']
    .filter(Boolean).join(' ')
  const candidateComparison = (profile.candidates || []).slice(0, 3)
    .map(candidate => `"${candidate.aliases?.[0] || candidate.title}"`).join(' ')
  const queries = unique([
    `"${mechanic}" "${loop}" similar games gameplay mechanics`,
    candidateComparison
      ? `${candidateComparison} UI UX party battle menu comparison`
      : `${uiFocus} game UI reference`,
    `${clean(agenda).slice(0, 140)} 유사 게임 후보 비교 UI 인터페이스`.trim()
  ]).slice(0, 3)
  return { keywords, queries, profile, preferredTarget: preferred }
}

const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
  Promise.resolve(promise).then(
    value => { clearTimeout(timer); resolve(value) },
    error => { clearTimeout(timer); reject(error) }
  )
})

function compactSearchResult(result, query, lane) {
  return (result?.results || []).slice(0, 6).map(item => {
    const url = safeUrl(item.url)
    const manualOnly = isManualOnlyHost(sourceHost(url))
    return {
      title: clean(item.title).slice(0, 180),
      url,
      // Game UI DB는 페이지 메타데이터만 보존하고 본문/픽셀을 RAG·모델 입력으로 넘기지 않는다.
      excerpt: manualOnly ? '' : clean(item.content).slice(0, 360),
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
      query,
      lane,
      aiInputAllowed: !manualOnly,
      ...(manualOnly ? {
        policy: 'manual-review-only', usage: 'human-review-only',
        aiUseAllowed: false, downloadAllowed: false
      } : {})
    }
  }).filter(item => item.title || item.url)
}

function foldText(value) {
  return String(value || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')
    .toLowerCase().replace(/[’`]/g, "'")
    .replace(/[^a-z0-9가-힣]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function evidenceForCandidate(candidate, sources) {
  const needles = unique([candidate.title, ...(candidate.aliases || [])]
    .map(foldText).filter(needle => needle.length > 4))
  return sources.filter(source => {
    const haystack = foldText(`${source.title} ${source.excerpt}`)
    return needles.some(needle => haystack.includes(needle))
  })
}

function normalizeLlmSelection(raw, evidenceById) {
  if (!raw) return null
  let parsed
  try {
    const text = String(raw.text || raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    parsed = JSON.parse(text)
  } catch { return null }
  const listed = Array.isArray(parsed.candidates) ? parsed.candidates : []
  const candidates = listed.slice(0, 5).map((candidate, index) => {
    const title = clean(candidate.title).slice(0, 100)
    const evidenceIds = unique((candidate.evidenceIds || []).map(clean))
      .filter(id => evidenceById.has(id)).slice(0, 5)
    const titleNeedle = foldText(title)
    const supported = evidenceIds.some(id => {
      const source = evidenceById.get(id)
      return titleNeedle.length > 3 && foldText(`${source?.title} ${source?.excerpt}`).includes(titleNeedle)
    })
    return {
      id: clean(candidate.id) || `candidate-${index + 1}`,
      title,
      why: clean(candidate.why).slice(0, 360),
      mechanics: unique((candidate.mechanics || []).map(clean)).slice(0, 6),
      uiFocus: unique((candidate.uiFocus || []).map(clean)).slice(0, 6),
      evidenceIds,
      sourceUrls: unique(evidenceIds.map(id => evidenceById.get(id)?.url)).filter(Boolean).slice(0, 5),
      supported,
      originalIndex: index
    }
  }).filter(candidate => candidate.title && candidate.supported)
  // A comparison with fewer than three cited targets is not enough evidence to
  // replace the deterministic profile baseline.
  if (candidates.length < 3) return null
  const requestedIndex = Math.max(0, Math.min(listed.length - 1, Number(parsed.selectedIndex) || 0))
  const selectedIndex = candidates.findIndex(candidate => candidate.originalIndex === requestedIndex)
  // Never silently retarget when validation removed the model's selected item.
  if (selectedIndex < 0) return null
  return {
    candidates: candidates.map(({ supported, originalIndex, ...candidate }) => candidate),
    selectedIndex,
    reason: clean(parsed.reason || candidates[selectedIndex].why).slice(0, 500)
  }
}

async function selectWithEvidence({ agenda, plan, sources, generate }) {
  if (!generate) return null
  const allowedSources = sources.filter(source =>
    !isManualOnlySource(source) && source.aiInputAllowed !== false && source.url
  ).slice(0, 16).map(source => ({ ...source, id: stableEvidenceId(source) }))
  if (!allowedSources.length) return null
  const evidenceById = new Map(allowedSources.map(source => [source.id, source]))
  const evidence = allowedSources.map(source =>
    `[${source.id}] ${source.title}\n${source.excerpt}\n${source.url}`
  ).join('\n\n')
  const schema = {
    type: 'object',
    properties: {
      candidates: {
        type: 'array', minItems: 3, maxItems: 5,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' }, title: { type: 'string' }, why: { type: 'string' },
            mechanics: { type: 'array', items: { type: 'string' } },
            uiFocus: { type: 'array', items: { type: 'string' } },
            evidenceIds: { type: 'array', minItems: 1, items: { type: 'string' } }
          },
          required: ['id', 'title', 'why', 'mechanics', 'uiFocus', 'evidenceIds']
        }
      },
      selectedIndex: { type: 'integer' },
      reason: { type: 'string' }
    },
    required: ['candidates', 'selectedIndex', 'reason']
  }
  const out = await withTimeout(generate({
    system: '당신은 게임 레퍼런스 리서처입니다. 근거에 없는 사실을 만들지 말고, 구현 범위가 작은 2D 웹 게임에 전용 가능한 사례를 우선하세요.',
    messages: [{
      role: 'user',
      text: `기획: ${agenda}\n키워드: ${plan.keywords.join(', ')}\n선호 타겟: ${plan.preferredTarget || '없음'}\n\n검색 근거:\n${evidence}\n\n각 후보의 정확한 게임명을 명시한 근거 ID를 evidenceIds에 1개 이상 넣으세요. 근거에 게임명이 없는 후보는 만들지 마세요. 검증 가능한 후보 3~5개를 비교하고 최종 타겟 하나를 고르세요. 캐릭터나 아트를 복제하지 않고 정보 구조·상호작용·피드백 패턴만 차용할 수 있어야 합니다.`
    }],
    hint: 'reference_select', model: 'fast', json: schema, maxTokens: 1200
  }), 14000, 'reference selection')
  return normalizeLlmSelection(out, evidenceById)
}

function buildCandidates(plan, sources, llmSelection) {
  const chosenByModel = llmSelection
  const base = chosenByModel?.candidates?.length ? chosenByModel.candidates : plan.profile.candidates
  const candidates = base.slice(0, 5).map((candidate, index) => {
    const matches = evidenceForCandidate(candidate, sources)
    const preferred = plan.preferredTarget && candidate.title.toLowerCase().includes(plan.preferredTarget.toLowerCase())
    const fit = Number.isFinite(Number(candidate.implementationFit))
      ? Number(candidate.implementationFit)
      : Math.max(0.45, 0.72 - index * 0.08)
    const sourceUrls = unique([...(candidate.sourceUrls || []), ...matches.map(item => item.url)]).filter(Boolean).slice(0, 5)
    return {
      ...candidate,
      score: Math.min(0.98, 0.18 + fit * 0.3 + Math.min(0.28, sourceUrls.length * 0.08) + (preferred ? 0.12 : 0)),
      evidenceCount: sourceUrls.length,
      sourceUrls
    }
  })
  let selectedIndex = chosenByModel?.selectedIndex ?? candidates.reduce(
    (best, candidate, index, list) => candidate.score > list[best].score ? index : best,
    0
  )
  if (plan.preferredTarget) {
    const preferredIndex = candidates.findIndex(candidate =>
      candidate.title.toLowerCase().includes(plan.preferredTarget.toLowerCase()) ||
      plan.preferredTarget.toLowerCase().includes(candidate.title.toLowerCase())
    )
    if (preferredIndex >= 0) selectedIndex = preferredIndex
  }
  selectedIndex = Math.max(0, Math.min(candidates.length - 1, selectedIndex))
  const selected = {
    ...candidates[selectedIndex],
    confidence: Number(candidates[selectedIndex]?.score || 0.58).toFixed(2) * 1
  }
  const reason = chosenByModel?.reason || selected.why
  const selectionMode = chosenByModel
    ? 'llm-evidence'
    : selected.evidenceCount > 0 ? 'profile-evidence' : 'profile-fallback'
  return { candidates, selected, reason, selectionMode }
}

function uiQueries(selected) {
  return [
    `site:gameuidatabase.com "${selected.title}" UI`,
    `"${selected.title}" game UI HUD menu screenshots`,
    `site:interfaceingame.com "${selected.title}" interface`
  ]
}

const preferredUiDomain = url => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (isManualOnlyHost(host)) return 3
    if (host === 'interfaceingame.com') return 2
    if (host === 'mobygames.com') return 1
  } catch {}
  return 0
}

function buildUiReferences(selected, uiSources) {
  const ranked = [...uiSources]
    .filter(source => source.url)
    .sort((a, b) => preferredUiDomain(b.url) - preferredUiDomain(a.url) || (b.score || 0) - (a.score || 0))
  const references = []
  const seen = new Set()
  for (const source of ranked) {
    if (seen.has(source.url)) continue
    seen.add(source.url)
    const gameUiDb = preferredUiDomain(source.url) === 3
    references.push({
      title: source.title || selected.title,
      url: source.url,
      source: (() => { try { return new URL(source.url).hostname.replace(/^www\./, '') } catch { return 'web' } })(),
      kind: gameUiDb ? 'ui-database-metadata' : preferredUiDomain(source.url) ? 'ui-database' : 'web-reference',
      screens: selected.uiFocus || [],
      excerpt: source.excerpt,
      verified: true,
      captureStatus: gameUiDb ? 'manual-review-only' : 'metadata-only',
      ...(gameUiDb ? {
        policy: 'manual-review-only', usage: 'human-review-only',
        aiUseAllowed: false, aiInputAllowed: false, downloadAllowed: false, thumbnail: null,
        rightsNote: 'Game UI Database 화면은 수동 검토 전용. 픽셀을 핫링크·다운로드·프록시·AI/ML 입력에 사용하지 않고 일반화된 UX 패턴만 기록.'
      } : {})
    })
    if (references.length >= 8) break
  }
  if (!references.some(reference => reference.source === 'gameuidatabase.com')) {
    references.unshift({
      title: `Game UI Database — ${selected.title} 검색`,
      url: 'https://www.gameuidatabase.com/',
      source: 'gameuidatabase.com',
      kind: 'lookup',
      query: selected.title,
      screens: selected.uiFocus || [],
      verified: false,
      captureStatus: 'lookup-required',
      policy: 'manual-review-only', usage: 'human-review-only',
      aiUseAllowed: false, aiInputAllowed: false, downloadAllowed: false, thumbnail: null,
      rightsNote: 'Game UI Database는 인간 검토용 검색 목적지만 제공합니다. 페이지·이미지·본문을 AI 입력이나 자동 수집에 사용하지 않습니다.'
    })
  }
  return references.slice(0, 8)
}

const limitedStrings = (value, limit = 8, length = 220) => unique(
  (Array.isArray(value) ? value : []).map(item => clean(item).slice(0, length))
).slice(0, limit)

function parseJsonResponse(raw) {
  if (!raw) return null
  try {
    const text = String(raw.text || raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch { return null }
}

function blueprintGenre(agenda, selected) {
  const signal = foldText(`${agenda} ${selected?.id} ${selected?.title} ${(selected?.mechanics || []).join(' ')}`)
  if (/pokemon|creature collection|monster collection|포켓몬|몬스터 수집|수집형/.test(signal)) return 'collection'
  if (/runner|auto run|endless run|러너|달리|장애물/.test(signal)) return 'runner'
  if (/rhythm|timing|note highway|리듬|박자|비트/.test(signal)) return 'rhythm'
  if (/brick breaker|breakout|arkanoid|벽돌/.test(signal)) return 'brick'
  return 'arcade'
}

function fallbackCoreLoop(genre) {
  const templates = {
    collection: {
      goal: 'Build a small original team and win short readable encounters.',
      verbs: ['inspect', 'choose', 'resolve', 'collect', 'organize'],
      steps: [
        ['read', 'Read both units and the current turn state.', 'Stable HP/status cards and a clear active-unit marker.'],
        ['choose', 'Choose one command from a compact command group.', 'Focused command enlarges and changes outline before confirmation.'],
        ['resolve', 'Resolve one player action and one opponent response.', 'Anticipation, hit reaction, HP tween and short message appear in order.'],
        ['collect', 'Convert a valid encounter outcome into collection progress.', 'Capture/result burst updates party and codex counters once.'],
        ['organize', 'Review or switch the team, then re-enter play.', 'Party selection persists and the active unit is visibly marked.']
      ],
      sessionGoal: 'Complete one encounter and make one collection or party decision in 2–4 minutes.',
      failureRecovery: 'A result screen explains the outcome and restarts with one confirm input.'
    },
    runner: {
      goal: 'Read upcoming hazards, time a compact action and extend the run.',
      verbs: ['scan', 'jump', 'land', 'score', 'retry'],
      steps: [
        ['scan', 'Read a hazard before it reaches the action zone.', 'Foreground contrast and approach motion telegraph timing.'],
        ['act', 'Trigger the primary jump or dodge.', 'Squash, launch trail and input flash acknowledge immediately.'],
        ['resolve', 'Land safely or collide.', 'Landing pulse rewards success; collision freezes briefly and reacts.'],
        ['escalate', 'Increase score and cadence without hiding readability.', 'Milestone banner and subtle speed shift communicate escalation.']
      ],
      sessionGoal: 'Beat the previous distance in a 30–90 second run.',
      failureRecovery: 'Show distance, best score and one-input retry.'
    },
    rhythm: {
      goal: 'Read a musical cue, input inside a timing window and sustain a chain.',
      verbs: ['read', 'tap', 'judge', 'chain', 'recover'],
      steps: [
        ['read', 'Track the next cue toward a fixed judgment point.', 'Lane motion and beat pulse share one visual rhythm.'],
        ['tap', 'Use one primary input at the judgment point.', 'The input receptor reacts on the same frame.'],
        ['judge', 'Classify timing without obscuring the next cue.', 'Perfect/good/miss uses distinct shape, color and motion.'],
        ['chain', 'Accumulate combo and score, then recover after a miss.', 'Combo emphasis grows modestly and resets with a clear break.']
      ],
      sessionGoal: 'Finish one short chart and understand the grade.',
      failureRecovery: 'Result grading exposes accuracy and offers immediate replay.'
    },
    brick: {
      goal: 'Control rebounds, clear readable targets and exploit short power windows.',
      verbs: ['position', 'deflect', 'break', 'collect', 'clear'],
      steps: [
        ['position', 'Move the paddle while reading the ball trajectory.', 'Paddle movement and projected contact zone remain high contrast.'],
        ['deflect', 'Return the ball with position-dependent direction.', 'Contact flash, trail kink and sound event confirm the rebound.'],
        ['break', 'Damage or clear a target.', 'Target cracks, score pops and depth shadow reacts once.'],
        ['escalate', 'Collect a temporary modifier or face a denser pattern.', 'Modifier timer is separated from score and lives.']
      ],
      sessionGoal: 'Clear one compact board in 1–3 minutes.',
      failureRecovery: 'Life loss pauses briefly; final result offers one-input retry.'
    },
    arcade: {
      goal: 'Learn one primary action, receive immediate feedback and chase a better short-session score.',
      verbs: ['read', 'act', 'react', 'score', 'retry'],
      steps: [
        ['read', 'Read the current objective and next threat.', 'World contrast and a compact HUD separate action from status.'],
        ['act', 'Use one primary action plus at most one secondary action.', 'Input acknowledgement appears in the same frame.'],
        ['resolve', 'Resolve success or failure unambiguously.', 'Motion, shape and number feedback agree.'],
        ['escalate', 'Increase challenge after a visible milestone.', 'A short transition announces the changed rule or pace.']
      ],
      sessionGoal: 'Complete and understand a full run within 1–3 minutes.',
      failureRecovery: 'A result summary and one-input retry preserve flow.'
    }
  }
  const template = templates[genre] || templates.arcade
  return {
    ...template,
    steps: template.steps.map(([id, action, feedback]) => ({ id, action, feedback }))
  }
}

function fallbackScreens(genre) {
  const screen = (id, label, purpose, primaryAction, feedback, layout, priority = 'required') => ({
    id, label, purpose, role: purpose, entry: id === 'title' ? 'boot' : 'explicit state transition',
    exit: id === 'result' ? 'confirm to title or restart' : 'explicit confirm/back action',
    priority, layout, primaryAction, feedback, patternIds: []
  })
  const base = [
    screen('title', 'Title / Start', 'Teach the fantasy, objective and controls before play.', 'Start game', 'Selected start control responds before transition.', 'logo/hero above; primary action and controls in a safe lower panel'),
    screen('gameplay', genre === 'collection' ? 'Encounter / Battle' : 'Gameplay', 'Keep the playfield dominant while exposing only decision-critical status.', 'Perform the core action', 'Anticipation, resolution and state update occur in readable order.', 'world in top 72%; HUD and commands use no more than bottom 28%'),
    screen('result', 'Result / Retry', 'Explain outcome, progress and next action.', 'Retry or return', 'Score/progress settles once before controls unlock.', 'outcome first, metrics second, one primary action last')
  ]
  if (genre === 'collection') {
    base.splice(2, 0,
      screen('party', 'Party', 'Compare the owned team and choose one active unit.', 'Select or switch unit', 'Selection marker, details and active badge update together.', '2×3 compact card grid plus one reusable detail region'),
      screen('codex', 'Collection / Codex', 'Show discovered, owned and unknown entries without exposing copyrighted forms.', 'Inspect entry', 'Cell, detail region and completion count share one selection.', 'repeatable grid plus selected-entry details and completion progress', 'recommended')
    )
  } else {
    base.splice(2, 0, screen('help', 'Help / Pause', 'Keep controls and objective available without restarting.', 'Resume', 'Focus returns to gameplay predictably.', 'short overlay with controls, objective and resume'))
  }
  return base
}

function fallbackPatterns(genre, selected) {
  const pattern = (id, category, requirement, implementationHint, verify, required = true) => ({
    id, category, requirement, sourcePattern: requirement, adaptation: implementationHint,
    implementationHint, implementationCue: implementationHint, verify, evidenceIds: [], required
  })
  const common = [
    pattern('depth-stage', 'visual', 'Compose every play scene as far, mid and near world layers plus a separate UI layer.', 'Use a horizon, y-dependent scale, occlusion, atmospheric contrast and foreground framing; never use a single flat background fill.', 'Renderer exposes three world-layer passes, perspective scale and contact shadows.'),
    pattern('state-feedback', 'feedback', 'Every consequential input has anticipation, impact/reaction and settled-state feedback.', 'Use short timers and deterministic animation state rather than visual RNG in the render loop.', 'Input produces visible acknowledgement and the resulting state is legible within 500 ms.'),
    pattern('safe-hud', 'information-architecture', 'Keep the playfield dominant and group related status into reusable elevated panels.', 'Reserve at most 28% of height for persistent HUD; overlays must preserve a clear primary action.', 'No essential world object or action target is hidden by the HUD.'),
    pattern('adaptive-viewport', 'layout', 'Choose one genre-appropriate supported viewport and adapt the reference hierarchy into that viewport safe area.', 'Declare exactly one of 480×320, 360×480 or 400×400; reflow source information instead of stretching or preserving source proportions literally.', 'The chosen viewport has no overflow, clipped controls or illegible required information.')
  ]
  const byGenre = {
    collection: [
      pattern('command-group', 'interaction', 'Expose battle choices as one compact group with unmistakable focus and confirm states.', 'Use an original 2×2 or short-row command layout; color is redundant with label, icon shape and focus outline.', 'Keyboard traversal, confirm and back never leave focus ambiguous.'),
      pattern('party-grid', 'information-architecture', 'Compare up to six units without opening a nested screen for every stat.', 'Use reusable original portrait cards and one shared details region; do not copy branded frames or creature silhouettes.', 'Owned state, health, active selection and role are visible at a glance.'),
      pattern('collection-grid', 'progression', 'Represent discovered/owned/unknown state in one repeatable collection grid.', 'Use original abstract silhouettes for unknown entries and a completion summary.', 'Progress updates once after collection and persists on re-entry.')
    ],
    runner: [
      pattern('hazard-telegraph', 'readability', 'Show hazards early enough to support a deliberate reaction.', 'Separate hazards from scenery by silhouette, contrast and motion lane.', 'At least one reaction window is visible before collision.'),
      pattern('one-action-onboarding', 'interaction', 'Teach the primary action inside the first playable seconds.', 'Show a concise contextual cue, then fade it after demonstrated success.', 'A first-time player can act without opening help.')
    ],
    rhythm: [
      pattern('fixed-judgment-line', 'readability', 'Keep one stable judgment target while cues move predictably toward it.', 'Align cue motion, beat pulse and input receptor without decorative overlap.', 'Timing can be read without relying on audio alone.'),
      pattern('timing-grade', 'feedback', 'Distinguish timing grades with redundant shape, color and motion.', 'Render grade feedback outside the incoming cue path and retire it quickly.', 'Perfect/good/miss remain distinguishable in grayscale.')
    ],
    brick: [
      pattern('trajectory-readability', 'readability', 'Ball, paddle and next contact remain visually separable at maximum speed.', 'Use trail length, contrast and contact flash; keep decorative particles outside the ball silhouette.', 'The ball remains trackable during dense target states.'),
      pattern('target-damage', 'feedback', 'Communicate target durability before and after each hit.', 'Combine crack stage, value or fill change with a single impact reaction.', 'A hit never appears to pass through an unchanged target.')
    ],
    arcade: [
      pattern('instant-onboarding', 'interaction', 'State the objective and primary input before the first failure is possible.', 'Use one concise instruction cue and reinforce it through the first successful action.', 'A new player can explain the action after one attempt.'),
      pattern('score-milestone', 'progression', 'Tie score changes to specific world events and announce meaningful milestones.', 'Place small score pops at the event and reserve large banners for milestones.', 'Score never changes without a visible cause.')
    ]
  }
  const patterns = [...common, ...(byGenre[genre] || byGenre.arcade)]
  for (const focus of limitedStrings(selected?.uiFocus, 3, 100)) {
    const duplicate = patterns.some(item => foldText(item.requirement).includes(foldText(focus)))
    if (!duplicate) patterns.push(pattern(
      `reference-${patterns.length + 1}`, 'reference-adaptation',
      `Adapt the generalized “${focus}” information pattern without copying branded expression.`,
      'Rebuild the hierarchy with original labels, proportions, icons, palette and assets for this game scope.',
      'The functional relationship is present while protected expression is absent.', false
    ))
  }
  return patterns
}

function fallbackInteraction(genre) {
  const controls = genre === 'runner' ? ['Arrow keys / A,D: optional lane movement', 'Space: jump/action']
    : genre === 'rhythm' ? ['Space / primary button: timed input', 'Escape: pause']
      : genre === 'brick' ? ['Arrow keys / A,D: move paddle', 'Space: launch/confirm']
        : genre === 'collection' ? ['Arrow keys: move focus', 'Space / Enter: confirm', 'Escape: back']
          : ['Arrow keys / WASD: move or focus', 'Space / Enter: primary action', 'Escape: pause/back']
  return {
    controls,
    focusRule: 'Exactly one interactive target has a visible focus state; transitions preserve or deliberately reset focus.',
    feedback: ['same-frame input acknowledgement', 'anticipation before consequence', 'impact/reaction', 'settled state'],
    randomnessRule: 'Use seeded gameplay RNG only for game decisions; rendering must remain stable for the same state.'
  }
}

function allowedEvidenceMap(sources, selected) {
  const allowed = sources.filter(source => !isManualOnlySource(source) && source.aiInputAllowed !== false && source.url)
    .slice(0, 12).map(source => {
      const sourceText = foldText(`${source.title} ${source.excerpt}`)
      const claims = limitedStrings([...(selected?.mechanics || []), ...(selected?.uiFocus || [])], 5, 100)
        .filter(claim => {
          const normalized = foldText(claim)
          return normalized.length > 3 && sourceText.includes(normalized)
        })
      return {
        id: stableEvidenceId(source),
        title: clean(source.title).slice(0, 160),
        url: source.url,
        lane: source.lane || 'discovery',
        excerpt: clean(source.excerpt).slice(0, 280),
        claims,
        aiInputAllowed: true
      }
    })
  return [...allowed, {
    id: 'src-baseline', title: 'Deterministic genre baseline', url: '', lane: 'fallback',
    excerpt: 'Built-in implementation-safe game UX grammar used because permitted web evidence was unavailable.',
    claims: limitedStrings([...(selected?.mechanics || []), ...(selected?.uiFocus || [])], 6, 100),
    aiInputAllowed: true
  }]
}

function blueprintSchema() {
  const strings = { type: 'array', items: { type: 'string' } }
  return {
    type: 'object',
    properties: {
      coreLoop: {
        type: 'object', properties: {
          goal: { type: 'string' }, verbs: strings,
          steps: { type: 'array', items: { type: 'object', properties: {
            id: { type: 'string' }, action: { type: 'string' }, feedback: { type: 'string' }
          }, required: ['id', 'action', 'feedback'] } },
          sessionGoal: { type: 'string' }, failureRecovery: { type: 'string' }
        }, required: ['goal', 'verbs', 'steps', 'sessionGoal', 'failureRecovery']
      },
      screens: { type: 'array', items: { type: 'object', properties: {
        id: { type: 'string' }, label: { type: 'string' }, purpose: { type: 'string' },
        entry: { type: 'string' }, exit: { type: 'string' }, layout: { type: 'string' },
        primaryAction: { type: 'string' }, feedback: { type: 'string' }, priority: { type: 'string' }
      }, required: ['id', 'label', 'purpose', 'layout', 'primaryAction', 'feedback'] } },
      patterns: { type: 'array', items: { type: 'object', properties: {
        id: { type: 'string' }, category: { type: 'string' }, requirement: { type: 'string' },
        implementationHint: { type: 'string' }, verify: { type: 'string' }, evidenceIds: strings,
        required: { type: 'boolean' }
      }, required: ['id', 'category', 'requirement', 'implementationHint', 'verify', 'evidenceIds', 'required'] } },
      visualGrammar: { type: 'object', properties: {
        composition: { type: 'string' }, perspective: { type: 'string' }, lighting: { type: 'string' },
        shadows: { type: 'string' }, palette: { type: 'string' }, motion: { type: 'string' }
      }, required: ['composition', 'perspective', 'lighting', 'shadows', 'palette', 'motion'] },
      requiredStates: strings,
      implementation: { type: 'object', properties: {
        difficulty: { type: 'string' }, systems: strings, reusableComponents: strings, cutOrder: strings
      }, required: ['difficulty', 'systems', 'reusableComponents', 'cutOrder'] }
    },
    required: ['coreLoop', 'screens', 'patterns', 'visualGrammar', 'requiredStates', 'implementation']
  }
}

async function extractBlueprintWithEvidence({ agenda, currentInfo, selected, selectionMode, sources, generate }) {
  if (!generate) return null
  const evidenceMap = allowedEvidenceMap(sources, selected).filter(item => item.url)
  if (!evidenceMap.length) return null
  const evidence = evidenceMap.map(item =>
    `[${item.id}] ${item.title}\n${item.excerpt}\n${item.url}`
  ).join('\n\n')
  const out = await withTimeout(generate({
    system: [
      'You are a game systems and UI reference analyst.',
      'Extract implementation-ready structural patterns only from the supplied permitted evidence.',
      'Never imitate names, characters, silhouettes, logos, maps, dialogue, exact layouts, icons, palettes, pixel art or other protected expression.',
      'Design a small 2D Canvas game with convincing 2.5D depth and no additional user production steps.',
      'Every pattern must cite one or more supplied evidence ids and include a testable verification sentence.'
    ].join(' '),
    messages: [{
      role: 'user',
      text: [
        `Game brief: ${agenda}`,
        `Current context: ${currentInfo || 'none'}`,
        `Selected reference target: ${selected.title}`,
        `Generalized mechanics: ${selectionMode === 'llm-evidence' ? (selected.mechanics || []).join(', ') : 'derive only from permitted evidence'}`,
        `Generalized UI notes: ${selectionMode === 'llm-evidence' ? unique(selected.uiFocus || []).join(', ') : 'derive only from permitted evidence'}`,
        '', 'Permitted evidence (the only source material you may analyze):', evidence,
        '', 'Return a compact implementation blueprint. Include title, gameplay and result screens plus a genre-appropriate auxiliary screen. ',
        'Use far/mid/near/UI layers, y-based perspective scale, contact shadows, controlled lighting and viewport-safe UI hierarchy.'
      ].join('\n')
    }],
    hint: 'reference_blueprint', model: 'fast', json: blueprintSchema(), maxTokens: 2600
  }), 20000, 'reference blueprint')
  const parsed = parseJsonResponse(out)
  return parsed && parsed.coreLoop && Array.isArray(parsed.screens) && Array.isArray(parsed.patterns)
    ? parsed
    : null
}

function slugId(value, fallback) {
  const slug = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
  return slug || fallback
}

function normalizeBlueprint({ agenda, selected, selectionMode, sources, extracted }) {
  const genre = blueprintGenre(agenda, selected)
  const fallbackLoop = fallbackCoreLoop(genre)
  const fallbackScreenList = fallbackScreens(genre)
  const fallbackPatternList = fallbackPatterns(genre, selected)
  const evidenceMap = allowedEvidenceMap(sources, selected)
  const validEvidenceIds = new Set(evidenceMap.map(item => item.id))
  const defaultEvidenceIds = ['src-baseline']

  const rawLoop = extracted?.coreLoop || {}
  const extractedSteps = Array.isArray(rawLoop.steps) ? rawLoop.steps.slice(0, 8).map((step, index) => ({
    id: slugId(step?.id, `step-${index + 1}`),
    action: clean(step?.action).slice(0, 260),
    feedback: clean(step?.feedback).slice(0, 260)
  })).filter(step => step.action && step.feedback) : []
  const coreLoop = {
    goal: clean(rawLoop.goal).slice(0, 300) || fallbackLoop.goal,
    verbs: limitedStrings(rawLoop.verbs, 8, 60).length ? limitedStrings(rawLoop.verbs, 8, 60) : fallbackLoop.verbs,
    steps: extractedSteps.length >= 3 ? extractedSteps : fallbackLoop.steps,
    sessionGoal: clean(rawLoop.sessionGoal).slice(0, 260) || fallbackLoop.sessionGoal,
    failureRecovery: clean(rawLoop.failureRecovery).slice(0, 260) || fallbackLoop.failureRecovery
  }

  const extractedScreens = Array.isArray(extracted?.screens) ? extracted.screens.slice(0, 10).map((item, index) => {
    const id = slugId(item?.id, `screen-${index + 1}`)
    return {
      id, label: clean(item?.label).slice(0, 100) || id,
      purpose: clean(item?.purpose).slice(0, 260), role: clean(item?.purpose).slice(0, 260),
      entry: clean(item?.entry).slice(0, 160) || 'explicit state transition',
      exit: clean(item?.exit).slice(0, 160) || 'explicit confirm/back action',
      priority: item?.priority === 'recommended' ? 'recommended' : 'required',
      layout: clean(item?.layout).slice(0, 300),
      primaryAction: clean(item?.primaryAction).slice(0, 160),
      feedback: clean(item?.feedback).slice(0, 260), patternIds: []
    }
  }).filter(item => item.purpose && item.layout && item.primaryAction && item.feedback) : []
  // Core lifecycle screens are invariant. An evidence-derived auxiliary marked
  // `recommended` stays optional; only add the genre fallback auxiliary when the
  // model supplied no auxiliary screen at all.
  const screensById = new Map(extractedScreens.map(item => [item.id, item]))
  const coreScreenIds = new Set(['title', 'gameplay', 'result'])
  const hasExtractedAuxiliary = extractedScreens.some(item => !coreScreenIds.has(item.id))
  for (const fallback of fallbackScreenList.filter(item => coreScreenIds.has(item.id))) {
    if (!screensById.has(fallback.id)) screensById.set(fallback.id, fallback)
    else screensById.get(fallback.id).priority = 'required'
  }
  for (const fallback of fallbackScreenList.filter(item => !coreScreenIds.has(item.id))) {
    if (screensById.has(fallback.id) || hasExtractedAuxiliary) continue
    screensById.set(fallback.id, fallback)
  }
  const screens = [...screensById.values()].slice(0, 10)

  const extractedPatterns = Array.isArray(extracted?.patterns) ? extracted.patterns.slice(0, 12).map((item, index) => {
    const id = slugId(item?.id, `pattern-${index + 1}`)
    const implementationHint = clean(item?.implementationHint).slice(0, 360)
    const requirement = clean(item?.requirement).slice(0, 360)
    const cited = limitedStrings(item?.evidenceIds, 5, 60).filter(id => validEvidenceIds.has(id))
    return {
      id, category: clean(item?.category).slice(0, 80) || 'reference-adaptation',
      requirement, sourcePattern: requirement, adaptation: implementationHint,
      implementationHint, implementationCue: implementationHint,
      verify: clean(item?.verify).slice(0, 300), evidenceIds: cited.length ? cited : defaultEvidenceIds,
      required: item?.required !== false
    }
  }).filter(item => item.requirement && item.implementationHint && item.verify) : []
  const patternsById = new Map(extractedPatterns.map(item => [item.id, item]))
  for (const fallback of fallbackPatternList) {
    // Reserved baseline ids stay deterministic; evidence-derived patterns supplement rather than weaken them.
    if (fallback.required || !patternsById.has(fallback.id)) {
      patternsById.set(fallback.id, { ...fallback, evidenceIds: defaultEvidenceIds })
    }
  }
  const patterns = [...patternsById.values()].slice(0, 16)
  const baselineRequiredIds = new Set(fallbackPatternList.filter(item => item.required).map(item => item.id))
  let evidenceRequiredBudget = Math.max(0, 8 - baselineRequiredIds.size)
  for (const pattern of patterns) {
    if (baselineRequiredIds.has(pattern.id)) pattern.required = true
    else if (pattern.required && evidenceRequiredBudget > 0) evidenceRequiredBudget--
    else pattern.required = false
  }

  for (const screen of screens) {
    const semantic = foldText(`${screen.id} ${screen.purpose} ${screen.layout}`)
    screen.patternIds = patterns.filter(pattern => {
      const patternText = foldText(`${pattern.category} ${pattern.requirement}`)
      return ['depth-stage', 'state-feedback', 'safe-hud', 'adaptive-viewport'].includes(pattern.id) ||
        semantic.split(' ').some(token => token.length > 4 && patternText.includes(token))
    }).map(pattern => pattern.id).slice(0, 6)
  }

  const rawVisual = extracted?.visualGrammar || {}
  const visualGrammar = {
    projection: '2.5D layered 2D',
    depthLayers: ['far', 'mid', 'near', 'ui'],
    composition: clean(rawVisual.composition).slice(0, 300) || 'Far atmosphere and silhouettes, mid gameplay actors, near framing/occluders, then isolated UI.',
    perspective: clean(rawVisual.perspective).slice(0, 300) || 'Set a horizon and derive object scale, overlap and travel speed from normalized screen y.',
    depthScale: 'clamp(0.72 + ((y - horizonY) / (height - horizonY)) * 0.48, 0.72, 1.20)',
    lighting: clean(rawVisual.lighting).slice(0, 300) || 'One dominant world light, restrained local accents and a subtle foreground vignette.',
    shadows: clean(rawVisual.shadows).slice(0, 300) || 'Soft ellipse contact shadows scale with actor depth and remain separate from sprites.',
    palette: clean(rawVisual.palette).slice(0, 300) || 'Use value-separated world planes and reserve the highest contrast for actions, focus and threats.',
    motion: clean(rawVisual.motion).slice(0, 300) || 'Use anticipation, directional travel, reaction and settle poses with deterministic timers.',
    legibility: 'Gameplay actors must remain distinguishable by silhouette, value and motion—not color alone.'
  }
  const layout = {
    safeArea: { top: 12, right: 14, bottom: 12, left: 14 },
    hudMaxRatio: 0.28,
    horizon: 0.38,
    depthScale: { min: 0.72, max: 1.2, axis: 'normalized-y' },
    panelHierarchy: ['world', 'context/status', 'primary action', 'temporary feedback']
  }
  const viewport = {
    width: 480, height: 320, aspect: '3:2',
    selectionRule: 'Choose exactly one viewport for the game; these are platform candidates, not simultaneous layout targets.',
    supportedCandidates: [{ width: 480, height: 320, aspect: '3:2' }, { width: 360, height: 480, aspect: '3:4' }, { width: 400, height: 400, aspect: '1:1' }],
    adaptation: ['translate source hierarchy into the chosen safe area', 'reflow grids before shrinking text', 'keep controls inside safe area', 'recompute horizon and HUD bounds', 'never uniformly stretch the canvas bitmap']
  }
  const interaction = fallbackInteraction(genre)
  const requiredStates = unique([
    ...limitedStrings(extracted?.requiredStates, 12, 100),
    'title:idle', 'gameplay:active', 'gameplay:feedback', 'result:summary',
    ...(genre === 'collection' ? ['party:browse', 'party:selected', 'codex:unknown', 'codex:owned'] : [])
  ])
  const rawImplementation = extracted?.implementation || {}
  const implementation = {
    difficulty: ['small', 'medium'].includes(rawImplementation.difficulty) ? rawImplementation.difficulty : 'small',
    systems: limitedStrings(rawImplementation.systems, 8, 100).length
      ? limitedStrings(rawImplementation.systems, 8, 100)
      : ['finite state machine', 'input mapping', 'deterministic animation timers', 'semantic events', 'persistent score/progress'],
    reusableComponents: limitedStrings(rawImplementation.reusableComponents, 8, 100).length
      ? limitedStrings(rawImplementation.reusableComponents, 8, 100)
      : ['layer renderer', 'panel primitive', 'focusable command group', 'status card', 'result summary'],
    cutOrder: limitedStrings(rawImplementation.cutOrder, 6, 140).length
      ? limitedStrings(rawImplementation.cutOrder, 6, 140)
      : ['decorative particles', 'secondary transitions', 'optional content variants'],
    budget: { codeLines: '450–800', coreScreens: screens.filter(item => item.priority === 'required').length, maxPrimaryInputs: 4 },
    viewportAdaptation: 'Layout tokens and normalized coordinates; no separate handcrafted build per aspect ratio.'
  }
  const originality = {
    allowed: ['core-loop abstraction', 'information hierarchy', 'interaction flow', 'feedback timing', 'generalized spatial composition'],
    forbidden: ['reference names and terminology', 'characters or recognizable silhouettes', 'logos and trademarks', 'maps and dialogue', 'exact layout proportions', 'icons and frames', 'exact palette', 'pixel art or other source assets'],
    forbiddenVisibleTerms: forbiddenVisibleTerms(agenda, selected),
    forbiddenVisibleTermKeys: forbiddenVisibleTerms(agenda, selected).map(foldText)
  }
  const requiredScreens = screens.filter(item => item.priority === 'required').map(item => item.id)
  const requiredPatternIds = patterns.filter(item => item.required).map(item => item.id)
  const permittedSourceIds = new Set(evidenceMap.filter(item => item.url).map(item => item.id))
  const evidenceCoverage = patterns.length
    ? patterns.filter(pattern => pattern.evidenceIds.some(id => permittedSourceIds.has(id))).length / patterns.length
    : 0
  const extractionMode = extracted ? 'llm-evidence' : 'deterministic-fallback'
  const qualityWarnings = []
  if (!permittedSourceIds.size) qualityWarnings.push('permitted-web-evidence-unavailable')
  if (!extracted) qualityWarnings.push('blueprint-extraction-used-deterministic-baseline')
  if (selectionMode === 'profile-fallback') qualityWarnings.push('selected-target-used-uncited-profile-baseline')
  if (evidenceCoverage < 0.4) qualityWarnings.push('low-evidence-coverage-keep-reference-claims-generic')
  const quality = {
    evidenceCoverage: Number(evidenceCoverage.toFixed(2)),
    confidence: Number(Math.min(0.96, Math.max(0.4, Number(selected.confidence || 0.58)) * (extracted ? 1 : 0.82)).toFixed(2)),
    mode: extractionMode,
    warnings: qualityWarnings
  }
  // The id represents executable semantics, not merely a target and a few IDs.
  // A layout, verification, state or implementation-budget change must not reuse
  // a previous contract's trace/QA identity.
  const contractId = stableContractId([BLUEPRINT_SCHEMA_VERSION, JSON.stringify({
    agenda: foldText(agenda), targetId: selected.id, genre, coreLoop, viewport,
    screens: screens.map(({ id, purpose, entry, exit, priority, layout, primaryAction, feedback, patternIds }) =>
      ({ id, purpose, entry, exit, priority, layout, primaryAction, feedback, patternIds })),
    patterns: patterns.map(({ id, category, requirement, implementationHint, verify, evidenceIds, required }) =>
      ({ id, category, requirement, implementationHint, verify, evidenceIds, required })),
    visualGrammar, layout, interaction, requiredStates, implementation, originality,
    qa: { requiredScreens, requiredPatternIds }
  })])
  const traceability = patterns.map(pattern => ({
    contractId: pattern.id,
    sourcePattern: pattern.sourcePattern,
    sourceIds: pattern.evidenceIds,
    targetScreen: screens.find(screen => screen.patternIds.includes(pattern.id))?.id || 'gameplay',
    implementation: pattern.implementationHint,
    verification: pattern.verify
  }))
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    version: '1.1', contractId,
    target: { id: selected.id, title: selected.title, selectionMode },
    targetId: selected.id, targetTitle: selected.title,
    genre, coreLoop, viewport, screens, patterns, layout,
    visualGrammar, visual: visualGrammar, interaction, requiredStates, implementation,
    originality, prohibitedCopying: originality.forbidden,
    qa: {
      requiredScreens, requiredPatternIds, requiredStates,
      forbiddenVisibleTerms: originality.forbiddenVisibleTerms,
      depthSignals: ['meta.visual.perspective=true', 'far/mid/near render passes', 'y-dependent scale', 'ellipse contact shadows', 'foreground light/vignette'],
      feedbackSignals: ['input acknowledgement', 'anticipation', 'impact or reaction', 'settled state', 'semantic event']
    },
    evidenceMap, evidenceTrace: evidenceMap, traceability,
    sourcePolicy: {
      llmInputs: 'permitted-search-evidence-and-generalized-notes-only',
      manualOnlyDomains: [...MANUAL_ONLY_HOSTS],
      manualOnlyRule: 'Never send page metadata, text, screenshots or pixels from manual-only domains to an AI model.',
      assetRule: 'No source images or protected expression are downloaded, proxied or copied.'
    },
    quality, extractionMode
  }
}

async function parallelSearch(queries, search, lane, emit) {
  if (!search) {
    return { sources: [], runs: queries.map(query => ({ query, lane, status: 'unavailable', hits: 0 })) }
  }
  let completed = 0
  const settled = await Promise.all(queries.map(async query => {
    try {
      const result = await withTimeout(search(query, { maxResults: 6, timeoutMs: 12000 }), 13500, `${lane} search`)
      const sources = compactSearchResult(result, query, lane)
      completed++
      emit?.({ status: lane === 'discovery' ? 'searching' : 'ui-search', completedQueries: completed, totalQueries: queries.length, lastQuery: query, lastHits: sources.length })
      return { query, lane, status: 'done', hits: sources.length, sources }
    } catch (error) {
      completed++
      emit?.({ status: lane === 'discovery' ? 'searching' : 'ui-search', completedQueries: completed, totalQueries: queries.length, lastQuery: query, lastHits: 0 })
      return { query, lane, status: 'error', hits: 0, error: clean(error?.message).slice(0, 220), sources: [] }
    }
  }))
  return {
    sources: settled.flatMap(run => run.sources),
    runs: settled.map(({ sources, ...run }) => run)
  }
}

async function executeReferenceResearch(input, deps) {
  const agenda = clean(input?.agenda).slice(0, 1800)
  if (!agenda) throw new Error('agenda 필요')
  const currentInfo = clean(input?.currentInfo).slice(0, 3000)
  const preferredTarget = clean(input?.preferredTarget).slice(0, 120)
  const emit = deps.emit
  const plan = deriveReferencePlan({ agenda, currentInfo, preferredTarget })
  emit?.({ status: 'keywords', keywords: plan.keywords, queries: plan.queries, completedQueries: 0, totalQueries: plan.queries.length })

  emit?.({ status: 'searching', keywords: plan.keywords, queries: plan.queries, completedQueries: 0, totalQueries: plan.queries.length })
  const discovery = await parallelSearch(plan.queries, deps.search, 'discovery', emit)

  emit?.({ status: 'selecting', completedQueries: plan.queries.length, totalQueries: plan.queries.length })
  let llmSelection = null
  try {
    llmSelection = await selectWithEvidence({ agenda, plan, sources: discovery.sources, generate: deps.generate })
  } catch { /* deterministic evidence/profile selection below */ }
  const selection = buildCandidates(plan, discovery.sources, llmSelection)

  const lookupQueries = uiQueries(selection.selected)
  emit?.({
    status: 'ui-search', selected: selection.selected,
    queries: [...plan.queries, ...lookupQueries], completedQueries: 0, totalQueries: lookupQueries.length
  })
  const ui = await parallelSearch(lookupQueries, deps.search, 'ui', emit)
  const sources = []
  const seenUrls = new Set()
  for (const source of [...discovery.sources, ...ui.sources]) {
    const key = source.url || `${source.title}:${source.excerpt}`
    if (!key || seenUrls.has(key)) continue
    seenUrls.add(key); sources.push(source)
  }
  const uiReferences = buildUiReferences(selection.selected, ui.sources)
  emit?.({ status: 'blueprinting', selected: selection.selected, completedQueries: lookupQueries.length, totalQueries: lookupQueries.length })
  // Curated profile details are discovery/fallback seeds, not live design facts.
  // When the target came from profile matching, permitted web evidence alone must
  // supply target-specific mechanics/UI details to the extraction model.
  const selectedForBlueprint = selection.selectionMode === 'profile-evidence'
    ? { ...selection.selected, mechanics: [], uiFocus: [] }
    : selection.selected
  let extractedBlueprint = null
  try {
    if (selection.selectionMode === 'profile-fallback') throw new Error('uncited target uses deterministic baseline')
    extractedBlueprint = await extractBlueprintWithEvidence({
      agenda, currentInfo, selected: selectedForBlueprint, selectionMode: selection.selectionMode,
      sources, generate: deps.generate
    })
  } catch { /* complete deterministic blueprint below */ }
  const blueprint = normalizeBlueprint({
    agenda, selected: selectedForBlueprint, selectionMode: selection.selectionMode,
    sources, extracted: extractedBlueprint
  })
  const permittedEvidence = sources.filter(source =>
    !isManualOnlySource(source) && source.aiInputAllowed !== false
  )
  const fallback = permittedEvidence.length === 0 || selection.selectionMode === 'profile-fallback'
  const result = {
    status: fallback ? 'fallback' : 'done',
    keywords: plan.keywords,
    queries: [...plan.queries, ...lookupQueries],
    queryRuns: [...discovery.runs, ...ui.runs],
    candidates: selection.candidates,
    selected: selection.selected,
    uiReferences,
    sources: sources.slice(0, 24),
    evidence: permittedEvidence.slice(0, 16),
    blueprint,
    designContract: blueprint,
    reason: selection.reason,
    selectionMode: selection.selectionMode,
    fallback,
    fallbackReason: fallback
      ? selection.selectionMode === 'profile-fallback'
        ? '검색 근거에서 후보 3개를 검증하지 못해 특정 게임의 세부 표현 대신 내장 장르 baseline을 사용했습니다.'
        : 'AI 입력이 허용된 웹 근거를 사용할 수 없어 내장 장르 계약과 수동 UI 데이터베이스 조회 절차를 사용했습니다.'
      : '',
    generatedAt: new Date().toISOString()
  }
  emit?.({ ...result, status: result.status })
  return result
}

export async function runReferenceResearch(input, deps = {}) {
  const agenda = clean(input?.agenda).slice(0, 1800)
  const currentInfo = clean(input?.currentInfo).slice(0, 3000)
  const key = JSON.stringify([
    PIPELINE_CACHE_VERSION,
    agenda.toLowerCase(),
    stableContractId([currentInfo]),
    clean(input?.preferredTarget).toLowerCase(),
    Boolean(deps.search), Boolean(deps.generate)
  ])
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) {
    const result = { ...hit.result, cached: true }
    deps.emit?.({ ...result, status: result.status })
    return result
  }
  if (inflight.has(key)) {
    deps.emit?.({ status: 'searching', deduplicated: true })
    return inflight.get(key)
  }
  const task = executeReferenceResearch(input, deps)
    .then(result => {
      // Outages and uncited-profile fallbacks must be retried on the next run;
      // caching them would turn a transient research failure into 15 minutes of
      // silently stale production decisions.
      if (!result.fallback) cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS })
      return result
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, task)
  return task
}

export function clearReferenceResearchCache() {
  cache.clear()
  inflight.clear()
}
