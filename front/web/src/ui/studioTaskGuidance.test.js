import test from 'node:test'
import assert from 'node:assert/strict'
import { getTaskGuidance, selectGuidedTask, studioTaskKey } from './studioTaskGuidance.js'

const task = (id, action, status, extra = {}) => ({
  id, action, status,
  enabled: status !== 'locked',
  destination: `${id} 목적지`,
  actionLabel: `${id} 시작`,
  arrivalNote: `${id} 화면이 열립니다.`,
  ...extra
})

test('recommended production action is highlighted ahead of unfinished free-roam tasks', () => {
  const tasks = [
    task('team', 'team-interaction', 'available'),
    task('play', 'play-game', 'available'),
    task('create', 'new-meeting', 'available')
  ]
  assert.equal(selectGuidedTask(tasks, { action: 'new-meeting' }).id, 'create')
})

test('active work wins and locked recommendations are skipped', () => {
  const active = task('evaluation', 'watch-playtest', 'active')
  assert.equal(selectGuidedTask([
    task('create', 'new-meeting', 'available'),
    active
  ], { action: 'new-meeting' }), active)

  assert.equal(selectGuidedTask([
    task('evaluation', 'start-playtest', 'locked'),
    task('team', 'team-interaction', 'available')
  ], { action: 'start-playtest' }).id, 'team')
})

test('repeatable completed work is the final actionable fallback', () => {
  const replay = task('play', 'play-game', 'done', { repeatable: true, enabled: true })
  assert.equal(selectGuidedTask([task('improve', 'upgrade-meeting', 'locked'), replay]), replay)
})

test('guidance exposes a concise instruction, destination and concrete action', () => {
  const item = task('team', 'team-interaction', 'available', {
    guide: '팀원 근처에서 E로 대화하거나 소품을 E로 집은 뒤 F로 던져 보세요.'
  })
  const guidance = getTaskGuidance(item)
  assert.match(guidance.label, /추천/)
  assert.match(guidance.text, /E.*F/)
  assert.equal(guidance.destination, 'team 목적지')
  assert.equal(guidance.actionLabel, 'team 시작')
  assert.equal(studioTaskKey(item), 'team:team-interaction')
})

test('locked guidance explains the prerequisite instead of offering an action', () => {
  const guidance = getTaskGuidance(task('improve', 'upgrade-meeting', 'locked', { blockReason: '게임 평가를 먼저 완료해 주세요.' }))
  assert.equal(guidance.locked, true)
  assert.equal(guidance.label, '해제 조건')
  assert.match(guidance.text, /게임 평가/)
})
