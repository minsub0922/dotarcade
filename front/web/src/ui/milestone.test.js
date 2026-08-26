import test from 'node:test'
import assert from 'node:assert/strict'
import { getMilestoneConflict, getStudioMilestone, MILESTONE_ACTION, selectActiveProject } from './milestone.js'

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
