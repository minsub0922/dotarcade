import test from 'node:test'
import assert from 'node:assert/strict'
import { Engine } from './world.js'

const openGrid = (width = 32, height = 22) => Array.from({ length: height }, () => '.'.repeat(width))

function createEngine() {
  const events = []
  const canvas = {
    width: 1440,
    height: 960,
    getContext: () => ({ imageSmoothingEnabled: false })
  }
  const common = {
    spawn: [12, 10],
    collision: openGrid(),
    door: { approach: [], tiles: [] }
  }
  const engine = new Engine(canvas, {
    maps: {
      office: { ...common, meeting: null, shelf: null, wander: [1, 1, 30, 20] },
      arcade: { ...common, cabinets: [] }
    },
    onInteract: event => events.push(event)
  })
  engine.camera.x = engine.player.x
  engine.camera.y = engine.player.y
  return { engine, events }
}

function placeNearPlayer(engine, id, dx = 20, dy = 0) {
  const object = engine.worldObject(id)
  object.x = engine.player.x + dx
  object.y = engine.player.y + dy
  object.z = 0
  object.vx = 0
  object.vy = 0
  return object
}

function screenPoint(engine, worldX, worldY) {
  const scale = engine._renderScale()
  return {
    x: (worldX - engine.camera.x) * scale + engine.cv.width / 2,
    y: (worldY - engine.camera.y) * scale + engine.cv.height / 2
  }
}

for (const [id, kind] of [['office-book-a', 'book'], ['office-trash', 'trashbin']]) {
  test(`${kind} pointer interaction keeps ground taps for movement and explicit actions throw`, () => {
    const { engine, events } = createEngine()
    const object = placeNearPlayer(engine, id)
    const objectPoint = screenPoint(engine, object.x, object.y)

    assert.equal(engine.interactAtPoint(objectPoint.x, objectPoint.y), true)
    assert.equal(engine.heldObjectId, id)
    assert.equal(object.held, true)
    assert.deepEqual(events.map(event => event.type), ['pickup'])

    const destination = screenPoint(engine, engine.player.x + 150, engine.player.y)
    assert.equal(engine.interactAtPoint(destination.x, destination.y), false, 'ordinary tap remains available for movement')
    assert.equal(engine.heldObjectId, id, 'ordinary tap must not drop or throw the held prop')
    assert.equal(object.held, true)
    assert.deepEqual(events.map(event => event.type), ['pickup'])

    assert.equal(engine.interactAtPoint(destination.x, destination.y, { heldAction: 'throw' }), true)
    assert.equal(engine.heldObjectId, null)
    assert.equal(object.held, false)
    assert.ok(object.vx > 0)
    assert.deepEqual(events.map(event => event.type), ['pickup', 'throw'])
  })
}

test('tapping an avatar while carrying does not auto-aim or consume the held prop', () => {
  const { engine, events } = createEngine()
  const book = placeNearPlayer(engine, 'office-book-a')
  const teammate = engine.addAgent('designer', 'designer', [15, 11], { map: 'office', autonomy: false })
  teammate.x = engine.player.x + 112
  teammate.y = engine.player.y + 36

  assert.equal(engine.pickupObject(book.id), true)
  const ground = screenPoint(engine, engine.player.x + 150, engine.player.y - 120)
  assert.equal(engine.interactAtPoint(ground.x, ground.y), false)
  assert.equal(engine.heldObjectId, book.id)

  const avatarBody = screenPoint(engine, teammate.x, teammate.y - 38)
  assert.equal(engine.interactAtPoint(avatarBody.x, avatarBody.y), false)
  assert.equal(engine.heldObjectId, book.id)
  assert.equal(book.held, true)
  assert.deepEqual(events.map(event => event.type), ['pickup'])
})

test('a guide target follows its agent and survives unrelated proximity and held-prop hints', () => {
  const { engine } = createEngine()
  const teammate = engine.addAgent('designer', 'designer', [15, 10], { map: 'office', autonomy: false })
  teammate.x = engine.player.x + 110
  teammate.y = engine.player.y + 20

  assert.deepEqual(engine.setGuideTarget(teammate.id), { type: 'agent', id: teammate.id })
  assert.equal(engine.interactionTarget, null, 'setting guidance must not manufacture an E interaction')

  teammate.x += 35
  const movedTarget = engine._resolveGuideTarget()
  assert.equal(movedTarget.x, teammate.x, 'the guide resolves the live agent position instead of a stale coordinate')
  assert.equal(movedTarget.y, teammate.y)

  const book = placeNearPlayer(engine, 'office-book-a')
  assert.equal(engine.pickupObject(book.id), true)
  engine._computeHint()
  assert.equal(engine.interactionTarget?.type, 'heldProp')
  assert.deepEqual(engine.guideTarget, { type: 'agent', id: teammate.id })
  assert.equal(engine._resolveGuideTarget()?.id, teammate.id)

  const ellipses = []
  const strokes = []
  engine.ctx = {
    save() {}, restore() {}, beginPath() {}, fill() {},
    ellipse(...args) { ellipses.push(args) },
    stroke() { strokes.push(this.strokeStyle) },
    fillStyle: '', strokeStyle: '', lineWidth: 0
  }
  engine.reduceMotion = true
  engine._drawGuideTargetHalo()

  assert.equal(ellipses.length, 2, 'the persistent guide uses a two-ring floor marker')
  assert.equal(ellipses[0][0], teammate.x)
  assert.equal(ellipses[0][1], teammate.y + 1)
  assert.deepEqual(strokes, ['rgba(171,143,255,.98)', 'rgba(255,215,91,.96)'])
})

test('guide targets clear on invalidation, agent reset and map changes', () => {
  const { engine } = createEngine()
  engine.addAgent('dev1', 'dev1', [13, 10], { map: 'office', autonomy: false })

  engine.setGuideTarget('dev1')
  assert.ok(engine.guideTarget)
  assert.equal(engine.setGuideTarget({ type: 'agent', id: 'missing' }), null)
  assert.equal(engine.guideTarget, null)

  engine.setGuideTarget('dev1')
  engine.setMap('arcade', [12, 10])
  assert.equal(engine.guideTarget, null, 'map transitions reset task guidance')

  engine.setMap('office', [12, 10])
  engine.setGuideTarget('dev1')
  engine.clearAgents()
  assert.equal(engine.guideTarget, null, 'clearing the agent collection also resets guidance')
})

test('a fast prop hits the first avatar crossed between frames and ignores avatars off its path', () => {
  const { engine, events } = createEngine()
  engine.t = 1000
  engine.npcReactions.random = () => .5
  const book = placeNearPlayer(engine, 'office-book-a')
  const first = engine.addAgent('dev1', 'dev1', [13, 10], { map: 'office', autonomy: false })
  const second = engine.addAgent('designer', 'designer', [14, 10], { map: 'office', autonomy: false })
  const offPath = engine.addAgent('writer', 'writer', [13, 11], { map: 'office', autonomy: false })
  first.x = engine.player.x + 60; first.y = engine.player.y
  second.x = engine.player.x + 92; second.y = engine.player.y
  offPath.x = engine.player.x + 45; offPath.y = engine.player.y + 32
  engine.player.dir = 'right'

  assert.equal(engine.pickupObject(book.id), true)
  assert.equal(engine.throwHeld(), true)
  book.vx = 120
  book.vy = 0
  book.vz = 0
  book.z = 48
  engine.t += 16.67
  engine.update(16.67)

  const hit = events.find(event => event.type === 'propHit')
  assert.equal(hit?.agent.id, first.id)
  assert.ok(first.meta.reactionKind)
  assert.equal(second.meta.reactionKind, undefined)
  assert.equal(offPath.meta.reactionKind, undefined)
  assert.ok(book.x < first.x, 'the prop is rewound to first contact before bouncing')
  assert.ok(book.vx < 0)
})

for (const [id, kind] of [['office-book-a', 'book'], ['office-trash', 'trashbin']]) {
  test(`${kind} real throw arc hits and reacts at normal play distance`, () => {
    const { engine, events } = createEngine()
    engine.t = 1000
    engine.npcReactions.random = () => .5
    const object = placeNearPlayer(engine, id)
    const teammate = engine.addAgent('dev1', 'dev1', [15, 10], { map: 'office', autonomy: false })
    teammate.x = engine.player.x + 120
    teammate.y = engine.player.y
    engine.player.dir = 'right'

    assert.equal(engine.pickupObject(object.id), true)
    assert.equal(engine.throwHeld(), true)
    for (let frame = 0; frame < 45 && !events.some(event => event.type === 'propHit'); frame++) {
      engine.t += 16.67
      engine.update(16.67)
    }

    const reactions = events.filter(event => event.type === 'npcReaction')
    const hits = events.filter(event => event.type === 'propHit')
    assert.equal(reactions.length, 1)
    assert.equal(hits.length, 1)
    assert.equal(hits[0].agent.id, teammate.id)
    assert.ok(teammate.meta.reactionKind)
    assert.ok(object.vx < 0, 'the prop bounces away from the avatar after contact')
    assert.equal(engine.getReactionEvidence().at(-1).source.id, object.id)
    assert.equal(engine.getReactionEvidence().at(-1).agent.id, teammate.id)
  })
}

test('held prop persists while moving and cannot be silently replaced by another prop or vehicle', () => {
  const { engine } = createEngine()
  const book = placeNearPlayer(engine, 'office-book-a')
  const otherBook = placeNearPlayer(engine, 'office-book-b', 22, 2)
  const bicycle = placeNearPlayer(engine, 'office-bike', 24, 0)

  assert.equal(engine.pickupObject(book.id), true)
  assert.equal(engine.pickupObject(otherBook.id), false)
  assert.equal(engine.mountVehicle(bicycle.id), false)
  assert.equal(engine.heldObjectId, book.id)

  engine.player.dir = 'right'
  engine.player.x += 31
  engine.player.y += 7
  engine._updateWorldObjects(16.67)
  assert.equal(engine.heldObjectId, book.id)
  assert.equal(book.x, engine.player.x + 7)
  assert.equal(book.y, engine.player.y)

  const state = engine.getWorldInteractionState()
  assert.equal(state.held.id, book.id)
  assert.deepEqual(state.held.actions, {
    throw: { id: 'throw', key: 'F', enabled: true },
    drop: { id: 'drop', key: 'E', enabled: true }
  })
  engine._computeHint()
  assert.equal(engine.currentHint.type, 'heldProp')
  assert.equal(engine.currentHint.objectLabel, '게임 디자인 책')
  assert.match(engine.currentHint.label, /들고 있음.*F 던지기.*E 내려놓기/)
  assert.equal(engine.performWorldAction('throw'), true)
  assert.equal(engine.heldObjectId, null)
})

test('vehicles are at least twice walking speed and retain single-hit collision gating', () => {
  const { engine, events } = createEngine()
  const walkSpeed = engine.player.speed
  const scooter = placeNearPlayer(engine, 'office-scooter')

  assert.ok(scooter.speed >= walkSpeed * 2)
  assert.equal(engine.mountVehicle(scooter.id), true)
  assert.equal(engine.player.speed, scooter.speed)
  assert.equal(engine.dismountVehicle({ silent: true }), true)

  const bicycle = placeNearPlayer(engine, 'office-bike')
  assert.ok(bicycle.speed > scooter.speed)
  assert.ok(bicycle.speed * 3 < 35, '50ms capped frame displacement must remain inside the vehicle hit radius')
  assert.equal(engine.mountVehicle(bicycle.id), true)

  const teammate = engine.addAgent('pm', 'pm', [13, 10], { map: 'office', autonomy: false })
  teammate.x = engine.player.x + 20
  teammate.y = engine.player.y
  engine.player.dir = 'right'
  engine.player.moving = true
  engine.t = 1000

  engine._updateWorldObjects(16.67)
  engine._updateWorldObjects(16.67)
  assert.equal(events.filter(event => event.type === 'vehicleHit').length, 1)
})

test('nearby teammate keeps E talk while the vehicle exposes an independent R action', () => {
  const { engine } = createEngine()
  for (const object of engine.worldObjects) object.z = 9
  const bicycle = placeNearPlayer(engine, 'office-bike', 24, 0)
  const teammate = engine.addAgent('designer', 'designer', [12, 10], { map: 'office', autonomy: false })
  teammate.x = engine.player.x + 18
  teammate.y = engine.player.y
  teammate.meta.shortName = '유나'

  engine._computeHint()

  assert.equal(engine.currentHint.type, 'agent')
  assert.equal(engine.currentHint.id, teammate.id)
  assert.equal(engine.currentHint.key, undefined, 'talk retains the default E key')
  assert.deepEqual(engine.currentHint.rideAction, {
    type: 'vehicle', id: bicycle.id, key: 'R', label: '블루 자전거 타기', detail: '이동 속도 UP'
  })
  assert.equal(engine.interactionTarget.type, 'agent', 'the world-space E badge stays attached only to the teammate')
  assert.equal(engine.interactWorld(engine.currentHint), false, 'E interaction must not accidentally mount the nearby vehicle')
  assert.equal(engine.mountedVehicleId, null)

  assert.equal(engine.performWorldAction('ride'), true)
  assert.equal(engine.mountedVehicleId, bicycle.id)
  engine._computeHint()
  assert.equal(engine.currentHint.type, 'agent', 'talk remains the primary E action even while mounted beside a teammate')
  assert.equal(engine.currentHint.rideAction.type, 'vehicleMounted')
  assert.equal(engine.currentHint.rideAction.key, 'R')
})

test('mounted controls ease into speed and keep a travelled-distance ride cycle', () => {
  const { engine } = createEngine()
  const bicycle = placeNearPlayer(engine, 'office-bike')
  const startX = engine.player.x

  assert.equal(engine.mountVehicle(bicycle.id), true)
  assert.equal(engine.player.dir, bicycle.dir, 'the first seated pose preserves the parked bicycle direction')
  engine.keys.add('KeyD')
  engine.update(16.67)

  const firstStep = engine.player.x - startX
  assert.ok(firstStep > 0)
  assert.ok(firstStep < bicycle.speed * .5, 'mounting must not jump straight to maximum speed')
  assert.ok(engine.player.meta.rideState.distance >= firstStep)

  for (let i = 0; i < 24; i++) engine.update(16.67)
  assert.ok(engine.player.meta.rideState.vx > bicycle.speed * .8, 'vehicle reaches cruising speed progressively')
  const distanceAtRelease = engine.player.meta.rideState.distance
  engine.keys.clear()
  engine.update(16.67)
  assert.ok(engine.player.meta.rideState.distance > distanceAtRelease, 'release eases out instead of freezing in one frame')
})

test('foot collision matches the current A* cell instead of sampling the row below', () => {
  const { engine } = createEngine()
  const rows = openGrid()
  rows[11] = '#'.repeat(32)
  engine.maps.office.collision = rows

  assert.equal(Math.floor(engine.player.y / 48), 10)
  assert.equal(engine._walkable(engine.player.x, engine.player.y), true)
})

test('enlarged vehicles reserve their wheel envelope near furniture', () => {
  const { engine } = createEngine()
  const rows = openGrid().map(row => [...row])
  rows[10][13] = '#'
  engine.maps.office.collision = rows.map(row => row.join(''))

  assert.equal(engine._walkable(engine.player.x, engine.player.y), true, 'standing avatar still fits the current tile')
  assert.equal(
    engine._vehicleWalkable(engine.player.x, engine.player.y, 'bicycle', 'right'),
    false,
    'bicycle wheel envelope must not overlap the blocked furniture tile'
  )
})

test('dynamic shelf cartridges redraw inside the shelf depth layer', () => {
  const { engine } = createEngine()
  const calls = []
  engine.ctx = { drawImage: () => calls.push('foreground') }
  engine._drawShelfCartridges = () => calls.push('cartridges')

  engine._drawFurnitureOccluder(
    { id: 'game-shelf-front', source: [10, 20, 30, 40], baseline: 60 },
    { width: 1440, height: 960 }
  )
  assert.deepEqual(calls, ['foreground', 'cartridges'])
})

test('dismount eases the parked vehicle away instead of teleporting it', () => {
  const { engine } = createEngine()
  const bicycle = placeNearPlayer(engine, 'office-bike')
  assert.equal(engine.mountVehicle(bicycle.id), true)
  const start = { x: engine.player.x, y: engine.player.y }

  assert.equal(engine.dismountVehicle(), true)
  assert.deepEqual({ x: bicycle.x, y: bicycle.y }, start)
  assert.ok(bicycle.parkMotion)
  const target = { x: bicycle.parkMotion.toX, y: bicycle.parkMotion.toY }

  engine.t += bicycle.parkMotion.duration
  engine._updateWorldObjects(16.67)
  assert.equal(bicycle.parkMotion, undefined)
  assert.deepEqual({ x: bicycle.x, y: bicycle.y }, target)
})
