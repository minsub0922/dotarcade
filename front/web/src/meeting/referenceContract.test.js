import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeReferenceDesignContract,
  referenceContractPrompt,
  referenceImplementationMarkdown,
  visualQaRequiredScreens
} from './referenceContract.js'
import { P } from './prompts.js'

const payload = {
  selected: { id: 'sample-rpg', title: 'Sample RPG' },
  designContract: {
    version: '2', contractId: 'contract-sample-v2',
    targetId: 'sample-rpg', targetTitle: 'Sample RPG',
    viewport: { width: 480, height: 320 },
    screens: [
      { id: 'title', role: 'entry' },
      { id: 'gameplay', role: 'core loop' },
      { id: 'result', role: 'score' },
      { id: 'party', role: 'roster', verify: 'Space로 진입' }
    ],
    patterns: [{
      id: 'party-card-grid', sourcePattern: 'six-unit overview',
      adaptation: '독자적 2×3 역할 카드', targetScreens: ['party'],
      implementationCue: 'drawParty와 drawCard helper', verify: '선택 강조 확인'
    }],
    originality: { forbiddenVisibleTerms: ['Sample RPG'] },
    traceability: [{
      patternId: 'party-card-grid', sourcePattern: 'six-unit overview', targetScreen: 'party',
      implementation: 'drawParty', verification: '키보드 도달 + 선택 강조'
    }],
    qa: { requiredScreens: ['party'], requiredPatternIds: ['party-card-grid'] }
  }
}

test('canonical server design contract becomes one bounded production contract', () => {
  const contract = normalizeReferenceDesignContract(payload)
  assert.equal(contract.contractId, 'contract-sample-v2')
  assert.deepEqual(contract.viewport, { w: 480, h: 320, aspect: '3:2' })
  assert.ok(contract.qa.requiredScreens.includes('party'))
  assert.deepEqual(contract.qa.requiredPatternIds, ['party-card-grid'])
  assert.equal(contract.traceability[0].targetScreen, 'party')
  assert.deepEqual(contract.originality.forbiddenVisibleTerms, ['Sample RPG'])

  const prompt = referenceContractPrompt(contract)
  assert.match(prompt, /contract-sample-v2/)
  assert.match(prompt, /implementedPatterns/)
  assert.match(prompt, /forbiddenVisibleTerms/)
  assert.match(prompt, /원본 캐릭터.*복제하지 않는다/)
})

test('legacy blueprint and selected-only results remain compatible without game-specific code', () => {
  const fromBlueprint = normalizeReferenceDesignContract({
    selected: { id: 'runner-ref', title: 'Runner Reference' },
    blueprint: {
      layout: { viewport: { aspect: '3:4' } },
      uiPatterns: [{ name: 'result cadence', apply: '점수와 재시작을 한 화면에 배치' }],
      qa: { requiredScreens: ['help'] }
    }
  })
  assert.equal(fromBlueprint.viewport.aspect, '3:4')
  assert.ok(fromBlueprint.qa.requiredScreens.includes('help'))
  assert.equal(fromBlueprint.patterns.length, 1)

  const inferred = normalizeReferenceDesignContract({
    selected: { id: 'collection-ref', title: 'Collection Reference', uiFocus: ['party grid', 'codex collection grid'] }
  })
  assert.ok(inferred.qa.requiredScreens.includes('party'))
  assert.ok(inferred.qa.requiredScreens.includes('codex'))
  assert.equal(normalizeReferenceDesignContract('[legacy referenceContext string]'), null)
})

test('canonical blueprint keeps implementation details but does not promote recommended screens or prose into exact code tokens', () => {
  const contract = normalizeReferenceDesignContract({
    designContract: {
      target: { id: 'arcade-ref', title: 'Arcade Reference' },
      coreLoop: { goal: 'survive', verbs: ['move'], steps: [{ id: 'step-1', action: 'move', feedback: 'flash' }] },
      screens: [
        { id: 'title', priority: 'required', layout: 'centered start' },
        { id: 'gameplay', priority: 'required', patternIds: ['safe-hud'] },
        { id: 'result', priority: 'required' },
        { id: 'help', priority: 'recommended' }
      ],
      patterns: [{ id: 'safe-hud', requirement: 'safe HUD', implementationHint: 'drawHud', verify: 'readable', required: true }],
      interaction: { controls: ['Arrow keys: move', 'Space: confirm'] },
      qa: {
        requiredScreens: ['title', 'gameplay', 'result'], requiredPatternIds: ['safe-hud'],
        depthSignals: ['far/mid/near render passes'],
        feedbackSignals: [{ id: 'impact-state', codeSignals: ['renderer:drawImpact'], verify: 'impact visible' }]
      }
    }
  })
  assert.equal(contract.coreLoop.goal, 'survive')
  assert.equal(contract.screens.find(screen => screen.id === 'help').required, false)
  assert.equal(contract.qa.requiredScreens.includes('help'), false)
  assert.deepEqual(contract.interaction.controls, ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'])
  assert.deepEqual(contract.qa.depthSignals[0].codeSignals, [])
  assert.deepEqual(contract.qa.feedbackSignals[0].codeSignals, ['renderer:drawImpact'])
  assert.deepEqual(contract.patterns[0].targetScreens, ['gameplay'])
})

test('contract required screens override collection fallback without promoting recommended screens', () => {
  const contract = normalizeReferenceDesignContract({
    designContract: {
      target: { id: 'collection-reference', title: 'Collection Reference' },
      screens: [
        { id: 'title', priority: 'required' },
        { id: 'gameplay', priority: 'required' },
        { id: 'result', priority: 'required' },
        { id: 'party', priority: 'required' },
        { id: 'codex', priority: 'recommended' }
      ],
      qa: { requiredScreens: ['title', 'gameplay', 'result', 'party'] }
    }
  })
  assert.deepEqual(visualQaRequiredScreens(contract, { collectionFallback: true }), ['title', 'gameplay', 'result', 'party'])
  assert.deepEqual(visualQaRequiredScreens(null, { collectionFallback: true }), ['party'])
  assert.equal(contract.screens.find(screen => screen.id === 'codex').required, false)

  const implementation = P.impl('생물 수집', 'PRD', 'DESIGN', 'ARCH', '', null, '', contract)
  const review = P.review(contract)
  assert.match(implementation, /qa\.requiredScreens만 출시 필수/)
  assert.match(review, /recommended 화면을 강제하지 마세요/)
})

test('legacy contract identity changes with executable semantics and warns on an unsupported schema major', () => {
  const make = adaptation => normalizeReferenceDesignContract({
    selected: { id: 'future-runner', title: 'Future Runner' },
    blueprint: {
      schemaVersion: 'reference-blueprint/v2',
      screens: [
        { id: 'title', priority: 'required' },
        { id: 'gameplay', priority: 'required' },
        { id: 'result', priority: 'required' },
        { id: 'help', priority: 'recommended' }
      ],
      patterns: [{ id: 'hazard-cue', requirement: 'early cue', adaptation, required: true }],
      qa: { requiredScreens: ['title', 'gameplay', 'result'], requiredPatternIds: ['hazard-cue'] }
    }
  })
  const first = make('use a silhouette pulse')
  const second = make('use a lane warning marker')
  assert.notEqual(first.contractId, second.contractId)
  assert.equal(first.schemaCompatibility, 'forward-compatible-subset')
  assert.ok(first.quality.warnings.some(warning => warning.startsWith('unsupported-reference-schema-major:2')))
})

test('fallback identity and prompts preserve bounded originality title restrictions', () => {
  const make = term => normalizeReferenceDesignContract({
    selected: { id: 'reference-target', title: 'Reference Target' },
    blueprint: {
      screens: ['title', 'gameplay', 'result', 'help'],
      originality: { forbiddenVisibleTerms: [term] },
      interaction: { controls: ['Space', 'Escape'] }
    }
  })
  const first = make('Reference Target')
  const second = make('Reference Target Deluxe')
  assert.notEqual(first.contractId, second.contractId)
  assert.deepEqual(first.originality.forbiddenVisibleTerms, ['Reference Target'])
  assert.deepEqual(first.interaction.controls, ['Space', 'Escape'])
  assert.match(referenceContractPrompt(first), /meta\.title.*독자적 명칭/)
})

test('PRD to design to architecture to implementation and repair all consume the same contract', () => {
  const contract = normalizeReferenceDesignContract(payload)
  const prd = P.prd('작은 수집 RPG', null, '[legacy summary]', contract)
  const design = P.design(null, '[legacy summary]', contract, '# PRD FULL SENTINEL')
  const arch = P.arch(null, '[legacy summary]', contract, '# PRD FULL SENTINEL', '# DESIGN FULL SENTINEL')
  const impl = P.impl('작은 수집 RPG', 'PRD', 'DESIGN', 'ARCH', '', null, '[legacy summary]', contract)
  const repair = P.repair(
    `window.game={meta:{title:'별빛 정원 수호대'}}`,
    { visual: { reference: { missing: ['party-card-grid'] } } },
    contract,
    '별빛 정원에서 빛 조각을 모으고 운석을 피하는 수집형 캐처'
  )

  for (const prompt of [prd, design, arch, impl, repair]) assert.match(prompt, /contract-sample-v2/)
  assert.match(design, /PRD FULL SENTINEL/)
  assert.match(arch, /PRD FULL SENTINEL/)
  assert.match(arch, /DESIGN FULL SENTINEL/)
  assert.match(impl, /meta\.reference\/meta\.designContract/)
  assert.match(repair, /visual\.issues/)
  assert.match(repair, /\[안건\] 별빛 정원에서 빛 조각을 모으고 운석을 피하는 수집형 캐처/)
  assert.match(repair, /현재 제목: 별빛 정원 수호대/)
  assert.match(repair, /meta\.title.*한 글자도 다르게 바꾸지/)
})

test('release trace matrix records planned, declared and verified status per pattern', () => {
  const contract = normalizeReferenceDesignContract(payload)
  const docs = {
    prd: 'party-card-grid requirement',
    design: 'party-card-grid layout',
    arch: 'party-card-grid drawParty'
  }
  const code = `const meta={reference:{contractId:'contract-sample-v2',target:'sample-rpg',implementedPatterns:['party-card-grid'],screens:['party']}}`
  const markdown = referenceImplementationMarkdown(contract, { code, docs, qaResult: { pass: true } })
  assert.match(markdown, /Implementation Traceability Matrix/)
  assert.match(markdown, /계획됨.*설계됨.*연결됨.*선언됨.*검증됨/)
})
