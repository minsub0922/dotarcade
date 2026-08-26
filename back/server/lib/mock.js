// DOTCADE — mock LLM provider (Gemini 도달 불가/오프라인 데모용)
// 실제 프로바이더와 동일한 인터페이스: generate / stream / embed
// 프론트가 넘기는 hint(작업 종류)와 personaMeta로 그럴듯한 한국어 응답을 합성한다.

const pick = (arr, seed) => arr[Math.abs(seed) % arr.length]
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h }

function agendaText(text) {
  const source = String(text || '')
  const patterns = [
    /\[안건\]\s*["“]?([^\n"”]{2,180})/i,
    /(?:새\s+)?(?:회의\s+)?안건(?:을\s*냈습니다|입니다)?\s*[:：]\s*["“]([^\n"”]{2,180})["”]?/i,
    /(?:새\s+)?(?:회의\s+)?안건(?:을\s*냈습니다|입니다)?\s*[:：]\s*([^\n]{2,180})/i
  ]
  for (const pattern of patterns) {
    const match = source.match(pattern)
    if (match?.[1]) return match[1].trim()
  }
  return ''
}

function currentRepairTitle(text) {
  const code = String(text || '').match(/\[현재 코드\]\s*```(?:js|javascript)?\s*\n([\s\S]*?)```/i)?.[1] || ''
  const match = code.match(/\bmeta\s*:\s*\{[\s\S]{0,1200}?\btitle\s*:\s*(['"`])([^'"`\r\n]{1,120})\1/)
  return match?.[2]?.trim() || ''
}

function keywords(text) {
  const source = String(text)
  // Prompt boilerplate must never outrank the actual agenda. This also keeps
  // generated titles stable when research/RAG/reference contracts grow.
  const focus = agendaText(source)
  const keywordSource = focus || source
  const stop = new Set([
    '게임', '만들', '어요', '해서', '하는', '그리고', '있는', '주세요', '해줘', '합니다',
    '당신은', '팀장이', '안건', '신규', '기존', '이번', '회의', '문서', '아래', '따라',
    '완전히', '동작하는', '작성하세요', '출력', '게임팩', '계약', '반드시', '준수', '코드',
    '냈습니다', '시작해', '각자', '조사부터', '진행해', '관련', '참고', '팀장님'
  ])
  return [...new Set(keywordSource.match(/[가-힣a-zA-Z]{2,}/g) || [])]
    .filter(w => !stop.has(w)).slice(0, 6)
}

function messageText(messages = []) {
  return messages.map(message => {
    if (typeof message === 'string') return message
    if (typeof message?.text === 'string') return message.text
    if (Array.isArray(message?.parts)) {
      return message.parts.map(part => typeof part === 'string' ? part : (part?.text || '')).join('\n')
    }
    return ''
  }).filter(Boolean).join('\n')
}

function telemetryFrom(text) {
  const value = key => {
    const match = String(text).match(new RegExp(`"${key}"\\s*:\\s*(-?[0-9.]+)`))
    return match ? Number(match[1]) : null
  }
  const bool = key => {
    const match = String(text).match(new RegExp(`"${key}"\\s*:\\s*(true|false)`))
    return match ? match[1] === 'true' : null
  }
  return {
    score: value('score'), ms: value('ms'), presses: value('presses'),
    errors: value('errors'), overFired: bool('overFired')
  }
}

const compactReferenceId = value => String(value || '').trim().toLowerCase()
  .replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '')
const referenceList = value => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
const uniqueReferenceIds = values => [...new Set(referenceList(values).map(value => {
  if (typeof value === 'string') return compactReferenceId(value)
  return compactReferenceId(value?.id || value?.key || value?.name || value?.screen || value?.state)
}).filter(Boolean))]

function normalizeMockReferenceContract(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const contract = value.designContract || value.blueprint || value
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return null
  const raw = contract.raw && typeof contract.raw === 'object' ? contract.raw : contract
  const qa = contract.qa && typeof contract.qa === 'object' ? contract.qa : {}
  const target = contract.target && typeof contract.target === 'object' ? contract.target : {}
  const required = items => referenceList(items).filter(item => typeof item === 'string' || item?.required !== false)
  const explicitScreens = uniqueReferenceIds(qa.requiredScreens)
  const explicitPatterns = uniqueReferenceIds(qa.requiredPatternIds)
  const screens = explicitScreens.length ? explicitScreens : uniqueReferenceIds(required(contract.screens || contract.requiredScreens))
  const patterns = explicitPatterns.length ? explicitPatterns : uniqueReferenceIds(required(contract.patterns || contract.requiredPatterns || contract.implementedPatterns))
  const states = uniqueReferenceIds(required(qa.requiredStates || contract.requiredStates || contract.states || contract.implementedStates))
  const depthSignals = uniqueReferenceIds(required(qa.depthSignals || contract.depthSignals || contract.implementedDepth))
  const feedbackSignals = uniqueReferenceIds(required(qa.feedbackSignals || contract.feedbackSignals || contract.implementedFeedback))
  const contractId = String(contract.contractId || contract.id || '').trim().slice(0, 160)
  const targetId = String(target.id || contract.targetId || '').trim().slice(0, 160)
  if (!contractId && !targetId && !screens.length && !patterns.length) return null
  return {
    contractId, targetId,
    screens: screens.slice(0, 12),
    implementedPatterns: patterns.slice(0, 16),
    implementedStates: states.slice(0, 16),
    depthSignals: depthSignals.slice(0, 16),
    feedbackSignals: feedbackSignals.slice(0, 16),
    raw
  }
}

function parseContractJsonBlocks(prompt) {
  const source = String(prompt || '').slice(-240000)
  const marker = '[정규화된 레퍼런스 디자인 계약'
  const markerIndex = source.lastIndexOf(marker)
  const scopes = markerIndex >= 0 ? [source.slice(markerIndex), source] : [source]
  for (const scope of scopes) {
    const blocks = [...scope.matchAll(/```json\s*\n([\s\S]*?)```/gi)].reverse()
    for (const block of blocks) {
      if (block[1].length > 120000) continue
      try {
        const parsed = JSON.parse(block[1])
        const candidate = parsed?.designContract || parsed?.blueprint || parsed
        if (!candidate || typeof candidate !== 'object' || !Object.prototype.hasOwnProperty.call(candidate, 'contractId')) continue
        const normalized = normalizeMockReferenceContract(parsed)
        if (normalized) return normalized
      } catch { /* malformed JSON is handled by the field-only fallback below */ }
    }
  }
  return null
}

function parseReferenceMetaExample(prompt) {
  const source = String(prompt || '').slice(-80000)
  const anchor = Math.max(source.lastIndexOf('구현 코드의 meta 선언 예'), source.lastIndexOf('reference:'), source.lastIndexOf('"reference"'))
  if (anchor < 0) return null
  const scope = source.slice(anchor, anchor + 16000)
  const quoted = key => {
    const match = scope.match(new RegExp(`(?:["']?${key}["']?)\\s*:\\s*(["'])([^"'\\n]{1,160})\\1`, 'i'))
    return match?.[2] || ''
  }
  const array = key => {
    const match = scope.match(new RegExp(`(?:["']?${key}["']?)\\s*:\\s*\\[([^\\]]{0,4000})\\]`, 'i'))
    return match ? [...match[1].matchAll(/["']([^"'\n]{1,160})["']/g)].map(item => item[1]) : []
  }
  return normalizeMockReferenceContract({
    contractId: quoted('contractId'),
    targetId: quoted('targetId') || quoted('target'),
    requiredScreens: array('screens'),
    requiredPatterns: array('implementedPatterns'),
    requiredStates: array('implementedStates'),
    depthSignals: array('depthSignals'),
    feedbackSignals: array('feedbackSignals')
  })
}

function extractMockReferenceContract(prompt) {
  return parseContractJsonBlocks(prompt) || parseReferenceMetaExample(prompt)
}

function referenceMachineSignals(contract) {
  if (!contract?.raw) return { tokens: [], renderers: [] }
  const strings = []
  const visit = value => {
    if (typeof value === 'string') strings.push(value)
    else if (Array.isArray(value)) value.slice(0, 40).forEach(visit)
    else if (value && typeof value === 'object') {
      ;['qaSignals', 'implementationSignals', 'codeSignals', 'signals', 'tokens', 'implementationCue', 'verify'].forEach(key => visit(value[key]))
      const type = compactReferenceId(value.type || value.kind)
      const signal = value.value || value.name || value.token || value.renderer
      if (signal && ['renderer', 'token', 'state', 'draw'].includes(type)) strings.push(`${type}:${signal}`)
    }
  }
  const implementedPatterns = new Set(contract.implementedPatterns || [])
  const requiredPatternItems = referenceList(contract.raw.patterns).filter(item => implementedPatterns.has(compactReferenceId(item?.id || item)))
  visit(requiredPatternItems); visit(contract.raw.requiredStates)
  visit(contract.raw.qa?.requiredStates); visit(contract.raw.qa?.depthSignals); visit(contract.raw.qa?.feedbackSignals)
  const reservedRenderers = new Set(['drawPanel', 'drawFarLayer', 'drawMidLayer', 'drawNearLayer', 'drawShadow', 'drawTitle', 'drawHelp', 'drawParty', 'drawCodex', 'drawOverlayScreen', 'drawGameplay', 'drawResult', 'renderGameplay'])
  const renderers = [...new Set(strings.map(signal => String(signal).match(/^renderer:([A-Za-z_$][\w$]{0,80})$/i)?.[1])
    .filter(name => name && !reservedRenderers.has(name)))].slice(0, 12)
  const tokens = [...new Set(strings.filter(signal => /^(?:token|state|draw):/i.test(String(signal))))].slice(0, 24)
  return { tokens, renderers }
}

const foldVisibleTitleTerm = value => String(value || '').normalize('NFKD')
  .replace(/\p{M}/gu, '').normalize('NFC').toLowerCase().replace(/[^a-z0-9가-힣]+/g, '')

function mockTitleForbiddenTerms(contract) {
  const raw = contract?.raw || {}
  const originality = raw.originality && typeof raw.originality === 'object' ? raw.originality : {}
  const explicit = referenceList(
    originality.forbiddenVisibleTerms || raw.forbiddenVisibleTerms || raw.qa?.forbiddenVisibleTerms
  ).filter(value => typeof value === 'string')
  const targetTitle = String(raw.target?.title || raw.targetTitle || '')
  const targetParts = targetTitle.match(/[\p{L}\p{N}]{2,}/gu) || []
  return [...new Set([...explicit, targetTitle, ...targetParts]
    .map(foldVisibleTitleTerm).filter(term => /[가-힣]/.test(term) ? term.length >= 2 : term.length >= 3))]
}

function stripReferenceComparison(value) {
  return String(value || '')
    // Up to three words before Korean comparison markers, including attached forms (X처럼/X같은).
    .replace(/(?:^|[\s"'“”])(?:[^\s,.;!?]+\s+){0,2}[^\s,.;!?]+?\s*(?:처럼|같은|같이)(?=$|[\s,.;!?])/gi, ' ')
    .replace(/\b(?:inspired\s+by|like)\s+[\p{L}\p{N}_.:-]+(?:\s+[\p{L}\p{N}_.:-]+){0,2}/giu, ' ')
    .replace(/\b[\p{L}\p{N}_.:-]+(?:-inspired|-like)\b/giu, ' ')
    .replace(/\s+/g, ' ').trim()
}

function normalizeTitleToken(value) {
  let token = String(value || '').trim()
  const suffixes = [
    '으로부터', '에게서', '에서', '에게', '으로', '처럼', '같은', '같이',
    '합니다', '하세요', '해줘', '해요', '하며', '하고', '해서', '하는', '한다', '하여',
    '께서', '까지', '부터', '와', '과', '을', '를', '은', '는', '의', '에', '도', '만', '가', '이'
  ]
  for (const suffix of suffixes) {
    if (token.endsWith(suffix) && Array.from(token.slice(0, -suffix.length)).length >= 2) {
      token = token.slice(0, -suffix.length)
      break
    }
  }
  return token
}

function originalMockTitle(prompt, fallbackKeywords, contract, seed) {
  const agenda = agendaText(prompt) || String(prompt || '').slice(0, 240)
  const forbidden = mockTitleForbiddenTerms(contract)
  const withoutComparison = stripReferenceComparison(agenda)
  const agendaFolded = foldVisibleTitleTerm(agenda)
  const hadReferenceCue = withoutComparison !== agenda.trim() || forbidden.some(term => agendaFolded.includes(term))
  const legacyAgendaTitle = referenceList(fallbackKeywords).slice(0, 2).join(' ').trim()
  if (!hadReferenceCue && !forbidden.length && legacyAgendaTitle) return legacyAgendaTitle.slice(0, 28)
  const stop = new Set([
    '게임', '제작', '신규', '회의', '레퍼런스', '기반', '스타일', '느낌', '구성',
    '만들', '진행', '플레이', '적용', '참고', '요청', '모으', '오가', '되게'
  ])
  const sourceTokens = withoutComparison.match(/[\p{L}\p{N}]{2,}/gu) || fallbackKeywords || []
  const tokens = [...new Set(sourceTokens.map(normalizeTitleToken).filter(token => {
    const folded = foldVisibleTitleTerm(token)
    if (Array.from(token).length < 2 || stop.has(token) || !folded) return false
    return !forbidden.some(term => folded.includes(term) || term === folded)
  }))]
  const accents = ['원정대', '작전', '탐사록', '항해단', '야행', '대소동', '프론티어', '퀘스트']
    .filter(word => !forbidden.some(term => foldVisibleTitleTerm(word).includes(term)))
  const safePool = ['별빛', '바람', '네온', '비밀', '픽셀'].filter(word =>
    !forbidden.some(term => foldVisibleTitleTerm(word).includes(term)))
  const primary = tokens[0] || pick(safePool.length ? safePool : ['아케이드'], seed)
  const secondary = hadReferenceCue
    ? pick(accents.length ? accents : ['모험'], seed + 17)
    : (tokens[1] || pick(accents.length ? accents : ['모험'], seed + 17))
  return [primary, secondary].filter(Boolean).map(token => Array.from(token).slice(0, 12).join('')).join(' ').slice(0, 28)
}

// ---------- mock game template (파라미터화된 캐처 게임) ----------
export function mockGameCode({ title = '별똥별 받기', theme = '#ffd24a', bad = '#ff5a7a', item = '★', collection = false, referenceContract = null } = {}) {
  const reference = normalizeMockReferenceContract(referenceContract)
  const contractScreens = reference?.screens || []
  const baselineScreens = collection
    ? ['title', 'gameplay', 'result', 'party', 'codex']
    : ['title', 'gameplay', 'result', 'help']
  const visualScreens = [...new Set([...baselineScreens, ...contractScreens])]
  const contractAuxScreens = contractScreens.filter(screen => !['title', 'gameplay', 'result'].includes(screen))
  const baselineTargets = collection ? ['gameplay', 'party', 'codex'] : ['gameplay', 'help']
  const titleTargets = reference ? ['gameplay', ...contractAuxScreens] : baselineTargets
  if (reference && titleTargets.length === 1) titleTargets.push('help')
  const titleOptions = titleTargets.map(screen => screen === 'gameplay' ? 'START RUN' : screen.replace(/-/g, ' ').toUpperCase().slice(0, 160))
  const referenceSignals = referenceMachineSignals(reference)
  const referenceRendererCode = referenceSignals.renderers.map((name, index) =>
    `    function ${name}() { drawReferenceSignalBadge(${JSON.stringify(name.replace(/^draw/i, '').toUpperCase().slice(0, 16) || 'REFERENCE')}, ${index}) }`
  ).join('\n')
  const referenceRendererNames = referenceSignals.renderers.join(', ')
  const referenceMeta = reference ? `,\n    reference: ${JSON.stringify({
    contractId: reference.contractId,
    targetId: reference.targetId,
    screens: reference.screens,
    implementedPatterns: reference.implementedPatterns,
    implementedStates: reference.implementedStates,
    depthSignals: reference.depthSignals,
    feedbackSignals: reference.feedbackSignals
  }, null, 6).replace(/^/gm, '    ').trimStart()}` : ''
  return `// ${title} — DOTCADE mock 생성 게임 (LLM 모의 모드)
window.game = {
  meta: {
    title: ${JSON.stringify(title)},
    desc: '별빛 정원을 달리며 빛 조각을 모으고 운석을 피하는 2.5D 캐처',
    controls: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Escape'],
    viewport: { w: 480, h: 320 },
    visual: {
      aspect: '3:2',
      depthLayers: ['far', 'mid', 'near'],
      perspective: true,
      screens: ${JSON.stringify(visualScreens)}
    }${referenceMeta}
  },
  _raf: 0,
  start(canvas, api) {
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const rng = api.rng
    const horizon = 112
    const keys = {}
    const collectionMode = ${collection ? 'true' : 'false'}
    const referenceMode = ${reference ? 'true' : 'false'}
    const titleOptions = ${JSON.stringify(titleOptions)}
    const titleTargets = ${JSON.stringify(titleTargets)}
    const auxiliaryScreens = ${JSON.stringify(visualScreens.filter(screen => !['title', 'gameplay', 'result'].includes(screen)))}
    const referenceSemanticTokens = ${JSON.stringify(reference ? {
      patterns: reference.implementedPatterns,
      states: reference.implementedStates,
      depth: reference.depthSignals,
      feedback: reference.feedbackSignals,
      implementation: referenceSignals.tokens
    } : { patterns: [], states: [], depth: [], feedback: [], implementation: [] })}
    const scenery = Array.from({ length: 18 }, (_, i) => ({
      x: (i * 83 + 29) % W,
      y: 17 + (i * 47) % 78,
      size: i % 5 === 0 ? 3 : 2,
      phase: i * 0.71
    }))
    let screen = 'title', menuIndex = 0, selectedIndex = 0, lastScreenEmitted = ''
    let px = W / 2, items = [], particles = []
    let score = 0, lives = 3, t = 0, playFrames = 0, shake = 0, overReported = false
    let inputFlash = 0, feedbackTimer = 0, stateTimer = 0, battleReady = true

    const emitScreen = (id, reason, from = null) => {
      if (!id || id === lastScreenEmitted) return
      api.emit && api.emit('screen', { id, from, reason })
      lastScreenEmitted = id
    }
    const setScreen = (next, reason) => {
      if (!next || next === screen) return
      const from = screen
      screen = next
      emitScreen(next, reason || 'transition', from)
    }
    const returnToTitle = reason => {
      menuIndex = selectedIndex = 0
      setScreen('title', reason || 'back')
    }
    const resetRun = () => {
      px = W / 2; items = []; particles = []; score = 0; lives = 3
      playFrames = 0; shake = 0; overReported = false; setScreen('gameplay', 'start-run')
      api.reportScore(0)
      api.emit && api.emit('restart', { label: 'new-run' })
    }
    const kd = e => {
      if (keys[e.code]) return
      keys[e.code] = true
      inputFlash = 8; feedbackTimer = 14; stateTimer = 18
      if (screen === 'title') {
        if (e.code === 'ArrowUp') menuIndex = selectedIndex = (menuIndex + titleOptions.length - 1) % titleOptions.length
        if (e.code === 'ArrowDown') menuIndex = selectedIndex = (menuIndex + 1) % titleOptions.length
        if (e.code === 'Space') {
          if (menuIndex === 0) resetRun()
          else if (referenceMode) setScreen(titleTargets[menuIndex], 'menu-confirm')
          else if (collectionMode) setScreen(menuIndex === 1 ? 'party' : 'codex', 'menu-confirm')
          else setScreen('help', 'menu-confirm')
        }
      } else if (auxiliaryScreens.includes(screen) && (e.code === 'Space' || e.code === 'Escape')) {
        returnToTitle(e.code === 'Escape' ? 'escape' : 'back')
      } else if (screen === 'result' && e.code === 'Space') {
        resetRun()
      }
    }
    const ku = e => { keys[e.code] = false }
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku)
    this._cleanup = () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }

    const depthScale = y => 0.62 + Math.max(0, Math.min(1, (y - horizon) / (H - horizon))) * 0.54
    const spawn = () => items.push({
      x: 28 + rng() * (W - 56), y: horizon - 8,
      v: 0.72 + rng() * 0.72 + playFrames / 7200,
      bad: rng() < 0.27, sway: rng() * Math.PI * 2
    })
    const burst = (x, y, color) => {
      for (let i = 0; i < 8; i++) {
        const angle = i / 8 * Math.PI * 2
        particles.push({ x, y, vx: Math.cos(angle) * 1.8, vy: Math.sin(angle) * 1.8, life: 20, color })
      }
    }

    function drawPanel(x, y, w, h, active = false) {
      ctx.fillStyle = 'rgba(4,8,20,.38)'; ctx.fillRect(x + 3, y + 4, w, h)
      ctx.fillStyle = active ? 'rgba(39,58,91,.96)' : 'rgba(12,20,42,.92)'; ctx.fillRect(x, y, w, h)
      ctx.strokeStyle = active ? ${JSON.stringify(theme)} : '#526485'; ctx.lineWidth = active ? 2 : 1; ctx.strokeRect(x, y, w, h)
    }

    function textLinesByWidth(value, maxWidth) {
      const text = String(value == null ? '' : value).replace(/\\s+/g, ' ').trim()
      if (!text) return ['']
      const lines = []
      let line = ''
      for (const word of text.split(' ')) {
        const candidate = line ? line + ' ' + word : word
        if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue }
        if (line) { lines.push(line); line = '' }
        if (ctx.measureText(word).width <= maxWidth) { line = word; continue }
        let chunk = ''
        for (const glyph of Array.from(word)) {
          const next = chunk + glyph
          if (chunk && ctx.measureText(next).width > maxWidth) { lines.push(chunk); chunk = glyph }
          else if (!chunk && ctx.measureText(glyph).width > maxWidth) { lines.push(glyph) }
          else chunk = next
        }
        line = chunk
      }
      if (line || !lines.length) lines.push(line)
      return lines
    }

    function ellipsisToWidth(value, maxWidth) {
      const text = String(value == null ? '' : value).trim()
      if (ctx.measureText(text).width <= maxWidth) return text
      const ellipsis = '…'
      if (ctx.measureText(ellipsis).width > maxWidth) return ''
      const glyphs = Array.from(text)
      while (glyphs.length && ctx.measureText(glyphs.join('') + ellipsis).width > maxWidth) glyphs.pop()
      return glyphs.join('').trimEnd() + ellipsis
    }

    function fitTextBlock(value, maxWidth, maxHeight, options = {}) {
      const maxLines = Math.max(1, options.maxLines || 1)
      const maxFont = Math.max(8, options.maxFont || 20)
      const minFont = Math.min(maxFont, Math.max(8, options.minFont || 10))
      const weight = options.weight || 'bold'
      const family = options.family || 'monospace'
      for (let size = maxFont; size >= minFont; size--) {
        ctx.font = weight + ' ' + size + 'px ' + family
        const lines = textLinesByWidth(value, maxWidth)
        const lineHeight = Math.ceil(size * 1.08)
        if (lines.length <= maxLines && lines.length * lineHeight <= maxHeight) return { lines, size, lineHeight, weight, family }
      }
      ctx.font = weight + ' ' + minFont + 'px ' + family
      const lineHeight = Math.ceil(minFont * 1.08)
      const visibleCount = Math.max(1, Math.min(maxLines, Math.floor(maxHeight / lineHeight) || 1))
      const allLines = textLinesByWidth(value, maxWidth)
      const lines = allLines.slice(0, visibleCount)
      if (allLines.length > visibleCount) {
        lines[visibleCount - 1] = ellipsisToWidth(allLines.slice(visibleCount - 1).join(' '), maxWidth)
      }
      return { lines, size: minFont, lineHeight, weight, family }
    }

    function drawFittedText(value, x, y, maxWidth, maxHeight, options = {}) {
      ctx.save()
      const layout = fitTextBlock(value, maxWidth, maxHeight, options)
      ctx.font = layout.weight + ' ' + layout.size + 'px ' + layout.family
      ctx.textAlign = options.align || 'center'; ctx.textBaseline = 'middle'
      const totalHeight = layout.lines.length * layout.lineHeight
      const firstY = y + (maxHeight - totalHeight) / 2 + layout.lineHeight / 2
      layout.lines.forEach((line, index) => ctx.fillText(line, x, firstY + index * layout.lineHeight, maxWidth))
      ctx.restore()
      return layout
    }

    function drawFarLayer(frame) {
      const sky = ctx.createLinearGradient(0, 0, 0, horizon + 42)
      sky.addColorStop(0, '#0b1530'); sky.addColorStop(.55, '#263c65'); sky.addColorStop(1, '#806078')
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H)
      const moon = ctx.createRadialGradient(389, 54, 2, 389, 54, 44)
      moon.addColorStop(0, 'rgba(255,242,178,.95)'); moon.addColorStop(.28, 'rgba(255,203,130,.32)'); moon.addColorStop(1, 'rgba(255,190,100,0)')
      ctx.fillStyle = moon; ctx.fillRect(340, 5, 98, 98)
      ctx.fillStyle = '#ffe9ab'; ctx.beginPath(); ctx.arc(389, 54, 10, 0, Math.PI * 2); ctx.fill()
      for (const star of scenery) {
        const glow = .55 + Math.sin(frame * .025 + star.phase) * .35
        ctx.fillStyle = 'rgba(190,220,255,' + glow.toFixed(2) + ')'
        ctx.fillRect(star.x, star.y, star.size, star.size)
      }
      ctx.fillStyle = '#253955'; ctx.beginPath(); ctx.moveTo(0, 135); ctx.lineTo(72, 72); ctx.lineTo(139, 127); ctx.lineTo(216, 57); ctx.lineTo(303, 130); ctx.lineTo(389, 79); ctx.lineTo(W, 136); ctx.lineTo(W, 164); ctx.lineTo(0, 164); ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#182d47'; ctx.beginPath(); ctx.moveTo(0, 148); ctx.lineTo(92, 104); ctx.lineTo(166, 142); ctx.lineTo(248, 92); ctx.lineTo(331, 146); ctx.lineTo(423, 102); ctx.lineTo(W, 141); ctx.lineTo(W, 171); ctx.lineTo(0, 171); ctx.closePath(); ctx.fill()
    }

    function drawMidLayer(frame) {
      const ground = ctx.createLinearGradient(0, horizon, 0, H)
      ground.addColorStop(0, '#315754'); ground.addColorStop(.48, '#1f4547'); ground.addColorStop(1, '#102838')
      ctx.fillStyle = ground; ctx.fillRect(0, horizon, W, H - horizon)
      ctx.strokeStyle = 'rgba(140,230,210,.14)'; ctx.lineWidth = 1
      for (let x = -100; x <= W + 100; x += 76) { ctx.beginPath(); ctx.moveTo(W / 2, horizon); ctx.lineTo(x, H); ctx.stroke() }
      ;[126, 143, 165, 194, 231, 276].forEach(y => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() })
      ctx.fillStyle = '#173a3e'
      for (let i = 0; i < 11; i++) {
        const y = 128 + (i % 3) * 10, scale = depthScale(y)
        const x = i * 49 - 18
        ctx.fillRect(x, y - 18 * scale, 10 * scale, 19 * scale)
        ctx.fillRect(x - 5 * scale, y - 12 * scale, 20 * scale, 4 * scale)
      }
    }

    function drawNearLayer(frame) {
      ctx.fillStyle = '#071824'
      for (let i = 0; i < 8; i++) {
        const h = 18 + (i % 3) * 10
        ctx.fillRect(i * 12, H - h, 5, h); ctx.fillRect(W - i * 12 - 5, H - h, 5, h)
      }
      const shade = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 310)
      shade.addColorStop(0, 'rgba(2,6,16,0)'); shade.addColorStop(1, 'rgba(2,6,16,.46)')
      ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H)
    }

    function drawShadow(x, y, scale = 1) {
      ctx.fillStyle = 'rgba(2,7,16,.38)'; ctx.beginPath(); ctx.ellipse(x, y, 22 * scale, 6 * scale, 0, 0, Math.PI * 2); ctx.fill()
    }

    function drawTitle() {
      drawPanel(103, 46, 274, 224, true)
      ctx.fillStyle = ${JSON.stringify(theme)}
      drawFittedText(${JSON.stringify(title)}, W / 2, 57, 238, 45, { maxLines: 2, maxFont: 27, minFont: 13 })
      ctx.textAlign = 'center'
      ctx.fillStyle = '#a9bad8'; ctx.font = '11px monospace'; ctx.fillText('STAR GARDEN · NIGHT SHIFT', W / 2, 113)
      titleOptions.forEach((label, i) => {
        const compactMenu = titleOptions.length > 3
        const rowH = compactMenu ? Math.max(18, Math.floor(116 / titleOptions.length)) : (titleOptions.length > 2 ? 29 : 34)
        const menuY = compactMenu ? 121 + i * (rowH + 2) : (titleOptions.length > 2 ? 128 + i * 37 : 139 + i * 47)
        drawPanel(151, menuY, 178, rowH, menuIndex === i)
        ctx.fillStyle = menuIndex === i ? '#fff' : '#91a2c2'
        drawFittedText(label, W / 2, menuY + 2, 158, rowH - 4, { maxLines: 1, maxFont: compactMenu ? 10 : 13, minFont: 8 })
      })
      ctx.fillStyle = '#7889aa'; ctx.font = '10px monospace'; ctx.fillText('↑↓ SELECT  ·  SPACE CONFIRM', W / 2, 253); ctx.textAlign = 'left'
    }

    function drawHelp() {
      drawPanel(75, 48, 330, 224, true)
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 20px monospace'; ctx.fillText('FIELD GUIDE', W / 2, 88)
      ctx.fillStyle = ${JSON.stringify(theme)}; ctx.font = 'bold 13px monospace'; ctx.fillText(${JSON.stringify(item)} + '  STAR SHARD  +10', W / 2, 128)
      ctx.fillStyle = ${JSON.stringify(bad)}; ctx.fillText('◆  METEOR  LIFE -1', W / 2, 158)
      ctx.fillStyle = '#bdc9df'; ctx.font = '12px monospace'; ctx.fillText('← → 이동 · 가까울수록 오브젝트가 커집니다', W / 2, 198)
      ctx.fillStyle = '#7de0c0'; ctx.font = 'bold 12px monospace'; ctx.fillText('SPACE  BACK', W / 2, 240); ctx.textAlign = 'left'
    }

    function drawParty() {
      drawPanel(68, 43, 344, 234, true)
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 20px monospace'; ctx.fillText('PARTY STATUS', W / 2, 78)
      const cards = [
        { name: 'GARDENER', role: 'CATCH', color: '#7de0c0' },
        { name: 'LANTERN', role: 'LIGHT', color: ${JSON.stringify(theme)} },
        { name: 'SHIELD', role: 'GUARD', color: '#7da9ef' }
      ]
      cards.forEach((card, i) => {
        const x = 93 + i * 101; drawPanel(x, 105, 88, 91, i === 0)
        ctx.fillStyle = card.color; ctx.beginPath(); ctx.arc(x + 44, 132, 13, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px monospace'; ctx.fillText(card.name, x + 44, 164)
        ctx.fillStyle = '#8192b1'; ctx.font = '9px monospace'; ctx.fillText(card.role, x + 44, 181)
      })
      ctx.fillStyle = '#7de0c0'; ctx.font = 'bold 12px monospace'; ctx.fillText('SPACE  BACK', W / 2, 244); ctx.textAlign = 'left'
    }

    function drawCodex() {
      drawPanel(73, 45, 334, 230, true)
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 20px monospace'; ctx.fillText('FIELD CODEX', W / 2, 80)
      const entries = [
        { glyph: ${JSON.stringify(item)}, name: 'STAR SHARD', note: 'SAFE · +10', color: ${JSON.stringify(theme)} },
        { glyph: '◆', name: 'METEOR', note: 'DANGER · -1 LIFE', color: ${JSON.stringify(bad)} }
      ]
      entries.forEach((entry, i) => {
        const y = 106 + i * 62; drawPanel(104, y, 272, 48, false)
        ctx.fillStyle = entry.color; ctx.font = 'bold 20px monospace'; ctx.fillText(entry.glyph, 135, y + 30)
        ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = 'bold 11px monospace'; ctx.fillText(entry.name, 165, y + 20)
        ctx.fillStyle = '#8495b4'; ctx.font = '9px monospace'; ctx.fillText(entry.note, 165, y + 35); ctx.textAlign = 'center'
      })
      ctx.fillStyle = '#7de0c0'; ctx.font = 'bold 12px monospace'; ctx.fillText('SPACE  BACK', W / 2, 252); ctx.textAlign = 'left'
    }

    function drawReferenceSignalBadge(label, index) {
      const x = 91 + (index % 3) * 103, y = 190 + Math.floor(index / 3) * 18
      ctx.fillStyle = index === selectedIndex ? ${JSON.stringify(theme)} : '#617291'
      ctx.fillRect(x, y, 5, 5)
      ctx.fillStyle = '#91a2c2'; ctx.font = '8px monospace'; ctx.fillText(label, x + 9, y + 6)
    }
${referenceRendererCode || '    // No contract-specific named renderer signals were requested.'}

    function drawOverlayScreen(screenId) {
      drawPanel(66, 42, 348, 236, true)
      ctx.fillStyle = '#fff'
      drawFittedText(String(screenId).replace(/-/g, ' ').toUpperCase(), W / 2, 61, 300, 27, { maxLines: 1, maxFont: 20, minFont: 10 })
      ctx.textAlign = 'center'
      ctx.fillStyle = '#8495b4'; ctx.font = '10px monospace'
      ctx.fillText('REFERENCE FLOW · ORIGINAL DOTCADE LAYOUT', W / 2, 99)
      const cards = referenceSemanticTokens.patterns.slice(0, 6)
      cards.forEach((token, i) => {
        const col = i % 2, row = Math.floor(i / 2), x = 91 + col * 153, y = 117 + row * 39
        drawPanel(x, y, 145, 31, i === selectedIndex % Math.max(1, cards.length))
        ctx.fillStyle = i === selectedIndex % Math.max(1, cards.length) ? ${JSON.stringify(theme)} : '#a7b5ce'
        ctx.font = 'bold 9px monospace'; ctx.fillText(String(token).toUpperCase().slice(0, 19), x + 72, y + 20)
      })
      const contractRenderers = [${referenceRendererNames}]
      contractRenderers.slice(0, 3).forEach(renderer => renderer())
      ctx.fillStyle = inputFlash > 0 ? '#fff' : '#7de0c0'; ctx.font = 'bold 12px monospace'
      ctx.fillText('SPACE  BACK', W / 2, 253); ctx.textAlign = 'left'
    }

    function drawGameplay() {
      drawPanel(12, 10, 145, 32); drawPanel(W - 108, 10, 96, 32)
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px monospace'; ctx.fillText('SCORE ' + score, 23, 31)
      ctx.fillStyle = '#ff8198'; ctx.fillText('♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, 3 - lives)), W - 94, 31)
      ctx.fillStyle = '#91a2c2'; ctx.font = '10px monospace'; ctx.fillText('← → MOVE', 17, H - 17)
    }

    function drawResult() {
      drawPanel(104, 61, 272, 194, true)
      ctx.textAlign = 'center'; ctx.fillStyle = ${JSON.stringify(bad)}; ctx.font = 'bold 25px monospace'; ctx.fillText('MISSION OVER', W / 2, 105)
      ctx.fillStyle = '#fff'; ctx.font = 'bold 22px monospace'; ctx.fillText('SCORE ' + score, W / 2, 151)
      ctx.fillStyle = '#91a3c2'; ctx.font = '11px monospace'; ctx.fillText('별빛 정원 탐사 기록이 저장되었습니다', W / 2, 182)
      ctx.fillStyle = ${JSON.stringify(theme)}; ctx.font = 'bold 12px monospace'; ctx.fillText('SPACE  RETRY', W / 2, 226); ctx.textAlign = 'left'
    }

    function updateGameplay() {
      playFrames++
      if (playFrames % Math.max(22, 46 - (playFrames >> 9)) === 0) spawn()
      if (keys.ArrowLeft) px -= 4.2
      if (keys.ArrowRight) px += 4.2
      px = Math.max(24, Math.min(W - 24, px))
      for (const it of items) { it.y += it.v; it.x += Math.sin(playFrames * .025 + it.sway) * .18 }
      for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += .035; p.life-- }
      particles = particles.filter(p => p.life > 0)
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]
        if (it.y > H - 55 && it.y < H - 20 && Math.abs(it.x - px) < 27) {
          if (it.bad) {
            lives--; shake = 9; burst(it.x, it.y, ${JSON.stringify(bad)})
            api.emit && api.emit('hit', { value: -1, label: 'meteor', lives })
          } else {
            score += 10; burst(it.x, it.y, ${JSON.stringify(theme)}); api.reportScore(score)
            api.emit && api.emit('collect', { reward: 10, label: 'star-shard', score })
          }
          items.splice(i, 1)
        } else if (it.y > H - 18) items.splice(i, 1)
      }
      if (playFrames % 30 === 0) { score += 1; api.reportScore(score) }
      if (playFrames % 12 === 0 && api.observe) {
        const sorted = items.slice().sort((a, b) => b.y - a.y)
        const threat = sorted.find(it => it.bad), reward = sorted.find(it => !it.bad)
        const danger = !!(threat && threat.y > H - 135 && Math.abs(threat.x - px) < 62)
        const target = danger ? threat : reward
        const goLeft = target ? (danger ? target.x > px : target.x < px) : px > W / 2
        api.observe({
          suggestedActions: [goLeft ? 'ArrowLeft' : 'ArrowRight'],
          avoidActions: danger ? [goLeft ? 'ArrowRight' : 'ArrowLeft'] : [],
          danger: danger ? Math.min(1, threat.y / H) : 0,
          progress: Math.min(1, playFrames / 2400),
          state: danger ? 'danger' : 'collect'
        })
      }
      if (lives <= 0) setScreen('result', 'lives-depleted')
    }

    function renderGameplay() {
      const ordered = items.slice().sort((a, b) => a.y - b.y)
      for (const it of ordered) {
        const scale = depthScale(it.y)
        drawShadow(it.x, it.y + 7 * scale, scale * .56)
        ctx.save(); ctx.translate(it.x, it.y); ctx.scale(scale, scale)
        if (it.bad) {
          ctx.fillStyle = ${JSON.stringify(bad)}; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = '#ffb0bd'; ctx.fillRect(-3, -4, 4, 3)
        } else {
          ctx.fillStyle = ${JSON.stringify(theme)}; ctx.font = 'bold 17px monospace'; ctx.textAlign = 'center'; ctx.fillText(${JSON.stringify(item)}, 0, 6); ctx.textAlign = 'left'
        }
        ctx.restore()
      }
      drawShadow(px, H - 21, 1)
      ctx.fillStyle = '#7de0c0'; ctx.fillRect(px - 18, H - 39, 36, 17)
      ctx.fillStyle = '#439f91'; ctx.fillRect(px - 12, H - 47, 24, 10)
      ctx.fillStyle = '#e8ffff'; ctx.fillRect(px + 5, H - 43, 5, 4)
      for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life / 20); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3) }
      ctx.globalAlpha = 1
      drawGameplay()
    }

    const loop = () => {
      t++
      emitScreen(screen, 'initial', null)
      if (inputFlash > 0) inputFlash--
      if (feedbackTimer > 0) feedbackTimer--
      if (stateTimer > 0) stateTimer--
      battleReady = screen === 'gameplay' && stateTimer === 0
      if (screen === 'gameplay') updateGameplay()
      const sx = shake > 0 ? Math.sin(t * 5.3) * shake * .45 : 0
      if (shake > 0) shake--
      ctx.save(); ctx.translate(sx, 0)
      drawFarLayer(t); drawMidLayer(t)
      if (screen === 'title') drawTitle()
      else if (screen === 'help') drawHelp()
      else if (screen === 'party') drawParty()
      else if (screen === 'codex') drawCodex()
      else if (screen === 'result') drawResult()
      else if (auxiliaryScreens.includes(screen)) drawOverlayScreen(screen)
      else renderGameplay()
      drawNearLayer(t); ctx.restore()
      if (screen === 'result' && !overReported) {
        overReported = true; api.emit && api.emit('death', { label: 'mission-over', score }); api.gameOver(score)
      }
      this._raf = requestAnimationFrame(loop)
    }
    loop()
  },
  stop() { cancelAnimationFrame(this._raf); this._cleanup && this._cleanup() }
}`
}

// ---------- per-hint mock text ----------
function mockText({ hint = 'chat', system = '', user = '', messages = [], personaMeta = {} }) {
  // 실제 provider와 마찬가지로 messages를 프롬프트 본문으로 취급한다.
  // 이전 구현은 user만 읽어 프론트의 모든 생성/평가 요청이 페르소나별 고정 응답에 가까웠다.
  const prompt = [user, messageText(messages)].filter(Boolean).join('\n')
  const seed = hash(prompt + system)
  const kws = keywords(prompt)
  const kw = kws[0] || '게임'
  const referenceContract = extractMockReferenceContract(prompt)
  // 전체 prompt에는 공통 비주얼 계약의 "몬스터 수집형" 예시가 항상 들어갈 수 있다.
  // 실제 안건 또는 수리 대상 meta만 보고 분류해 일반 게임이 collection UI로 오염되지 않게 한다.
  const agendaFocus = agendaText(prompt)
  const existingCollectionMeta = /screens\s*:\s*\[[^\]]*['"]party['"][^\]]*['"]codex['"]/i.test(prompt)
  const requiredCollectionRepair = /meta\.visual\.screens[^\n]{0,160}party\/codex/i.test(prompt)
  const collectionGame = /포켓몬|몬스터|생물\s*수집|캐릭터\s*수집|도감|creature\s*collection|monster\s*collection/i.test(agendaFocus) ||
    existingCollectionMeta || requiredCollectionRepair ||
    (referenceContract?.screens.includes('party') && referenceContract?.screens.includes('codex'))
  const gameTitle = originalMockTitle(prompt, kws, referenceContract, seed)
  const name = personaMeta.name || (system.match(/이름[:은]?\s*([가-힣]{2,4})/) || [])[1] || '팀원'

  switch (hint) {
    case 'research':
      return `[${name}의 조사 메모]\n- '${kw}' 관련 최근 트렌드: 짧은 세션(30~60초)과 즉각적 피드백이 핵심.\n- 유사 도트 게임 사례: 단순 조작(1~2키) + 점진적 난이도 상승 조합이 평이 좋음.\n- 과거 우리 게임 피드백 참고: 조작감·타격감 관련 지적이 반복됨 → 이번엔 초기 반응속도에 신경 쓸 것.\n- 제안 키워드: ${kws.slice(0, 3).join(', ') || '아케이드, 하이스코어'}`
    case 'debate':
      return pick([
        `'${kw}' 컨셉 좋다고 생각해요. 다만 조작은 두 개 키 이내로 줄여야 오락실 손님들이 바로 붙을 수 있어요. 첫 3초 안에 규칙이 이해되게 갑시다.`,
        `저는 난이도 곡선이 걱정돼요. 초반 10초는 실패가 거의 없게 하고, 이후부터 가속을 붙이는 방식을 제안합니다. 점수는 콤보 보너스로 차별화하고요.`,
        `비주얼은 3색 팔레트로 제한하는 게 도트 감성에 맞아요. ${kw} 모티프를 픽셀 심볼로 단순화하면 화면이 훨씬 정리될 겁니다.`,
        `스코프 조심해요. 이번 버전은 핵심 루프 하나만: 피하고-먹고-점수. 파워업은 다음 버전 백로그로 넘기죠.`,
        `하이스코어 도전 욕구가 생기려면 죽는 순간이 억울하면 안 돼요. 히트박스는 보이는 것보다 살짝 작게 잡읍시다.`
      ], seed + (personaMeta.idx || 0))
    case 'concept':
      return `핵심 한 줄: "${kw}"를 소재로 한 원버튼/투버튼 하이스코어 아케이드.\n루프: 조작→위험 회피/아이템 획득→점수 상승→가속.\n차별점: 콤보 배수와 마지막 순간 회피 보너스.`
    case 'prd':
      return `# PRD — ${kw} 게임\n\n## 목표\n30초~2분 세션의 하이스코어 도트 아케이드.\n\n## 핵심 루프\n1. 좌우 조작으로 위험 회피\n2. 아이템 획득 시 +10점\n3. 시간에 따라 낙하 속도 가속\n\n## 조작\nArrowLeft / ArrowRight / ArrowUp / ArrowDown / Space\n\n## 화면 흐름\ntitle → gameplay → result, title에서 ${collectionGame ? 'party/codex' : 'help'} 조회.\n\n## 실패 조건\n라이프 3 소진 시 게임 오버 → 최종 점수\n\n## 성공 기준\n- 첫 플레이 10초 내 규칙 이해\n- 평균 세션 45초 이상\n- 조작 입력 지연 체감 없음`
    case 'design':
      return `# 아트/UX 스펙\n\n## 팔레트\n원경 #0b1530 / 중경 #315754 / 전경 #071824 / 주인공 #7de0c0 / 아이템 #ffd24a / 위험 #ff5a7a / UI #ffffff\n\n## 화면 구성\n480×320(3:2). 12px safe area, 상단 32px HUD, 중앙 원근 플레이필드.\n\n## 2.5D 깊이\nfar의 달·산, mid의 소실점 그리드, near의 큰 풀과 비네트. y가 커질수록 0.62→1.16 스케일, 타원형 접지 그림자.\n\n## 화면별 UI\ntitle/gameplay/result/${collectionGame ? 'party/codex' : 'help'}, 공통 이중 패널과 선택 테두리 사용.\n\n## 연출\n피격 셰이크, 획득 파티클, 그라디언트 달빛, 결과 점수 강조.`
    case 'arch':
      return `# 기술 설계\n\n- 단일 rAF 루프, screen 상태와 items[], particles[], player, score, lives\n- 렌더: drawFarLayer → drawMidLayer → y-sort 오브젝트/접지 그림자 → drawNearLayer → 화면 UI\n- 충돌: AABB, 시각 크기의 약 80%\n- 난이도: 스폰 간격 46f→22f, 낙하속도 playFrames/7200 가속\n- api.rng는 스폰 때만 사용하고 렌더는 sin/cos로 재현\n- reportScore 즉시 호출, gameOver 1회 보장, stop에서 리스너 해제`
    case 'review':
      return pick([
        `PRD 확인했습니다. 콤보 규칙만 명확히 하면 바로 구현 가능해 보여요. 승인 의견입니다.`,
        `히트박스 축소(시각 대비 80%)만 아키텍처에 반영해 주세요. 나머지는 동의합니다.`,
        `모바일 터치 대응은 하네스가 처리하니 게임 코드는 키보드만 신경 쓰면 됩니다. 진행하죠.`
      ], seed)
    case 'qa':
      return `QA 리포트: 스모크 테스트 통과. 캔버스 렌더 확인, 점수 증가 확인, 게임오버 이벤트 정상. 발견 이슈 없음.`
    case 'repair':
      return '```js\n' + mockGameCode({
        // QA repair fixes the current game; it must not silently create a new
        // identity from boilerplate such as "방금 구현한". The agenda remains
        // the fallback only when the broken code has no readable meta.title.
        title: currentRepairTitle(prompt) || gameTitle,
        collection: collectionGame,
        referenceContract
      }) + '\n```'
    case 'code':
      return '```js\n' + mockGameCode({
        title: gameTitle,
        theme: pick(['#ffd24a', '#7dc7ff', '#ff9d5c', '#b78cff'], seed),
        item: pick(['★', '◆', '●', '♥'], seed),
        collection: collectionGame,
        referenceContract
      }) + '\n```'
    case 'changelog':
      return `- ${kw} 컨셉의 신규 게임 릴리즈\n- 핵심 루프(회피/획득/콤보) 구현\n- 자동 QA 스모크 테스트 통과`
    case 'feedback': {
      const strict = personaMeta.strict ?? 5
      const telemetry = telemetryFrom(prompt)
      const playSignal =
        (telemetry.score > 0 ? 0.45 : -0.25) +
        (telemetry.presses > 4 ? 0.2 : -0.2) +
        (telemetry.overFired ? 0.15 : 0) -
        Math.min(2, Math.max(0, telemetry.errors || 0)) * 0.8
      const base = 8.2 - strict * 0.35 + ((Math.abs(seed) % 100) / 100) * 1.5 - 0.75 + playSignal
      const score = Math.max(2, Math.min(10, Math.round(base)))
      const s = Math.abs(seed)
      const ax = off => Math.max(1, Math.min(10, Math.round(base + off)))
      return JSON.stringify({
        score,
        ratings: {
          fun: ax(((s >> 1) % 3) - 1),
          controls: ax(((s >> 2) % 4) - 2),
          balance: ax(((s >> 3) % 3) - 1),
          graphics: ax(((s >> 4) % 4) - 1),
          immersion: ax(((s >> 5) % 3) - 2),
          originality: ax(((s >> 6) % 5) - 2)
        },
        oneLiner: telemetry.errors > 0 ? '플레이 중 오류가 보여서 몰입이 끊겼어요' : pick([
          '조작이 바로 손에 익어서 좋았어요', '난이도가 좀 아쉽지만 손맛은 있네요',
          '한 판만 더 하고 싶어지는 게임', '그래픽 감성은 좋은데 변화가 더 필요해요',
          '점수 올리는 재미가 확실합니다', '초반이 심심해요, 뒤로 갈수록 재밌음'
        ], seed + strict),
        detail: {
          fun: pick(['루프가 단순한데 중독성이 있음', '반복 플레이 동기가 조금 약함', '가속 붙는 순간부터 진짜 재밌어짐'], seed),
          difficulty: pick(['체감 난이도 적절', '초반 너무 쉬움', '후반 급격히 어려워짐'], seed + 1),
          controls: pick(['입력 지연 없음, 쾌적', '키 반응은 좋은데 관성이 아쉬움', '조작 직관적'], seed + 2),
          graphics: pick(['도트 감성 좋음', '팔레트 통일감 있음', '이펙트가 더 있으면 좋겠음'], seed + 3)
        },
        bugs: telemetry.errors > 0
          ? [`자동 플레이 중 오류 ${telemetry.errors}건 감지`]
          : ((seed % 7 === 0) ? ['가끔 아이템이 벽 끝에 붙어 나옴'] : []),
        suggestions: [pick(['콤보 시스템 강화', '파워업 아이템 추가', '랭킹 표시', '스테이지 변화'], seed + 4)]
      })
    }
    case 'summary':
      return `# 오락실 반응 종합 리포트\n\n**총평**: 손님들의 평균 반응은 긍정적. 조작감과 단순한 루프가 강점, 후반 콘텐츠 다양성이 약점.\n\n## 강점\n- 즉시 이해되는 규칙, 낮은 진입장벽\n- 하이스코어 도전 동기\n\n## 약점\n- 플레이 변화 폭 부족 (파워업/이벤트 부재)\n- 일부 연령대에서 난이도 곡선 불만\n\n## 다음 버전 우선순위\n1. 콤보/파워업 시스템\n2. 후반 페이즈 변화(배경·속도·패턴)\n3. 히트박스 미세 조정`
    default: // chat
      return pick([
        `네 팀장님, ${kw} 건은 제가 정리해서 공유드릴게요. 회의로 진행해 보실래요?`,
        `지금 ${kw} 관련 아이디어 몇 개 생각해 둔 게 있어요. 회의 안건으로 올려주시면 바로 풀어보겠습니다.`,
        `오늘 컨디션 좋습니다! 새 게임 만들 준비 됐어요.`,
        `최근 오락실 피드백 보니까 조작감 얘기가 많더라고요. 다음 작품에 반영하면 좋겠어요.`
      ], seed)
  }
}

export const mockProvider = {
  name: 'mock',
  async generate(opts) {
    await new Promise(r => setTimeout(r, 150 + Math.random() * 350))
    return { text: mockText(opts), sources: opts.search ? [{ title: '(모의) 아케이드 트렌드 2026', uri: 'https://example.com/arcade-trends' }] : [] }
  },
  async stream(opts, onDelta) {
    const text = mockText(opts)
    const step = Math.max(4, Math.floor(text.length / 40))
    for (let i = 0; i < text.length; i += step) {
      onDelta(text.slice(i, i + step))
      await new Promise(r => setTimeout(r, 24))
    }
    return { text, sources: [] }
  },
  async embed(texts) {
    return texts.map(t => {
      const v = new Array(256).fill(0)
      for (const w of String(t).toLowerCase().match(/[가-힣a-z0-9]{2,}/g) || []) {
        v[Math.abs(hash(w)) % 256] += 1
      }
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
      return v.map(x => x / n)
    })
  }
}
