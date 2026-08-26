import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureArcadeSummary, mergeSavedFeedback, saveFeedbackWithRetry } from './report.js'

test('completed simulation gets a grounded fallback when summary streaming is empty', () => {
  const reports = [
    { visitor: { name: '민준' }, score: 8, oneLiner: '콤보 손맛이 좋다', suggestions: ['후반 패턴 추가'] },
    { visitor: { name: '서연' }, score: 6, oneLiner: '초반이 조금 길다', suggestions: ['초반 템포 개선'] }
  ]
  const summary = ensureArcadeSummary({
    text: '', game: { title: '붕어빵 캐처' }, version: 'v1.0.0', reports, avg: 7,
    ratings: { fun: 8.2, controls: 7.1, balance: 5.4 }
  })

  assert.match(summary, /붕어빵 캐처 v1\.0\.0/)
  assert.match(summary, /2명의 유효 평가/)
  assert.match(summary, /콤보 손맛이 좋다/)
  assert.match(summary, /후반 패턴 추가/)
  assert.match(summary, /밸런스 5\.4/)
})

test('non-empty streamed summary is preserved', () => {
  assert.equal(ensureArcadeSummary({ text: '# 실제 요약\n본문' }), '# 실제 요약\n본문')
})

test('feedback persistence retries once and returns the acknowledgement', async () => {
  let calls = 0
  const result = await saveFeedbackWithRetry(async payload => {
    calls++
    if (calls === 1) throw new Error('temporary network error')
    return { ok: true, feedback: payload }
  }, { version: 'v1.0.0' })

  assert.equal(calls, 2)
  assert.equal(result.ok, true)
})

test('saved feedback is immediately merged into the local game library', () => {
  const feedback = { avg: 7.2, reports: [{ score: 7 }], summary: '완료' }
  const games = mergeSavedFeedback([{ id: 'g1', feedback: {} }], 'g1', 'v1.0.0', feedback, { runs: 1 })
  assert.deepEqual(games[0].feedback['v1.0.0'], feedback)
  assert.equal(games[0].stats.runs, 1)
})
