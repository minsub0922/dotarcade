import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getMilestoneConflict,
  getStudioMilestone,
  getStudioMilestoneById,
  getStudioMilestones,
  MILESTONE_ACTION,
  MILESTONE_STATUS,
  selectActiveProject,
  STUDIO_TODO
} from './milestone.js'

test('a studio with only bundled seed games routes to a new-game meeting', () => {
  const milestone = getStudioMilestone({ games: [{ id: 'seed', source: 'default', title: '기본 게임' }] })
  assert.equal(milestone.action, MILESTONE_ACTION.NEW_MEETING)
  assert.equal(milestone.destination, '사무실 회의실')
})

test('a release without current-version feedback routes to playtest', () => {
  const game = { id: 'g1', source: 'meeting', title: '별빛 정원', version: 'v1', feedback: {} }
  const milestone = getStudioMilestone({ games: [game] })
  assert.equal(milestone.action, MILESTONE_ACTION.START_PLAYTEST)
  assert.equal(milestone.gameId, 'g1')

  const upgraded = { ...game, version: 'v1.1', feedback: { v1: { avg: 8.1 } } }
  assert.equal(getStudioMilestone({ games: [upgraded] }).action, MILESTONE_ACTION.START_PLAYTEST)
})

test('a tested release routes to an upgrade meeting with its score', () => {
  const game = { id: 'g1', source: 'meeting', title: '별빛 정원', version: 'v1', feedback: { v1: { avg: 7.4 } } }
  const milestone = getStudioMilestone({ games: [game] })
  assert.equal(milestone.action, MILESTONE_ACTION.UPGRADE_MEETING)
  assert.match(milestone.detail, /7\.4\/10/)
})

test('active work takes priority over the release loop', () => {
  const game = { id: 'g1', source: 'meeting', title: '별빛 정원', version: 'v1' }
  const meeting = getStudioMilestone({ games: [game], meeting: { status: 'running', phase: 'design', phaseLabel: '디자인' } })
  assert.equal(meeting.action, MILESTONE_ACTION.RESUME_MEETING)

  const playtest = getStudioMilestone({ games: [game], arcade: { status: 'running', title: '별빛 정원', progress: 8 } })
  assert.equal(playtest.action, MILESTONE_ACTION.WATCH_PLAYTEST)
  assert.equal(playtest.step, '8/20')
})

test('pause and resume transitions remain active work and surface the human intervention state', () => {
  for (const status of ['pausing', 'paused', 'resuming']) {
    const meeting = { status, phase: 'design', phaseLabel: '아트/UX 스펙', agenda: '별빛 정원' }
    const milestone = getStudioMilestone({ meeting })
    assert.equal(milestone.action, MILESTONE_ACTION.RESUME_MEETING, status)
    assert.match(getMilestoneConflict({ meeting }, MILESTONE_ACTION.START_PLAYTEST), /제작 회의/, status)
  }

  const paused = getStudioMilestone({ meeting: { status: 'paused', phase: 'design', phaseLabel: '아트/UX 스펙' } })
  assert.match(paused.kicker, /개입 대기/)
  assert.match(paused.actionLabel, /재개/)
  assert.equal(paused.tone, 'warning')
})

test('active project selection ignores old seed games and follows explicit ownership', () => {
  const games = [
    { id: 'seed', source: 'default', updatedAt: '2030-01-01' },
    { id: 'older', source: 'meeting', updatedAt: '2026-01-01' },
    { id: 'latest', source: 'meeting', updatedAt: '2026-02-01' }
  ]
  assert.equal(selectActiveProject(games, null, null).id, 'latest')
  assert.equal(selectActiveProject(games, { resultGameId: 'older' }, null).id, 'older')
  assert.equal(selectActiveProject(games, null, { activeMission: { gameId: 'older' } }).id, 'older')

  const milestone = getStudioMilestone({ games, studio: { activeMission: { gameId: 'older' } } })
  assert.equal(milestone.gameId, 'older')
})

test('unseen terminal report takes priority and cancelled test offers a retry', () => {
  const game = { id: 'g1', source: 'meeting', title: '별빛 정원', version: 'v1', feedback: {} }
  const report = getStudioMilestone({ games: [game], arcade: { gameId: 'g1', title: game.title, status: 'report_error', reportSeen: false } })
  assert.equal(report.action, MILESTONE_ACTION.VIEW_REPORT)
  assert.match(report.kicker, /복구/)

  const retry = getStudioMilestone({ games: [game], arcade: { gameId: 'g1', status: 'cancelled', reportSeen: true } })
  assert.equal(retry.action, MILESTONE_ACTION.START_PLAYTEST)
  assert.match(retry.title, /다시 시작/)
})

test('meeting and playtest actions are mutually exclusive while either is active', () => {
  const meeting = { status: 'running' }
  const arcade = { status: 'summarizing' }
  assert.match(getMilestoneConflict({ meeting }, MILESTONE_ACTION.START_PLAYTEST), /제작 회의/)
  assert.match(getMilestoneConflict({ arcade }, MILESTONE_ACTION.NEW_MEETING), /플레이테스트/)
  assert.match(getMilestoneConflict({ meeting, arcade }, MILESTONE_ACTION.RESUME_MEETING), /플레이테스트/)
  assert.equal(getMilestoneConflict({ arcade }, MILESTONE_ACTION.WATCH_PLAYTEST), '')
})

test('the complete todo list always exposes the six requested activities in step order', () => {
  const todos = getStudioMilestones({ games: [{ id: 'seed', source: 'default' }] })
  assert.deepEqual(todos.map(item => item.id), [
    STUDIO_TODO.TEAM_INTERACTION,
    STUDIO_TODO.PLAY_GAME,
    STUDIO_TODO.CREATE_GAME,
    STUDIO_TODO.INTERRUPT_MEETING,
    STUDIO_TODO.GET_EVALUATION,
    STUDIO_TODO.IMPROVE_GAME
  ])
  assert.deepEqual(todos.map(item => item.step), ['1/6', '2/6', '3/6', '4/6', '5/6', '6/6'])
  assert.ok(todos.every(item => item.confirmTitle && item.destination && item.actionLabel && item.route))
})

test('optional earlier activities do not lock other playable unfinished activities', () => {
  const todos = getStudioMilestones({ games: [{ id: 'seed', source: 'default' }] })
  assert.equal(getStudioMilestoneById({ games: [{ id: 'seed', source: 'default' }] }, STUDIO_TODO.TEAM_INTERACTION).status, MILESTONE_STATUS.AVAILABLE)
  assert.equal(todos[1].status, MILESTONE_STATUS.AVAILABLE)
  assert.equal(todos[2].status, MILESTONE_STATUS.AVAILABLE)
  assert.equal(todos[3].status, MILESTONE_STATUS.LOCKED)
  assert.equal(todos[4].status, MILESTONE_STATUS.LOCKED)
  assert.equal(todos[5].status, MILESTONE_STATUS.LOCKED)
})

test('free-roam completion flags are durable presentation signals without changing list order', () => {
  const studio = { todoProgress: {
    [STUDIO_TODO.TEAM_INTERACTION]: true,
    [STUDIO_TODO.PLAY_GAME]: { done: true }
  } }
  const todos = getStudioMilestones({ games: [{ id: 'seed', source: 'default' }], studio })
  assert.equal(todos[0].status, MILESTONE_STATUS.DONE)
  assert.equal(todos[1].status, MILESTONE_STATUS.DONE)
  assert.equal(todos[0].canStart, true, 'completed repeatable activities remain replayable')
  assert.deepEqual(todos.map(item => item.order), [1, 2, 3, 4, 5, 6])
})

test('the local task activity contract maps interaction, play and pause events', () => {
  const todos = getStudioMilestones({
    games: [{ id: 'seed', source: 'default' }],
    taskActivity: { socialized: 1, playedGame: 2, pausedMeeting: 3 }
  })
  assert.equal(todos[0].status, MILESTONE_STATUS.DONE)
  assert.equal(todos[1].status, MILESTONE_STATUS.DONE)
  assert.equal(todos[3].status, MILESTONE_STATUS.DONE)
  assert.equal(todos[0].enabled, todos[0].canStart)
})

test('a running meeting activates creation and makes the interruption step actionable', () => {
  const state = { games: [{ id: 'seed', source: 'default' }], meeting: { status: 'running', phaseLabel: '컨셉 토론', agenda: '별빛 정원' } }
  const todos = getStudioMilestones(state)
  assert.equal(todos[2].status, MILESTONE_STATUS.ACTIVE)
  assert.equal(todos[2].action, MILESTONE_ACTION.RESUME_MEETING)
  assert.equal(todos[3].status, MILESTONE_STATUS.AVAILABLE)
  assert.equal(todos[3].action, MILESTONE_ACTION.INTERRUPT_MEETING)
  assert.equal(todos[3].canStart, true)
  assert.equal(getMilestoneConflict(state, MILESTONE_ACTION.INTERRUPT_MEETING), '')
})

test('a previous pause does not prevent interrupting a later running meeting', () => {
  const interruption = getStudioMilestones({
    meeting: { status: 'running', phaseLabel: '구현' },
    taskActivity: { pausedMeeting: 123 }
  })[3]
  assert.equal(interruption.status, MILESTONE_STATUS.AVAILABLE)
  assert.equal(interruption.canStart, true)
})

test('an explicitly paused meeting completes interruption while a transition remains active', () => {
  const paused = getStudioMilestones({ meeting: { status: 'paused' } })[3]
  assert.equal(paused.status, MILESTONE_STATUS.DONE)
  assert.equal(paused.canStart, false)
  assert.match(paused.blockReason, /이미/)

  const pausing = getStudioMilestones({ meeting: { status: 'pausing' } })[3]
  assert.equal(pausing.status, MILESTONE_STATUS.ACTIVE)
  assert.equal(pausing.canStart, false)
  assert.match(pausing.blockReason, /저장/)
})

test('a released game unlocks evaluation without requiring free-roam tasks', () => {
  const game = { id: 'g1', source: 'meeting', title: '별빛 정원', version: 'v1.0.0', feedback: {} }
  const todos = getStudioMilestones({ games: [game] })
  assert.equal(todos[2].status, MILESTONE_STATUS.DONE)
  assert.equal(todos[4].status, MILESTONE_STATUS.AVAILABLE)
  assert.equal(todos[4].action, MILESTONE_ACTION.START_PLAYTEST)
  assert.equal(todos[4].gameId, 'g1')
  assert.equal(todos[5].status, MILESTONE_STATUS.LOCKED)
})

test('evaluation follows running, report and completed states with the matching action', () => {
  const game = { id: 'g1', source: 'meeting', title: '별빛 정원', version: 'v1.0.0', feedback: {} }
  const running = getStudioMilestones({ games: [game], arcade: { status: 'running', gameId: 'g1', title: game.title, progress: 7 } })[4]
  assert.equal(running.status, MILESTONE_STATUS.ACTIVE)
  assert.equal(running.action, MILESTONE_ACTION.WATCH_PLAYTEST)
  assert.match(running.detail, /7\/20/)

  const report = getStudioMilestones({ games: [game], arcade: { status: 'done', gameId: 'g1', title: game.title, reportSeen: false } })[4]
  assert.equal(report.status, MILESTONE_STATUS.ACTIVE)
  assert.equal(report.action, MILESTONE_ACTION.VIEW_REPORT)

  const tested = { ...game, feedback: { 'v1.0.0': { avg: 7.8 } } }
  const completed = getStudioMilestones({ games: [tested] })
  assert.equal(completed[4].status, MILESTONE_STATUS.DONE)
  assert.equal(completed[5].status, MILESTONE_STATUS.AVAILABLE)
  assert.equal(completed[5].action, MILESTONE_ACTION.UPGRADE_MEETING)
  assert.equal(completed[5].gameId, 'g1')
})

test('an upgrade meeting and upgraded release make improvement active then done', () => {
  const game = { id: 'g1', source: 'meeting', title: '별빛 정원', version: 'v1.0.0', feedback: { 'v1.0.0': { avg: 7.8 } } }
  const active = getStudioMilestones({ games: [game], meeting: { status: 'running', upgrade: true, gameId: 'g1', phaseLabel: '개선 구현' } })[5]
  assert.equal(active.status, MILESTONE_STATUS.ACTIVE)
  assert.equal(active.action, MILESTONE_ACTION.RESUME_MEETING)

  const upgraded = { ...game, version: 'v1.1.0', versions: [{ version: 'v1.0.0' }, { version: 'v1.1.0' }] }
  const done = getStudioMilestones({ games: [upgraded] })[5]
  assert.equal(done.status, MILESTONE_STATUS.DONE)
  assert.equal(done.canStart, false)
})
