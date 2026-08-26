import test from 'node:test'
import assert from 'node:assert/strict'
import { NpcReactionSystem } from './npcReactions.js'

function npc(id, x, y, map = 'office') {
  return {
    id, x, y, map, visible: true, label: id, dir: 'down', speed: 3,
    path: [[9, 9]], cb: () => {}, sitting: true, moving: false, idleT: 0, meta: {}
  }
}

function canvasSpy() {
  const calls = []
  const ctx = { calls }
  for (const name of ['save', 'restore', 'beginPath', 'arc', 'ellipse', 'fill', 'stroke', 'fillText', 'moveTo', 'lineTo', 'clip', 'drawImage', 'fillRect', 'translate', 'quadraticCurveTo']) {
    ctx[name] = (...args) => calls.push([name, ...args])
  }
  return ctx
}

const NEUTRAL_VISUAL = {
  x: 0, y: 0, rotation: 0,
  scaleX: 1, scaleY: 1,
  flash: 0, actionLines: 0,
  phase: 'none', emotion: null, intensity: 0
}

test('vehicle hit interrupts one NPC, records evidence and suppresses contact spam', () => {
  const reactions = new NpcReactionSystem({ random: () => .5 })
  const pm = npc('pm', 128, 100)
  pm.meta.shortName = '박서준'
  const other = npc('dev1', 131, 113)
  const agents = new Map([[pm.id, pm], [other.id, other]])
  const player = { id: 'player', x: 100, y: 100, dir: 'right', moving: true }
  const vehicle = { id: 'office-bike', kind: 'bicycle', label: '블루 자전거', speed: 7.8 }
  const bubbles = []
  const events = []

  const hit = reactions.tryVehicleHit({
    now: 100, vehicle, player, agents, map: 'office',
    isWalkable: () => true,
    bubble: (...args) => bubbles.push(args),
    onInteract: event => events.push(event)
  })

  assert.equal(hit.agent.id, 'pm')
  assert.equal(hit.kind, 'knockback')
  assert.equal(pm.path.length, 0)
  assert.equal(pm.cb, null)
  assert.equal(pm.sitting, false)
  assert.ok(pm.meta.reactionLockUntil > 100)
  assert.equal(pm.meta.reactionPhase, 'anticipation')
  assert.equal(pm.meta.reactionEmotion, 'angry')
  assert.equal(events[0].type, 'npcReaction')
  assert.equal(events[0].agent.role, 'PM')
  assert.equal(events[0].emotion, 'angry')
  assert.deepEqual(events[0].visual.phases, ['anticipation', 'impact', 'recover'])
  assert.equal(events[0].evidence.followUpAction, 'set-safety-boundary')
  assert.equal(events[0].evidence.plannerInterrupted, true)
  assert.match(bubbles[0][1], /안전|서행|속도/)

  assert.equal(reactions.tryVehicleHit({
    now: 200, vehicle, player, agents, map: 'office', isWalkable: () => true
  }), null, 'global vehicle gate prevents multi-hit on consecutive frames')
  assert.equal(reactions.getEvidence().length, 1)
})

test('reaction applies bounded knockback, faces player, then talks and expires', () => {
  const reactions = new NpcReactionSystem({ random: () => .5 })
  const teammate = npc('designer', 128, 100)
  teammate.meta.shortName = '김다은'
  const agents = new Map([[teammate.id, teammate]])
  const player = { id: 'player', x: 100, y: 100, dir: 'right', moving: true }
  const vehicle = { id: 'office-scooter', kind: 'scooter', label: '킥보드', speed: 6.8 }
  const events = []
  const bubbles = []

  reactions.tryVehicleHit({
    now: 0, vehicle, player, agents, map: 'office', isWalkable: () => true,
    bubble: (...args) => bubbles.push(args), onInteract: event => events.push(event)
  })
  assert.equal(teammate.meta.reactionEmotion, 'hurt')
  const anticipation = reactions.visualOffset(teammate, 35)
  assert.equal(anticipation.phase, 'anticipation')
  assert.ok(anticipation.scaleX > 1)
  assert.ok(anticipation.scaleY < 1)
  assert.equal(anticipation.flash, 0)

  const impact = reactions.visualOffset(teammate, 100)
  assert.equal(impact.phase, 'impact')
  assert.ok(impact.flash > .5)
  assert.ok(impact.actionLines > .5)
  assert.notEqual(impact.rotation, 0)

  const reduced = reactions.visualOffset(teammate, 100, true)
  assert.deepEqual(
    { x: reduced.x, y: reduced.y, rotation: reduced.rotation, scaleX: reduced.scaleX, scaleY: reduced.scaleY, actionLines: reduced.actionLines },
    { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, actionLines: 0 }
  )
  assert.equal(reduced.phase, 'impact')
  assert.equal(reduced.emotion, 'hurt')
  assert.ok(reduced.flash > 0)

  const before = teammate.x
  reactions.update({
    now: 100, dt: 16.67, agents, map: 'office', player,
    isWalkable: () => true, bubble: (...args) => bubbles.push(args),
    onInteract: event => events.push(event)
  })
  assert.ok(teammate.x > before)
  assert.ok(reactions.isLocked(teammate, 100))

  reactions.update({
    now: 1100, dt: 16.67, agents, map: 'office', player,
    isWalkable: () => true, bubble: (...args) => bubbles.push(args),
    onInteract: event => events.push(event)
  })
  assert.equal(teammate.dir, 'left')
  assert.equal(teammate.meta.reactionLockUntil, 0)

  reactions.update({
    now: 1900, dt: 16.67, agents, map: 'office', player,
    isWalkable: () => true, bubble: (...args) => bubbles.push(args),
    onInteract: event => events.push(event)
  })
  assert.equal(events.at(-1).type, 'npcReactionFollowUp')
  assert.equal(events.at(-1).action, 'critique-telegraph')
  assert.equal(events.at(-1).gesture, 'hands-up')
  assert.equal(events.at(-1).emotion, 'angry')
  assert.equal(teammate.meta.reactionFollowUp, 'critique-telegraph')
  assert.ok(bubbles.length >= 2)

  reactions.update({
    now: 3000, dt: 16.67, agents, map: 'office', player, isWalkable: () => true
  })
  assert.equal(teammate.meta.reactionKind, undefined)
  assert.equal(teammate.meta.reactionEmotion, undefined)
  assert.deepEqual(reactions.visualOffset(teammate, 3000), NEUTRAL_VISUAL)
})

test('prop hit reacts once per target and update cannot create a reaction loop', () => {
  const reactions = new NpcReactionSystem({ random: () => .9 })
  const visitor = npc('v07', 111, 100, 'arcade')
  const officeNpc = npc('pm', 103, 100, 'office')
  const agents = new Map([[visitor.id, visitor], [officeNpc.id, officeNpc]])
  const prop = {
    id: 'arcade-book', kind: 'book', label: '공략 노트',
    x: 100, y: 100, z: 20, vx: 5, vy: 0
  }
  const player = { id: 'player', x: 50, y: 100, dir: 'right', moving: false }
  const events = []

  const hit = reactions.tryPropHit({
    now: 500, prop, player, agents, map: 'arcade',
    isWalkable: () => true, onInteract: event => events.push(event)
  })
  assert.equal(hit.agent.id, 'v07')
  assert.equal(hit.kind, 'stun')
  assert.equal(hit.emotion, 'dizzy')
  assert.equal(visitor.meta.reactionEmotion, 'dizzy')
  assert.equal(hit.restitution, .48)
  assert.equal(officeNpc.meta.reactionKind, undefined)

  assert.equal(reactions.tryPropHit({
    now: 900, prop, player, agents, map: 'arcade', isWalkable: () => true
  }), null)

  for (let i = 0; i < 120; i++) {
    reactions.update({
      now: 520 + i * 16.67, dt: 16.67, agents, map: 'arcade', player,
      isWalkable: () => true, onInteract: event => events.push(event)
    })
  }
  assert.equal(events.filter(event => event.type === 'npcReaction').length, 1)
  assert.equal(reactions.getEvidence().length, 1)
})

test('three-stage visual contract draws impact flash and directional action lines', () => {
  const reactions = new NpcReactionSystem({ random: () => .5 })
  const teammate = npc('dev1', 112, 100)
  const agents = new Map([[teammate.id, teammate]])
  reactions.tryPropHit({
    now: 0,
    prop: { id: 'book-a', kind: 'book', label: '책', x: 100, y: 100, z: 12, vx: 7, vy: 0 },
    player: { x: 60, y: 100 }, agents, map: 'office', isWalkable: () => true
  })

  assert.equal(reactions.visualOffset(teammate, 30).phase, 'anticipation')
  assert.equal(reactions.visualOffset(teammate, 120).phase, 'impact')
  const recover = reactions.visualOffset(teammate, 500)
  assert.equal(recover.phase, 'recover')
  assert.equal(recover.flash, 0)
  assert.equal(recover.actionLines, 0)

  const ctx = canvasSpy()
  reactions.draw(ctx, teammate, 120, { spriteHeight: 70 })
  assert.ok(ctx.calls.some(([name]) => name === 'lineTo'), 'impact draws action lines')
  assert.ok(ctx.calls.some(([name]) => name === 'ellipse'), 'impact draws sprite flash')
  assert.ok(ctx.calls.some(([name]) => name === 'fillText'), 'emotion emote remains visible')
})

test('impact badge preserves the hit avatar portrait and overlays its reaction face', () => {
  const reactions = new NpcReactionSystem({ random: () => .95 })
  const teammate = npc('dev1', 112, 100)
  const agents = new Map([[teammate.id, teammate]])
  reactions.tryPropHit({
    now: 0,
    prop: { id: 'trash-face', kind: 'trashbin', label: '통', x: 100, y: 100, z: 12, vx: 7, vy: 0 },
    player: { x: 60, y: 100 }, agents, map: 'office', isWalkable: () => true
  })
  const ctx = canvasSpy()
  const faceImage = { complete: true, naturalWidth: 96 }
  reactions.draw(ctx, teammate, 140, { spriteHeight: 70, faceImage })
  assert.ok(ctx.calls.some(([name]) => name === 'drawImage'), 'avatar face portrait is drawn')
  assert.ok(ctx.calls.some(([name]) => name === 'quadraticCurveTo'), 'reaction expression is overlaid')
  assert.ok(ctx.calls.some(([name]) => name === 'fillText'), 'semantic emotion icon remains visible')
})

test('agent-wide cooldown rejects alternating prop ids after visual recovery', () => {
  const reactions = new NpcReactionSystem({ random: () => .5 })
  const visitor = npc('v03', 110, 100, 'arcade')
  const agents = new Map([[visitor.id, visitor]])
  const player = { x: 60, y: 100 }
  const prop = id => ({ id, kind: 'book', label: '책', x: 100, y: 100, z: 12, vx: 7, vy: 0 })

  assert.ok(reactions.tryPropHit({
    now: 0, prop: prop('book-a'), player, agents, map: 'arcade', isWalkable: () => true
  }))
  reactions.update({ now: 1500, dt: 16.67, agents, map: 'arcade', player, isWalkable: () => true })
  assert.equal(visitor.meta.reactionKind, undefined, 'visual state has recovered')
  assert.equal(reactions.tryPropHit({
    now: 1700, prop: prop('book-b'), player, agents, map: 'arcade', isWalkable: () => true
  }), null, 'new source id cannot bypass per-agent anti-spam cooldown')
  assert.equal(reactions.getEvidence().length, 1)
  assert.ok(reactions.tryPropHit({
    now: 2500, prop: prop('book-b'), player, agents, map: 'arcade', isWalkable: () => true
  }), 'NPC can react again after bounded cooldown')
})

test('dodge uses surprised emotion while stun uses dizzy emotion', () => {
  const dodgeSystem = new NpcReactionSystem({ random: () => .1 })
  const dodgeNpc = npc('v01', 110, 100, 'arcade')
  const dodge = dodgeSystem.tryPropHit({
    now: 0,
    prop: { id: 'book', kind: 'book', x: 100, y: 100, z: 10, vx: 6, vy: 0 },
    player: { x: 50, y: 100 }, agents: new Map([[dodgeNpc.id, dodgeNpc]]),
    map: 'arcade', isWalkable: () => true
  })
  assert.equal(dodge.kind, 'dodge')
  assert.equal(dodge.emotion, 'surprised')

  const stunSystem = new NpcReactionSystem({ random: () => .95 })
  const stunNpc = npc('v02', 110, 100, 'arcade')
  const stun = stunSystem.tryPropHit({
    now: 0,
    prop: { id: 'trash', kind: 'trashbin', x: 100, y: 100, z: 10, vx: 6, vy: 0 },
    player: { x: 50, y: 100 }, agents: new Map([[stunNpc.id, stunNpc]]),
    map: 'arcade', isWalkable: () => true
  })
  assert.equal(stun.kind, 'stun')
  assert.equal(stun.emotion, 'dizzy')
})

test('every office role plans and emits its own follow-up action', () => {
  const expected = {
    pm: 'set-safety-boundary',
    dev1: 'inspect-hitbox',
    dev2: 'pitch-counterplay',
    designer: 'critique-telegraph',
    writer: 'note-the-incident'
  }
  for (const [id, action] of Object.entries(expected)) {
    const reactions = new NpcReactionSystem({ random: () => .5 })
    const teammate = npc(id, 128, 100)
    const agents = new Map([[id, teammate]])
    const player = { x: 100, y: 100, dir: 'right', moving: true }
    const events = []
    const hit = reactions.tryVehicleHit({
      now: 0,
      vehicle: { id: `bike-${id}`, kind: 'bicycle', speed: 7 },
      player, agents, map: 'office', isWalkable: () => true,
      onInteract: event => events.push(event)
    })
    assert.equal(hit.evidence.evidence.followUpAction, action, `${id} plans ${action}`)
    reactions.update({
      now: 1900, dt: 16.67, agents, map: 'office', player,
      isWalkable: () => true, onInteract: event => events.push(event)
    })
    const follow = events.find(event => event.type === 'npcReactionFollowUp')
    assert.equal(follow.action, action, `${id} emits ${action}`)
    assert.ok(follow.gesture)
    assert.ok(['hurt', 'angry', 'surprised'].includes(follow.emotion))
  }
})

test('reset clears transient locks without deleting evidence', () => {
  const reactions = new NpcReactionSystem({ random: () => .2 })
  const visitor = npc('v02', 112, 100, 'arcade')
  const agents = new Map([[visitor.id, visitor]])
  reactions.tryPropHit({
    now: 20,
    prop: { id: 'book', kind: 'book', label: '책', x: 100, y: 100, z: 10, vx: 8, vy: 0 },
    player: { x: 60, y: 100 }, agents, map: 'arcade', isWalkable: () => true
  })
  assert.ok(visitor.meta.reactionLockUntil)
  reactions.reset(agents)
  assert.equal(visitor.meta.reactionLockUntil, undefined)
  assert.equal(reactions.isLocked(visitor, 30), false)
  assert.equal(reactions.getEvidence().length, 1)
})
