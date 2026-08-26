import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVE_MEETING_STATUSES,
  isMeetingActive,
  isMeetingPaused,
  isMeetingTransitioning,
  meetingStatusCopy
} from './status.js'

test('all execution and human-intervention transition states keep a meeting active', () => {
  assert.deepEqual(ACTIVE_MEETING_STATUSES, [
    'running', 'pausing', 'paused', 'resuming',
    'interrupting', 'interrupted', 'waiting_for_human', 'error'
  ])
  for (const status of ACTIVE_MEETING_STATUSES) {
    assert.equal(isMeetingActive(status), true, status)
    assert.equal(isMeetingActive({ status }), true, status)
  }
})

test('terminal and missing meetings are not active', () => {
  for (const value of [null, undefined, '', 'done', 'cancelled', { status: 'done' }]) {
    assert.equal(isMeetingActive(value), false)
  }
})

test('paused and transitional states remain distinguishable for controls', () => {
  assert.equal(isMeetingPaused({ status: 'paused' }), true)
  assert.equal(isMeetingPaused({ status: 'waiting_for_human' }), true)
  assert.equal(isMeetingPaused({ status: 'error' }), true)
  assert.equal(isMeetingPaused({ status: 'pausing' }), false)
  assert.equal(isMeetingTransitioning('pausing'), true)
  assert.equal(isMeetingTransitioning('resuming'), true)
  assert.equal(isMeetingTransitioning('interrupting'), true)
  assert.equal(isMeetingTransitioning('running'), false)
  assert.deepEqual(meetingStatusCopy('paused'), { label: '팀장 개입 대기', tone: 'paused' })
})
