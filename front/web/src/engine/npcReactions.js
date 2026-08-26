// DOTCADE — 플레이어가 만든 충돌에 대한 NPC 물리/사회 리액션
//
// 월드 엔진과 자율 플래너 사이의 얇은 경계 모듈이다. 이 모듈은 NPC의
// 짧은 반응 상태만 소유하며 장기 목적지나 일과는 플래너에 돌려준다.

const DEFAULT_TILE = 48
const TEAM_IDS = new Set(['pm', 'dev1', 'dev2', 'designer', 'writer'])
// `prop.z` is measured from the floor to the prop's draw origin. A standing
// avatar is about 79px tall, and the tumbling prop itself extends below that
// origin. The old fixed 52px cutoff only covered the avatar's lower body and
// made most of the normal throw arc pass through without a hit.
const AVATAR_HIT_HEIGHT = 79
const PROP_VERTICAL_REACH = Object.freeze({ book: 22, trashbin: 10 })

function propHitCeiling(prop) {
  return AVATAR_HIT_HEIGHT + (PROP_VERTICAL_REACH[prop?.kind] || 12)
}

function segmentCircleInterval(from, to, center, radius) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const ox = from.x - center.x
  const oy = from.y - center.y
  const a = dx * dx + dy * dy
  const radiusSq = radius * radius
  if (a < .0001) return ox * ox + oy * oy <= radiusSq ? [0, 1] : null

  const b = 2 * (ox * dx + oy * dy)
  const c = ox * ox + oy * oy - radiusSq
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null
  const root = Math.sqrt(discriminant)
  const enter = Math.max(0, (-b - root) / (2 * a))
  const exit = Math.min(1, (-b + root) / (2 * a))
  return enter <= exit ? [enter, exit] : null
}

function belowCeilingInterval(fromZ, toZ, ceiling) {
  if (fromZ <= ceiling && toZ <= ceiling) return [0, 1]
  if (fromZ > ceiling && toZ > ceiling) return null
  const crossing = Math.max(0, Math.min(1, (ceiling - fromZ) / (toZ - fromZ)))
  return fromZ <= ceiling ? [0, crossing] : [crossing, 1]
}

function pathContact(agent, from, to, radius, ceiling) {
  const horizontal = segmentCircleInterval(from, to, agent, radius)
  const vertical = belowCeilingInterval(from.z, to.z, ceiling)
  if (!horizontal || !vertical) return null
  const progress = Math.max(horizontal[0], vertical[0])
  const exit = Math.min(horizontal[1], vertical[1])
  if (progress > exit) return null
  const x = from.x + (to.x - from.x) * progress
  const y = from.y + (to.y - from.y) * progress
  const z = from.z + (to.z - from.z) * progress
  return { progress, x, y, z, distance: Math.hypot(agent.x - x, agent.y - y) }
}

const TEAM_LINES = {
  pm: {
    vehicle: [
      '정리하면요, 여기서는 서행입니다.',
      '우선순위에 안전 운전부터 추가할게요.',
      '자전거는 좋지만 사무실 제한 속도부터 정하죠.'
    ],
    book: [
      '문서는 던지지 말고 공유해 주세요.',
      'PRD 피드백이 꽤 물리적이네요.',
      '이 책은 이번 스프린트 범위 밖입니다.'
    ],
    trashbin: [
      '청소도 백로그에 넣어야겠네요.',
      '쓰레기통 이동은 다음 액션으로 정리하죠.',
      '범위를 줄이랬지 통을 던지랬나요?'
    ],
    follow: [
      '괜찮습니다. 대신 재발 방지 항목은 남길게요.',
      '다음 액션은 명확합니다. 천천히 다니기예요.'
    ]
  },
  dev1: {
    vehicle: [
      '그건 프레임 단위로 생각해봐야 해요!',
      '탑승물 히트박스가 너무 큽니다.',
      '충돌 벡터 확인했습니다. 재현 가능해요.'
    ],
    book: [
      '책 콜라이더가 관통했어요.',
      '물리 레이어 분리부터 해야겠네요.',
      '방금 판정, 테스트 케이스로 남깁니다.'
    ],
    trashbin: [
      '질량값이 가벼운 통 수준이 아닌데요?',
      '이 반발 계수는 리뷰가 필요합니다.',
      '런타임 물리 테스트까지 하실 줄은 몰랐네요.'
    ],
    follow: [
      '다친 건 없어요. 충돌 로그는 남았습니다.',
      '다음에는 디버그 히트박스부터 켜죠.'
    ]
  },
  dev2: {
    vehicle: [
      '와, 탈것 대시까지 구현된 거예요?!',
      '어어어, 세이브 포인트 어디죠!',
      '이거 넉백 이펙트 넣으면 진짜 맛있겠는데요!'
    ],
    book: [
      '오, 원거리 아이템 좋네요! 아프긴 한데요!',
      '책 투사체 버그 아니고 기능 맞죠?',
      '바로 패링 기능도 구현 가능… 아, 아니에요.'
    ],
    trashbin: [
      '쓰레기통 궁극기 너무 센데요!',
      '이거 생각보다 타격감 좋은데요?!',
      '어 버그… 아니, 재밌는 기능이다!'
    ],
    follow: [
      '저 괜찮아요! 대신 다음엔 경고 이펙트 주세요.',
      '한 번 더는 말고요. 쿨다운부터 넣어요!'
    ]
  },
  designer: {
    vehicle: [
      '움직임에 반 박자 예고가 필요해요.',
      '실루엣은 예쁜데 동선이 너무 과감해요!',
      '충돌 플래시 컬러는 조금만 부드럽게 가죠.'
    ],
    book: [
      '책 궤적은 예쁜데 제 쪽은 아니죠.',
      '이건 시각 피드백보다 사전 경고가 먼저예요.',
      '보라색 책이면 다 용서되는 건 아니에요.'
    ],
    trashbin: [
      '쓰레기통 팔레트부터 너무 공격적이에요.',
      '이 화면은 물리적으로도 숨 쉴 틈이 없네요.',
      '여기에 반 박자 쉼표를… 아니, 통부터 치워요.'
    ],
    follow: [
      '괜찮아요. 다음엔 피격 전에 그림자를 보여줘요.',
      '리액션은 좋았어요. 사용자 안전은 더 챙기고요.'
    ]
  },
  writer: {
    vehicle: [
      '이 장면의 주인공은 왜 저를 치고 갔을까요?',
      '갑자기 장르가 오피스 추격극이 됐네요.',
      '자전거에도 서사가 필요하지만 이건 너무 급해요!'
    ],
    book: [
      '이야기는 책으로 전해도, 책을 던지진 말아요.',
      '복선치고는 꽤 묵직하네요.',
      '제 원고에 액션 장면이 추가됐어요.'
    ],
    trashbin: [
      '버린 설정이 이렇게 돌아올 줄은 몰랐네요.',
      '쓰레기통의 감정 곡선이 가장 격렬해요.',
      '이건 서사적 필연이 아니라 사고예요!'
    ],
    follow: [
      '괜찮아요. 이 사건은 짧은 에피소드로 쓸게요.',
      '다음 장면에서는 서로 대화로 해결해요.'
    ]
  }
}

// 방문자 ID를 다섯 가지 반응 성향으로 안정적으로 나눈다. 매 실행마다
// 말은 달라져도 인물의 기질까지 매번 뒤집히지는 않게 하기 위함이다.
const VISITOR_LINES = [
  {
    vehicle: ['오, 갑자기 PvP 모드예요?', '방금 건 회피 가능했어요!', '속도전이면 저도 안 져요.'],
    book: ['원거리 공격까지 된다고요?', '아이템전 시작한 거예요?', '책 투척 판정은 조금 빡센데요.'],
    trashbin: ['이건 필살기잖아요!', '통째로 던지는 건 반칙 아닌가요?', '방금 콤보 카운트 올라갔죠?'],
    follow: ['괜찮아요. 다음엔 정면 승부예요.', '이번 판정은 기억해 둘게요.']
  },
  {
    vehicle: ['천천히 가요, 놀랐잖아요.', '괜찮지만 실내 운전은 조심해요.', '조금만 여유 있게 다녀요.'],
    book: ['책은 읽는 게 더 좋지 않을까요?', '괜찮아요, 모서리만 아니면요.', '조용히 게임하러 왔는데 깜짝 놀랐네요.'],
    trashbin: ['앗, 청소 시간인가요?', '통이 먼저 저를 찾아왔네요.', '괜찮아요. 주변부터 정리하죠.'],
    follow: ['전 괜찮아요. 이제 같이 게임해요.', '한숨 돌리고 다시 놀죠.']
  },
  {
    vehicle: ['와! 여기 탈것도 움직여요?', '방금 움직임 다시 보고 싶어요!', '이런 것도 상호작용이 되는구나!'],
    book: ['우와, 책도 날아가요?', '숨은 기능 발견!', '이 책 다시 주울 수 있어요?'],
    trashbin: ['쓰레기통도 물리가 있어요!', '이 맵 자유도 진짜 높다!', '통이 데굴데굴 굴러왔어요!'],
    follow: ['신기하긴 한데 다음엔 옆으로 던져 주세요.', '괜찮아요! 다른 것도 찾아볼래요.']
  },
  {
    vehicle: ['충돌 판정은 다시 보셔야겠는데요.', '예고 없이 닿으면 불공정해요.', '이동 속도 대비 회피 시간이 짧아요.'],
    book: ['투사체 가독성이 조금 부족해요.', '궤적과 실제 판정이 맞는지 봐야겠어요.', '피격 피드백은 확실하네요.'],
    trashbin: ['크기 대비 충돌 범위가 과합니다.', '무거운 오브젝트 밸런스가 필요해요.', '이건 군중 제어기가 너무 길어요.'],
    follow: ['로그가 남는다면 재현해 볼게요.', '경고 표시만 있어도 훨씬 공정해져요.']
  },
  {
    vehicle: ['이거 완전 방송각인데요?!', '잠깐, 방금 장면 클립 땄어요?', '사무실이 갑자기 액션 게임 됐어요!'],
    book: ['책 맞는 리액션까지 있어요?', '친구한테 보여주고 싶은 장면이네요.', '이거 웃기긴 한데 저한테 또 던지진 마요!'],
    trashbin: ['와, 통이 화면을 다 먹었어요!', '오늘의 하이라이트 나왔네요.', '이 자유도는 인정할게요!'],
    follow: ['괜찮아요. 대신 다음엔 제가 찍을게요.', '같이 게임하면 봐드릴게요.']
  }
]

const REACTION_SPEC = {
  dodge: { lockMs: 620, visualMs: 1180, impulse: 7.1, anticipationMs: 68, impactMs: 210 },
  knockback: { lockMs: 900, visualMs: 1450, impulse: 6.0, anticipationMs: 82, impactMs: 270 },
  stun: { lockMs: 1420, visualMs: 2020, impulse: 3.7, anticipationMs: 96, impactMs: 330 }
}

const EMOTION_SPEC = {
  surprised: { emoji: '❗', color: '#ffe17a', panel: 'rgba(63,50,30,.95)' },
  hurt: { emoji: '💢', color: '#ff8f8f', panel: 'rgba(72,35,43,.95)' },
  dizzy: { emoji: '💫', color: '#d5b8ff', panel: 'rgba(72,55,116,.95)' },
  angry: { emoji: '😠', color: '#ffad68', panel: 'rgba(78,39,30,.95)' }
}

// Dialogue is already role-specific above. This table also gives every team
// role a concrete post-impact action/gesture so follow-ups are not just random
// text with identical behaviour.
const TEAM_FOLLOW_UP = {
  pm: { action: 'set-safety-boundary', gesture: 'point', emotion: 'angry', evadeBias: .08 },
  dev1: { action: 'inspect-hitbox', gesture: 'inspect', emotion: 'hurt', evadeBias: .12 },
  dev2: { action: 'pitch-counterplay', gesture: 'spark', emotion: 'surprised', evadeBias: .08 },
  designer: { action: 'critique-telegraph', gesture: 'hands-up', emotion: 'angry', evadeBias: .32 },
  writer: { action: 'note-the-incident', gesture: 'note', emotion: 'surprised', evadeBias: .22 }
}

const VISITOR_FOLLOW_UP = [
  { action: 'challenge-rematch', gesture: 'challenge', emotion: 'angry', evadeBias: .08 },
  { action: 'shake-it-off', gesture: 'wave', emotion: 'hurt', evadeBias: .34 },
  { action: 'inspect-the-object', gesture: 'inspect', emotion: 'surprised', evadeBias: .12 },
  { action: 'report-balance-issue', gesture: 'point', emotion: 'angry', evadeBias: .26 },
  { action: 'celebrate-the-clip', gesture: 'spark', emotion: 'surprised', evadeBias: .08 }
]

const NEUTRAL_VISUAL = Object.freeze({
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  flash: 0,
  actionLines: 0,
  phase: 'none',
  emotion: null,
  intensity: 0
})

const DIR = {
  left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1]
}

function values(collection) {
  if (!collection) return []
  return collection instanceof Map ? collection.values() : collection
}

function pick(list, random) {
  if (!list?.length) return ''
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))]
}

function visitorProfile(id) {
  const number = Number(String(id || '').replace(/\D/g, '')) || 1
  return VISITOR_LINES[(number - 1) % VISITOR_LINES.length]
}

function visitorProfileIndex(id) {
  const number = Number(String(id || '').replace(/\D/g, '')) || 1
  return (number - 1) % VISITOR_LINES.length
}

function profileFor(agent) {
  if (agent?.meta?.reactionProfile) return agent.meta.reactionProfile
  return TEAM_LINES[agent?.id] || visitorProfile(agent?.id)
}

function followUpFor(agent) {
  return TEAM_FOLLOW_UP[agent?.id] || VISITOR_FOLLOW_UP[visitorProfileIndex(agent?.id)]
}

function emotionFor(agent, kind) {
  if (kind === 'stun') return 'dizzy'
  if (kind === 'dodge') return 'surprised'
  return agent?.id === 'pm' || agent?.id === 'dev1' ? 'angry' : 'hurt'
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function phaseFor(state, now) {
  if (now < state.impactAt) return 'anticipation'
  if (now < state.recoverAt) return 'impact'
  return 'recover'
}

function neutralVisual() {
  return { ...NEUTRAL_VISUAL }
}

function drawReactionFace(ctx, emotion) {
  ctx.save()
  ctx.strokeStyle = '#542c37'
  ctx.fillStyle = '#542c37'
  ctx.lineWidth = 1.8
  ctx.lineCap = 'round'
  if (emotion === 'surprised') {
    ctx.beginPath(); ctx.arc(-5, -1, 2, 0, Math.PI * 2); ctx.arc(5, -1, 2, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.ellipse(0, 7, 2.8, 4, 0, 0, Math.PI * 2); ctx.stroke()
  } else if (emotion === 'dizzy') {
    for (const x of [-5, 5]) {
      ctx.beginPath(); ctx.moveTo(x - 2.5, -3); ctx.lineTo(x + 2.5, 2)
      ctx.moveTo(x + 2.5, -3); ctx.lineTo(x - 2.5, 2); ctx.stroke()
    }
    ctx.beginPath(); ctx.moveTo(-5, 8); ctx.quadraticCurveTo(-2.5, 5.5, 0, 8); ctx.quadraticCurveTo(2.5, 10.5, 5, 8); ctx.stroke()
  } else if (emotion === 'angry') {
    ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(-2, -2); ctx.moveTo(2, -2); ctx.lineTo(8, -6); ctx.stroke()
    ctx.beginPath(); ctx.arc(-5, 0, 1.3, 0, Math.PI * 2); ctx.arc(5, 0, 1.3, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(0, 12, 5.2, Math.PI + .25, Math.PI * 2 - .25); ctx.stroke()
  } else {
    ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(-3, 1); ctx.moveTo(-3, -3); ctx.lineTo(-8, 1); ctx.stroke()
    ctx.beginPath(); ctx.arc(5, 0, 1.4, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.moveTo(-5, 8); ctx.quadraticCurveTo(0, 4.5, 5, 8); ctx.stroke()
  }
  ctx.restore()
}

function stableSpinSign(agentId, sourceKind) {
  const text = `${agentId || 'npc'}:${sourceKind || 'impact'}`
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return hash & 1 ? -1 : 1
}

function sourceKey(sourceType, source) {
  return `${sourceType}:${source?.id || source?.kind || 'unknown'}`
}

function unit(x, y, fallback = [0, 1]) {
  const length = Math.hypot(x, y)
  return length > .001 ? [x / length, y / length] : fallback
}

function faceToward(agent, player) {
  const dx = player.x - agent.x
  const dy = player.y - agent.y
  return Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? 'right' : 'left')
    : (dy > 0 ? 'down' : 'up')
}

function safeSummary(agent) {
  return {
    id: agent.id,
    name: agent.meta?.shortName || String(agent.label || agent.id).split(' · ')[0],
    role: TEAM_IDS.has(agent.id)
      ? ({ pm: 'PM', dev1: '시니어 개발자', dev2: '주니어 개발자', designer: '디자이너', writer: '콘텐츠 작가' }[agent.id])
      : '플레이테스터',
    teamMember: TEAM_IDS.has(agent.id)
  }
}

export class NpcReactionSystem {
  constructor({ random = Math.random, tileSize = DEFAULT_TILE, maxEvidence = 40 } = {}) {
    this.random = random
    this.tileSize = tileSize
    this.maxEvidence = maxEvidence
    this.states = new Map()
    this.pairCooldowns = new Map()
    this.agentCooldowns = new Map()
    this.vehicleGateUntil = 0
    this.evidence = []
    this.sequence = 0
  }

  reset(agents) {
    for (const agent of values(agents)) this._clearMeta(agent)
    this.states.clear()
    this.pairCooldowns.clear()
    this.agentCooldowns.clear()
    this.vehicleGateUntil = 0
  }

  forgetAgent(id) {
    this.states.delete(id)
    this.agentCooldowns.delete(id)
    for (const key of this.pairCooldowns.keys()) {
      if (key.endsWith(`>${id}`)) this.pairCooldowns.delete(key)
    }
  }

  getEvidence(limit = this.maxEvidence) {
    return this.evidence.slice(-Math.max(0, limit)).map(item => ({ ...item }))
  }

  isLocked(agentOrId, now) {
    const id = typeof agentOrId === 'string' ? agentOrId : agentOrId?.id
    const state = this.states.get(id)
    return !!state && now < state.lockUntil
  }

  // 던진 물체가 실제 충돌 가능한 상태일 때 호출한다. 리액션을 소비했을
  // 때만 결과를 돌려주므로 월드 쪽은 그때 반사/파티클을 적용하면 된다.
  tryPropHit({ now, prop, previousPosition = null, agents, map, player, isWalkable, bubble, onInteract }) {
    const speed = Math.hypot(prop?.vx || 0, prop?.vy || 0)
    if (!prop || speed <= 2.1) return null
    const radius = prop.kind === 'trashbin' ? 30 : 24
    const to = { x: Number(prop.x) || 0, y: Number(prop.y) || 0, z: Number(prop.z) || 0 }
    const from = previousPosition
      ? {
          x: Number(previousPosition.x) || 0,
          y: Number(previousPosition.y) || 0,
          z: Number(previousPosition.z) || 0
        }
      : to
    const ceiling = propHitCeiling(prop)
    const candidates = []
    for (const agent of values(agents)) {
      if (!this._eligible(agent, map, now, sourceKey('prop', prop))) continue
      const contact = pathContact(agent, from, to, radius, ceiling)
      if (contact) candidates.push({ agent, contact })
    }
    candidates.sort((a, b) => a.contact.progress - b.contact.progress || a.contact.distance - b.contact.distance)
    const found = candidates[0]
    if (!found) return null

    const incoming = unit(prop.vx, prop.vy)
    const reaction = this._react({
      now, agent: found.agent, player, map, sourceType: 'prop', source: prop,
      incoming, speed, distance: found.contact.distance, isWalkable, bubble, onInteract
    })
    return reaction ? {
      ...reaction,
      agent: found.agent,
      contact: found.contact,
      restitution: prop.kind === 'trashbin' ? .38 : .48,
      lift: prop.kind === 'trashbin' ? 3.5 : 3.2
    } : null
  }

  // 탑승 중인 플레이어가 이동한 프레임에 호출한다. 진행 방향 앞쪽의 가장
  // 가까운 NPC 한 명만 반응시키며 군중을 관통해 연쇄 타격하지 않는다.
  tryVehicleHit({ now, vehicle, player, agents, map, isWalkable, bubble, onInteract }) {
    if (!vehicle || !player?.moving || now < this.vehicleGateUntil) return null
    const incoming = DIR[player.dir] || [0, 1]
    const candidates = []
    const key = sourceKey('vehicle', vehicle)
    for (const agent of values(agents)) {
      if (!this._eligible(agent, map, now, key)) continue
      const dx = agent.x - player.x
      const dy = agent.y - player.y
      const distance = Math.hypot(dx, dy)
      const forward = dx * incoming[0] + dy * incoming[1]
      const lateral = Math.abs(dx * incoming[1] - dy * incoming[0])
      if (distance < 35 && forward > -4 && lateral < 27) candidates.push({ agent, distance, forward })
    }
    candidates.sort((a, b) => a.distance - b.distance || b.forward - a.forward)
    const found = candidates[0]
    if (!found) return null

    const result = this._react({
      now, agent: found.agent, player, map, sourceType: 'vehicle', source: vehicle,
      incoming, speed: vehicle.speed || 6, distance: found.distance,
      isWalkable, bubble, onInteract
    })
    if (result) this.vehicleGateUntil = now + 460
    return result ? { ...result, agent: found.agent } : null
  }

  update({ now, dt, agents, map, player, isWalkable, bubble, goTo, onInteract }) {
    const frame = Math.min(3, Math.max(0, dt / 16.67))
    const liveIds = new Set()
    for (const agent of values(agents)) liveIds.add(agent.id)

    for (const [id, state] of this.states) {
      const agent = agents instanceof Map
        ? agents.get(id)
        : [...values(agents)].find(item => item.id === id)
      if (!agent || !liveIds.has(id)) {
        this.states.delete(id)
        continue
      }
      if (agent.map && agent.map !== map) continue

      const phase = phaseFor(state, now)
      agent.meta.reactionPhase = phase

      const movingForce = Math.hypot(state.vx, state.vy) > .08
      // A very short anticipation/hit-stop makes the actual contact readable.
      // Physics starts at impactAt and still ends at the original bounded lock.
      if (movingForce && now >= state.impactAt && now < state.lockUntil) {
        const nx = agent.x + state.vx * frame
        const ny = agent.y + state.vy * frame
        if (!isWalkable || isWalkable(nx, agent.y)) agent.x = nx
        else state.vx *= -.22
        if (!isWalkable || isWalkable(agent.x, ny)) agent.y = ny
        else state.vy *= -.22
        state.vx *= Math.pow(.82, frame)
        state.vy *= Math.pow(.82, frame)
        agent.meta.reactionForce = { x: state.vx, y: state.vy }
        agent.moving = Math.hypot(state.vx, state.vy) > .35
      }

      if (!state.recovered && now >= state.lockUntil) {
        state.recovered = true
        state.vx = 0
        state.vy = 0
        agent.moving = false
        agent.dir = faceToward(agent, player)
        agent.idleT = Math.max(agent.idleT || 0, 900 + this.random() * 900)
        agent.meta.reactionLockUntil = 0
        agent.meta.reactionForce = { x: 0, y: 0 }
      }

      if (!state.followed && state.followAt && now >= state.followAt) {
        state.followed = true
        state.emotion = state.followEmotion
        state.emoji = EMOTION_SPEC[state.emotion].emoji
        agent.meta.reactionEmotion = state.emotion
        agent.meta.reactionEmoji = state.emoji
        agent.meta.reactionGesture = state.followGesture
        agent.meta.reactionFollowUp = state.followAction
        if (bubble && state.followLine) bubble(id, state.followLine, 2600)
        agent.dir = faceToward(agent, player)

        // 일부 NPC는 말만 하고 끝내지 않고 플레이어 반대쪽 한 타일로 물러난다.
        if (state.evadeAfter && goTo) {
          const away = unit(agent.x - player.x, agent.y - player.y, DIR[agent.dir] || [0, 1])
          const tx = Math.floor((agent.x + away[0] * this.tileSize * 1.35) / this.tileSize)
          const ty = Math.floor((agent.y + away[1] * this.tileSize * 1.35) / this.tileSize)
          const px = tx * this.tileSize + this.tileSize / 2
          const py = ty * this.tileSize + this.tileSize - 6
          if (!isWalkable || isWalkable(px, py)) {
            goTo(id, [tx, ty])
            agent.meta.reactionEvading = true
          }
        }

        onInteract?.({
          type: 'npcReactionFollowUp',
          reactionId: state.reactionId,
          at: now,
          agent: safeSummary(agent),
          action: state.followAction,
          gesture: state.followGesture,
          emotion: state.emotion,
          movement: state.evadeAfter ? 'evade' : 'hold',
          line: state.followLine
        })
      }

      if (now >= state.visualUntil) {
        this._clearMeta(agent)
        this.states.delete(id)
      }
    }

    for (const [key, until] of this.pairCooldowns) {
      if (until <= now) this.pairCooldowns.delete(key)
    }
    for (const [id, until] of this.agentCooldowns) {
      if (until <= now) this.agentCooldowns.delete(id)
    }
  }

  // Foot-pivot sprite transform contract. x/y are pixels, rotation is radians,
  // scaleX/scaleY are multipliers, and flash/actionLines are normalized 0..1.
  // The caller should translate to the avatar's foot anchor, apply rotation and
  // scale, then draw the sprite upward from that origin. Extra fields are safe
  // for older callers that only consume x/y/rotation.
  visualOffset(agent, now, reduceMotion = false) {
    const state = this.states.get(agent?.id)
    if (!state || now >= state.visualUntil) return neutralVisual()
    const phase = phaseFor(state, now)
    const base = {
      ...neutralVisual(),
      phase,
      emotion: state.emotion,
      intensity: state.strength
    }
    if (reduceMotion) {
      // Preserve a restrained contact flash and semantic phase/emotion while
      // removing displacement, rotation, scaling and animated action lines.
      if (phase === 'impact') base.flash = .3
      return base
    }

    if (phase === 'anticipation') {
      const progress = clamp01((now - state.startedAt) / Math.max(1, state.impactAt - state.startedAt))
      const crouch = Math.sin(progress * Math.PI / 2)
      return {
        ...base,
        x: -state.incomingX * 1.7 * crouch,
        y: 1.25 * crouch,
        rotation: -state.spinSign * .032 * crouch,
        scaleX: 1 + .075 * crouch,
        scaleY: 1 - .095 * crouch,
        actionLines: .16 * crouch
      }
    }

    if (phase === 'impact') {
      const progress = clamp01((now - state.impactAt) / Math.max(1, state.recoverAt - state.impactAt))
      const burst = Math.sin(progress * Math.PI)
      const contact = Math.pow(1 - progress, 1.8)
      const squash = Math.sin(progress * Math.PI * 2) * .13
      const kindScale = state.kind === 'dodge' ? .72 : state.kind === 'stun' ? .88 : 1
      return {
        ...base,
        x: state.forceX * burst * 3.4 * kindScale,
        y: state.forceY * burst * 1.2 - burst * (state.kind === 'knockback' ? 3.4 : 2.15),
        rotation: state.spinSign * burst * (state.kind === 'knockback' ? .115 : .075),
        scaleX: 1 + squash * kindScale,
        scaleY: 1 - squash * kindScale,
        flash: clamp01(contact * 1.25),
        actionLines: clamp01(Math.pow(1 - progress, .72))
      }
    }

    const progress = clamp01((now - state.recoverAt) / Math.max(1, state.visualUntil - state.recoverAt))
    const fade = Math.pow(1 - progress, 1.7)
    const age = now - state.recoverAt
    const wobble = Math.sin(age / (state.kind === 'stun' ? 58 : 72)) * fade
    const squash = Math.cos(age / 68) * fade * .045
    return {
      ...base,
      x: (state.kind === 'stun' ? wobble * 2.1 : state.forceX * fade * .8),
      y: -Math.abs(wobble) * (state.kind === 'stun' ? 1.05 : .45),
      rotation: state.spinSign * wobble * (state.kind === 'stun' ? .07 : .038),
      scaleX: 1 + squash,
      scaleY: 1 - squash
    }
  }

  // Call after the sprite. This draws the normalized flash/action-lines contract
  // as a readable overlay plus the emotion emote and dizzy orbit.
  draw(ctx, agent, now, { spriteHeight = 70, reduceMotion = false, faceImage = null } = {}) {
    const state = this.states.get(agent?.id)
    if (!state || now >= state.visualUntil) return
    const visual = this.visualOffset(agent, now, reduceMotion)
    const age = now - state.startedAt
    const tail = clamp01((state.visualUntil - now) / 260)
    const bounce = reduceMotion ? 0 : Math.abs(Math.sin(age / 115)) * 4
    const x = agent.x + 21
    const y = agent.y - spriteHeight - 4 - bounce
    const centerY = agent.y - spriteHeight * .48
    const emotion = EMOTION_SPEC[state.emotion] || EMOTION_SPEC.surprised

    if (visual.actionLines > .01) {
      const perpendicularX = -state.incomingY
      const perpendicularY = state.incomingX
      ctx.save()
      ctx.globalAlpha = visual.actionLines * .86 * tail
      ctx.strokeStyle = emotion.color
      ctx.lineWidth = 2.4
      ctx.lineCap = 'round'
      for (let i = -2; i <= 2; i++) {
        const spread = i * 6
        const startX = agent.x - state.incomingX * (31 + Math.abs(i) * 2) + perpendicularX * spread
        const startY = centerY - state.incomingY * (24 + Math.abs(i) * 2) + perpendicularY * spread
        ctx.beginPath()
        ctx.moveTo(startX, startY)
        ctx.lineTo(startX + state.incomingX * (10 + (2 - Math.abs(i)) * 2), startY + state.incomingY * (10 + (2 - Math.abs(i)) * 2))
        ctx.stroke()
      }
      ctx.restore()
    }

    if (visual.flash > .01) {
      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      ctx.globalAlpha = visual.flash * .38 * tail
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.ellipse(agent.x, centerY, 19 + visual.flash * 5, spriteHeight * .4, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = visual.flash * .72 * tail
      ctx.strokeStyle = emotion.color
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(agent.x, centerY, 17 + (1 - visual.flash) * 12, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    const hasFace = !!(faceImage?.complete && faceImage.naturalWidth)
    const badgeRadius = hasFace ? 18 : 13
    ctx.save()
    ctx.globalAlpha = tail
    ctx.fillStyle = emotion.panel
    ctx.strokeStyle = 'rgba(255,255,255,.92)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, badgeRadius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    if (hasFace) {
      ctx.save()
      ctx.beginPath(); ctx.arc(x, y, badgeRadius - 3, 0, Math.PI * 2); ctx.clip()
      ctx.drawImage(faceImage, x - badgeRadius + 3, y - badgeRadius + 3, (badgeRadius - 3) * 2, (badgeRadius - 3) * 2)
      ctx.fillStyle = `${emotion.color}2b`; ctx.fillRect(x - badgeRadius, y - badgeRadius, badgeRadius * 2, badgeRadius * 2)
      ctx.restore()
      ctx.save(); ctx.translate(x, y); drawReactionFace(ctx, state.emotion); ctx.restore()
      ctx.fillStyle = emotion.color
      ctx.beginPath(); ctx.arc(x + 13, y + 13, 7, 0, Math.PI * 2); ctx.fill()
      ctx.font = '9px "Apple Color Emoji", "Segoe UI Emoji", sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillStyle = '#fff'; ctx.fillText(state.emoji, x + 13, y + 13.5)
    } else {
      ctx.font = '16px "Apple Color Emoji", "Segoe UI Emoji", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(state.emoji, x, y + 1)
    }

    if (state.emotion === 'dizzy' && !reduceMotion) {
      ctx.fillStyle = '#ffd868'
      for (let i = 0; i < 3; i++) {
        const angle = age / 240 + i * Math.PI * 2 / 3
        ctx.beginPath()
        ctx.arc(agent.x + Math.cos(angle) * 17, agent.y - spriteHeight + 9 + Math.sin(angle) * 5, 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  _eligible(agent, map, now, key) {
    if (!agent?.visible || agent.id === 'player') return false
    if (agent.map && agent.map !== map) return false
    if (agent.meta?.chatting) return false
    if (this.isLocked(agent, now)) return false
    if (now < (this.agentCooldowns.get(agent.id) || 0)) return false
    return now >= (this.pairCooldowns.get(`${key}>${agent.id}`) || 0)
  }

  _reactionKind(sourceType, source) {
    const roll = this.random()
    if (sourceType === 'vehicle') return roll < .27 ? 'dodge' : roll < .76 ? 'knockback' : 'stun'
    if (source?.kind === 'trashbin') return roll < .16 ? 'dodge' : roll < .58 ? 'knockback' : 'stun'
    return roll < .31 ? 'dodge' : roll < .84 ? 'knockback' : 'stun'
  }

  _react({ now, agent, player, map, sourceType, source, incoming, speed, distance, isWalkable, bubble, onInteract }) {
    const key = `${sourceKey(sourceType, source)}>${agent.id}`
    if (now < (this.pairCooldowns.get(key) || 0)) return null
    if (now < (this.agentCooldowns.get(agent.id) || 0)) return null

    const profile = profileFor(agent)
    const followUp = followUpFor(agent)
    const sourceKind = sourceType === 'vehicle' ? 'vehicle' : (source.kind === 'trashbin' ? 'trashbin' : 'book')
    const kind = this._reactionKind(sourceType, source)
    const spec = REACTION_SPEC[kind]
    const emotion = emotionFor(agent, kind)
    const teamMember = TEAM_IDS.has(agent.id)
    const strength = Math.max(.72, Math.min(1.3, (speed || 5) / 6.5))
    const [incomingX, incomingY] = incoming
    let [fx, fy] = incoming

    if (kind === 'dodge') {
      const sign = this.random() < .5 ? -1 : 1
      let side = [-fy * sign, fx * sign]
      const ahead = [agent.x + side[0] * 22, agent.y + side[1] * 22]
      if (isWalkable && !isWalkable(ahead[0], ahead[1])) side = [-side[0], -side[1]]
      if (isWalkable && !isWalkable(agent.x + side[0] * 18, agent.y + side[1] * 18)) side = [-fx, -fy]
      ;[fx, fy] = side
    }

    const line = pick(profile[sourceKind] || profile.vehicle, this.random)
    const followLine = pick(profile.follow, this.random)
    const lockMs = spec.lockMs * (teamMember ? 1 : .9)
    const reactionId = `impact-${++this.sequence}`
    const followChance = teamMember ? .62 : .36
    const evadeChance = clamp01((sourceType === 'vehicle' ? .22 : .12) + followUp.evadeBias)
    const willFollow = this.random() < followChance
    const followAt = willFollow ? now + lockMs + 420 + this.random() * 520 : 0
    const cooldownMs = sourceType === 'vehicle' ? 3100 : 2450
    const state = {
      reactionId,
      kind,
      emotion,
      emoji: EMOTION_SPEC[emotion].emoji,
      sourceType,
      sourceKind,
      startedAt: now,
      impactAt: now + spec.anticipationMs,
      recoverAt: now + spec.anticipationMs + spec.impactMs,
      lockUntil: now + lockMs,
      visualUntil: Math.max(now + spec.visualMs, followAt ? followAt + 520 : 0),
      incomingX,
      incomingY,
      forceX: fx,
      forceY: fy,
      spinSign: stableSpinSign(agent.id, sourceKind),
      strength,
      vx: fx * spec.impulse * strength,
      vy: fy * spec.impulse * strength * .78,
      recovered: false,
      followed: !willFollow,
      followAt,
      followLine,
      followAction: followUp.action,
      followGesture: followUp.gesture,
      followEmotion: followUp.emotion,
      evadeAfter: willFollow && this.random() < evadeChance
    }
    this.states.set(agent.id, state)
    this.pairCooldowns.set(key, now + cooldownMs)
    this.agentCooldowns.set(agent.id, now + cooldownMs)

    agent.path = []
    agent.cb = null
    agent.sitting = false
    agent.moving = true
    agent.idleT = Math.max(agent.idleT || 0, lockMs + 800)
    agent.dir = Math.abs(fx) > Math.abs(fy) ? (fx > 0 ? 'right' : 'left') : (fy > 0 ? 'down' : 'up')
    agent.meta.reactionLockUntil = state.lockUntil
    agent.meta.reactionUntil = state.visualUntil
    agent.meta.reactionKind = kind
    agent.meta.reactionPhase = 'anticipation'
    agent.meta.reactionEmotion = emotion
    agent.meta.reactionEmoji = state.emoji
    agent.meta.reactionSource = sourceType
    agent.meta.reactionForce = { x: state.vx, y: state.vy }
    agent.meta.reactionEvading = false
    agent.meta.reactionGesture = null
    agent.meta.reactionFollowUp = willFollow ? followUp.action : null
    if (bubble && line) bubble(agent.id, line, Math.max(1900, lockMs + 700))

    const summary = safeSummary(agent)
    const evidence = {
      id: reactionId,
      type: 'npcReaction',
      at: now,
      map,
      sourceType,
      source: { id: source.id, kind: source.kind, label: source.label },
      agent: summary,
      reaction: kind,
      emotion,
      line,
      distance: Math.round(distance * 10) / 10,
      speed: Math.round((speed || 0) * 10) / 10,
      cooldownMs,
      visual: {
        phases: ['anticipation', 'impact', 'recover'],
        anticipationMs: spec.anticipationMs,
        impactMs: spec.impactMs,
        scale: true,
        rotation: true,
        flash: true,
        actionLines: true
      },
      evidence: {
        detected: true,
        plannerInterrupted: true,
        lockUntil: state.lockUntil,
        followUpPlanned: willFollow,
        followUpAction: willFollow ? followUp.action : null,
        followUpGesture: willFollow ? followUp.gesture : null,
        evadePlanned: state.evadeAfter
      }
    }
    this.evidence.push(evidence)
    if (this.evidence.length > this.maxEvidence) this.evidence.splice(0, this.evidence.length - this.maxEvidence)
    onInteract?.(evidence)
    return { reactionId, kind, emotion, line, evidence }
  }

  _clearMeta(agent) {
    if (!agent?.meta) return
    delete agent.meta.reactionLockUntil
    delete agent.meta.reactionUntil
    delete agent.meta.reactionKind
    delete agent.meta.reactionPhase
    delete agent.meta.reactionEmotion
    delete agent.meta.reactionEmoji
    delete agent.meta.reactionSource
    delete agent.meta.reactionForce
    delete agent.meta.reactionEvading
    delete agent.meta.reactionGesture
    delete agent.meta.reactionFollowUp
  }
}

export const NPC_REACTION_TEAM_IDS = TEAM_IDS
