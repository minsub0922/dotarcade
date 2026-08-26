import test from 'node:test'
import assert from 'node:assert/strict'
import { Engine } from './world.js'
import { SEAT_PHASES } from './seatMotion.js'

const openGrid = (width = 30, height = 20) => Array.from({ length: height }, () => '.'.repeat(width))
const OFFICE_SEATS = {
  player: { desk: [25, 5], face: 'up' },
  pm: { desk: [15, 6], face: 'up' },
  dev1: { desk: [20, 6], face: 'up' },
  dev2: { desk: [20, 11], face: 'up' },
  designer: { desk: [15, 11], face: 'up' },
  writer: { desk: [25, 10], face: 'up' }
}

function createEngine() {
  const context = { imageSmoothingEnabled: false, drawImage() {} }
  const canvas = { width: 1440, height: 960, getContext: () => context }
  const collision = openGrid()
  const engine = new Engine(canvas, {
    maps: {
      office: {
        spawn: [12, 10], collision, seats: structuredClone(OFFICE_SEATS),
        meeting: { seats: [[4, 4], [6, 4], [8, 4], [4, 7], [6, 7], [8, 7]], faces: ['down', 'down', 'down', 'up', 'up', 'up'], head: [2, 7], headFace: 'right', zone: [2, 3, 8, 6] },
        shelf: null, door: { approach: [], tiles: [] }, wander: [1, 1, 28, 18], layout: { occluders: [] }
      },
      arcade: { spawn: [2, 9], collision, cabinets: [], door: { approach: [], tiles: [] }, layout: { occluders: [] } }
    }
  })
  return { engine, context }
}

function advance(engine, frames, deltaMs = 20) {
  for (let frame = 0; frame < frames; frame += 1) {
    engine.t += deltaMs
    engine.update(deltaMs)
  }
}

function atDesk(entity, desk, dx = 0, dy = 0) {
  entity.x = desk[0] * 48 + 24 + dx
  entity.y = desk[1] * 48 + 40 + dy
  entity.path = []
  entity.moving = false
}

test('QA state exposes the six canonical desk anchors and only player/team actors', () => {
  const { engine } = createEngine()
  engine.addAgent('pm', 'pm', OFFICE_SEATS.pm.desk, { map: 'office', home: OFFICE_SEATS.pm, autonomy: false })
  engine.addAgent('v01', 'v01', [10, 10], { map: 'office', autonomy: false })

  const state = engine.getChairSeatingState()
  assert.equal(state.enabled, true)
  assert.deepEqual(
    state.chairs.map(({ id, ownerId, tile, anchor }) => ({ id, ownerId, tile, anchor })),
    [
      { id: 'desk-player', ownerId: 'player', tile: [25, 5], anchor: { x: 1224, y: 280 } },
      { id: 'desk-pm', ownerId: 'pm', tile: [15, 6], anchor: { x: 744, y: 328 } },
      { id: 'desk-dev1', ownerId: 'dev1', tile: [20, 6], anchor: { x: 984, y: 328 } },
      { id: 'desk-dev2', ownerId: 'dev2', tile: [20, 11], anchor: { x: 984, y: 568 } },
      { id: 'desk-designer', ownerId: 'designer', tile: [15, 11], anchor: { x: 744, y: 568 } },
      { id: 'desk-writer', ownerId: 'writer', tile: [25, 10], anchor: { x: 1224, y: 520 } }
    ]
  )
  assert.deepEqual(state.actors.map(actor => actor.id), ['player', 'pm'])
  assert.equal(state.actors.some(actor => actor.id === 'v01'), false)
  assert.doesNotThrow(() => JSON.stringify(state))
})

test('idle-near capture waits briefly, eases into the chair and input safely stands', () => {
  const { engine } = createEngine()
  atDesk(engine.player, OFFICE_SEATS.player.desk, 18, 0)

  advance(engine, 4, 20)
  assert.equal(engine.player.seatMotion.phase, SEAT_PHASES.STANDING, '80ms pass-by dwell must not capture')
  advance(engine, 1, 20)
  assert.equal(engine.player.seatMotion.phase, SEAT_PHASES.ENTERING)
  assert.equal(engine.player.sitting, false, 'entry starts from the standing silhouette')
  advance(engine, 15, 20)
  assert.equal(engine.player.seatMotion.phase, SEAT_PHASES.SEATED)
  assert.equal(engine.player.sitting, true)
  assert.deepEqual([engine.player.x, engine.player.y, engine.player.dir], [1224, 280, 'up'])
  assert.equal(engine.player.meta.seat.source, 'proximity')

  engine.keys.add('KeyD')
  const beforeX = engine.player.x
  advance(engine, 1, 20)
  assert.equal(engine.player.sitting, false)
  assert.equal(engine.player.seatMotion.phase, SEAT_PHASES.EXITING)
  assert.equal(engine.player.meta.seat, undefined)
  assert.ok(engine.player.x > beforeX, 'standing does not swallow the movement input')
  advance(engine, 14, 20)
  assert.equal(engine.player.seatMotion.phase, SEAT_PHASES.STANDING)
})

test('owner priority and occupancy prevent two actors claiming one desk', () => {
  const { engine } = createEngine()
  const pm = engine.addAgent('pm', 'pm', OFFICE_SEATS.pm.desk, { map: 'office', home: OFFICE_SEATS.pm, autonomy: false })
  atDesk(pm, OFFICE_SEATS.pm.desk, 8, 0)
  atDesk(engine.player, OFFICE_SEATS.pm.desk, -8, 0)

  advance(engine, 22, 20)
  assert.equal(pm.meta.seat?.id, 'desk-pm')
  assert.equal(pm.sitting, true)
  assert.equal(engine.player.sitting, false)
  assert.equal(engine.getChairSeatingState().chairs.find(chair => chair.id === 'desk-pm').occupiedBy, 'pm')
})

test('held, mounted, social and reaction states block capture while handheld play remains allowed', () => {
  const { engine } = createEngine()
  atDesk(engine.player, OFFICE_SEATS.player.desk)
  engine.heldObjectId = 'office-book-a'
  advance(engine, 24, 20)
  assert.equal(engine.player.sitting, false)
  engine.heldObjectId = null
  engine.mountedVehicleId = 'office-bike'
  advance(engine, 24, 20)
  assert.equal(engine.player.sitting, false)
  engine.mountedVehicleId = null
  engine.player.meta.chatting = true
  advance(engine, 24, 20)
  assert.equal(engine.player.sitting, false)
  delete engine.player.meta.chatting
  engine.player.meta.handheld = { active: true }
  advance(engine, 24, 20)
  assert.equal(engine.player.sitting, true, 'portable play is compatible with a desk chair')
  engine.player.meta.chatting = true
  advance(engine, 1, 20)
  assert.equal(engine.player.sitting, false, 'a chat started outside the engine still releases the chair')
  assert.equal(engine.player.meta.seat, undefined)
  delete engine.player.meta.chatting

  const pm = engine.addAgent('pm', 'pm', OFFICE_SEATS.pm.desk, { map: 'office', home: OFFICE_SEATS.pm, autonomy: false })
  engine.sit('pm', OFFICE_SEATS.pm.desk, 'up', { immediate: true })
  pm.meta.reactionUntil = engine.t + 600
  advance(engine, 1, 20)
  assert.equal(pm.sitting, false)
  assert.equal(pm.meta.seat, undefined)
  assert.ok(pm.seatBlockedUntil >= pm.meta.reactionUntil + 350)
})

test('mount, pickup, pointer path and map change explicitly release the player seat', () => {
  const cases = [
    ['mount', (engine) => {
      const bike = engine.worldObject('office-bike'); bike.x = engine.player.x + 20; bike.y = engine.player.y
      assert.equal(engine.mountVehicle(bike.id), true)
    }],
    ['pickup', (engine) => {
      const book = engine.worldObject('office-book-a'); book.x = engine.player.x + 20; book.y = engine.player.y
      assert.equal(engine.pickupObject(book.id), true)
    }],
    ['path', (engine) => engine.playerAutoWalk([24, 6])],
    ['map', (engine) => engine.setMap('arcade', [2, 9])]
  ]
  for (const [label, action] of cases) {
    const { engine } = createEngine()
    engine.sit('player', OFFICE_SEATS.player.desk, 'up', { immediate: true })
    assert.equal(engine.player.sitting, true)
    action(engine)
    assert.equal(engine.player.sitting, false, `${label} must stand the player`)
    assert.equal(engine.player.meta.seat, undefined)
  }
})

test('meeting mode preserves scripted chair animation and suppresses proximity seating', () => {
  const { engine } = createEngine()
  const pm = engine.addAgent('pm', 'pm', [4, 4], { map: 'office', home: OFFICE_SEATS.pm, autonomy: false })
  engine.meetingMode = true
  engine.sit('pm', [4, 4], 'down')
  atDesk(engine.player, OFFICE_SEATS.player.desk)

  assert.equal(pm.seatMotion.phase, SEAT_PHASES.ENTERING, 'scripted sit keeps its visible transition')
  advance(engine, 18, 20)
  assert.equal(pm.sitting, true)
  assert.equal(pm.seatMotion.phase, SEAT_PHASES.SEATED)
  assert.equal(pm.meta.seat.source, 'scripted')
  assert.deepEqual([pm.x, pm.y, pm.dir], [216, 232, 'down'])
  assert.equal(engine.player.sitting, false, 'meeting head movement owns the player during scripted seating')
  assert.equal(engine.getChairSeatingState().meetingMode, true)
})

test('seated desk repaint uses only the measured lower front strip', () => {
  const { engine, context } = createEngine()
  const calls = []
  context.drawImage = (...args) => calls.push(args)
  const background = { id: 'office-v2' }
  engine.maps.office.layout.occluders = [
    { id: 'desk-player-front', source: [1134, 151, 162, 139], baseline: 260 }
  ]
  engine.sit('player', OFFICE_SEATS.player.desk, 'up', { immediate: true })

  engine._drawSeatFront(engine.player, background)
  assert.deepEqual(calls, [[background, 1134, 260, 162, 30, 1134, 260, 162, 30]])
})
