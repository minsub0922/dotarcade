// DOTCADE — 캔버스 월드 엔진 (맵 렌더 · 이동 · 충돌 · 에이전트 · 말풍선)
import { astar } from './pathfind.js'
import {
  NPC_GOALS,
  createAutonomyState,
  configureAutonomyState,
  ageDrives,
  chooseUtilityGoal,
  buildBoundedPlan,
  consumeReplanBudget,
  beginGoal,
  advanceAction,
  actionTimedOut,
  sampleStuck,
  finishGoal,
  smoothTilePath,
  autonomySnapshot
} from './npcPlanner.js'
import {
  POCKET_STATION, isPocketStation, drawPocketStation, drawAgentHandheld
} from './handheldVisuals.js'
import { NpcReactionSystem } from './npcReactions.js'
import {
  AVATAR_FRAME, DISMOUNT_DURATION, avatarAssetUrl, avatarAssetVersion, avatarDrawLayout, createWalkState, directionFromDelta,
  isWalkSheetCompatible, rideDirectionFromDelta, rideLayout, rideTransitionPose, sampleRideCycle,
  sampleWalkFrame, sheetSource
} from './avatarAnimation.js'
import {
  NEUTRAL_AVATAR_WALK_POSE, createAvatarWalkMotionState, sampleAvatarWalkMotion
} from './avatarWalkMotion.js'
import {
  SEAT_PHASES, advanceSeatMotion, createSeatMotionState, seatApproachProximity, seatPoseLayout
} from './seatMotion.js'
import { AvatarEmotionSystem } from './avatarEmotions.js'
import { drawAgentRoleLabel } from './agentRoleLabel.js'
import {
  dynamicAvoidTiles, layoutOccluders, navigationGridWithAvoid, occupiedEntityTiles, randomWalkableAvoiding
} from './worldLayout.js'

const T = 48
const WORLD_W = 1440
const WORLD_H = 960
const PLAYER_WALK_SPEED = 4.4
const AUTO_SEAT_ENTER_RADIUS = 20
const AUTO_SEAT_RELEASE_RADIUS = 34
const AUTO_SEAT_IDLE_MS = 100
const AUTO_SEAT_REACTION_COOLDOWN = 350
const AVATAR_VISUAL = Object.freeze({
  player: { width: 54, height: 82 },
  npc: { width: 52, height: 79 },
  seated: { width: 48, height: 72 },
  mounted: { width: 52, height: 82 }
})
const DIRS = ['down', 'left', 'right', 'up']
const DIR_VECTOR = {
  down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }
}
const WORLD_OBJECTS = [
  POCKET_STATION,
  { id: 'office-bike', map: 'office', kind: 'bicycle', label: '블루 자전거', tile: [21, 16], mountable: true, speed: 9.6, color: '#3f8fe5', dir: 'right' },
  { id: 'office-scooter', map: 'office', kind: 'scooter', label: '퍼플 킥보드', tile: [25, 16], mountable: true, speed: 8.8, color: '#9a62e8', dir: 'left' },
  { id: 'office-book-a', map: 'office', kind: 'book', label: '게임 디자인 책', tile: [9, 11], throwable: true, color: '#7d6df2', dir: 'right' },
  { id: 'office-book-b', map: 'office', kind: 'book', label: '픽셀 아트 책', tile: [18, 16], throwable: true, color: '#ee6f91', dir: 'left' },
  { id: 'office-trash', map: 'office', kind: 'trashbin', label: '가벼운 쓰레기통', tile: [27, 6], throwable: true, color: '#8dd8e8', dir: 'right' },
  { id: 'arcade-bike', map: 'arcade', kind: 'bicycle', label: '네온 자전거', tile: [21, 15], mountable: true, speed: 9.6, color: '#ff68c4', dir: 'left' },
  { id: 'arcade-scooter', map: 'arcade', kind: 'scooter', label: '블루 킥보드', tile: [18, 15], mountable: true, speed: 8.8, color: '#69dcff', dir: 'right' },
  { id: 'arcade-book', map: 'arcade', kind: 'book', label: '공략 노트', tile: [17, 17], throwable: true, color: '#ffd35c', dir: 'right' },
  { id: 'arcade-trash', map: 'arcade', kind: 'trashbin', label: '가벼운 쓰레기통', tile: [27, 18], throwable: true, color: '#a5b2c4', dir: 'left' }
]
const ARCADE_ZONE = [8, 6, 24, 15]   // 손님이 배회하는 오락실 구역
const ARCADE_LINES = [
  '우와, 신작 나왔대!', '이 캐비닛 내 최고기록 있는데', '동전 챙겨왔지 ㅎㅎ', '오늘 신기록 간다',
  '🕹️ 이 게임 재밌겠다', '구경만 해도 재밌네', '한 판만 더...', '여기 분위기 좋다',
  '옆 사람 플레이 잘하네', '이따 랭킹 봐야지'
]
const SOCIAL_OPENERS = [
  '잠깐, 지금 뭐 하고 있어요?', '방금 아이디어 하나 떠올랐어요', '요즘 플레이 감각 어때요?',
  '잠깐 쉬면서 얘기할래요?', '이 부분 같이 보면 재밌겠는데요'
]
const SOCIAL_REPLIES = [
  '오, 그 관점은 좋네요!', '맞아요. 한 번 시험해보죠', '저도 비슷하게 느꼈어요',
  '그럼 다음 판에 확인해봐요', '좋아요, 메모해둘게요'
]
const PLAYER_REPLIES = ['좋아, 계속 해보자!', '그거 괜찮은데?', '다음 테스트에 넣어보자', '응, 결과가 궁금하네']
const PORTABLE_LINES = ['휴대기로 짧게 한 판!', '이 조작, 손에 착 붙는데?', '어디서든 테스트 가능 🎮', '한 판만 더 하고 갈게요']
const WORK_LINES = ['좋아, 다시 집중!', '이 부분만 마무리하자', '진행 상황 업데이트 중...', '테스트 한 번 더 돌려볼게요']
const stableUnit = value => {
  let h = 2166136261
  for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return (h >>> 0) / 4294967295
}

export class Engine {
  constructor(canvas, { maps, manifest, walkManifest, onHint, onInteract, onAgentEvent } = {}) {
    this.cv = canvas
    this.ctx = canvas.getContext('2d')
    this.maps = maps
    this.manifest = manifest
    // Walking atlases once shipped with their horizontal rows reversed. Keep
    // every directional still and atlas on the same audited build even when a
    // browser/CDN still owns a response for the old, unversioned public URL.
    this.avatarAssetVersion = avatarAssetVersion(walkManifest)
    this.onHint = onHint || (() => {})
    this.onInteract = onInteract || (() => {})
    this.onAgentEvent = onAgentEvent || (() => {})
    this.images = {}       // idle/portrait images: id -> {down,left,right,up,face}
    this.walkSheets = {}   // 144x288 sheet: 3 gait columns x 4 canonical directions
    this.mapImg = {}
    this.mapDepthEnabled = {}
    this.map = 'office'
    this.keys = new Set()
    this.player = this._ent('player', 'player', this.maps.office.spawn, 'down')
    this.player.speed = PLAYER_WALK_SPEED
    this.agents = new Map()
    this.freezePlayer = false
    this.meetingMode = false
    this.simMode = false
    this.cabinetLabels = {}   // cabinetIdx -> {title, emoji, color, playerName}
    this.marquee = null       // 배포 중 게임 {title emoji color}
    this.moveMarker = null    // 유저 클릭 이동 피드백
    this.hoverTile = null     // 마우스가 가리키는 이동 가능 타일
    this.interactionTarget = null
    // A task guide is intentionally independent from the transient proximity
    // hint. Picking up a prop changes interactionTarget to the player, while
    // the teammate selected by the task must remain visually identifiable.
    this.guideTarget = null
    this.stepFx = []          // 발걸음 먼지/잔상
    this.impactFx = []        // 던진 소품의 충돌/바운스 파티클
    this.npcReactions = new NpcReactionSystem({ tileSize: T })
    this.avatarEmotions = new AvatarEmotionSystem({
      onEmotion: event => this.onAgentEvent(event)
    })
    this.worldObjects = this._createWorldObjects()
    this.mountedVehicleId = null
    this.heldObjectId = null
    this.currentHint = null
    this.camera = { x: this.player.x, y: this.player.y, zoom: 1 }
    this._newPaks = new Map() // gameId -> {until, kind:'new'|'up'} 신규/업그레이드 게임팩 하이라이트
    this._motionMedia = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
    this.reduceMotion = !!this._motionMedia?.matches
    this._onMotionChange = e => { this.reduceMotion = !!e.matches }
    this._motionMedia?.addEventListener?.('change', this._onMotionChange)
    this._raf = 0
    this._last = 0
    this._hintKey = ''
    this._assignmentSeq = 0
    this._sentenceCooldowns = new Map()
    this.t = 0
  }

  // ---------- assets ----------
  async load(spriteIds) {
    const jobs = []
    const img = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src })
    const imgWithFallback = async (primary, fallback) => (await img(primary)) || img(fallback)
    for (const m of ['office', 'arcade']) {
      if (!this.mapImg[m]) jobs.push((async () => {
        const v2 = await img(`/assets/map_${m}_v2.png`)
        this.mapDepthEnabled[m] = !!v2
        this.mapImg[m] = v2 || await img(`/assets/map_${m}.png`)
      })())
    }
    for (const id of spriteIds) {
      if (!this.images[id]) {
        this.images[id] = {}
        for (const d of [...DIRS, 'face']) {
          jobs.push(
            imgWithFallback(avatarAssetUrl(id, `${d}.png`, this.avatarAssetVersion), `/assets/sprites/${id}/${d}.png`)
              .then(i => { this.images[id][d] = i })
          )
        }
      }
      if (!(id in this.walkSheets)) {
        this.walkSheets[id] = null
        jobs.push(img(avatarAssetUrl(id, 'walk-sheet.png', this.avatarAssetVersion)).then(i => { this.walkSheets[id] = i }))
      }
    }
    await Promise.all(jobs)
  }

  _ent(id, sprite, tile, dir = 'down') {
    const x = tile[0] * T + T / 2
    const y = tile[1] * T + T - 6
    return {
      id, sprite, x, y, dir,
      path: [], speed: 3.0, moving: false, sitting: false,
      stepAt: 0, stepSide: 0,
      walkAnimation: createWalkState(x, y),
      walkMotion: createAvatarWalkMotionState(),
      seatMotion: createSeatMotionState(),
      seatIdleMs: 0, seatCandidateId: null, seatBlockedUntil: 0,
      bubble: null, cb: null, state: 'idle', idleT: 2000 + Math.random() * 4000,
      label: '', color: '#fff', visible: true, home: null, meta: {}, autonomy: null
    }
  }

  _createWorldObjects() {
    return WORLD_OBJECTS.map(spec => ({
      ...spec,
      x: spec.tile[0] * T + T / 2,
      y: spec.tile[1] * T + T - 6,
      z: 0, vx: 0, vy: 0, vz: 0, spin: 0,
      held: false, mounted: false, bounces: 0, hitAt: 0
    }))
  }

  addAgent(id, sprite, tile, { label, color, home, map, autonomy = 'auto', autonomyProfile, strategy } = {}) {
    const e = this._ent(id, sprite, tile)
    e.label = label || id; e.color = color || '#fff'; e.home = home || null
    e.map = map || this.map
    this.agents.set(id, e)
    // Known team/visitor NPCs opt into autonomy by default. Scripted one-off
    // entities stay deterministic unless the caller passes autonomy:true.
    const autoEnabled = autonomy === true || (autonomy === 'auto' && (!!home || /^v\d+/i.test(id)))
    if (autoEnabled) {
      const profiles = autonomyProfile
        ? (Array.isArray(autonomyProfile) ? autonomyProfile : [autonomyProfile])
        : home ? ['team', id] : ['visitor', strategy]
      this.enableAutonomy(id, { profiles })
    }
    return e
  }
  removeAgent(id) {
    const e = this.agents.get(id)
    if (e) this._finishAssignment(e, 'cancelled', 'agent-removed')
    this.npcReactions.forgetAgent(id)
    if (e) this.avatarEmotions.forget(e)
    this.agents.delete(id)
    if (this.guideTarget?.type === 'agent' && this.guideTarget.id === id) this.setGuideTarget(null)
  }
  agent(id) { return this.agents.get(id) }
  clearAgents() {
    for (const e of this.agents.values()) {
      this._finishAssignment(e, 'cancelled', 'agents-cleared')
      this.avatarEmotions.forget(e)
    }
    this.npcReactions.reset(this.agents)
    this.agents.clear()
    this.setGuideTarget(null)
  }

  /**
   * Persistently highlights a task target without changing the current E/F
   * interaction. Agent targets are stored by id so the ring follows autonomous
   * movement. Passing null (or an unknown agent) clears the guide.
   */
  setGuideTarget(target = null) {
    if (target == null) {
      this.guideTarget = null
      return null
    }
    const descriptor = typeof target === 'string' ? { type: 'agent', id: target } : target
    if (descriptor?.type !== 'agent' || !descriptor.id || !this.agents.has(descriptor.id)) {
      this.guideTarget = null
      return null
    }
    this.guideTarget = { type: 'agent', id: descriptor.id }
    return this.guideTarget
  }

  _resolveGuideTarget() {
    const target = this.guideTarget
    if (!target) return null
    const agent = target.type === 'agent' ? this.agents.get(target.id) : null
    if (!agent || !agent.visible || (agent.map && agent.map !== this.map)) return null
    return this._resolveInteractionTarget(target)
  }

  // ---------- autonomous NPC public API ----------
  enableAutonomy(id, options = {}) {
    const e = this.agents.get(id)
    if (!e) return null
    const variation = stableUnit(id)
    const profiles = options.profiles || (e.home ? ['team', id] : ['visitor'])
    e.autonomy = createAutonomyState({
      ...options,
      enabled: options.enabled !== false,
      profiles,
      now: this.t,
      speedScale: options.speedScale ?? (0.92 + variation * 0.18),
      arrivalRadius: options.arrivalRadius ?? (4 + variation * 3)
    })
    e.meta.autonomy = autonomySnapshot(e.autonomy)
    return e.autonomy
  }

  configureAutonomy(id, patch = {}) {
    const e = this.agents.get(id)
    if (!e) return null
    if (!e.autonomy) this.enableAutonomy(id, patch)
    else configureAutonomyState(e.autonomy, patch)
    e.meta.autonomy = autonomySnapshot(e.autonomy)
    return e.autonomy
  }

  disableAutonomy(id, reason = 'disabled') {
    const e = this.agents.get(id)
    if (!e?.autonomy) return false
    this._finishAutonomyGoal(e, 'cancelled', reason)
    this._finishAssignment(e, 'cancelled', reason)
    e.autonomy.enabled = false
    e.meta.autonomy = autonomySnapshot(e.autonomy)
    return true
  }

  suspendAutonomy(id, reason = 'external') {
    const e = this.agents.get(id)
    if (!e?.autonomy) return false
    e.autonomy.suspendedBy = reason
    e.path = e.meta.autonomyPath ? [] : e.path
    delete e.meta.autonomyPath
    return true
  }

  resumeAutonomy(id, reason = null) {
    const e = this.agents.get(id)
    if (!e?.autonomy || (reason && e.autonomy.suspendedBy !== reason)) return false
    e.autonomy.suspendedBy = null
    e.autonomy.nextThinkAt = Math.max(e.autonomy.nextThinkAt || 0, this.t + 250)
    return true
  }

  getAutonomyState(id) {
    const e = this.agents.get(id)
    return e?.autonomy ? autonomySnapshot(e.autonomy) : null
  }

  getChairSeatingState() {
    const occupancy = this._seatOccupancy()
    const actors = this._eligibleSeatActors().map(e => ({
      id: e.id,
      kind: e === this.player ? 'player' : 'team',
      sitting: !!e.sitting,
      phase: e.seatMotion?.phase || SEAT_PHASES.STANDING,
      mix: Number(e.seatMotion?.mix) || 0,
      seatId: e.seatMotion?.seatId || e.meta?.seat?.id || null,
      source: e.meta?.seat?.source || null,
      candidateId: e.seatCandidateId || null,
      idleMs: Math.round(e.seatIdleMs || 0),
      blockedReason: this._autoSeatBlockReason(e),
      position: { x: e.x, y: e.y }
    }))
    const chairs = this._officeDeskSeats().map(seat => ({
      id: seat.id,
      ownerId: seat.ownerId,
      tile: [...seat.tile],
      face: seat.face,
      anchor: { ...seat.anchor },
      occupiedBy: occupancy.get(seat.id) || null
    }))
    return {
      enabled: this.map === 'office' && !this.meetingMode && !this.simMode,
      map: this.map,
      meetingMode: !!this.meetingMode,
      chairs,
      actors,
      player: actors.find(actor => actor.id === 'player') || null,
      team: actors.filter(actor => actor.kind === 'team')
    }
  }

  getReactionEvidence(limit = 40) {
    return this.npcReactions.getEvidence(limit)
  }

  // Shared emotion API for player, team members and arcade visitors. Explicit
  // calls still respect the system's hard cooldowns to prevent refresh loops.
  expressEmotion(id, kind, options = {}) {
    const e = id === 'player' ? this.player : this.agents.get(id)
    return e ? this.avatarEmotions.express(e, kind, { ...options, now: this.t }) : null
  }

  cueEmotion(id, cue, context = {}) {
    const e = id === 'player' ? this.player : this.agents.get(id)
    return e ? this.avatarEmotions.cue(e, cue, { ...context, now: this.t }) : null
  }

  getEmotionState(id) {
    const e = id === 'player' ? this.player : this.agents.get(id)
    return e ? this.avatarEmotions.snapshot(e, this.t) : null
  }

  clearEmotion(id) {
    const e = id === 'player' ? this.player : this.agents.get(id)
    return e ? this.avatarEmotions.clear(e) : false
  }

  setHandheld(id, handheld = null) {
    const e = id === 'player' ? this.player : this.agents.get(id)
    if (!e) return false
    if (!handheld || handheld.active === false) {
      delete e.meta.handheld
      if (e.meta.activity === 'portablePlay') delete e.meta.activity
    } else {
      e.meta.handheld = { active: true, state: 'playing', ...handheld }
      e.meta.activity = 'portablePlay'
    }
    this.onAgentEvent({ type: 'handheld', agent: e, handheld: e.meta.handheld || null })
    return true
  }

  // Contract used by ArcadeSim/portable-play integrations.
  // enqueueNpcGoal(id, {kind:'play-game', venue:'cabinet'|'handheld',
  //   target:[tx,ty], gameId, title, maxDurationMs, onArrive,
  //   allowDuringSim:true}) -> {id, promise, cancel}
  enqueueNpcGoal(agentId, request = {}) {
    const e = this.agents.get(agentId)
    if (!e) return null
    if (!e.autonomy) this.enableAutonomy(agentId, { profiles: [/^v\d+/i.test(agentId) ? 'visitor' : 'team', agentId] })
    const a = e.autonomy
    if (a.assignment) this._finishAssignment(e, 'cancelled', 'superseded')
    if (a.currentGoal) this._finishAutonomyGoal(e, 'cancelled', 'assigned-goal-preempt')
    // Assigned evaluation goals have higher priority than the stagger/ambient
    // `goTo` command that may still be taking the visitor to an idle spot.
    e.path = []
    e.cb = null
    this._standEntity(e, 'assignment')
    delete e.meta.autonomyPath
    a.externalCommand = false
    a.externalCommandAt = 0

    const venue = request.venue || (request.kind === 'portablePlay' ? 'handheld' : 'cabinet')
    const kind = request.kind === 'play-game'
      ? (['handheld', 'portable', 'gameboy'].includes(venue) ? NPC_GOALS.PORTABLE_PLAY : NPC_GOALS.ARCADE_PLAY)
      : request.kind === 'return-to-desk' ? NPC_GOALS.RETURN_HOME
        : (request.kind || NPC_GOALS.IDLE)
    const target = Array.isArray(request.target) ? request.target
      : Array.isArray(request.target?.tile) ? request.target.tile : null
    const id = `npc-goal-${++this._assignmentSeq}`
    let resolve
    const promise = new Promise(res => { resolve = res })
    const assignment = {
      id, kind, venue, target, gameId: request.gameId || null, title: request.title || '',
      maxDurationMs: Math.max(800, Math.min(18000, request.maxDurationMs || 6000)),
      maxReplans: Math.max(0, Math.min(5, request.maxReplans ?? 3)),
      onArrive: typeof request.onArrive === 'function' ? request.onArrive : null,
      allowDuringSim: request.allowDuringSim !== false,
      queuedAt: this.t, arrived: false, resolve,
      evidence: [{ type: 'assigned', at: this.t, venue, target }]
    }
    a.assignment = assignment
    a.nextThinkAt = this.t
    a.blockedUntil = this.t
    a.replanTimes = [] // explicit assignment receives a fresh bounded budget
    e.meta.autonomyAssignment = {
      id, kind, venue, target, gameId: assignment.gameId, status: 'queued',
      routePlan: [], evidence: assignment.evidence, replans: a.replanCount,
      timeoutAt: this.t + a.limits.maxGoalMs
    }
    return {
      id,
      promise,
      cancel: () => {
        if (e.autonomy?.assignment?.id !== id) return false
        this._finishAutonomyGoal(e, 'cancelled', 'caller-cancelled')
        this._finishAssignment(e, 'cancelled', 'caller-cancelled')
        return true
      }
    }
  }

  requestAgentGoal(agentId, kind, options = {}) {
    return this.enqueueNpcGoal(agentId, { ...options, kind })
  }

  // 오락실 상시 손님: 시뮬레이션이 없어도 맵에 활기가 돌도록 배회 NPC 유지
  ensureArcadeAmbient(visitors) {
    for (const v of visitors) {
      const existed = this.agents.get(v.id)
      if (existed) {
        existed.meta.ambientArcade = true
        this.configureAutonomy(v.id, { profiles: ['visitor', v.strategy] })
        continue
      }
      const spot = this._randomNpcTile(ARCADE_ZONE, 'arcade') || this.maps.arcade.spawn
      const e = this.addAgent(v.id, v.id, spot, {
        label: `${v.name}(${v.age})`, color: '#c9d1ff', map: 'arcade',
        autonomy: true, autonomyProfile: ['visitor', v.strategy], strategy: v.strategy
      })
      e.meta.ambientArcade = true
      e.meta.strategy = v.strategy
      e.idleT = 800 + Math.random() * 6000
      e.dir = DIRS[Math.floor(Math.random() * DIRS.length)]
    }
  }

  grid() { return this.maps[this.map].collision }

  _dynamicAvoid(mapName = this.map) {
    return dynamicAvoidTiles(this.maps[mapName], this.worldObjects, mapName, T)
  }

  _npcGrid(mapName = this.map, keepTiles = []) {
    return navigationGridWithAvoid(this.maps[mapName], this.worldObjects, mapName, T, keepTiles)
  }

  _randomNpcTile(zone, mapName = this.map) {
    const map = this.maps[mapName]
    const avoid = this._dynamicAvoid(mapName)
    const occupied = occupiedEntityTiles(this.agents.values(), mapName, T)
    for (const key of occupied) avoid.add(key)
    if (mapName === this.map && this.player?.visible !== false) {
      const playerOccupied = occupiedEntityTiles([{ ...this.player, map: mapName, visible: true }], mapName, T)
      for (const key of playerOccupied) avoid.add(key)
    }
    return randomWalkableAvoiding(map.collision, zone, avoid)
  }

  setMap(name, playerTile) {
    this.npcReactions.reset(this.agents)
    this._standEntity(this.player, 'map-change', { immediate: true })
    if (this.mountedVehicleId) this.dismountVehicle({ silent: true })
    if (this.heldObjectId) this.dropHeld({ silent: true })
    this.map = name
    if (playerTile) { this.player.x = playerTile[0] * T + T / 2; this.player.y = playerTile[1] * T + T - 6 }
    this.player.path = []
    this.moveMarker = null
    this.hoverTile = null
    this.interactionTarget = null
    this.setGuideTarget(null)
    this.currentHint = null
    this._hintKey = ''
    this.onHint(null)
    this.stepFx = []
    this.centerCamera(true)
  }

  setZoom(value) {
    this.camera.zoom = Math.max(1, Math.min(1.72, Math.round(value * 100) / 100))
    this.centerCamera(true)
    return this.camera.zoom
  }
  resizeViewport(cssWidth, cssHeight, dpr = 1) {
    const ratio = Math.max(1, Math.min(2, dpr || 1))
    const width = Math.max(320, Math.round(cssWidth * ratio))
    const height = Math.max(240, Math.round(cssHeight * ratio))
    if (this.cv.width !== width || this.cv.height !== height) {
      this.cv.width = width
      this.cv.height = height
      this.ctx.imageSmoothingEnabled = false
      this.centerCamera(true)
    }
  }
  _renderScale() {
    return Math.max(this.cv.width / WORLD_W, this.cv.height / WORLD_H) * this.camera.zoom
  }
  centerCamera(snap = false) {
    const scale = this._renderScale()
    const halfW = this.cv.width / (2 * scale), halfH = this.cv.height / (2 * scale)
    const tx = Math.max(halfW, Math.min(WORLD_W - halfW, this.player.x))
    const ty = Math.max(halfH, Math.min(WORLD_H - halfH, this.player.y))
    if (snap) { this.camera.x = tx; this.camera.y = ty }
    return { x: tx, y: ty }
  }

  // ---------- agent commands ----------
  _officeDeskSeats() {
    const seats = this.maps?.office?.seats || {}
    return Object.entries(seats)
      .filter(([, value]) => Array.isArray(value?.desk) && value.desk.length >= 2)
      .map(([ownerId, value]) => {
        const tile = [Number(value.desk[0]), Number(value.desk[1])]
        const anchor = { x: tile[0] * T + T / 2, y: tile[1] * T + T - 8 }
        return {
          id: `desk-${ownerId}`,
          ownerId,
          kind: 'desk',
          tile,
          face: value.face || 'up',
          x: anchor.x,
          y: anchor.y,
          anchor,
          approach: anchor,
          occluderId: `desk-${ownerId}-front`
        }
      })
  }

  _seatActorById(id) {
    return id === 'player' ? this.player : this.agents.get(id)
  }

  _eligibleSeatActors() {
    const eligibleIds = new Set(this._officeDeskSeats().map(seat => seat.ownerId))
    return [this.player, ...this.agents.values()].filter(e => (
      eligibleIds.has(e.id) && (e === this.player || !!e.home)
    ))
  }

  _seatForTile(tile) {
    if (!Array.isArray(tile)) return null
    return this._officeDeskSeats().find(seat => seat.tile[0] === tile[0] && seat.tile[1] === tile[1]) || null
  }

  _hasSeatState(e) {
    return !!(e?.sitting || e?.meta?.seat || (e?.seatMotion?.mix || 0) > 0)
  }

  _seatEntity(e, seat, { source = 'scripted', immediate = false } = {}) {
    if (!e || !seat?.anchor) return false
    const currentSeatId = e.seatMotion?.seatId || e.meta?.seat?.id
    const sameActiveSeat = currentSeatId === seat.id && (e.seatMotion?.mix || 0) > 0
    e.x = seat.anchor.x
    e.y = seat.anchor.y
    e.dir = seat.face || 'down'
    e.path = []
    e.moving = false
    const resolveImmediately = immediate || this.reduceMotion
    if (resolveImmediately) {
      e.seatMotion = createSeatMotionState({ phase: SEAT_PHASES.SEATED, seat })
    } else if (sameActiveSeat) {
      // Repeated RETURN_HOME/WORK plans may call sit while the actor is already
      // in this chair. Preserve the current mix instead of popping upright and
      // replaying the whole transition every time the planner checks in.
      e.seatMotion = e.seatMotion.phase === SEAT_PHASES.EXITING
        ? advanceSeatMotion(e.seatMotion, { actor: e, seat, near: true, deltaMs: 1 })
        : { ...e.seatMotion, facing: seat.face || e.seatMotion.facing, anchor: { ...seat.anchor } }
    } else {
      e.seatMotion = advanceSeatMotion(createSeatMotionState(), { actor: e, seat, near: true, deltaMs: 0 })
    }
    e.sitting = resolveImmediately || seatPoseLayout(e.seatMotion).isSeated
    e.seatIdleMs = 0
    e.seatCandidateId = seat.id
    e.meta.seat = {
      id: seat.id,
      ownerId: seat.ownerId || null,
      kind: seat.kind || 'chair',
      tile: seat.tile ? [...seat.tile] : null,
      face: e.dir,
      anchor: { ...seat.anchor },
      enteredAt: this.t,
      source,
      occluderId: seat.occluderId || null
    }
    delete e.meta.seatExit
    delete e.meta.autonomyPath
    return true
  }

  _standEntity(e, reason = 'manual', { immediate = false, cooldownMs = 140 } = {}) {
    if (!e) return false
    const hadSeat = this._hasSeatState(e)
    e.seatMotion = advanceSeatMotion(e.seatMotion, {
      enabled: false,
      immediate,
      // A one-millisecond seed moves mix=1 into EXITING immediately. Passing
      // zero leaves the pure reducer at its seated upper bound for one frame.
      deltaMs: immediate ? 0 : 1,
      reduceMotion: this.reduceMotion
    })
    e.sitting = false
    e.seatIdleMs = 0
    e.seatCandidateId = null
    e.seatBlockedUntil = Math.max(e.seatBlockedUntil || 0, this.t + Math.max(0, cooldownMs))
    if (e.meta.seat) {
      e.meta.lastSeatExit = { id: e.meta.seat.id, reason, at: this.t }
      if (!immediate && (e.seatMotion?.mix || 0) > 0) e.meta.seatExit = { ...e.meta.seat }
      delete e.meta.seat
    }
    if (immediate || e.seatMotion?.phase === SEAT_PHASES.STANDING) delete e.meta.seatExit
    return hadSeat
  }

  stand(id, reason = 'manual') {
    return this._standEntity(this._seatActorById(id), reason)
  }

  _seatOccupancy() {
    const occupancy = new Map()
    for (const e of this._eligibleSeatActors()) {
      const seatId = e.seatMotion?.seatId || e.meta?.seat?.id
      if (seatId && ((e.seatMotion?.mix || 0) > 0 || e.sitting)) occupancy.set(seatId, e.id)
    }
    return occupancy
  }

  _moveBesideSeat(e, seat) {
    if (!e || !seat?.anchor) return false
    const offsets = [[0, 34], [-34, 26], [34, 26], [-38, 0], [38, 0]]
    const others = [this.player, ...this.agents.values()].filter(other => other !== e && other.visible !== false)
    const candidates = offsets.map(([dx, dy]) => ({ x: seat.anchor.x + dx, y: seat.anchor.y + dy }))
    const destination = candidates.find(point => this._walkable(point.x, point.y)
      && others.every(other => Math.hypot(other.x - point.x, other.y - point.y) > 24))
      || candidates.find(point => this._walkable(point.x, point.y))
    if (!destination) return false
    e.x = destination.x
    e.y = destination.y
    e.dir = 'down'
    e.path = []
    e.moving = false
    return true
  }

  _ownerNeedsSeat(seat, actor) {
    if (!seat?.ownerId || seat.ownerId === actor.id) return false
    const owner = this._seatActorById(seat.ownerId)
    if (!owner || !owner.visible || (owner.map && owner.map !== 'office')) return false
    if ((owner.seatMotion?.seatId || owner.meta?.seat?.id) === seat.id) return true
    const proximity = seatApproachProximity(owner, seat, {
      enterRadius: AUTO_SEAT_ENTER_RADIUS,
      releaseRadius: AUTO_SEAT_RELEASE_RADIUS
    })
    if (proximity.withinRelease) return true
    const destination = owner.path?.at(-1) || owner.autonomy?.currentGoal?.targetTile
    return Array.isArray(destination) && destination[0] === seat.tile[0] && destination[1] === seat.tile[1]
  }

  _autoSeatBlockReason(e) {
    if (this.map !== 'office' || (e.map && e.map !== 'office')) return 'map'
    if (this.meetingMode) return 'meeting'
    if (this.simMode) return 'simulation'
    if (!e.visible) return 'hidden'
    if (e.path?.length || e.moving) return 'movement'
    if ((e.seatBlockedUntil || 0) > this.t) return 'cooldown'
    if (this._reactionUntil(e) > this.t) return 'reaction'
    if (e.meta?.chatting || e.meta?.activity === 'socialize' || (e.meta?.socialLock?.until || 0) > this.t) return 'social'
    if (e === this.player) {
      if (this.freezePlayer) return 'frozen'
      if (this.mountedVehicleId || e.meta?.rideMotion) return 'mounted'
      if (this.heldObjectId) return 'holding'
    }
    if (!e.meta?.seat && e.autonomy?.currentGoal && e.autonomy.currentGoal.kind !== NPC_GOALS.IDLE) return 'autonomy'
    return null
  }

  _autoSeatCandidate(e, occupancy) {
    return this._officeDeskSeats()
      .map(seat => ({
        seat,
        proximity: seatApproachProximity(e, seat, {
          enterRadius: AUTO_SEAT_ENTER_RADIUS,
          releaseRadius: AUTO_SEAT_RELEASE_RADIUS
        })
      }))
      .filter(({ seat, proximity }) => {
        // Team members own one authored workstation each. Allowing them to
        // claim another desk creates a later owner-return collision; the
        // player may still try any genuinely free chair.
        if (e !== this.player && seat.ownerId !== e.id) return false
        const occupiedBy = occupancy.get(seat.id)
        if (occupiedBy && occupiedBy !== e.id) return false
        if (seat.id === e.seatMotion?.seatId) return proximity.withinRelease
        return proximity.withinEnter && !this._ownerNeedsSeat(seat, e)
      })
      .sort((a, b) => (
        Number(b.seat.ownerId === e.id) - Number(a.seat.ownerId === e.id)
        || a.proximity.distance - b.proximity.distance
        || a.seat.id.localeCompare(b.seat.id)
      ))[0] || null
  }

  _updateAutomaticChairSeating(dt) {
    const actors = this._eligibleSeatActors()
    const occupancy = this._seatOccupancy()
    for (const e of actors) {
      const reactionUntil = this._reactionUntil(e)
      if (reactionUntil > this.t && this._hasSeatState(e)) {
        this._standEntity(e, 'reaction', {
          cooldownMs: reactionUntil - this.t + AUTO_SEAT_REACTION_COOLDOWN
        })
        continue
      }
      const socialActive = e.meta?.chatting
        || e.meta?.activity === 'socialize'
        || (e.meta?.socialLock?.until || 0) > this.t
      if (socialActive && this._hasSeatState(e)) {
        // The React chat panel can set `chatting` without routing the actor to
        // a safe standing tile. Keep an already seated teammate in the chair
        // (and restore the authored facing) rather than standing them inside
        // the desk. Planner-driven SOCIALIZE calls _standEntity before moving.
        if (e.meta?.seat) {
          e.path = []
          e.moving = false
          e.dir = e.meta.seat.face || e.dir
        }
        continue
      }
      // Scripted/home/meeting seats own their target. Their transition is
      // advanced separately so meeting callbacks stay deterministic while the
      // visible body still eases into the chair.
      if (e.meta?.seat?.source && e.meta.seat.source !== 'proximity') continue
      if (e.seatMotion?.phase === SEAT_PHASES.EXITING) continue

      const blocked = this._autoSeatBlockReason(e)
      if (blocked) {
        if ((e.seatMotion?.mix || 0) > 0) this._standEntity(e, blocked)
        else { e.seatIdleMs = 0; e.seatCandidateId = null }
        continue
      }
      const candidate = this._autoSeatCandidate(e, occupancy)
      if (!candidate) {
        if ((e.seatMotion?.mix || 0) > 0) this._standEntity(e, 'left-chair')
        else { e.seatIdleMs = 0; e.seatCandidateId = null }
        continue
      }
      if (e.seatCandidateId !== candidate.seat.id) {
        e.seatCandidateId = candidate.seat.id
        e.seatIdleMs = 0
      }
      e.seatIdleMs += dt
      if (e.seatIdleMs < AUTO_SEAT_IDLE_MS && !(e.seatMotion?.mix > 0)) continue

      e.seatMotion = advanceSeatMotion(e.seatMotion, {
        actor: e,
        seat: candidate.seat,
        near: true,
        deltaMs: dt,
        enterRadius: AUTO_SEAT_ENTER_RADIUS,
        releaseRadius: AUTO_SEAT_RELEASE_RADIUS,
        reduceMotion: this.reduceMotion
      })
      const pose = seatPoseLayout(e.seatMotion)
      const settle = this.reduceMotion ? 1 : Math.min(1, dt / 80)
      e.x += (candidate.seat.anchor.x - e.x) * settle
      e.y += (candidate.seat.anchor.y - e.y) * settle
      if (e.seatMotion.phase === SEAT_PHASES.SEATED) {
        e.x = candidate.seat.anchor.x
        e.y = candidate.seat.anchor.y
      }
      e.dir = candidate.seat.face
      e.moving = false
      e.sitting = pose.isSeated
      e.meta.seat = {
        id: candidate.seat.id,
        ownerId: candidate.seat.ownerId,
        kind: 'desk',
        tile: [...candidate.seat.tile],
        face: candidate.seat.face,
        anchor: { ...candidate.seat.anchor },
        enteredAt: e.meta.seat?.enteredAt ?? this.t,
        source: 'proximity',
        occluderId: candidate.seat.occluderId
      }
      occupancy.set(candidate.seat.id, e.id)
    }
  }

  _advanceNonProximitySeatMotion(dt) {
    for (const e of this._eligibleSeatActors()) {
      if (e.seatMotion?.phase === SEAT_PHASES.EXITING) {
        e.seatMotion = advanceSeatMotion(e.seatMotion, {
          enabled: false,
          deltaMs: dt,
          reduceMotion: this.reduceMotion
        })
        if (e.seatMotion.phase === SEAT_PHASES.STANDING) {
          e.sitting = false
          delete e.meta.seatExit
        }
        continue
      }
      const seatMeta = e.meta?.seat
      if (!seatMeta || seatMeta.source === 'proximity' || e.seatMotion?.phase === SEAT_PHASES.SEATED) continue
      const seat = {
        id: seatMeta.id,
        ownerId: seatMeta.ownerId,
        kind: seatMeta.kind,
        tile: seatMeta.tile,
        face: seatMeta.face,
        x: seatMeta.anchor.x,
        y: seatMeta.anchor.y,
        anchor: seatMeta.anchor,
        approach: seatMeta.anchor,
        occluderId: seatMeta.occluderId
      }
      e.seatMotion = advanceSeatMotion(e.seatMotion, {
        actor: e,
        seat,
        near: true,
        deltaMs: dt,
        reduceMotion: this.reduceMotion
      })
      e.dir = seat.face
      e.sitting = seatPoseLayout(e.seatMotion).isSeated
    }
  }

  goTo(id, tile, cb, options = {}) {
    const e = id === 'player' ? this.player : this.agents.get(id)
    if (!e) return
    const autonomous = options.autonomous === true
    if (e !== this.player && e.autonomy && !autonomous) {
      if (e.autonomy.currentGoal) this._finishAutonomyGoal(e, 'cancelled', options.reason || 'scripted-command')
      e.autonomy.externalCommand = true
      e.autonomy.externalCommandAt = this.t
      e.autonomy.nextThinkAt = this.t + 400
      delete e.meta.autonomyPath
    }
    this._standEntity(e, options.reason || 'go-to')
    const from = [Math.floor(e.x / T), Math.floor(e.y / T)]
    const path = astar(this.grid(), from, tile)
    e.path = path || []
    const done = () => {
      if (e.autonomy && !autonomous) e.autonomy.externalCommand = false
      cb && cb()
    }
    e.cb = done
    if (!path || !path.length) { e.cb = null; done() }
  }
  sit(id, tile, face, options = {}) {
    const e = this._seatActorById(id); if (!e) return false
    if (e !== this.player && !e.home) return false
    const registered = this._seatForTile(tile)
    const anchor = { x: tile[0] * T + T / 2, y: tile[1] * T + T - 8 }
    const seat = registered || {
      id: `scripted:${tile[0]}:${tile[1]}`,
      ownerId: null,
      kind: 'scripted',
      tile: [...tile],
      face: face || 'down',
      x: anchor.x,
      y: anchor.y,
      anchor,
      approach: anchor,
      occluderId: null
    }
    seat.face = face || seat.face || 'down'
    if (registered) {
      const occupiedBy = this._seatOccupancy().get(registered.id)
      if (occupiedBy && occupiedBy !== e.id) {
        // The authored owner wins their desk when returning from a goal. Move
        // a temporary player sitter to the clear aisle before seating the
        // owner; non-owner scripted claims are rejected without overlapping.
        if (registered.ownerId !== e.id) return false
        const occupant = this._seatActorById(occupiedBy)
        this._standEntity(occupant, 'owner-return', { immediate: true, cooldownMs: 900 })
        this._moveBesideSeat(occupant, registered)
      }
    }
    this._seatEntity(e, seat, {
      source: options.source || 'scripted',
      immediate: options.immediate === true
    })
    if (e.autonomy) { e.autonomy.externalCommand = false; e.autonomy.nextThinkAt = this.t + 700 }
    return true
  }
  face(id, dir) { const e = id === 'player' ? this.player : this.agents.get(id); if (e) e.dir = dir }
  playerAutoWalk(tile, cb) {
    const p = this.player
    this._standEntity(p, 'auto-walk')
    const from = [Math.floor(p.x / T), Math.floor(p.y / T)]
    p.path = astar(this.grid(), from, tile) || []
    p.cb = cb || null
    if (!p.path.length) { p.cb = null; cb && cb() }
  }
  screenToWorld(px, py) {
    const scale = this._renderScale()
    return {
      x: (px - this.cv.width / 2) / scale + this.camera.x,
      y: (py - this.cv.height / 2) / scale + this.camera.y
    }
  }
  setPointerPosition(px, py) {
    if (px == null || py == null) { this.hoverTile = null; return }
    const world = this.screenToWorld(px, py)
    const tx = Math.floor(world.x / T), ty = Math.floor(world.y / T)
    const row = this.grid()[ty]
    this.hoverTile = row && tx >= 0 && tx < row.length
      ? { tx, ty, walkable: row[tx] === '.', x: tx * T + T / 2, y: ty * T + T - 6 }
      : null
  }
  walkPlayerToPoint(px, py) {
    if (this.freezePlayer) return false
    const world = this.screenToWorld(px, py)
    const tile = [Math.floor(world.x / T), Math.floor(world.y / T)]
    const from = [Math.floor(this.player.x / T), Math.floor(this.player.y / T)]
    const path = astar(this.grid(), from, tile)
    if (!path) {
      this.moveMarker = { x: world.x, y: world.y, valid: false, started: this.t, until: this.t + 650 }
      return false
    }
    this._standEntity(this.player, 'pointer-walk')
    this.player.path = path
    this.player.cb = null
    const goal = path[path.length - 1] || from
    this.moveMarker = {
      x: goal[0] * T + T / 2, y: goal[1] * T + T - 6,
      valid: true, started: this.t, reachedAt: path.length ? null : this.t,
      until: this.t + Math.min(9000, Math.max(2400, path.length * 240))
    }
    return true
  }
  bubble(id, text, ttl = 4200) {
    const e = id === 'player' ? this.player : this.agents.get(id)
    if (e) e.bubble = text ? { text: String(text), until: performance.now() + ttl } : null
  }
  emote(id, on) { const e = this.agents.get(id); if (e) e.meta.speaking = on }

  // ---------- free-roam props / vehicles ----------
  worldObject(id) { return this.worldObjects.find(o => o.id === id) || null }

  getWorldInteractionState() {
    const mounted = this.worldObject(this.mountedVehicleId)
    const held = this.worldObject(this.heldObjectId)
    return {
      mounted: mounted ? { id: mounted.id, kind: mounted.kind, label: mounted.label, speed: mounted.speed } : null,
      seating: this.getChairSeatingState(),
      held: held ? {
        id: held.id,
        kind: held.kind,
        label: held.label,
        actions: {
          throw: { id: 'throw', key: 'F', enabled: !this.freezePlayer },
          drop: { id: 'drop', key: 'E', enabled: !this.freezePlayer }
        }
      } : null
    }
  }

  nearbyRideableVehicle(maxDistance = T * 1.8) {
    if (this.mountedVehicleId) return this.worldObject(this.mountedVehicleId)
    return this.worldObjects
      .filter(o => o.map === this.map && o.mountable && !o.held && !o.mounted && o.z < 8 && Math.hypot(o.vx, o.vy) < .8)
      .map(o => ({ o, distance: Math.hypot(o.x - this.player.x, o.y - this.player.y) }))
      .filter(({ distance }) => distance < maxDistance)
      .sort((a, b) => a.distance - b.distance)[0]?.o || null
  }

  // Explicit action entry point for keyboard and touch UI. Pointer interaction
  // deliberately never guesses that a tap means throw: the caller must name
  // the action, which keeps pickup -> carry -> throw as three readable states.
  performWorldAction(action, target = null) {
    if (this.freezePlayer) return false
    if (action === 'throw') return this.throwHeld(target)
    if (action === 'drop') return this.dropHeld()
    if (action === 'dismount') return this.dismountVehicle()
    if (action === 'ride') {
      if (this.mountedVehicleId) return this.dismountVehicle()
      const vehicle = this.nearbyRideableVehicle()
      return vehicle ? this.mountVehicle(vehicle.id) : false
    }
    return false
  }

  settleFreeRoam({ silent = true } = {}) {
    const dropped = this.heldObjectId ? this.dropHeld({ silent }) : false
    const parked = this.mountedVehicleId ? this.dismountVehicle({ silent }) : false
    return dropped || parked
  }

  interactWorld(hint = this.currentHint) {
    if (!hint) return false
    if (hint.type === 'vehicle') return this.mountVehicle(hint.id)
    if (hint.type === 'vehicleMounted') return this.dismountVehicle()
    if (hint.type === 'prop') return this.pickupObject(hint.id)
    if (hint.type === 'heldProp') return this.dropHeld()
    return false
  }

  mountVehicle(id) {
    const o = this.worldObject(id)
    if (!o || !o.mountable || o.map !== this.map || o.mounted || o.held || this.heldObjectId || this.freezePlayer) return false
    if (Math.hypot(o.x - this.player.x, o.y - this.player.y) > T * 1.8) return false
    this._standEntity(this.player, 'mount', { immediate: true })
    if (this.mountedVehicleId) this.dismountVehicle({ silent: true })
    // Enter the parked vehicle in its visible orientation, then let movement
    // steer it. Snapping every mount to the avatar's approach direction made
    // the first seated frame look as if the bicycle rotated underneath them.
    this.player.dir = DIR_VECTOR[o.dir] ? o.dir : this.player.dir
    o.mounted = true
    o.x = this.player.x; o.y = this.player.y; o.dir = this.player.dir
    this.mountedVehicleId = o.id
    this.player.speed = o.speed
    this.player.path = []
    this.player.meta.mounted = o.kind
    this.player.meta.rideState = {
      kind: o.kind,
      vx: 0,
      vy: 0,
      cruise: 0,
      distance: 0,
      heading: null,
      bank: 0
    }
    this.player.meta.rideMotion = {
      phase: 'mount', kind: o.kind, vehicleId: o.id,
      startedAt: this.t, dir: this.player.dir
    }
    this.bubble('player', o.kind === 'bicycle' ? '자전거 출발! 🚲' : '킥보드 출발! 🛴', 1800)
    this.cueEmotion('player', 'player-mount', { source: `player-mount:${o.kind}` })
    this._hintKey = ''
    this.onInteract({ type: 'mount', object: o })
    return true
  }

  dismountVehicle({ silent = false } = {}) {
    const o = this.worldObject(this.mountedVehicleId)
    if (!o) return false
    const side = this.player.dir === 'left' ? 1 : this.player.dir === 'right' ? -1 : 1
    const candidates = [side * 34, -side * 34, 0].map(offset => ({ x: this.player.x + offset, y: this.player.y + 4 }))
    const parked = candidates.find(candidate => this._vehicleWalkable(candidate.x, candidate.y, o.kind, this.player.dir)) || {
      x: this.player.x, y: this.player.y
    }
    o.dir = this.player.dir
    o.mounted = false
    this.mountedVehicleId = null
    this.player.speed = PLAYER_WALK_SPEED
    delete this.player.meta.mounted
    delete this.player.meta.rideState
    if (silent || this.reduceMotion) {
      o.x = parked.x; o.y = parked.y
      delete o.parkMotion
      delete this.player.meta.rideMotion
    }
    else {
      o.parkMotion = {
        fromX: this.player.x, fromY: this.player.y,
        toX: parked.x, toY: parked.y,
        startedAt: this.t, duration: DISMOUNT_DURATION
      }
      o.x = this.player.x; o.y = this.player.y
      this.player.meta.rideMotion = {
        phase: 'dismount', kind: o.kind, vehicleId: o.id,
        startedAt: this.t, dir: this.player.dir
      }
    }
    if (!silent) this.bubble('player', '여기 세워둘게', 1400)
    this._hintKey = ''
    this.onInteract({ type: 'dismount', object: o })
    return true
  }

  pickupObject(id) {
    const o = this.worldObject(id)
    if (!o || !o.throwable || o.map !== this.map || o.held || o.mounted || this.heldObjectId || this.freezePlayer) return false
    if (Math.hypot(o.x - this.player.x, o.y - this.player.y) > T * 1.65) return false
    this._standEntity(this.player, 'pickup', { immediate: true })
    if (this.mountedVehicleId) this.dismountVehicle({ silent: true })
    o.held = true
    o.vx = 0; o.vy = 0; o.vz = 0; o.z = 42; o.bounces = 0
    this.heldObjectId = o.id
    this.player.meta.holding = o.kind
    this.bubble('player', `${o.label} 획득!`, 1500)
    this.cueEmotion('player', 'player-pickup', { source: `player-pickup:${o.kind}` })
    this._hintKey = ''
    this.onInteract({ type: 'pickup', object: o })
    return true
  }

  dropHeld({ silent = false } = {}) {
    const o = this.worldObject(this.heldObjectId)
    if (!o) return false
    const dir = DIR_VECTOR[this.player.dir] || DIR_VECTOR.down
    const candidate = { x: this.player.x + dir.x * 25, y: this.player.y + dir.y * 19 }
    o.x = this._propWalkable(candidate.x, candidate.y) ? candidate.x : this.player.x
    o.y = this._propWalkable(candidate.x, candidate.y) ? candidate.y : this.player.y
    o.z = 0; o.vx = 0; o.vy = 0; o.vz = 0; o.held = false; o.spin = 0
    this.heldObjectId = null
    delete this.player.meta.holding
    if (!silent) this.bubble('player', '살짝 내려놓기', 1100)
    this._hintKey = ''
    this.onInteract({ type: 'drop', object: o })
    return true
  }

  throwHeld(target = null) {
    const o = this.worldObject(this.heldObjectId)
    if (!o || this.freezePlayer) return false
    let dir = DIR_VECTOR[this.player.dir] || DIR_VECTOR.down
    if (target) {
      const dx = target.x - this.player.x, dy = target.y - this.player.y
      const d = Math.hypot(dx, dy)
      if (d > 1) dir = { x: dx / d, y: dy / d }
    }
    const power = o.kind === 'trashbin' ? 7.2 : 9.6
    o.x = this.player.x + dir.x * 20
    o.y = this.player.y + dir.y * 16
    o.z = o.kind === 'trashbin' ? 28 : 34
    o.vx = dir.x * power
    o.vy = dir.y * power
    o.vz = o.kind === 'trashbin' ? 6.8 : 8.2
    o.spin = 0; o.bounces = 0; o.held = false; o.hitAt = 0
    this.heldObjectId = null
    delete this.player.meta.holding
    this._impact(o.x, o.y, o.color, 'whoosh')
    this.bubble('player', o.kind === 'trashbin' ? '통째로 간다! 🗑️' : '받아라! 📘', 1200)
    this.cueEmotion('player', 'player-throw', { source: `player-throw:${o.kind}` })
    this._hintKey = ''
    this.onInteract({ type: 'throw', object: o, direction: dir })
    return true
  }

  // 모바일/마우스: 첫 탭은 소품을 집기만 한다. 들고 있을 때의 일반 탭은
  // 이동을 계속하도록 false를 돌려주고, 명시적 터치 액션만 투척/내려놓기로 해석한다.
  interactAtPoint(px, py, options = {}) {
    if (this.freezePlayer) return false
    const heldAction = options?.heldAction || null
    const world = this.screenToWorld(px, py)
    const playerDistance = Math.hypot(world.x - this.player.x, world.y - this.player.y)
    if (this.heldObjectId) {
      if (heldAction === 'throw') return this.performWorldAction('throw', world)
      if (heldAction === 'drop') return this.performWorldAction('drop')
      return false
    }
    if (this.mountedVehicleId && playerDistance < 45) return this.dismountVehicle()
    // The station is tall, so its visible device sits well above its floor
    // anchor. Give the full silhouette a generous tap target on touch screens.
    const pocket = this.worldObject(POCKET_STATION.id)
    if (pocket?.map === this.map && Math.hypot(world.x - pocket.x, world.y - pocket.y) < 86 && Math.hypot(pocket.x - this.player.x, pocket.y - this.player.y) < T * 1.8) {
      this.onInteract({ type: 'handheld', id: pocket.id, key: 'E', label: 'DOTCADE POCKET · 게임팩 플레이', object: pocket })
      return true
    }
    const hit = this.worldObjects
      .filter(o => o.map === this.map && !o.held && !o.mounted && o.z < 8)
      .map(o => ({ o, d: Math.hypot(world.x - o.x, world.y - o.y) }))
      .filter(({ o, d }) => d < (
        isPocketStation(o) ? 42
          : o.kind === 'bicycle' ? 52
            : o.kind === 'scooter' ? 40 : 30
      ))
      .sort((a, b) => a.d - b.d)[0]?.o
    if (!hit || Math.hypot(hit.x - this.player.x, hit.y - this.player.y) > T * 1.8) return false
    if (isPocketStation(hit)) {
      this.onInteract({ type: 'handheld', id: hit.id, key: 'E', label: 'DOTCADE POCKET · 게임팩 플레이', object: hit })
      return true
    }
    return hit.mountable ? this.mountVehicle(hit.id) : this.pickupObject(hit.id)
  }

  // ---------- loop ----------
  start() {
    const tick = ts => {
      const dt = Math.min(50, ts - (this._last || ts)); this._last = ts; this.t += dt
      this.update(dt)
      this.draw()
      this._raf = requestAnimationFrame(tick)
    }
    this._raf = requestAnimationFrame(tick)
  }
  stop() {
    cancelAnimationFrame(this._raf)
    this.setGuideTarget(null)
    this.npcReactions.reset(this.agents)
    this.avatarEmotions.reset([this.player, ...this.agents.values()])
    this._motionMedia?.removeEventListener?.('change', this._onMotionChange)
  }

  // ---------- update ----------
  _walkable(px, py) {
    const g = this.grid()
    // Sprite manifests anchor collision to the eight pixels immediately above
    // the feet. Matching that footprint keeps keyboard and smoothed NPC motion
    // on the same cells selected by A*, instead of colliding one row early.
    for (const [ox, oy] of [[-11, -11], [11, -11], [-11, -2], [11, -2]]) {
      const tx = Math.floor((px + ox) / T), ty = Math.floor((py + oy) / T)
      if (!g[ty] || g[ty][tx] !== '.') return false
    }
    return true
  }

  _vehicleWalkable(px, py, kind = 'bicycle', dir = 'right') {
    const grid = this.grid()
    const horizontal = dir === 'left' || dir === 'right'
    const long = kind === 'bicycle' ? 46 : 33
    const short = kind === 'bicycle' ? 16 : 11
    const xs = horizontal ? [-long, 0, long] : [-short, 0, short]
    const ys = horizontal ? [-short, -2, short - 2] : [-long, 0, long]
    return xs.flatMap(x => ys.map(y => [x, y])).every(([ox, oy]) => {
      const tx = Math.floor((px + ox) / T)
      const ty = Math.floor((py + oy) / T)
      return grid[ty]?.[tx] === '.'
    })
  }

  _propWalkable(px, py) {
    const g = this.grid()
    const tx = Math.floor(px / T), ty = Math.floor(py / T)
    return !!g[ty] && g[ty][tx] === '.'
  }

  _impact(x, y, color = '#ffffff', kind = 'impact') {
    this.impactFx.push({ x, y, color, kind, map: this.map, born: this.t, life: kind === 'whoosh' ? 260 : 520 })
    if (this.impactFx.length > 36) this.impactFx.splice(0, this.impactFx.length - 36)
  }

  _updateWorldObjects(dt) {
    const f = dt / 16.67
    for (const object of this.worldObjects) {
      const motion = object.parkMotion
      if (!motion) continue
      const progress = Math.max(0, Math.min(1, (this.t - motion.startedAt) / Math.max(1, motion.duration)))
      const eased = 1 - Math.pow(1 - progress, 3)
      object.x = motion.fromX + (motion.toX - motion.fromX) * eased
      object.y = motion.fromY + (motion.toY - motion.fromY) * eased
      if (progress >= 1) delete object.parkMotion
    }
    const mounted = this.worldObject(this.mountedVehicleId)
    if (mounted) {
      mounted.x = this.player.x; mounted.y = this.player.y; mounted.dir = this.player.dir
      const hit = this.npcReactions.tryVehicleHit({
        now: this.t,
        vehicle: mounted,
        player: this.player,
        agents: this.agents,
        map: this.map,
        isWalkable: (x, y) => this._walkable(x, y),
        bubble: (id, text, ttl) => this.bubble(id, text, ttl),
        onInteract: event => this.onInteract(event)
      })
      if (hit) {
        this._impact(hit.agent.x, hit.agent.y, mounted.color)
        this.onInteract({ type: 'vehicleHit', object: mounted, agent: hit.agent, reactionId: hit.reactionId })
      }
    }
    const held = this.worldObject(this.heldObjectId)
    if (held) {
      const dir = DIR_VECTOR[this.player.dir] || DIR_VECTOR.down
      held.x = this.player.x + dir.x * 7
      held.y = this.player.y + dir.y * 5
      held.z = held.kind === 'trashbin' ? 37 : 45
      held.spin = 0
    }

    for (const o of this.worldObjects) {
      if (o.map !== this.map || o.held || o.mounted) continue
      const flying = o.z > 0 || Math.abs(o.vx) > .04 || Math.abs(o.vy) > .04 || Math.abs(o.vz) > .04
      if (!flying) continue

      const previousPosition = { x: o.x, y: o.y, z: o.z }
      let wallHit = false
      const nx = o.x + o.vx * f
      const ny = o.y + o.vy * f
      if (this._propWalkable(nx, o.y)) o.x = nx
      else { o.vx *= -.54; wallHit = true }
      if (this._propWalkable(o.x, ny)) o.y = ny
      else { o.vy *= -.54; wallHit = true }
      if (wallHit) {
        o.vz = Math.max(2.2, Math.abs(o.vz) * .44)
        this._impact(o.x, o.y, o.color)
      }

      o.vz -= .56 * f
      o.z += o.vz * f
      o.spin += (Math.abs(o.vx) + Math.abs(o.vy)) * (o.kind === 'book' ? .045 : .018) * f

      const speed = Math.hypot(o.vx, o.vy)
      if (speed > 2.1 && this.t - o.hitAt > 520) {
        const hit = this.npcReactions.tryPropHit({
          now: this.t,
          prop: o,
          previousPosition,
          player: this.player,
          agents: this.agents,
          map: this.map,
          isWalkable: (x, y) => this._walkable(x, y),
          bubble: (id, text, ttl) => this.bubble(id, text, ttl),
          onInteract: event => this.onInteract(event)
        })
        if (hit) {
          o.x = hit.contact.x; o.y = hit.contact.y; o.z = hit.contact.z
          o.hitAt = this.t
          o.vx *= -hit.restitution; o.vy *= -hit.restitution
          o.vz = Math.max(hit.lift, Math.abs(o.vz) * .5)
          this._impact(o.x, o.y, o.color)
          this.onInteract({ type: 'propHit', object: o, agent: hit.agent, reactionId: hit.reactionId })
        }
      }

      if (o.z <= 0) {
        o.z = 0
        if (Math.abs(o.vz) > 1.55 && o.bounces < 3) {
          o.vz = Math.abs(o.vz) * .38
          o.vx *= .69; o.vy *= .69; o.bounces += 1
          this._impact(o.x, o.y, o.color)
        } else {
          o.vz = 0; o.vx *= .72; o.vy *= .72
          if (Math.hypot(o.vx, o.vy) < .16) { o.vx = 0; o.vy = 0; o.spin = 0; o.bounces = 0 }
        }
      } else {
        o.vx *= Math.pow(.994, f); o.vy *= Math.pow(.994, f)
      }
    }
    this.impactFx = this.impactFx.filter(fx => this.t - fx.born < fx.life)
  }

  _finishAssignment(e, status = 'success', reason = '') {
    const a = e?.autonomy
    const assignment = a?.assignment
    if (!assignment) return null
    const meta = e.meta.autonomyAssignment || {}
    const report = {
      id: assignment.id,
      agentId: e.id,
      goal: assignment.kind,
      venue: assignment.venue,
      gameId: assignment.gameId,
      status,
      arrived: status === 'arrived' || reason === 'assigned-arrived',
      reason,
      elapsedMs: Math.max(0, this.t - assignment.queuedAt),
      routePlan: meta.routePlan || [],
      evidence: [...(assignment.evidence || []), ...(a.evidence || []).slice(-8)],
      replans: Math.max(0, a.replanCount - (assignment.replansAtStart || 0)),
      timeout: /timeout/i.test(reason)
    }
    a.assignment = null
    e.meta.autonomyAssignment = { ...meta, status, reason, completedAt: this.t, report }
    try { assignment.resolve?.(report) } catch {}
    this.onAgentEvent({ type: 'autonomy-assignment', agent: e, report })
    return report
  }

  _releaseConversation(e) {
    const conversation = e?.autonomy?.conversation
    if (!conversation) return
    const target = conversation.targetId === 'player' ? this.player : this.agents.get(conversation.targetId)
    for (const participant of [e, target]) {
      if (!participant) continue
      if (participant.meta.socialLock?.by === e.id) delete participant.meta.socialLock
      if (participant.meta.activity === 'socialize') delete participant.meta.activity
    }
    e.autonomy.conversation = null
  }

  _finishAutonomyGoal(e, status = 'success', reason = '') {
    const a = e?.autonomy
    if (!a?.currentGoal) return null
    const goal = a.currentGoal
    this._releaseConversation(e)
    if (e.meta.autonomyPath) e.path = []
    delete e.meta.autonomyPath
    if (a.activity?.kind === 'portablePlay') this.setHandheld(e.id, null)
    if (['portablePlay', 'arcadePlay', 'work'].includes(e.meta.activity)) delete e.meta.activity
    delete e.meta.playingGame
    const feedback = finishGoal(a, this.t, { status, reason, goal })
    if (status === 'success') this.avatarEmotions.cue(e, 'goal-success', { now: this.t, goal: goal.kind })
    else if (status === 'failed') this.avatarEmotions.cue(e, 'goal-failed', { now: this.t, goal: goal.kind })
    if (goal.assignmentId && a.assignment?.id === goal.assignmentId) {
      this._finishAssignment(e, reason === 'assigned-arrived' ? 'arrived' : status, reason)
    }
    e.meta.autonomy = autonomySnapshot(a)
    this.onAgentEvent({ type: 'autonomy-feedback', agent: e, feedback })
    return feedback
  }

  _reactionUntil(e) {
    return Math.max(Number(e.meta.reactionLockUntil) || 0, Number(e.meta.reactionUntil) || 0)
  }

  _entityForAutonomyTarget(id) {
    return id === 'player' ? this.player : this.agents.get(id)
  }

  _adjacentTile(target, fromEntity) {
    const tx = Math.floor(target.x / T), ty = Math.floor(target.y / T)
    const from = [Math.floor(fromEntity.x / T), Math.floor(fromEntity.y / T)]
    return [[tx - 1, ty], [tx + 1, ty], [tx, ty + 1], [tx, ty - 1]]
      .filter(([x, y]) => this._npcGrid()[y]?.[x] === '.')
      .sort((a, b) => (Math.abs(a[0] - from[0]) + Math.abs(a[1] - from[1])) - (Math.abs(b[0] - from[0]) + Math.abs(b[1] - from[1])))[0] || [tx, ty]
  }

  _observeNpc(e) {
    const a = e.autonomy
    const tile = [Math.floor(e.x / T), Math.floor(e.y / T)]
    const candidates = []
    const peers = [...this.agents.values()]
      .filter(other => other !== e && other.visible && (!other.map || other.map === this.map))
      .filter(other => !other.meta.chatting && this._reactionUntil(other) <= this.t)
      .filter(other => !other.meta.socialLock || other.meta.socialLock.until <= this.t)
      .filter(other => !other.autonomy?.externalCommand && !other.path.length && !other.autonomy?.currentGoal)
      .map(other => ({ entity: other, distance: Math.hypot(other.x - e.x, other.y - e.y) }))
      .filter(x => x.distance < T * 4.8)
    if (this.map === 'office' && !this.freezePlayer) {
      const playerDistance = Math.hypot(this.player.x - e.x, this.player.y - e.y)
      if (playerDistance < T * 4.2) peers.push({ entity: this.player, distance: playerDistance })
    }
    peers.sort((x, y) => x.distance - y.distance)

    const assignment = a.assignment
    if (assignment) {
      let target = assignment.target
      if (!target && assignment.kind === NPC_GOALS.ARCADE_PLAY) {
        const cab = this.maps.arcade.cabinets[Math.floor(stableUnit(`${e.id}:${assignment.id}`) * this.maps.arcade.cabinets.length)]
        target = cab?.spot || null
      }
      candidates.push({
        id: assignment.id,
        kind: assignment.kind,
        targetTile: target,
        targetId: assignment.venue === 'cabinet' ? `cabinet:${assignment.gameId || assignment.id}` : null,
        durationMs: assignment.maxDurationMs,
        data: { gameId: assignment.gameId, title: assignment.title, venue: assignment.venue },
        assignmentId: assignment.id,
        handoffOnArrive: !!assignment.onArrive,
        assigned: true
      })
      return { map: this.map, tile, nearbyCount: peers.length, peers, candidates, assignment: true }
    }

    if (peers.length && Math.random() < 0.68) {
      const nearPool = peers.slice(0, Math.min(3, peers.length))
      const peer = nearPool[Math.floor(Math.random() * nearPool.length)]
      candidates.push({
        kind: NPC_GOALS.SOCIALIZE,
        targetId: peer.entity.id,
        targetTile: this._adjacentTile(peer.entity, e),
        opportunity: Math.max(0, .25 - peer.distance / (T * 20)),
        maxTurns: 2 + (Math.random() < .55 ? 1 : 0)
      })
    }

    if (this.map === 'office' && e.home) {
      const home = e.home.desk
      const distanceHome = Math.abs(home[0] - tile[0]) + Math.abs(home[1] - tile[1])
      if (distanceHome > 1) candidates.push({ kind: NPC_GOALS.RETURN_HOME, targetTile: home, face: e.home.face, opportunity: distanceHome > 7 ? .25 : 0 })
      candidates.push({ kind: NPC_GOALS.WORK, targetTile: home, face: e.home.face, durationMs: 3600 + Math.random() * 2400, opportunity: e.sitting ? .12 : 0 })
      candidates.push({ kind: NPC_GOALS.PORTABLE_PLAY, durationMs: 4200 + Math.random() * 4500, data: { venue: 'handheld' }, opportunity: e.sitting ? -.08 : .06 })
      const roam = this._randomNpcTile(this.maps.office.wander, 'office')
      if (roam) candidates.push({ kind: NPC_GOALS.WANDER, targetTile: roam })
    } else if (this.map === 'arcade') {
      const cabs = this.maps.arcade.cabinets
      const reserved = new Set([...this.agents.values()]
        .filter(other => other !== e)
        .map(other => other.autonomy?.currentGoal?.targetId || (other.meta.playingGame?.cabinetId != null ? `cabinet:${other.meta.playingGame.cabinetId}` : null))
        .filter(Boolean))
      const available = cabs.filter(item => !reserved.has(`cabinet:${item.id}`))
      const cabPool = available.length ? available : cabs
      const cab = cabPool[Math.floor(Math.random() * cabPool.length)]
      if (cab) candidates.push({
        kind: NPC_GOALS.ARCADE_PLAY,
        targetId: `cabinet:${cab.id}`,
        targetTile: cab.spot,
        durationMs: 3600 + Math.random() * 4200,
        data: { cabinetId: cab.id },
        opportunity: this.cabinetLabels[cab.id] ? .13 : 0
      })
      candidates.push({ kind: NPC_GOALS.PORTABLE_PLAY, durationMs: 3800 + Math.random() * 4200, data: { venue: 'handheld' } })
      const roam = this._randomNpcTile(ARCADE_ZONE, 'arcade')
      if (roam) candidates.push({ kind: NPC_GOALS.WANDER, targetTile: roam, opportunity: .05 })
    }
    candidates.push({ kind: NPC_GOALS.IDLE, durationMs: 800 + Math.random() * 1800 })
    return { map: this.map, tile, nearbyCount: peers.length, peers, candidates, assignment: false }
  }

  _beginAutonomyGoal(e, goal) {
    const a = e.autonomy
    const plan = buildBoundedPlan(goal, a.limits)
    beginGoal(a, goal, plan, this.t)
    if (goal.kind === NPC_GOALS.SOCIALIZE) this._standEntity(e, 'socialize')
    e.meta.autonomy = autonomySnapshot(a)
    if (goal.assignmentId && e.meta.autonomyAssignment) {
      e.meta.autonomyAssignment.status = goal.targetTile ? 'planning-route' : 'starting'
      e.meta.autonomyAssignment.routePlan = plan.map(step => ({ kind: step.kind, target: step.targetTile || null }))
      a.assignment.replansAtStart = a.replanCount
      a.assignment.evidence.push({ type: 'plan', at: this.t, steps: plan.length })
    }
    this.avatarEmotions.cue(e, 'goal-start', { now: this.t, goal: goal.kind })
    this.onAgentEvent({ type: 'autonomy-goal', agent: e, goal, plan })
  }

  _startAutonomyRoute(e, step, replan = false) {
    const a = e.autonomy
    const from = [Math.floor(e.x / T), Math.floor(e.y / T)]
    const target = step.targetTile
    if (!target) return 'failed'
    const targetX = target[0] * T + T / 2, targetY = target[1] * T + T - 6
    if (Math.hypot(e.x - targetX, e.y - targetY) <= a.arrivalRadius + 3) return 'arrived'
    const navigationGrid = this._npcGrid(this.map, [target])
    const raw = astar(navigationGrid, from, target)
    if (!raw?.length) return 'failed'
    const route = smoothTilePath(navigationGrid, from, raw, 6)
    if (!route.length) return 'failed'
    this._standEntity(e, 'autonomy-route')
    e.path = route
    e.cb = null
    e.meta.autonomyPath = true
    step.started = true
    step.routeTarget = [...target]
    step.routeStartedAt = this.t
    a.stuck = { x: e.x, y: e.y, sampledAt: this.t, since: 0, routeLength: route.length }
    a.evidence.push({ type: replan ? 'route-replanned' : 'route-planned', at: this.t, rawNodes: raw.length, waypoints: route.length, target })
    a.evidence = a.evidence.slice(-24)
    if (a.assignment && e.meta.autonomyAssignment) {
      e.meta.autonomyAssignment.status = 'walking'
      e.meta.autonomyAssignment.routePlan = route.map(([x, y]) => [x, y])
      e.meta.autonomyAssignment.replans = Math.max(0, a.replanCount - (a.assignment.replansAtStart || 0))
      a.assignment.evidence.push({ type: replan ? 'replan' : 'route', at: this.t, waypoints: route.length })
    }
    return 'moving'
  }

  _replanAutonomyRoute(e, step, reason) {
    const a = e.autonomy
    if (a.assignment) {
      const used = Math.max(0, a.replanCount - (a.assignment.replansAtStart || 0))
      if (used >= a.assignment.maxReplans) return false
    }
    if (!consumeReplanBudget(a, this.t)) return false
    e.path = []
    delete e.meta.autonomyPath
    a.evidence.push({ type: 'replan-request', reason, at: this.t })
    return this._startAutonomyRoute(e, step, true) === 'moving'
  }

  _pickDialogueLine(speaker, pool) {
    const usable = pool.filter(line => (this._sentenceCooldowns.get(`${speaker.id}:${line}`) || 0) <= this.t)
    const source = usable.length ? usable : pool
    const line = source[Math.floor(Math.random() * source.length)]
    this._sentenceCooldowns.set(`${speaker.id}:${line}`, this.t + 24000)
    return line
  }

  _faceEachOther(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y
    if (a.meta?.seat) a.dir = a.meta.seat.face || a.dir
    else a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
    if (b.meta?.seat) b.dir = b.meta.seat.face || b.dir
    else b.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'left' : 'right') : (dy > 0 ? 'up' : 'down')
  }

  _updateSocialAction(e, step) {
    const a = e.autonomy
    const target = this._entityForAutonomyTarget(step.targetId)
    if (!target || (target.map && target.map !== this.map) || this._reactionUntil(target) > this.t) return 'failed'
    if (!a.conversation) {
      if (Math.hypot(target.x - e.x, target.y - e.y) > T * 2.25) return 'failed'
      if (target.meta.socialLock && target.meta.socialLock.until > this.t && target.meta.socialLock.by !== e.id) return 'failed'
      const turns = Math.max(2, Math.min(3, step.maxTurns || 3))
      const until = this.t + turns * 1180 + 900
      a.conversation = { targetId: target.id, turns, turn: 0, nextAt: this.t + 180, until }
      e.meta.socialLock = { by: e.id, with: target.id, until }
      target.meta.socialLock = { by: e.id, with: e.id, until }
      e.meta.activity = 'socialize'
      target.meta.activity = 'socialize'
      this._standEntity(e, 'socialize')
      // A target already seated at an authored desk can talk from the chair.
      // Standing it at the same anchor would place a full-height sprite inside
      // the desk; moving social initiators still stand before routing here.
      if (!target.meta?.seat) this._standEntity(target, 'socialize')
      if (target !== this.player && target.meta.autonomyPath) { target.path = []; delete target.meta.autonomyPath }
      this._faceEachOther(e, target)
      this.avatarEmotions.cue(e, 'social-start', { now: this.t, source: 'social-start' })
      this.avatarEmotions.cue(target, 'social-start', { now: this.t, source: 'social-start' })
      this.onAgentEvent({ type: 'social-start', agent: e, target, turns })
    }
    const chat = a.conversation
    this._faceEachOther(e, target)
    if (this.t >= chat.nextAt && chat.turn < chat.turns) {
      const speaker = chat.turn % 2 === 0 ? e : target
      const pool = speaker === e ? SOCIAL_OPENERS : speaker === this.player ? PLAYER_REPLIES : SOCIAL_REPLIES
      this.bubble(speaker.id, this._pickDialogueLine(speaker, pool), 1750)
      this.avatarEmotions.cue(speaker, 'social-turn', { now: this.t, source: 'social-turn' })
      chat.turn += 1
      chat.nextAt = this.t + 1120
    }
    if (chat.turn >= chat.turns && this.t >= chat.nextAt + 320) {
      this.avatarEmotions.cue(e, 'social-complete', { now: this.t, source: 'social-complete' })
      this.avatarEmotions.cue(target, 'social-complete', { now: this.t, source: 'social-complete' })
      this._releaseConversation(e)
      this.onAgentEvent({ type: 'social-complete', agent: e, target, turns: chat.turn })
      return 'success'
    }
    if (this.t > chat.until) { this._releaseConversation(e); return 'failed' }
    return 'running'
  }

  _beginAutonomyActivity(e, step) {
    const a = e.autonomy
    const goal = a.currentGoal
    const duration = Math.min(step.durationMs || 2500, a.limits.maxActionMs)
    a.activity = { kind: step.activity, startedAt: this.t, until: this.t + duration }
    e.meta.activity = step.activity
    if (step.activity === 'portablePlay') {
      this.setHandheld(e.id, {
        active: true,
        gameId: step.data?.gameId || goal.data?.gameId || null,
        title: step.data?.title || goal.data?.title || 'DOTCADE GO',
        state: 'playing',
        plannerGoalId: goal.id || goal.assignmentId || goal.kind
      })
      this.bubble(e.id, this._pickDialogueLine(e, PORTABLE_LINES), 2200)
    } else if (step.activity === 'arcadePlay') {
      e.meta.playingGame = { gameId: step.data?.gameId || goal.data?.gameId || null, cabinetId: step.data?.cabinetId ?? goal.data?.cabinetId }
      e.dir = goal.data?.cabinetId >= 5 ? 'right' : 'up'
      this.bubble(e.id, ARCADE_LINES[Math.floor(Math.random() * ARCADE_LINES.length)], 2100)
    } else if (step.activity === 'work') {
      this.bubble(e.id, this._pickDialogueLine(e, e.ambient?.length ? e.ambient : WORK_LINES), 2200)
    }
    this.avatarEmotions.cue(e, 'activity-start', { now: this.t, activity: step.activity })
    this._notifyAssignmentArrived(e, step.activity)
    this.onAgentEvent({ type: 'autonomy-activity', agent: e, activity: a.activity, goal })
  }

  _notifyAssignmentArrived(e, activity = null) {
    const a = e.autonomy
    const assignment = a?.assignment
    if (!assignment || assignment.arrived) return false
    assignment.arrived = true
    assignment.evidence.push({ type: 'arrived', at: this.t, activity })
    if (e.meta.autonomyAssignment) e.meta.autonomyAssignment.status = activity ? 'playing' : 'arrived'
    try {
      assignment.onArrive?.({ agent: e, goal: a.currentGoal, world: this, assignmentId: assignment.id, activity })
    } catch (error) {
      assignment.evidence.push({ type: 'on-arrive-error', at: this.t, message: String(error?.message || error) })
    }
    return true
  }

  _stepAutonomyAction(e) {
    const a = e.autonomy
    const step = a.plan[a.actionIndex]
    if (!step) { this._finishAutonomyGoal(e, 'success', 'plan-complete'); return }
    if (actionTimedOut(a, this.t)) { this._finishAutonomyGoal(e, 'failed', 'bounded-timeout'); return }

    if (step.kind === 'move') {
      const targetX = step.targetTile[0] * T + T / 2, targetY = step.targetTile[1] * T + T - 6
      const arrived = Math.hypot(e.x - targetX, e.y - targetY) <= a.arrivalRadius + 4
      if (arrived) {
        if ((a.arrivalPauseUntil || 0) > this.t) return
        e.path = []; delete e.meta.autonomyPath
        this._notifyAssignmentArrived(e)
        if (a.currentGoal.handoffOnArrive) {
          this._finishAutonomyGoal(e, 'success', 'assigned-arrived')
          return
        }
        if (advanceAction(a, this.t, { type: 'arrived', target: step.targetTile })) this._finishAutonomyGoal(e, 'success', 'plan-complete')
        return
      }
      if (!step.started) {
        const result = this._startAutonomyRoute(e, step)
        if (result === 'failed') this._finishAutonomyGoal(e, 'failed', 'route-unreachable')
        else if (result === 'arrived' && advanceAction(a, this.t)) this._finishAutonomyGoal(e, 'success', 'plan-complete')
        return
      }
      if (!e.path.length) {
        if (!this._replanAutonomyRoute(e, step, 'route-lost')) this._finishAutonomyGoal(e, 'failed', 'replan-budget-exhausted')
        return
      }
      if (sampleStuck(a, e, e.path.length, this.t)) {
        if (!this._replanAutonomyRoute(e, step, 'stuck-detected')) this._finishAutonomyGoal(e, 'failed', 'stuck-fallback')
      }
      return
    }

    if (step.kind === 'sit') {
      const tile = step.targetTile || a.currentGoal.targetTile || e.home?.desk || [Math.floor(e.x / T), Math.floor(e.y / T)]
      this.sit(e.id, tile, step.face || a.currentGoal.face || 'up', { source: 'autonomy' })
      if (advanceAction(a, this.t, { type: 'sat-down' })) this._finishAutonomyGoal(e, 'success', 'plan-complete')
      return
    }
    if (step.kind === 'socialize') {
      const result = this._updateSocialAction(e, step)
      if (result === 'success') {
        if (advanceAction(a, this.t, { type: 'conversation-complete', target: step.targetId })) this._finishAutonomyGoal(e, 'success', 'plan-complete')
      } else if (result === 'failed') this._finishAutonomyGoal(e, 'failed', 'social-target-unavailable')
      return
    }
    if (step.kind === 'activity') {
      if (a.currentGoal.handoffOnArrive && a.assignment?.onArrive) {
        this._notifyAssignmentArrived(e, step.activity)
        this._finishAutonomyGoal(e, 'success', 'assigned-arrived')
        return
      }
      if (!a.activity) this._beginAutonomyActivity(e, step)
      if (this.t >= a.activity.until) {
        if (a.activity.kind === 'portablePlay') this.setHandheld(e.id, null)
        if (['portablePlay', 'arcadePlay', 'work'].includes(e.meta.activity)) delete e.meta.activity
        delete e.meta.playingGame
        a.activity = null
        if (advanceAction(a, this.t, { type: 'activity-complete', activity: step.activity })) this._finishAutonomyGoal(e, 'success', 'plan-complete')
      }
      return
    }
    if (step.kind === 'wait') {
      if (this.t - a.actionStartedAt >= (step.durationMs || 700)) {
        if (advanceAction(a, this.t, { type: 'wait-complete' })) this._finishAutonomyGoal(e, 'success', 'plan-complete')
      }
    }
  }

  _updateNpcAutonomy(e, dt) {
    const a = e.autonomy
    if (!a?.enabled) return
    if (a.assignment && this.t - a.assignment.queuedAt > a.limits.maxGoalMs) {
      if (a.currentGoal) this._finishAutonomyGoal(e, 'failed', 'assignment-timeout')
      else this._finishAssignment(e, 'failed', 'assignment-timeout')
      return
    }
    if (e.meta.chatting || a.suspendedBy) return
    if (e.map && e.map !== this.map) return

    const reactionUntil = this._reactionUntil(e)
    if (a.externalCommand) {
      // A reaction may deliberately clear a scripted path/callback. Release the
      // command lock after that reaction so the actor cannot become inert.
      if (e.path.length || reactionUntil > this.t) return
      a.externalCommand = false
      a.nextThinkAt = Math.max(a.nextThinkAt, this.t + 350)
    }
    if (reactionUntil > this.t) {
      if (!a.pausedAt) a.pausedAt = this.t
      return
    }
    if (a.pausedAt) {
      const pausedFor = this.t - a.pausedAt
      a.actionStartedAt += pausedFor
      a.goalStartedAt += pausedFor
      a.stuck.sampledAt = this.t
      a.pausedAt = 0
      a.nextThinkAt = Math.max(a.nextThinkAt, this.t + 280)
    }
    if (e.meta.socialLock?.until > this.t && e.meta.socialLock.by !== e.id) return
    if (this.meetingMode) return
    if (this.simMode && !(a.assignment?.allowDuringSim && a.assignment)) return

    if (a.currentGoal) {
      ageDrives(a, dt, { map: this.map, nearbyCount: 0 })
      this._stepAutonomyAction(e)
      e.meta.autonomy = autonomySnapshot(a)
      return
    }
    if (this.t < a.nextThinkAt || this.t < a.blockedUntil) return

    const observation = this._observeNpc(e)
    ageDrives(a, dt, observation)
    if (!consumeReplanBudget(a, this.t)) {
      this._beginAutonomyGoal(e, { kind: NPC_GOALS.IDLE, durationMs: 900, utility: 0, fallback: true })
      return
    }
    const goal = chooseUtilityGoal(a, observation.candidates, this.t)
    if (!goal) {
      a.nextThinkAt = this.t + a.limits.failureBackoffMs
      return
    }
    this._beginAutonomyGoal(e, goal)
  }

  _separationSteer(e, dx, dy) {
    const a = e.autonomy
    let sx = 0, sy = 0
    const neighbors = [this.player, ...this.agents.values()]
    for (const other of neighbors) {
      if (other === e || !other.visible || (other.map && other.map !== this.map)) continue
      const ox = e.x - other.x, oy = e.y - other.y
      const d = Math.hypot(ox, oy)
      if (d < 1) {
        const sign = e.id < other.id ? -1 : 1
        sx += sign * .65; sy += (stableUnit(`${e.id}:${other.id}`) - .5) * .4
        continue
      }
      if (d > 36) continue
      const strength = (36 - d) / 36
      sx += (ox / d) * strength
      sy += (oy / d) * strength
    }
    const mag = Math.hypot(sx, sy)
    if (mag > 1) { sx /= mag; sy /= mag }
    // Low-pass steering + a forward bias provides hysteresis and prevents two
    // NPCs from flipping left/right on every frame in a narrow lane.
    a.steering.x = a.steering.x * .82 + sx * .18
    a.steering.y = a.steering.y * .82 + sy * .18
    let nx = dx + a.steering.x * .28
    let ny = dy + a.steering.y * .28
    const n = Math.hypot(nx, ny) || 1
    return { x: nx / n, y: ny / n }
  }

  _moveAgentAlongPath(e, f) {
    if (!e.path.length) return
    const beforeX = e.x, beforeY = e.y
    const [tx, ty] = e.path[0]
    const gx = tx * T + T / 2, gy = ty * T + T - 6
    const ddx = gx - e.x, ddy = gy - e.y
    const dist = Math.hypot(ddx, ddy)
    const autonomous = !!(e.autonomy?.enabled && e.meta.autonomyPath)
    const speed = e.speed * (autonomous ? e.autonomy.speedScale : 1)
    const arrivalRadius = autonomous ? e.autonomy.arrivalRadius : 1
    if (dist < speed * f + arrivalRadius) {
      e.x = gx; e.y = gy; e.path.shift()
      e.dir = directionFromDelta(e.x - beforeX, e.y - beforeY, e.dir)
      if (!e.path.length) {
        e.moving = false
        if (autonomous) e.autonomy.arrivalPauseUntil = this.t + 160 + stableUnit(`${e.id}:${tx}:${ty}`) * 260
        const cb = e.cb; e.cb = null; cb && cb()
      }
      return
    }

    let move = { x: ddx / dist, y: ddy / dist }
    // Separation is only applied to planner-owned routes. Meeting seats and
    // scripted evaluation positions therefore stay pixel deterministic.
    if (autonomous && dist > 24) move = this._separationSteer(e, move.x, move.y)
    const stepX = move.x * speed * f, stepY = move.y * speed * f
    if (!autonomous) {
      e.x += stepX; e.y += stepY
    } else {
      const nx = e.x + stepX, ny = e.y + stepY
      if (this._walkable(nx, ny)) { e.x = nx; e.y = ny }
      else {
        // Axis fallback slides around another agent/furniture without a full
        // A* replan. Persistent failure is handled by the stuck detector.
        if (this._walkable(nx, e.y)) e.x = nx
        if (this._walkable(e.x, ny)) e.y = ny
      }
    }
    // Face the displacement that actually happened after collision sliding,
    // not the intended steering vector. This prevents blocked NPCs from
    // appearing to moonwalk while the planner searches for a clear axis.
    e.dir = directionFromDelta(e.x - beforeX, e.y - beforeY, e.dir)
    e.moving = Math.hypot(e.x - beforeX, e.y - beforeY) > 0.02
  }

  _recordRideTravel(p, beforeX, beforeY, dt) {
    const state = p.meta?.rideState
    if (!state) return
    const dx = p.x - beforeX
    const dy = p.y - beforeY
    const travelled = Math.hypot(dx, dy)
    if (travelled <= .02) {
      state.bank += (0 - state.bank) * (1 - Math.exp(-dt / 85))
      return
    }
    state.distance += travelled
    const heading = Math.atan2(dy, dx)
    if (Number.isFinite(state.heading)) {
      const delta = Math.atan2(Math.sin(heading - state.heading), Math.cos(heading - state.heading))
      const targetBank = Math.max(-.085, Math.min(.085, delta * .09))
      state.bank += (targetBank - state.bank) * (1 - Math.exp(-dt / 70))
    }
    state.heading = heading
  }

  _moveMountedWithKeys(p, keyX, keyY, f, dt) {
    const state = p.meta?.rideState
    if (!state) return false
    let dx = keyX
    let dy = keyY
    const hasInput = !!(dx || dy)
    if (hasInput) {
      const length = Math.hypot(dx, dy)
      dx /= length; dy /= length
    }
    // Accelerating over a few frames removes the instant 0 -> 9.6px jump,
    // while a shorter braking response keeps office steering controllable.
    const response = hasInput ? (state.kind === 'bicycle' ? 145 : 118) : 82
    const blend = 1 - Math.exp(-dt / response)
    const targetX = hasInput ? dx * p.speed : 0
    const targetY = hasInput ? dy * p.speed : 0
    state.vx += (targetX - state.vx) * blend
    state.vy += (targetY - state.vy) * blend
    if (!hasInput && Math.hypot(state.vx, state.vy) < .08) state.vx = state.vy = 0

    const beforeX = p.x
    const beforeY = p.y
    const nx = p.x + state.vx * f
    const ny = p.y + state.vy * f
    const nextDir = rideDirectionFromDelta(state.vx, state.vy, p.dir)
    const canMove = (x, y) => this._vehicleWalkable(x, y, state.kind, nextDir)
    if (canMove(nx, p.y)) p.x = nx
    else state.vx = 0
    if (canMove(p.x, ny)) p.y = ny
    else state.vy = 0

    const movedX = p.x - beforeX
    const movedY = p.y - beforeY
    p.dir = rideDirectionFromDelta(movedX, movedY, p.dir)
    p.moving = Math.hypot(movedX, movedY) > .02
    this._recordRideTravel(p, beforeX, beforeY, dt)
    return p.moving
  }

  update(dt) {
    const f = dt / 16.67
    // --- player ---
    const p = this.player
    const keyX = (this.keys.has('ArrowRight') || this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('ArrowLeft') || this.keys.has('KeyA') ? 1 : 0)
    const keyY = (this.keys.has('ArrowDown') || this.keys.has('KeyS') ? 1 : 0) - (this.keys.has('ArrowUp') || this.keys.has('KeyW') ? 1 : 0)
    if ((keyX || keyY || p.path?.length) && this._hasSeatState(p)) this._standEntity(p, 'movement-input')
    if (p.path && p.path.length && (this.freezePlayer || (!keyX && !keyY))) {
      const beforeX = p.x, beforeY = p.y
      const [tx, ty] = p.path[0]
      const gx = tx * T + T / 2, gy = ty * T + T - 6
      const ddx = gx - p.x, ddy = gy - p.y
      const dist = Math.hypot(ddx, ddy)
      const rideState = p.meta?.rideState
      if (rideState) {
        const blend = 1 - Math.exp(-dt / (rideState.kind === 'bicycle' ? 145 : 118))
        rideState.cruise += (p.speed - rideState.cruise) * blend
      }
      const travelSpeed = rideState ? Math.max(1.1, rideState.cruise) : p.speed
      if (dist < travelSpeed * f + 1) {
        const arrivalDir = rideState ? rideDirectionFromDelta(gx - p.x, gy - p.y, p.dir) : p.dir
        if (rideState && !this._vehicleWalkable(gx, gy, rideState.kind, arrivalDir)) {
          p.path = []; p.moving = false; p.cb = null
          rideState.cruise = 0; rideState.vx = 0; rideState.vy = 0
          if (this.moveMarker?.valid) { this.moveMarker.valid = false; this.moveMarker.until = this.t + 520 }
        } else {
          p.x = gx; p.y = gy; p.path.shift()
          p.dir = rideState
            ? arrivalDir
            : directionFromDelta(p.x - beforeX, p.y - beforeY, p.dir)
        }
        this._recordRideTravel(p, beforeX, beforeY, dt)
        if (!p.path.length) {
          p.moving = false
          if (rideState) { rideState.cruise = 0; rideState.vx = 0; rideState.vy = 0 }
          const cb = p.cb; p.cb = null; cb && cb()
        }
      } else {
        const nextX = p.x + (ddx / dist) * travelSpeed * f
        const nextY = p.y + (ddy / dist) * travelSpeed * f
        const nextDir = rideState ? rideDirectionFromDelta(nextX - p.x, nextY - p.y, p.dir) : p.dir
        if (rideState && !this._vehicleWalkable(nextX, nextY, rideState.kind, nextDir)) {
          p.path = []; p.moving = false; p.cb = null
          rideState.cruise = 0; rideState.vx = 0; rideState.vy = 0
          if (this.moveMarker?.valid) { this.moveMarker.valid = false; this.moveMarker.until = this.t + 520 }
        } else {
          p.x = nextX; p.y = nextY
          p.dir = rideState
            ? nextDir
            : directionFromDelta(p.x - beforeX, p.y - beforeY, p.dir)
          p.moving = true
        }
        this._recordRideTravel(p, beforeX, beforeY, dt)
      }
    } else if (!this.freezePlayer) {
      let dx = keyX, dy = keyY
      if (p.meta?.rideState) {
        if (dx || dy) {
          p.path = []
          if (this.moveMarker?.valid && !this.moveMarker.reachedAt) this.moveMarker.until = Math.min(this.moveMarker.until, this.t + 240)
        }
        this._moveMountedWithKeys(p, dx, dy, f, dt)
      } else if (dx || dy) {
        const beforeX = p.x, beforeY = p.y
        p.path = []
        if (this.moveMarker?.valid && !this.moveMarker.reachedAt) this.moveMarker.until = Math.min(this.moveMarker.until, this.t + 240)
        const n = Math.hypot(dx, dy); dx /= n; dy /= n
        const nx = p.x + dx * p.speed * f, ny = p.y + dy * p.speed * f
        if (this._walkable(nx, p.y)) p.x = nx
        if (this._walkable(p.x, ny)) p.y = ny
        p.dir = directionFromDelta(p.x - beforeX, p.y - beforeY, p.dir)
        p.moving = Math.hypot(p.x - beforeX, p.y - beforeY) > 0.02
      } else p.moving = false
    } else p.moving = false

    this._updateWorldObjects(dt)
    this.npcReactions.update({
      now: this.t,
      dt,
      agents: this.agents,
      map: this.map,
      player: this.player,
      isWalkable: (x, y) => this._walkable(x, y),
      bubble: (id, text, ttl) => this.bubble(id, text, ttl),
      goTo: (id, tile) => this.goTo(id, tile, null, { autonomous: true, reason: 'impact-evade' }),
      onInteract: event => this.onInteract(event)
    })
    this.avatarEmotions.update({ now: this.t, entities: [p, ...this.agents.values()] })

    // --- agents follow paths / bounded autonomous loop ---
    for (const e of this.agents.values()) {
      if (e.map && e.map !== this.map) { if (e.bubble && performance.now() > e.bubble.until) e.bubble = null; continue }
      if (e.path.length) {
        if (this._hasSeatState(e)) this._standEntity(e, 'path-movement')
        this._moveAgentAlongPath(e, f)
      }
      // Compatibility fallback for explicitly non-autonomous scripted actors.
      // Team members and visitors never enter this legacy branch.
      else if (!e.autonomy?.enabled && !this.meetingMode && !this.simMode && this.map === 'office' && e.home && !e.meta.chatting) {
        e.idleT -= dt
        if (e.idleT <= 0) {
          e.idleT = 14000 + Math.random() * 30000
          if (e.sitting && Math.random() < 0.3) {
            const spot = this._randomNpcTile(this.maps.office.wander, 'office')
            if (spot) this.goTo(e.id, spot, () => {
              setTimeout(() => {
                if (!this.meetingMode && e.home) this.goTo(e.id, e.home.desk, () => this.sit(e.id, e.home.desk, e.home.face))
              }, 2500 + Math.random() * 5000)
            })
          } else if (!e.sitting && e.home) this.goTo(e.id, e.home.desk, () => this.sit(e.id, e.home.desk, e.home.face))
        }
      } else if (!e.autonomy?.enabled && !this.simMode && e.map === 'arcade' && e.meta.ambientArcade && !e.meta.chatting) {
        e.idleT -= dt
        if (e.idleT <= 0) {
          e.idleT = 8000 + Math.random() * 16000
          const spot = this._randomNpcTile(ARCADE_ZONE, 'arcade')
          if (spot) this.goTo(e.id, spot)
        }
      }
      this._updateNpcAutonomy(e, dt)
      if (e.bubble && performance.now() > e.bubble.until) e.bubble = null
    }
    this._advanceNonProximitySeatMotion(dt)
    this._updateAutomaticChairSeating(dt)
    if (p.bubble && performance.now() > p.bubble.until) p.bubble = null

    this.avatarEmotions.observe(p, {
      now: this.t,
      map: this.map,
      activity: p.meta.activity,
      handheld: !!p.meta.handheld?.active,
      mounted: !!this.mountedVehicleId,
      holding: !!this.heldObjectId,
      playingGame: p.meta.playingGame
    })
    for (const e of this.agents.values()) {
      if (!e.visible || (e.map && e.map !== this.map)) continue
      this.avatarEmotions.observe(e, {
        now: this.t,
        map: this.map,
        activity: e.meta.activity,
        goal: e.autonomy?.currentGoal?.kind,
        handheld: !!e.meta.handheld?.active,
        playingGame: e.meta.playingGame
      })
    }

    this._sampleAvatarWalk(p, dt)
    for (const e of this.agents.values()) {
      if (e.visible && (!e.map || e.map === this.map)) this._sampleAvatarWalk(e, dt)
    }

    if (this.moveMarker?.valid && !this.moveMarker.reachedAt && !p.path.length && Math.hypot(p.x - this.moveMarker.x, p.y - this.moveMarker.y) < 20) {
      this.moveMarker.reachedAt = this.t
      this.moveMarker.until = this.t + 520
    }

    if (this.reduceMotion) {
      this.stepFx = []
    } else {
      this._emitStep(p)
      for (const e of this.agents.values()) {
        if (e.visible && (!e.map || e.map === this.map)) this._emitStep(e)
      }
      this.stepFx = this.stepFx.filter(fx => this.t - fx.born < fx.life)
    }

    const target = this.centerCamera(false)
    const follow = this.reduceMotion ? 1 : 1 - Math.exp(-dt / 150)
    this.camera.x += (target.x - this.camera.x) * follow
    this.camera.y += (target.y - this.camera.y) * follow

    // --- interaction hint ---
    this._computeHint()
  }

  _sampleAvatarWalk(e, dt) {
    const mounted = e === this.player && !!this.mountedVehicleId
    const reacting = !mounted && this._reactionUntil(e) > this.t
    let rideTransitionActive = false
    if (e === this.player && e.meta?.rideMotion) {
      const motion = e.meta.rideMotion
      rideTransitionActive = rideTransitionPose(motion, this.t, this.reduceMotion).active
      if (!rideTransitionActive && (motion.phase === 'mount' || motion.phase === 'dismount')) {
        delete e.meta.rideMotion
      }
    }
    const walkSuppressed = e.sitting || reacting || mounted || rideTransitionActive
    const frame = sampleWalkFrame(e.walkAnimation, {
      x: e.x,
      y: e.y,
      speed: e.speed,
      moving: e.moving,
      paused: this.reduceMotion || walkSuppressed
    })
    sampleAvatarWalkMotion(e.walkMotion, {
      distance: e.walkAnimation.distance,
      direction: e.dir,
      speed: e.speed,
      moving: e.walkAnimation.advanced,
      paused: walkSuppressed,
      reset: e.walkAnimation.teleported,
      reduceMotion: this.reduceMotion,
      deltaMs: dt
    })
    return frame
  }

  _emitStep(e) {
    if (!e.moving || e.sitting) return
    const riding = e === this.player && !!this.mountedVehicleId
    let side
    if (riding) {
      if (this.t - (e.stepAt || 0) < 72) return
      e.stepAt = this.t
      e.stepSide = e.stepSide ? 0 : 1
      side = e.stepSide ? 1 : -1
    } else {
      const contact = e.walkAnimation?.frame
      if (contact !== 'stepL' && contact !== 'stepR') {
        e.walkAnimation.lastContact = null
        return
      }
      if (e.walkAnimation.lastContact === contact) return
      e.walkAnimation.lastContact = contact
      side = contact === 'stepL' ? -1 : 1
    }
    const horizontal = e.dir === 'left' || e.dir === 'right'
    this.stepFx.push({
      x: e.x + (horizontal ? 0 : side * 5),
      y: e.y + (horizontal ? side * 2 : 2),
      born: this.t, life: 430, map: this.map,
      color: riding ? '101,232,190' : (e === this.player ? '122,105,242' : '255,255,255'),
      ride: riding
    })
    if (this.stepFx.length > 72) this.stepFx.splice(0, this.stepFx.length - 72)
  }

  _computeHint() {
    let hint = null
    let rideAction = null
    const p = this.player
    const ptx = Math.floor(p.x / T), pty = Math.floor(p.y / T)
    if (!this.freezePlayer) {
      const held = this.worldObject(this.heldObjectId)
      const mounted = this.worldObject(this.mountedVehicleId)
      if (held) {
        hint = { type: 'heldProp', id: held.id, objectLabel: held.label, key: 'F', label: `${held.label} 들고 있음 · F 던지기 · E 내려놓기` }
      } else if (mounted) {
        rideAction = { type: 'vehicleMounted', id: mounted.id, key: 'R', label: `${mounted.label}에서 내리기`, detail: `이동 속도 ${mounted.speed.toFixed(1)}` }
      } else {
        const nearbyVehicle = this.nearbyRideableVehicle(T * 1.55)
        if (nearbyVehicle) {
          rideAction = { type: 'vehicle', id: nearbyVehicle.id, key: 'R', label: `${nearbyVehicle.label} 타기`, detail: '이동 속도 UP' }
        }
        const nearby = this.worldObjects
          .filter(o => o.map === this.map && !o.mountable && !o.held && !o.mounted && o.z < 8 && Math.hypot(o.vx, o.vy) < .8)
          .map(o => ({ o, d: Math.hypot(o.x - p.x, o.y - p.y) }))
          .filter(({ d }) => d < T * 1.55)
          .sort((a, b) => a.d - b.d)[0]?.o
        if (isPocketStation(nearby)) hint = { type: 'handheld', id: nearby.id, key: 'E', label: 'DOTCADE POCKET · 게임팩 플레이' }
        else if (nearby?.throwable) hint = { type: 'prop', id: nearby.id, key: 'E', label: `${nearby.label} 집기 · 든 뒤 F로 던지기` }
      }
    }
    if (!hint && this.map === 'office') {
      // 회의실 존 — 근처로 가면 E로 바로 회의 시작 (HUD '회의 시작' 버튼과 동일)
      const mz = this.maps.office.meeting && this.maps.office.meeting.zone // [x, y, w, h]
      if (mz && !this.meetingMode) {
        const [zx, zy, zw, zh] = mz
        if (ptx >= zx - 1 && ptx <= zx + zw && pty >= zy - 1 && pty <= zy + zh) {
          hint = { type: 'meeting', label: '회의 시작 (안건 제출)' }
        }
      }
      let best = null, bd = 1e9
      for (const e of this.agents.values()) {
        if (!e.visible || e.id.startsWith('v') || (e.map && e.map !== this.map)) continue
        const d = Math.hypot(e.x - p.x, e.y - p.y)
        if (d < T * 1.5 && d < bd) { bd = d; best = e }
      }
      if (!hint && best) hint = { type: 'agent', id: best.id, label: `${best.meta.shortName || best.label}과 대화` }
      const sh = this.maps.office.shelf
      if (!hint && sh) {
        // 진열대 본체 사방 1타일(위·옆·아래 어디서 접근해도) + 기존 front 타일 주변
        const [bx, by, bw, bh] = sh.tiles // [x, y, w, h]
        const nearBody = ptx >= bx - 1 && ptx <= bx + bw && pty >= by - 1 && pty <= by + bh
        const nearFront = (sh.front || []).some(([x, y]) => Math.abs(x - ptx) <= 1 && Math.abs(y - pty) <= 1)
        if (nearBody || nearFront) hint = { type: 'shelf', label: '게임팩 진열대 열기' }
      }
      const door = this.maps.office.door
      if (!hint && door.approach.concat(door.tiles).some(([x, y]) => Math.abs(x - ptx) + Math.abs(y - pty) <= 1)) {
        hint = { type: 'door', label: '오락실로 이동' }
      }
    } else if (!hint) {
      const door = this.maps.arcade.door
      if (door.approach.concat(door.tiles).some(([x, y]) => Math.abs(x - ptx) + Math.abs(y - pty) <= 1)) {
        hint = { type: 'door', label: '사무실로 돌아가기' }
      }
      if (!hint) {
        for (const c of this.maps.arcade.cabinets) {
          if (Math.abs(c.spot[0] - ptx) <= 1 && Math.abs(c.spot[1] - pty) <= 1 && this.cabinetLabels[c.id]) {
            hint = { type: 'cabinet', id: c.id, label: `${this.cabinetLabels[c.id].title} 플레이` }
            break
          }
        }
      }
    }
    // Riding is deliberately a separate R action. When a teammate and a
    // vehicle are both close, E continues to target the teammate while the UI
    // can render the ride action in its own non-overlapping chip.
    const emittedHint = hint
      ? (rideAction ? { ...hint, rideAction } : hint)
      : rideAction
    this.currentHint = emittedHint
    this.interactionTarget = this._resolveInteractionTarget(hint || rideAction)
    const rideKey = emittedHint?.rideAction ? `|${emittedHint.rideAction.type}${emittedHint.rideAction.id || ''}R` : ''
    const key = emittedHint ? emittedHint.type + (emittedHint.id || '') + (emittedHint.key || 'E') + rideKey : ''
    if (key !== this._hintKey) { this._hintKey = key; this.onHint(emittedHint) }
  }

  _resolveInteractionTarget(hint) {
    if (!hint) return null
    if (['vehicle', 'prop'].includes(hint.type)) {
      const o = this.worldObject(hint.id)
      return o ? {
        type: hint.type, id: o.id, key: hint.key || 'E', x: o.x, y: o.y,
        rx: o.kind === 'bicycle' ? 48 : o.kind === 'scooter' ? 34 : 20,
        ry: o.kind === 'bicycle' ? 20 : o.kind === 'scooter' ? 13 : 7,
        lift: o.kind === 'bicycle' ? 48 : o.kind === 'scooter' ? 45 : o.kind === 'trashbin' ? 42 : 28
      } : null
    }
    if (['vehicleMounted', 'heldProp'].includes(hint.type)) {
      const vehicle = hint.type === 'vehicleMounted' ? this.worldObject(hint.id) : null
      return {
        type: hint.type, id: hint.id, key: hint.key || 'E', x: this.player.x, y: this.player.y,
        rx: vehicle?.kind === 'bicycle' ? 48 : vehicle?.kind === 'scooter' ? 34 : 24,
        ry: vehicle?.kind === 'bicycle' ? 20 : vehicle?.kind === 'scooter' ? 13 : 8,
        lift: hint.type === 'heldProp' ? 102 : 112
      }
    }
    if (hint.type === 'agent') {
      const e = this.agents.get(hint.id)
      return e ? { type: 'agent', id: e.id, key: 'E', x: e.x, y: e.y, rx: 25, ry: 10, lift: 88 } : null
    }
    if (hint.type === 'handheld' || hint.type === 'portable') {
      const station = this.worldObject(hint.id || POCKET_STATION.id)
      return station ? { type: 'handheld', id: station.id, key: 'E', x: station.x, y: station.y, rx: 31, ry: 11, lift: 86 } : null
    }
    if (hint.type === 'meeting') {
      const z = this.maps.office.meeting?.zone
      return z ? { type: 'meeting', x: (z[0] + z[2] / 2) * T, y: (z[1] + z[3] / 2) * T, rx: z[2] * T / 2 - 14, ry: z[3] * T / 2 - 14, lift: 28 } : null
    }
    if (hint.type === 'shelf') {
      const sh = this.maps.office.shelf
      const front = sh?.front || []
      if (!front.length) return null
      const sx = front.reduce((sum, p) => sum + p[0], 0) / front.length
      const sy = front.reduce((sum, p) => sum + p[1], 0) / front.length
      return { type: 'shelf', x: sx * T + T / 2, y: sy * T + T - 6, rx: Math.max(36, front.length * T / 2), ry: 13, lift: 30 }
    }
    if (hint.type === 'door') {
      const door = this.maps[this.map].door
      const spots = door?.approach || []
      if (!spots.length) return null
      const sx = spots.reduce((sum, p) => sum + p[0], 0) / spots.length
      const sy = spots.reduce((sum, p) => sum + p[1], 0) / spots.length
      return { type: 'door', x: sx * T + T / 2, y: sy * T + T - 6, rx: 38, ry: 13, lift: 32 }
    }
    if (hint.type === 'cabinet') {
      const cab = this.maps.arcade.cabinets.find(c => c.id === hint.id)
      return cab ? { type: 'cabinet', x: cab.spot[0] * T + T / 2, y: cab.spot[1] * T + T - 6, rx: 30, ry: 11, lift: 42 } : null
    }
    return null
  }

  // ---------- draw ----------
  draw() {
    const { ctx, cv } = this
    ctx.imageSmoothingEnabled = false
    const bg = this.mapImg[this.map]
    ctx.fillStyle = '#0b0d16'; ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.save()
    ctx.translate(cv.width / 2, cv.height / 2)
    ctx.scale(this._renderScale(), this._renderScale())
    ctx.translate(-this.camera.x, -this.camera.y)
    if (bg) {
      ctx.drawImage(bg, 0, 0)
      this._eraseBakedVehicles(bg)
    }

    this._drawAmbientBack()

    if (this.map === 'arcade') this._drawCabinetScreens()
    this._drawMovementGuides()
    this._drawInteractionHalo()
    this._drawGuideTargetHalo()
    this._drawStepFx()
    this._drawImpactFx()

    // 캐릭터와 바닥 소품을 같은 y축으로 정렬해 자연스럽게 가려진다.
    const ents = [...this.agents.values()].filter(e => e.visible && (!e.map || e.map === this.map))
    ents.push(this.player)
    const scene = [
      ...ents.map(e => ({ type: 'entity', y: e.y, value: e })),
      ...this.worldObjects
        .filter(o => o.map === this.map && !o.held && !o.mounted)
        .map(o => ({ type: 'object', y: o.y, value: o })),
      ...(this.mapDepthEnabled[this.map] ? layoutOccluders(this.maps[this.map]) : [])
        .map(o => ({ type: 'occluder', y: o.baseline, value: o }))
    ].sort((a, b) => a.y - b.y || ({ entity: 0, object: 1, occluder: 2 }[a.type] - ({ entity: 0, object: 1, occluder: 2 }[b.type])))
    for (const item of scene) {
      if (item.type === 'entity') {
        this._drawEnt(item.value)
        this._drawSeatFront(item.value, bg)
      }
      else if (item.type === 'object') this._drawWorldObject(item.value)
      else this._drawFurnitureOccluder(item.value, bg)
    }
    if (this.map === 'office') this._drawShelfSign()
    for (const e of ents) this._drawEntOverlay(e)
    for (const e of ents) if (e.bubble) this._drawBubble(e)
    for (const e of ents) this._drawEntRoleLabel(e)
    this._drawInteractionKey()
    ctx.restore()
  }

  _drawFurnitureOccluder(occluder, background) {
    if (!background || !occluder?.source) return
    const [x, y, width, height] = occluder.source
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return
    // Repaint the measured foreground crop at its original coordinates. Since
    // this item participates in the same foot-y scene sort as avatars, walking
    // behind a sofa/desk hides the body while walking in front stays visible.
    this.ctx.drawImage(background, x, y, width, height, x, y, width, height)
    // Shelf cartridges are dynamic overlays, so they must share the shelf's
    // baseline. Drawing them before the crop erased them; drawing them after
    // the whole scene put them on top of avatars standing in front.
    if (occluder.id === 'game-shelf-front') this._drawShelfCartridges()
  }

  _drawSeatFront(e, background) {
    const seatPose = seatPoseLayout(e?.seatMotion, { facing: e?.dir })
    const seatMeta = e?.meta?.seat || e?.meta?.seatExit
    if (!background || !seatPose.active || !seatMeta?.occluderId || this.map !== 'office') return
    const occluder = layoutOccluders(this.maps.office).find(item => item.id === seatMeta.occluderId)
    if (!occluder) return
    const [x, y, width, height] = occluder.source
    const frontY = Math.max(y, Math.min(y + height, occluder.baseline))
    const frontHeight = y + height - frontY
    if (frontHeight <= 0) return
    // Only the measured lower lip is repainted after a seated actor. Reusing
    // the full opaque crop here would erase their torso and face.
    this.ctx.drawImage(background, x, frontY, width, frontHeight, x, frontY, width, frontHeight)
  }

  _drawAmbientBack() {
    const { ctx } = this
    const motionT = this.reduceMotion ? 0 : this.t
    ctx.save()
    ctx.globalCompositeOperation = 'screen'

    if (this.map === 'office') {
      // 창으로 들어오는 얕은 햇빛과 모니터의 청록색 글로우.
      const windowXs = [564, 708, 852, 996]
      for (let i = 0; i < windowXs.length; i++) {
        const sway = Math.sin(motionT / 2100 + i) * 8
        const x = windowXs[i]
        const beam = ctx.createLinearGradient(0, 74, 0, 360)
        beam.addColorStop(0, 'rgba(146,220,255,.15)')
        beam.addColorStop(1, 'rgba(146,220,255,0)')
        ctx.fillStyle = beam
        ctx.beginPath()
        ctx.moveTo(x - 27, 72); ctx.lineTo(x + 27, 72)
        ctx.lineTo(x + 74 + sway, 354); ctx.lineTo(x - 70 + sway, 354)
        ctx.closePath(); ctx.fill()
      }

      const monitors = [[744, 232], [984, 232], [1224, 184], [744, 472], [984, 472], [1224, 424]]
      for (let i = 0; i < monitors.length; i++) {
        const [x, y] = monitors[i]
        const glow = ctx.createRadialGradient(x, y, 2, x, y, 54 + Math.sin(motionT / 800 + i) * 4)
        glow.addColorStop(0, 'rgba(86,244,218,.22)')
        glow.addColorStop(.45, 'rgba(86,210,244,.08)')
        glow.addColorStop(1, 'rgba(86,210,244,0)')
        ctx.fillStyle = glow; ctx.fillRect(x - 64, y - 54, 128, 108)
      }

      // 밝은 바닥에서만 보이는 느린 먼지 입자. reduced-motion에서는 정지한다.
      for (let i = 0; i < 18; i++) {
        const x = 58 + ((i * 193 + motionT * (.006 + (i % 3) * .002)) % 1320)
        const y = 104 + ((i * 79 + motionT * (.004 + (i % 4) * .001)) % 760)
        const a = .13 + ((i * 17) % 7) * .018
        ctx.fillStyle = `rgba(255,250,218,${a.toFixed(3)})`
        ctx.beginPath(); ctx.arc(x, y, i % 4 === 0 ? 2 : 1.2, 0, Math.PI * 2); ctx.fill()
      }

      if (this.meetingMode) {
        const z = this.maps.office.meeting?.zone || [2, 3, 8, 6]
        const x = z[0] * T + 8, y = z[1] * T + 8, w = z[2] * T - 16, h = z[3] * T - 16
        const pulse = this.reduceMotion ? .3 : .24 + Math.sin(this.t / 420) * .07
        ctx.fillStyle = `rgba(113,96,238,${pulse.toFixed(3)})`
        ctx.beginPath(); ctx.roundRect(x, y, w, h, 32); ctx.fill()
        ctx.strokeStyle = 'rgba(201,193,255,.72)'; ctx.lineWidth = 3
        ctx.beginPath(); ctx.roundRect(x + 3, y + 3, w - 6, h - 6, 29); ctx.stroke()
      }
    } else {
      const neon = this.reduceMotion ? .2 : .17 + Math.sin(this.t / 330) * .06
      ctx.fillStyle = `rgba(255,76,190,${neon.toFixed(3)})`
      ctx.fillRect(22, 95, WORLD_W - 44, 12)
      for (const c of this.maps.arcade.cabinets) {
        const [sx, sy, ex, ey] = c.screen
        const cx = (sx + ex) / 2, cy = (sy + ey) / 2
        const glow = ctx.createRadialGradient(cx, cy, 5, cx, cy, this.simMode ? 86 : 62)
        glow.addColorStop(0, `rgba(112,220,255,${this.simMode ? .28 : .15})`)
        glow.addColorStop(1, 'rgba(112,220,255,0)')
        ctx.fillStyle = glow; ctx.fillRect(cx - 90, cy - 90, 180, 180)
      }
      if (this.simMode) {
        const floorPulse = this.reduceMotion ? .12 : .1 + Math.sin(this.t / 240) * .055
        ctx.fillStyle = `rgba(120,100,255,${floorPulse.toFixed(3)})`
        ctx.beginPath(); ctx.roundRect(552, 268, 340, 185, 22); ctx.fill()
      }
    }
    ctx.restore()
  }

  _drawMovementGuides() {
    const { ctx } = this
    if (this.hoverTile && !this.freezePlayer && !this.moveMarker) {
      const h = this.hoverTile
      ctx.save()
      ctx.strokeStyle = h.walkable ? 'rgba(255,255,255,.32)' : 'rgba(255,104,126,.36)'
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.ellipse(h.x, h.y + 1, 14, 5, 0, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    }

    const m = this.moveMarker
    if (!m) return
    if (this.t >= m.until) { this.moveMarker = null; return }
    const total = Math.max(1, m.until - m.started)
    const life = Math.max(0, Math.min(1, (m.until - this.t) / total))
    const pulse = this.reduceMotion ? 0 : Math.sin(this.t / 105) * 2.5
    ctx.save()
    if (m.valid && this.player.path.length) {
      ctx.strokeStyle = 'rgba(184,175,255,.42)'; ctx.lineWidth = 2
      ctx.setLineDash([3, 8]); ctx.lineDashOffset = this.reduceMotion ? 0 : -this.t / 70
      ctx.beginPath(); ctx.moveTo(this.player.x, this.player.y)
      for (const [tx, ty] of this.player.path) ctx.lineTo(tx * T + T / 2, ty * T + T - 6)
      ctx.stroke(); ctx.setLineDash([])
    }
    if (!m.valid) {
      ctx.strokeStyle = `rgba(255,91,119,${(.35 + life * .65).toFixed(3)})`; ctx.lineWidth = 3
      ctx.beginPath(); ctx.ellipse(m.x, m.y, 17 + pulse, 7 + pulse * .3, 0, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(m.x - 5, m.y - 5); ctx.lineTo(m.x + 5, m.y + 5)
      ctx.moveTo(m.x + 5, m.y - 5); ctx.lineTo(m.x - 5, m.y + 5); ctx.stroke()
    } else {
      const reached = !!m.reachedAt
      ctx.fillStyle = reached ? 'rgba(86,220,149,.2)' : 'rgba(122,105,242,.16)'
      ctx.strokeStyle = reached ? 'rgba(112,244,171,.95)' : 'rgba(255,255,255,.9)'
      ctx.lineWidth = 2.5
      ctx.beginPath(); ctx.ellipse(m.x, m.y, 15 + pulse, 6 + pulse * .3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      if (!reached) {
        ctx.fillStyle = '#fff'
        ctx.beginPath(); ctx.moveTo(m.x, m.y - 18 - pulse); ctx.lineTo(m.x - 5, m.y - 26 - pulse); ctx.lineTo(m.x + 5, m.y - 26 - pulse); ctx.closePath(); ctx.fill()
      }
    }
    ctx.restore()
  }

  _drawStepFx() {
    const { ctx } = this
    for (const fx of this.stepFx) {
      if (fx.map !== this.map) continue
      const p = Math.max(0, Math.min(1, (this.t - fx.born) / fx.life))
      ctx.fillStyle = `rgba(${fx.color},${((1 - p) * .26).toFixed(3)})`
      ctx.beginPath(); ctx.ellipse(fx.x, fx.y - p * (fx.ride ? 2 : 5), (fx.ride ? 6 : 3) + p * 5, (fx.ride ? 2 : 1.5) + p * 2, 0, 0, Math.PI * 2); ctx.fill()
    }
  }

  _drawImpactFx() {
    const { ctx } = this
    for (const fx of this.impactFx) {
      if (fx.map !== this.map) continue
      const p = Math.max(0, Math.min(1, (this.t - fx.born) / fx.life))
      const a = 1 - p
      ctx.save()
      ctx.globalAlpha = a
      ctx.strokeStyle = fx.color
      ctx.fillStyle = fx.color
      ctx.lineWidth = fx.kind === 'whoosh' ? 2 : 3
      if (fx.kind === 'whoosh') {
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath(); ctx.moveTo(fx.x - 5, fx.y + i * 5); ctx.lineTo(fx.x - 19 - p * 13, fx.y + i * 7); ctx.stroke()
        }
      } else {
        for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI / 3 + .22
          const r0 = 5 + p * 7, r1 = 11 + p * 15
          ctx.beginPath()
          ctx.moveTo(fx.x + Math.cos(angle) * r0, fx.y + Math.sin(angle) * r0 * .48)
          ctx.lineTo(fx.x + Math.cos(angle) * r1, fx.y + Math.sin(angle) * r1 * .48)
          ctx.stroke()
        }
        ctx.beginPath(); ctx.ellipse(fx.x, fx.y, 6 + p * 13, 2 + p * 5, 0, 0, Math.PI * 2); ctx.stroke()
      }
      ctx.restore()
    }
  }

  _drawWorldObject(o) {
    const { ctx } = this
    if (isPocketStation(o)) {
      drawPocketStation(ctx, o, this.t, this.reduceMotion)
      return
    }
    if (o.mountable) {
      this._drawVehicle(o, o.x, o.y, o.dir, false)
      return
    }
    const airY = o.y - o.z
    ctx.save()
    if (!o.held) {
      const shadowScale = Math.max(.42, 1 - o.z / 100)
      ctx.fillStyle = `rgba(16,15,25,${(.26 * shadowScale).toFixed(3)})`
      ctx.beginPath(); ctx.ellipse(o.x, o.y + 2, (o.kind === 'trashbin' ? 13 : 11) * shadowScale, 4 * shadowScale, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.translate(o.x, airY)
    ctx.rotate(o.kind === 'book' ? o.spin : Math.sin(o.spin) * .16)
    if (o.kind === 'book') {
      ctx.fillStyle = '#252336'; ctx.fillRect(-13, -13, 27, 20)
      ctx.fillStyle = o.color; ctx.fillRect(-14, -15, 26, 19)
      ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillRect(-9, -11, 16, 3); ctx.fillRect(-9, -5, 11, 2)
      ctx.fillStyle = '#f7e9c8'; ctx.fillRect(-11, 5, 25, 3)
      ctx.fillStyle = '#ff6688'; ctx.fillRect(7, -15, 3, 9)
    } else {
      ctx.fillStyle = 'rgba(16,18,28,.3)'; ctx.fillRect(-13, -23, 28, 28)
      ctx.fillStyle = o.color; ctx.fillRect(-14, -26, 27, 28)
      ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(-10, -22, 4, 20)
      ctx.fillStyle = '#394454'; ctx.fillRect(-17, -29, 33, 5); ctx.fillRect(-11, 2, 5, 4); ctx.fillRect(6, 2, 5, 4)
      ctx.strokeStyle = 'rgba(33,42,55,.65)'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(-8, -17); ctx.lineTo(-7, -2); ctx.moveTo(0, -17); ctx.lineTo(0, -2); ctx.moveTo(8, -17); ctx.lineTo(7, -2); ctx.stroke()
    }
    ctx.restore()
  }

  _eraseBakedVehicles(bg) {
    // ImageGen supplied richly textured maps with parked vehicles. Copy nearby
    // floor texture over those pixels so the runtime vehicle can truly leave its
    // parking spot when mounted (and return when the rider dismounts).
    const { ctx } = this
    if (this.map === 'office') {
      ctx.drawImage(bg, 780, 700, 170, 125, 950, 700, 170, 125)
      ctx.drawImage(bg, 790, 700, 125, 115, 1185, 700, 125, 115)
    } else {
      ctx.drawImage(bg, 700, 685, 190, 155, 920, 685, 190, 155)
    }
  }

  _drawVehicle(o, x, y, dir = 'right', riding = false, visual = null) {
    const { ctx } = this
    const horizontal = dir === 'left' || dir === 'right'
    const forward = DIR_VECTOR[dir] || DIR_VECTOR.right
    const moving = !!(riding && this.player.moving && !this.reduceMotion)
    const cycle = visual?.cycle || sampleRideCycle(0, false, o.kind, this.reduceMotion)
    const bank = Number(visual?.bank || 0)
    const vehicleScale = o.kind === 'bicycle' ? 1.62 : 1.58

    ctx.save()
    ctx.translate(x, y)
    if (moving) {
      ctx.strokeStyle = `${o.color}a6`; ctx.lineWidth = 2; ctx.lineCap = 'round'
      for (let i = 0; i < 3; i++) {
        const side = (i - 1) * 5
        const sx = -forward.x * (23 * vehicleScale + i * 5) + (horizontal ? 0 : side)
        const sy = -forward.y * (23 * vehicleScale + i * 5) + (horizontal ? side * .7 : 0)
        ctx.beginPath(); ctx.moveTo(sx, sy)
        ctx.lineTo(sx - forward.x * (14 + i * 4), sy - forward.y * (14 + i * 4)); ctx.stroke()
      }
    }

    ctx.fillStyle = 'rgba(16,15,25,.3)'
    ctx.beginPath()
    ctx.ellipse(
      0, 3,
      horizontal ? (o.kind === 'bicycle' ? 27 : 23) * vehicleScale : 8 * vehicleScale,
      horizontal ? 5 * vehicleScale : (o.kind === 'bicycle' ? 28 : 23) * vehicleScale,
      0, 0, Math.PI * 2
    )
    ctx.fill()
    ctx.rotate(bank * .5)
    ctx.scale(vehicleScale, vehicleScale)

    if (!horizontal) {
      const fy = forward.y
      if (o.kind === 'bicycle') {
        const rearY = -fy * 15
        const frontY = fy * 17
        for (const wy of [rearY, frontY]) {
          ctx.strokeStyle = '#242a38'; ctx.lineWidth = 5
          ctx.beginPath(); ctx.ellipse(0, wy, 5.3, 9.5, 0, 0, Math.PI * 2); ctx.stroke()
          ctx.strokeStyle = '#d8f3f1'; ctx.lineWidth = 1.2
          ctx.beginPath(); ctx.ellipse(0, wy, 3.6, 7.2, 0, 0, Math.PI * 2); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(-3.5, wy); ctx.lineTo(3.5, wy)
          ctx.moveTo(0, wy - 6.5); ctx.lineTo(0, wy + 6.5); ctx.stroke()
        }
        ctx.strokeStyle = o.color; ctx.lineWidth = 4; ctx.lineJoin = 'round'
        ctx.beginPath(); ctx.moveTo(0, rearY); ctx.lineTo(-5, -fy * 2); ctx.lineTo(0, frontY)
        ctx.moveTo(0, rearY); ctx.lineTo(5, fy * 3); ctx.lineTo(0, frontY); ctx.stroke()
        ctx.fillStyle = '#303344'
        const saddleY = -18.5 - fy * 1.5
        ctx.beginPath(); ctx.roundRect(-7, saddleY - 2, 14, 5, 2); ctx.fill()
        ctx.strokeStyle = '#dce9ef'; ctx.lineWidth = 3
        ctx.beginPath(); ctx.moveTo(0, frontY - fy * 4); ctx.lineTo(0, -24 + fy * 4)
        ctx.moveTo(-8, -24 + fy * 4); ctx.lineTo(8, -24 + fy * 4); ctx.stroke()
      } else {
        for (const wy of [-fy * 14, fy * 15]) {
          ctx.fillStyle = '#242a38'; ctx.beginPath(); ctx.ellipse(0, wy, 4.5, 7, 0, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = '#d8f3f1'; ctx.beginPath(); ctx.ellipse(0, wy, 1.8, 2.8, 0, 0, Math.PI * 2); ctx.fill()
        }
        ctx.fillStyle = o.color; ctx.beginPath(); ctx.roundRect(-6, -15, 12, 30, 5); ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.fillRect(-3, -10, 6, 18)
        ctx.strokeStyle = o.color; ctx.lineWidth = 4
        ctx.beginPath(); ctx.moveTo(0, fy * 13); ctx.lineTo(0, -28 + fy * 5); ctx.stroke()
        ctx.fillStyle = '#303344'; ctx.fillRect(-9, -30 + fy * 5, 18, 4)
      }
      ctx.restore()
      return
    }

    ctx.scale(dir === 'left' ? -1 : 1, 1)
    if (o.kind === 'bicycle') {
      for (const wx of [-17, 17]) {
        ctx.strokeStyle = '#242a38'; ctx.lineWidth = 5
        ctx.beginPath(); ctx.arc(wx, -1, 9, 0, Math.PI * 2); ctx.stroke()
        ctx.strokeStyle = '#d8f3f1'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(wx, -1, 7, 0, Math.PI * 2); ctx.stroke()
        ctx.strokeStyle = 'rgba(216,243,241,.62)'; ctx.lineWidth = 1
        for (let spoke = 0; spoke < 4; spoke++) {
          const angle = cycle.wheelPhase + spoke * Math.PI / 2
          ctx.beginPath(); ctx.moveTo(wx, -1)
          ctx.lineTo(wx + Math.cos(angle) * 6.5, -1 + Math.sin(angle) * 6.5); ctx.stroke()
        }
      }
      ctx.strokeStyle = o.color; ctx.lineWidth = 4; ctx.lineJoin = 'bevel'
      ctx.beginPath(); ctx.moveTo(-17, -1); ctx.lineTo(-5, -17); ctx.lineTo(5, -1); ctx.lineTo(-17, -1); ctx.lineTo(-2, -1); ctx.lineTo(11, -17); ctx.lineTo(17, -1); ctx.stroke()
      ctx.fillStyle = '#303344'; ctx.fillRect(-10, -20, 12, 4)
      ctx.strokeStyle = '#dce9ef'; ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(11, -17); ctx.lineTo(15, -24); ctx.lineTo(21, -24); ctx.stroke()
      ctx.strokeStyle = '#242a38'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(0, -3, 3.5, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(Math.cos(cycle.pedalPhase) * 6, -3 + Math.sin(cycle.pedalPhase) * 4); ctx.stroke()
    } else {
      for (const wx of [-14, 14]) {
        ctx.fillStyle = '#242a38'; ctx.beginPath(); ctx.arc(wx, 0, 6, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#d8f3f1'; ctx.beginPath(); ctx.arc(wx, 0, 2, 0, Math.PI * 2); ctx.fill()
      }
      ctx.fillStyle = o.color; ctx.fillRect(-17, -5, 30, 7)
      ctx.strokeStyle = o.color; ctx.lineWidth = 4
      ctx.beginPath(); ctx.moveTo(10, -4); ctx.lineTo(12, -29); ctx.stroke()
      ctx.fillStyle = '#303344'; ctx.fillRect(7, -31, 14, 4)
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(-11, -3, 17, 2)
    }
    ctx.restore()
  }

  _drawRiderDrive(o, e, layout, cycle, pose) {
    const { ctx } = this
    const settle = e.meta?.rideMotion?.phase === 'mount' ? pose.liftMix : 1
    if (settle < .16) return
    const bank = Number(e.meta?.rideState?.bank || 0)
    const limb = (hip, knee, foot, alpha = 1) => {
      ctx.globalAlpha = Math.min(1, settle * 1.35) * alpha
      ctx.strokeStyle = '#283859'; ctx.lineWidth = 4.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(knee.x, knee.y); ctx.lineTo(foot.x, foot.y); ctx.stroke()
      ctx.fillStyle = '#202838'
      ctx.save(); ctx.translate(foot.x, foot.y); ctx.rotate(layout.horizontal ? layout.forward.x * .06 : 0)
      ctx.beginPath(); ctx.roundRect(-4.5, -1.8, 9, 3.6, 1.5); ctx.fill(); ctx.restore()
    }

    ctx.save()
    ctx.translate(e.x + pose.offsetX, e.y + pose.hop + cycle.bob)
    ctx.rotate(pose.rotation + bank * .5)
    ctx.scale(pose.scaleX, pose.scaleY)
    if (o.kind === 'bicycle') {
      if (layout.horizontal) {
        for (const side of [-1, 1]) {
          const phase = cycle.pedalPhase + (side < 0 ? 0 : Math.PI)
          const pedal = { x: layout.forward.x * Math.cos(phase) * 9.5, y: -4.8 + Math.sin(phase) * 6.3 }
          const hip = { x: layout.hip.x - layout.forward.x * side * 2.2, y: layout.hip.y + side * .6 }
          const knee = {
            x: (hip.x + pedal.x) * .5 + layout.forward.x * (7 + Math.max(0, Math.sin(phase)) * 2.5),
            y: -17 + Math.abs(Math.sin(phase)) * 2.8
          }
          limb(hip, knee, pedal, side < 0 ? .7 : 1)
        }
      } else {
        for (const side of [-1, 1]) {
          const phase = cycle.pedalPhase + (side < 0 ? 0 : Math.PI)
          const pedal = { x: side * 5.5 + Math.cos(phase) * 2.5, y: -5 + Math.sin(phase) * 6 }
          const hip = { x: side * 3.2, y: layout.hip.y }
          // In the front/back silhouette a narrow knee angle reads as two
          // straight legs and makes the avatar look as if it is standing on
          // the bicycle. Flare each knee outside the frame, then bring the
          // shoe back to the pedal so the seated bend remains visible.
          const knee = {
            x: side * (12.5 + Math.abs(Math.cos(phase)) * 2.5),
            y: -18 + Math.abs(Math.sin(phase)) * 1.5
          }
          limb(hip, knee, pedal, side < 0 ? .72 : 1)
        }
      }
    } else if (layout.horizontal) {
      const side = layout.forward.x
      limb(
        { x: layout.hip.x - side * 2, y: layout.hip.y },
        { x: -side * 2, y: -10 },
        { x: -side * 3, y: -5 },
        .76
      )
      const kickFoot = {
        x: side * (5 - cycle.kick * 19),
        y: -4 + Math.sin(cycle.kick * Math.PI) * 5.5
      }
      limb(
        { x: layout.hip.x + side * 3.5, y: layout.hip.y },
        { x: side * (6 + cycle.kick * 4), y: -11 },
        kickFoot
      )
    } else {
      limb({ x: -3.5, y: layout.hip.y }, { x: -5.5, y: -10 }, { x: -4, y: -4.5 }, .76)
      limb(
        { x: 3.5, y: layout.hip.y },
        { x: 6 + cycle.kick * 3, y: -10 },
        { x: 4 + cycle.kick * 6, y: -4 + Math.sin(cycle.kick * Math.PI) * 4.5 }
      )
    }
    ctx.restore()
  }

  _drawMountedAvatar(e, img, layout, cycle, pose) {
    if (!img?.width || !img?.height) return false
    const { ctx } = this
    const settle = e.meta?.rideMotion?.phase === 'mount' ? pose.liftMix : 1
    const cropRatio = 1 - (1 - layout.cropRatio) * settle
    const sourceH = Math.max(1, Math.round(img.height * cropRatio))
    const scale = Math.min(AVATAR_VISUAL.mounted.height / img.height, AVATAR_VISUAL.mounted.width / img.width)
    const drawW = Math.round(img.width * scale)
    const drawH = Math.round(sourceH * scale)
    const bottomX = layout.bodyBottom.x * settle
    const bottomY = 4 + (layout.bodyBottom.y - 4) * settle
    const bank = Number(e.meta?.rideState?.bank || 0)

    ctx.save()
    ctx.translate(e.x + pose.offsetX + bottomX, e.y + pose.hop + bottomY + cycle.bob)
    ctx.rotate(pose.rotation + layout.lean * settle + bank * .55)
    ctx.scale(pose.scaleX, pose.scaleY)
    ctx.drawImage(img, 0, 0, img.width, sourceH, -Math.round(drawW / 2), -drawH, drawW, drawH)
    ctx.restore()
    return { drawW, drawH: Math.round(img.height * scale), bob: cycle.bob }
  }

  _drawDismountAvatar(e, img, kind, pose) {
    if (!img?.width || !img?.height || !pose?.active) return null
    const { ctx } = this
    const layout = rideLayout(kind, e.dir)
    const progress = Math.max(0, Math.min(1, Number(pose.progress) || 0))
    const mountedScale = Math.min(AVATAR_VISUAL.mounted.height / img.height, AVATAR_VISUAL.mounted.width / img.width)
    const standingScale = Math.min(AVATAR_VISUAL.player.height / img.height, AVATAR_VISUAL.player.width / img.width)
    const scale = mountedScale + (standingScale - mountedScale) * progress
    const cropRatio = layout.cropRatio + (1 - layout.cropRatio) * progress
    const sourceH = Math.max(1, Math.round(img.height * cropRatio))
    const drawW = Math.round(img.width * scale)
    const drawH = Math.round(sourceH * scale)
    const bottomX = layout.bodyBottom.x * (1 - progress)
    const bottomY = layout.bodyBottom.y * (1 - progress) + 4 * progress

    ctx.save()
    ctx.translate(e.x + pose.offsetX + bottomX, e.y + pose.hop + bottomY)
    ctx.rotate(pose.rotation + layout.lean * (1 - progress))
    ctx.scale(pose.scaleX, pose.scaleY)
    ctx.drawImage(img, 0, 0, img.width, sourceH, -Math.round(drawW / 2), -drawH, drawW, drawH)
    ctx.restore()
    return { drawW, drawH: Math.round(img.height * scale), bob: pose.hop || 0 }
  }

  _drawRiderGrip(o, e, layout, cycle, pose) {
    const { ctx } = this
    const settle = e.meta?.rideMotion?.phase === 'mount' ? pose.liftMix : 1
    if (settle < .26) return
    const bank = Number(e.meta?.rideState?.bank || 0)
    ctx.save()
    ctx.translate(e.x + pose.offsetX, e.y + pose.hop + cycle.bob)
    ctx.rotate(pose.rotation + bank * .5)
    ctx.scale(pose.scaleX, pose.scaleY)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    for (let i = 0; i < layout.handles.length; i++) {
      const handle = layout.handles[i]
      const sideOffset = layout.horizontal ? layout.forward.x * (i ? -2 : 2) : (i ? 2 : -2)
      const shoulder = { x: layout.shoulder.x + sideOffset, y: layout.shoulder.y + i * 1.8 }
      const elbow = {
        x: shoulder.x + (handle.x - shoulder.x) * .55 + (layout.horizontal ? 0 : sideOffset),
        y: shoulder.y + (handle.y - shoulder.y) * .52 + 3
      }
      ctx.globalAlpha = Math.min(1, settle * 1.35) * (i ? 1 : .72)
      ctx.strokeStyle = '#233554'; ctx.lineWidth = 4
      ctx.beginPath(); ctx.moveTo(shoulder.x, shoulder.y); ctx.lineTo(elbow.x, elbow.y); ctx.lineTo(handle.x, handle.y); ctx.stroke()
      ctx.fillStyle = '#f2bd91'; ctx.beginPath(); ctx.arc(handle.x, handle.y, 2.35, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = Math.min(1, settle * 1.35)
    ctx.strokeStyle = '#242a38'; ctx.lineWidth = 2.2
    const [a, b] = layout.handles
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    ctx.restore()
  }

  _drawInteractionHalo() {
    const { ctx } = this
    const a = this.interactionTarget
    if (!a || a.type === 'agent') return
    const pulse = this.reduceMotion ? 0 : Math.sin(this.t / 150) * 2
    ctx.save()
    ctx.fillStyle = 'rgba(107,229,166,.09)'
    ctx.strokeStyle = 'rgba(134,246,187,.88)'
    ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.ellipse(a.x, a.y, a.rx + pulse, a.ry + pulse * .35, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.restore()
  }

  _drawGuideTargetHalo() {
    const { ctx } = this
    const target = this._resolveGuideTarget()
    if (!target) return
    const pulse = this.reduceMotion ? 0 : Math.sin(this.t / 170) * 2
    const rx = target.rx + 5 + pulse
    const ry = target.ry + 2 + pulse * .3
    ctx.save()
    ctx.fillStyle = 'rgba(255,210,82,.12)'
    ctx.strokeStyle = 'rgba(171,143,255,.98)'
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.ellipse(target.x, target.y + 1, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.strokeStyle = 'rgba(255,215,91,.96)'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.ellipse(target.x, target.y + 1, rx + 5, ry + 2, 0, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
  }

  _drawInteractionKey() {
    const { ctx } = this
    const a = this.interactionTarget
    if (!a) return
    // Vehicle controls live in a dedicated DOM ride chip. Drawing another key
    // badge over the vehicle caused it to collide with nearby NPC talk badges.
    if (a.type === 'vehicle' || a.type === 'vehicleMounted') return
    // The bottom action bar already exposes mounted/held controls. Let the
    // short pickup/mount speech bubble read cleanly before showing the floating
    // key prompt above the player again.
    if (this.player.bubble && (a.type === 'vehicleMounted' || a.type === 'heldProp')) return
    const lift = a.type === 'agent' ? a.lift : Math.max(28, a.lift || 28)
    const y = a.y - lift + (this.reduceMotion ? 0 : Math.sin(this.t / 190) * 2)
    ctx.save()
    ctx.shadowColor = 'rgba(15,15,24,.28)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4
    ctx.fillStyle = 'rgba(31,31,38,.96)'
    ctx.beginPath(); ctx.roundRect(a.x - 16, y - 12, 32, 27, 9); ctx.fill()
    ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke()
    ctx.fillStyle = '#ffffff'; ctx.font = '800 15px "Segoe UI", sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(a.key || 'E', a.x, y + 7); ctx.textAlign = 'left'
    ctx.restore()
  }

  _drawEnt(e) {
    const { ctx } = this
    const set = this.images[e.sprite]
    const img = set && (set[e.dir] || set.down)
    const walkSheet = this.walkSheets[e.sprite]
    const isPlayer = e === this.player
    const mounted = isPlayer ? this.worldObject(this.mountedVehicleId) : null
    const held = isPlayer ? this.worldObject(this.heldObjectId) : null
    const rideMotion = isPlayer ? e.meta?.rideMotion : null
    const ridePose = rideTransitionPose(rideMotion, this.t, this.reduceMotion)
    const rideKind = mounted?.kind || rideMotion?.kind || null
    const dismounting = !mounted && rideMotion?.phase === 'dismount' && ridePose.active && !!rideKind
    const seatPose = seatPoseLayout(e.seatMotion, { facing: e.dir })
    const visuallySeated = !!e.sitting || seatPose.isSeated
    const walkFrame = e.walkAnimation?.frame || 'idle'
    const walkAdvanced = !!e.walkAnimation?.advanced
    // Only canonical 3x4 sheets are safe to slice. A malformed/partial sheet
    // falls back to the audited directional still instead of leaking an
    // adjacent action into the walking avatar.
    const useWalkSheet = !!(isWalkSheetCompatible(walkSheet) && walkAdvanced && !visuallySeated && !mounted && !this.reduceMotion)
    const useMotionSheet = useWalkSheet
    const source = useMotionSheet ? sheetSource(e.dir, walkFrame) : null
    const sourceW = source?.width || img?.width
    const sourceH = source?.height || img?.height
    const standingVisual = isPlayer ? AVATAR_VISUAL.player : AVATAR_VISUAL.npc
    const seatMix = seatPose.active ? seatPose.mix : (e.sitting ? 1 : 0)
    const targetH = standingVisual.height + (AVATAR_VISUAL.seated.height - standingVisual.height) * seatMix
    const targetW = standingVisual.width + (AVATAR_VISUAL.seated.width - standingVisual.width) * seatMix
    const frameLayout = avatarDrawLayout({
      sourceWidth: sourceW,
      sourceHeight: sourceH,
      targetWidth: targetW,
      targetHeight: targetH
    })
    const { drawW, drawH } = frameLayout
    const frameStride = walkFrame === 'stepL' ? -1 : walkFrame === 'stepR' ? 1 : 0
    const fallbackStride = !mounted && !this.reduceMotion && walkAdvanced ? Math.sin(this.t / 62 + e.x * .015) : 0
    const stride = mounted ? 0 : (useMotionSheet ? frameStride : fallbackStride)
    // The authored contact anchor already carries the gait. Vertical sine/bob
    // offsets lift that anchor away from the shadow and make both walking and
    // idle avatars appear to hover, so standing poses remain ground-locked.
    const bob = 0
    const stepX = !useMotionSheet && walkAdvanced && (e.dir === 'up' || e.dir === 'down') ? stride * .65 : 0
    const isGuideTarget = this.guideTarget?.type === 'agent' && this.guideTarget.id === e.id
    const isTarget = !isGuideTarget && this.interactionTarget?.type === 'agent' && this.interactionTarget.id === e.id
    const pulse = this.reduceMotion ? 0 : Math.sin(this.t / 145) * 1.6
    const baseRideLift = rideKind === 'bicycle' ? 9 : rideKind === 'scooter' ? 3 : 0
    const ridingLift = rideMotion?.phase === 'dismount' ? baseRideLift * ridePose.liftMix : 0
    const mountedLayout = mounted ? rideLayout(mounted.kind, e.dir) : null
    const mountedCycle = mounted
      ? sampleRideCycle(e.meta?.rideState?.distance || 0, e.moving, mounted.kind, this.reduceMotion)
      : null
    const rideVisual = mounted
      ? { cycle: mountedCycle, bank: e.meta?.rideState?.bank || 0 }
      : null
    const reactionMotion = isPlayer
      ? { x: 0, y: 0, rotation: 0 }
      : this.npcReactions.visualOffset(e, this.t, this.reduceMotion)
    const walkMotion = e.walkMotion?.pose || NEUTRAL_AVATAR_WALK_POSE
    const standingMotion = {
      x: (reactionMotion.x || 0) + (walkMotion.x || 0) + (ridePose.offsetX || 0) + seatPose.offsetX,
      y: (reactionMotion.y || 0) + (walkMotion.y || 0) + (ridePose.hop || 0) + seatPose.offsetY,
      rotation: (reactionMotion.rotation || 0) + (walkMotion.rotation || 0) + (ridePose.rotation || 0) + seatPose.rotation,
      shearX: (walkMotion.shearX || 0) + seatPose.shearX,
      scaleX: (reactionMotion.scaleX ?? 1) * (walkMotion.scaleX ?? 1) * ridePose.scaleX * seatPose.scaleX,
      scaleY: (reactionMotion.scaleY ?? 1) * (walkMotion.scaleY ?? 1) * ridePose.scaleY * seatPose.scaleY
    }

    if (isTarget) {
      ctx.fillStyle = 'rgba(102,229,162,.13)'
      ctx.strokeStyle = 'rgba(131,247,186,.96)'; ctx.lineWidth = 2.5
      ctx.beginPath(); ctx.ellipse(e.x, e.y + 1, 22 + pulse, 8 + pulse * .3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    }
    // Mounted vehicles own the ground shadow; drawing the standing avatar
    // shadow as well made the wheels look embedded in a dark puddle.
    if (!mounted && !seatPose.isSeated) {
      ctx.fillStyle = isPlayer ? 'rgba(20,15,36,.34)' : 'rgba(18,14,26,.27)'
      ctx.globalAlpha = (walkMotion.shadowAlpha ?? 1) * seatPose.shadowAlpha
      ctx.beginPath(); ctx.ellipse(
        e.x, e.y + 2,
        Math.max(10, drawW * .36 * (walkMotion.shadowScaleX ?? 1) * seatPose.shadowScaleX),
        4.6 * (walkMotion.shadowScaleY ?? 1) * seatPose.shadowScaleY,
        0, 0, Math.PI * 2
      ); ctx.fill()
      ctx.globalAlpha = 1
    }
    if (isPlayer && !seatPose.isSeated) {
      ctx.fillStyle = 'rgba(99,82,219,.12)'
      ctx.strokeStyle = 'rgba(255,255,255,.96)'; ctx.lineWidth = 3
      ctx.beginPath(); ctx.ellipse(e.x, e.y + 1, 19 + pulse * .35, 7.5 + pulse * .12, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.strokeStyle = 'rgba(124,105,242,.95)'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.ellipse(e.x, e.y + 1, 14.5, 5.3, 0, 0, Math.PI * 2); ctx.stroke()
    } else if (isPlayer && seatPose.isSeated) {
      ctx.strokeStyle = 'rgba(255,255,255,.72)'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.ellipse(e.x, e.y + 5, 16, 5, 0, 0, Math.PI * 2); ctx.stroke()
    }
    let mountedAvatar = null
    if (mounted) {
      this._drawVehicle(mounted, e.x, e.y, e.dir, true, rideVisual)
      this._drawRiderDrive(mounted, e, mountedLayout, mountedCycle, ridePose)
      mountedAvatar = this._drawMountedAvatar(e, img, mountedLayout, mountedCycle, ridePose)
      if (!mountedAvatar) {
        ctx.fillStyle = e.color
        ctx.fillRect(e.x - 11, e.y - 54, 22, 35)
      }
      this._drawRiderGrip(mounted, e, mountedLayout, mountedCycle, ridePose)
    } else if (dismounting && img) {
      mountedAvatar = this._drawDismountAvatar(e, img, rideKind, ridePose)
    } else if (img || useMotionSheet) {
      ctx.save()
      ctx.translate(
        Math.round(e.x + standingMotion.x),
        Math.round(e.y + standingMotion.y)
      )
      ctx.rotate(standingMotion.rotation)
      ctx.transform(1, 0, standingMotion.shearX, 1, 0, 0)
      ctx.scale(standingMotion.scaleX, standingMotion.scaleY)
      if (useMotionSheet) {
        ctx.drawImage(
          walkSheet,
          source.x, source.y, AVATAR_FRAME.width, AVATAR_FRAME.height,
          frameLayout.offsetX, frameLayout.offsetY + bob - ridingLift, drawW, drawH
        )
      } else {
        ctx.drawImage(img, frameLayout.offsetX + Math.round(stepX), frameLayout.offsetY + bob - ridingLift, drawW, drawH)
      }
      ctx.restore()
    } else {
      ctx.fillStyle = e.color
      ctx.fillRect(e.x - 12 + reactionMotion.x, e.y - 40 - ridingLift + reactionMotion.y, 24, 40)
    }
    if (!mounted) {
      drawAgentHandheld(ctx, e, {
        drawW,
        // Overlay actions share the same ground-contact origin. Excluding the
        // transparent rows below the foot anchor keeps handhelds and reaction
        // graphics attached to the visible body instead of the PNG bounds.
        drawH: frameLayout.anchorY,
        bob,
        time: this.t,
        reduceMotion: this.reduceMotion,
        visualOffset: standingMotion
      })
    }
    if (held) this._drawWorldObject(held)
    e._renderOverlay = {
      drawW: mountedAvatar?.drawW || drawW,
      drawH: mountedAvatar?.drawH || (frameLayout.anchorY + ridingLift) * seatPose.scaleY,
      bob: mountedCycle?.bob || bob
    }
  }

  _drawEntOverlay(e) {
    const { ctx } = this
    const set = this.images[e.sprite]
    const isPlayer = e === this.player
    const mounted = isPlayer ? this.worldObject(this.mountedVehicleId) : null
    const held = isPlayer ? this.worldObject(this.heldObjectId) : null
    const metrics = e._renderOverlay || {
      drawW: isPlayer ? AVATAR_VISUAL.player.width : AVATAR_VISUAL.npc.width,
      drawH: e.sitting ? AVATAR_VISUAL.seated.height : (isPlayer ? AVATAR_VISUAL.player.height : AVATAR_VISUAL.npc.height),
      bob: 0
    }
    const { drawW, drawH, bob } = metrics

    if (!isPlayer) this.npcReactions.draw(ctx, e, this.t, {
      spriteHeight: drawH,
      reduceMotion: this.reduceMotion,
      faceImage: set?.face || null
    })
    this.avatarEmotions.draw(ctx, e, this.t, {
      spriteHeight: drawH,
      drawWidth: drawW,
      bob,
      reduceMotion: this.reduceMotion,
      faceImage: set?.face || null
    })
    // speaking ring
    if (e.meta && e.meta.speaking) {
      const speakPulse = this.reduceMotion ? 0 : Math.sin(this.t / 105) * 2
      ctx.strokeStyle = 'rgba(255,210,74,.94)'; ctx.lineWidth = 2.5
      ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, 18 + speakPulse, 6.4 + speakPulse * .3, 0, 0, Math.PI * 2); ctx.stroke()
      this._drawEmote(e, drawW, drawH, bob)
    }
    // label
    ctx.font = `700 14px "Segoe UI", "Apple SD Gothic Neo", sans-serif`
    const name = isPlayer
      ? mounted ? `나 · ${mounted.kind === 'bicycle' ? '🚲' : '🛴'}` : held ? `나 · ${held.kind === 'book' ? '📘' : '🗑️'}` : '나'
      : (e.meta?.shortName || e.label)
    if (name) {
      const tw = ctx.measureText(name).width
      const chipW = tw + 25
      ctx.fillStyle = isPlayer ? 'rgba(92,76,194,.96)' : 'rgba(31,31,39,.88)'
      ctx.beginPath(); ctx.roundRect(e.x - chipW / 2, e.y + 9, chipW, 23, 9); ctx.fill()
      ctx.fillStyle = isPlayer ? '#b9f5d0' : (e.color || '#72dfa0')
      ctx.beginPath(); ctx.arc(e.x - tw / 2 - 6, e.y + 20, 3, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'; ctx.fillText(name, e.x + 4, e.y + 25); ctx.textAlign = 'left'
    }
  }

  _drawEntRoleLabel(e) {
    const isPlayer = e === this.player
    const metrics = e._renderOverlay || {
      drawH: e.sitting ? AVATAR_VISUAL.seated.height : (isPlayer ? AVATAR_VISUAL.player.height : AVATAR_VISUAL.npc.height),
      bob: 0
    }
    return drawAgentRoleLabel(this.ctx, e, { drawHeight: metrics.drawH, bob: metrics.bob })
  }

  _drawEmote(e, drawW, drawH, bob) {
    const { ctx } = this
    const x = e.x + drawW / 2 + 5
    const y = e.y - drawH + 16 + bob
    ctx.save()
    ctx.strokeStyle = 'rgba(255,222,104,.96)'; ctx.lineWidth = 2; ctx.lineCap = 'round'
    const phase = this.reduceMotion ? 0 : (this.t / 180) % 1
    for (let i = 0; i < 3; i++) {
      const r = 3 + i * 4 + phase * 2
      ctx.globalAlpha = Math.max(.18, .9 - i * .24 - phase * .2)
      ctx.beginPath(); ctx.arc(x, y, r, -1.05, 1.05); ctx.stroke()
    }
    ctx.restore()
  }

  _drawBubble(e) {
    const { ctx } = this
    const set = this.images[e.sprite]
    const mounted = e === this.player ? this.worldObject(this.mountedVehicleId) : null
    const h = e.sitting
      ? AVATAR_VISUAL.seated.height
      : mounted ? (mounted.kind === 'bicycle' ? 94 : 84)
        : (e === this.player ? AVATAR_VISUAL.player.height : AVATAR_VISUAL.npc.height)
    let text = e.bubble.text
    if (text.length > 64) text = text.slice(0, 63) + '…'
    ctx.font = '15px "Segoe UI", "Apple SD Gothic Neo", sans-serif'
    const maxW = 230
    const lines = []
    let line = ''
    for (const ch of text) {
      if (ch === '\n' || ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch === '\n' ? '' : ch }
      else line += ch
      if (lines.length >= 3) break
    }
    if (line && lines.length < 3) lines.push(line)
    const w = Math.min(maxW, Math.max(...lines.map(l => ctx.measureText(l).width))) + 18
    const bh = lines.length * 20 + 14
    let bx = e.x - w / 2, by = e.y - h - bh - 10
    const scale = this._renderScale()
    const viewLeft = this.camera.x - this.cv.width / (2 * scale)
    const viewRight = this.camera.x + this.cv.width / (2 * scale)
    const viewTop = this.camera.y - this.cv.height / (2 * scale)
    const viewBottom = this.camera.y + this.cv.height / (2 * scale)
    bx = Math.max(viewLeft + 6, Math.min(viewRight - w - 6, bx))
    by = Math.max(viewTop + 6, Math.min(viewBottom - bh - 12, by))
    ctx.save(); ctx.shadowColor = 'rgba(15,15,24,.28)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 5
    ctx.fillStyle = 'rgba(255,255,255,.98)'
    ctx.strokeStyle = 'rgba(35,35,44,.22)'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.roundRect(bx, by, w, bh, 12); ctx.fill(); ctx.stroke(); ctx.restore()
    ctx.beginPath()
    ctx.moveTo(e.x - 6, by + bh); ctx.lineTo(e.x + 6, by + bh); ctx.lineTo(e.x, by + bh + 8); ctx.closePath()
    ctx.fillStyle = 'rgba(255,255,255,.98)'; ctx.fill()
    ctx.fillStyle = '#262630'
    lines.forEach((l, i) => ctx.fillText(l, bx + 9, by + 21 + i * 20))
  }

  _drawCabinetScreens() {
    const { ctx } = this
    for (const c of this.maps.arcade.cabinets) {
      const info = this.cabinetLabels[c.id]
      const [sx, sy, ex, ey] = c.screen
      if (!info) {
        // idle attract mode
        ctx.fillStyle = `hsl(${(this.t / 20 + c.id * 47) % 360},70%,18%)`
        ctx.fillRect(sx, sy, ex - sx, ey - sy)
        ctx.fillStyle = `hsla(${(this.t / 8 + c.id * 90) % 360},90%,60%,.8)`
        const n = 4
        for (let i = 0; i < n; i++) {
          const px = sx + ((this.t / 30 + i * 17 + c.id * 7) % (ex - sx - 6))
          ctx.fillRect(px, sy + 4 + (i * 13) % (ey - sy - 10), 5, 5)
        }
      } else {
        ctx.fillStyle = '#10131f'; ctx.fillRect(sx, sy, ex - sx, ey - sy)
        ctx.fillStyle = info.color || '#ffd24a'
        ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'
        const cx = (sx + ex) / 2
        ctx.fillText(info.emoji || '🎮', cx, sy + (ey - sy) / 2 - 2)
        ctx.font = '9px monospace'
        ctx.fillText((info.title || '').slice(0, 8), cx, ey - 5)
        ctx.textAlign = 'left'
        // blink playing light
        if (info.playing && this.t % 900 < 550) {
          ctx.fillStyle = '#7de0a0'
          ctx.beginPath(); ctx.arc(ex + 6, sy - 4, 3, 0, Math.PI * 2); ctx.fill()
        }
      }
    }
    if (this.marquee) {
      ctx.font = 'bold 17px "Segoe UI", sans-serif'
      const msg = `NOW SHOWING: ${this.marquee.emoji} ${this.marquee.title}`
      const tw = ctx.measureText(msg).width
      const x = this.cv.width - ((this.t / 6) % (this.cv.width + tw))
      ctx.fillStyle = '#ffd24a'
      ctx.fillText(msg, x, 105)
    }
  }

  _drawShelfCartridges() {
    const { ctx } = this
    const sh = this.maps.office.shelf
    const games = this._shelfGames || []
    const [tx, ty] = [sh.tiles[0], sh.tiles[1]]
    games.slice(0, 10).forEach((g, i) => {
      const { x, y: y0, w, h } = this._pakXY(i)
      const fresh = this._newPak(g)
      const y = y0 + (fresh ? -Math.abs(Math.sin(this.t / 190)) * 5 : 0) // 새 팩은 통통 튐
      // 그림자 + 본체 (크게, 또렷하게)
      ctx.fillStyle = 'rgba(16,12,24,.35)'
      ctx.fillRect(x + 2, y0 + 3, w, h)
      if (fresh) {
        ctx.save()
        ctx.shadowColor = '#ffd24a'
        ctx.shadowBlur = 14 + Math.sin(this.t / 140) * 7
      }
      ctx.fillStyle = g.color || '#b78cff'
      ctx.fillRect(x, y, w, h)
      if (fresh) ctx.restore()
      ctx.strokeStyle = fresh ? '#ffd24a' : 'rgba(20,22,40,.85)'; ctx.lineWidth = 2
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
      // 라벨 스티커 + 큰 이모지
      ctx.fillStyle = 'rgba(255,255,255,.92)'
      ctx.fillRect(x + 4, y + 4, w - 8, h - 16)
      ctx.font = '16px monospace'; ctx.textAlign = 'center'
      ctx.fillText((g.emoji || '🎮'), x + w / 2, y + 21)
      ctx.textAlign = 'left'
      // 카트리지 그립 라인
      ctx.fillStyle = 'rgba(20,22,40,.5)'
      ctx.fillRect(x + 6, y + h - 9, w - 12, 2)
      ctx.fillRect(x + 6, y + h - 5, w - 12, 2)
    })
  }

  _drawShelfSign() {
    const { ctx } = this
    const sh = this.maps.office.shelf
    const [tx, ty, tw] = [sh.tiles[0], sh.tiles[1], sh.tiles[2] || 4]
    const games = this._shelfGames || []
    const freshList = games.slice(0, 10).map((g, i) => ({ g, i, n: this._newPak(g) })).filter(e => e.n)
    const hasNew = freshList.length > 0
    const cx = tx * T + (tw * T) / 2
    const pulse = hasNew ? 0.55 + 0.45 * Math.sin(this.t / 130) : 0.62 + 0.38 * Math.sin(this.t / 320)
    ctx.font = 'bold 15px "Segoe UI", sans-serif'
    const label = hasNew ? '✨ NEW 게임팩 입고!' : '🗄️ 게임팩'
    const lw = tw * T - 4
    ctx.fillStyle = '#14162a'
    ctx.beginPath(); ctx.roundRect(cx - lw / 2, ty * T - 26, lw, 22, 6); ctx.fill()
    ctx.strokeStyle = `rgba(255,210,74,${pulse.toFixed(3)})`; ctx.lineWidth = hasNew ? 3 : 2.5; ctx.stroke()
    ctx.fillStyle = hasNew && this.t % 700 < 350 ? '#ffffff' : '#ffd24a'
    ctx.textAlign = 'center'
    ctx.fillText(label, cx, ty * T - 10)
    ctx.textAlign = 'left'
    // 새 게임팩: NEW/UP 배지 + 반짝이 (팩 위에 그려 어디서든 눈에 띄게)
    for (const { i, n } of freshList) {
      const { x, y, w } = this._pakXY(i)
      const bw = n.kind === 'new' ? 34 : 26
      const bx = x + w / 2 - bw / 2, by = y - 13
      ctx.fillStyle = '#ff3d5e'
      ctx.beginPath(); ctx.roundRect(bx, by, bw, 14, 4); ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.font = 'bold 10px "Segoe UI", sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
      ctx.fillText(n.kind === 'new' ? 'NEW!' : 'UP!', x + w / 2, by + 11)
      ctx.textAlign = 'left'
      // 반짝이 3개 궤도
      for (let k = 0; k < 3; k++) {
        const a = this.t / 260 + k * 2.094
        const sx = x + w / 2 + Math.cos(a) * 27
        const sy = y + 18 + Math.sin(a) * 22
        const sp = 2.2 + Math.sin(this.t / 90 + k * 1.7) * 1.4
        ctx.strokeStyle = `rgba(255,225,120,${(0.55 + 0.45 * Math.sin(this.t / 110 + k)).toFixed(3)})`
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(sx - sp, sy); ctx.lineTo(sx + sp, sy)
        ctx.moveTo(sx, sy - sp); ctx.lineTo(sx, sy + sp)
        ctx.stroke()
      }
    }
  }
  setShelfGames(games) {
    const next = games || []
    // 최초 로드가 아니면 새 게임/새 버전을 감지해 45초간 하이라이트
    if (this._shelfGames) {
      const prevIds = new Set(this._shelfGames.map(g => g.id))
      const prevVer = new Map(this._shelfGames.map(g => [g.id, g.version]))
      for (const g of next) {
        if (!prevIds.has(g.id)) this._newPaks.set(g.id, { until: this.t + 45000, kind: 'new' })
        else if (prevVer.get(g.id) !== g.version) this._newPaks.set(g.id, { until: this.t + 45000, kind: 'up' })
      }
    }
    this._shelfGames = next
  }

  _pakXY(i) {
    const sh = this.maps.office.shelf
    const row = Math.floor(i / 5), col = i % 5
    return { x: sh.tiles[0] * T + 6 + col * 37, y: sh.tiles[1] * T + 6 + row * 45, w: 33, h: 38 }
  }

  _newPak(g) {
    const n = this._newPaks.get(g.id)
    if (!n) return null
    if (this.t > n.until) { this._newPaks.delete(g.id); return null }
    return n
  }
}
