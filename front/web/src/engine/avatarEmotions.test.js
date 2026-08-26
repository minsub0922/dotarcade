import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AVATAR_EMOTIONS,
  AvatarEmotionSystem,
  emotionRuleForCue
} from './avatarEmotions.js'

const entity = (id = 'dev1') => ({ id, x: 100, y: 100, dir: 'down', meta: {} })

test('explicit emotion has bounded state mirrored to entity metadata and expires', () => {
  const agent = entity()
  const emotions = new AvatarEmotionSystem({ random: () => .5 })
  const event = emotions.express(agent, 'happy', { now: 100, source: 'test', durationMs: 1200 })

  assert.equal(event.kind, 'happy')
  assert.equal(agent.meta.avatarEmotion.kind, 'happy')
  assert.equal(emotions.current(agent, 1299).kind, 'happy')
  assert.equal(emotions.current(agent, 1300), null)
  assert.equal(agent.meta.avatarEmotion, undefined)
})

test('global, kind and source cooldowns bound repeat emissions', () => {
  const agent = entity()
  const emotions = new AvatarEmotionSystem({
    random: () => .1,
    limits: { minGapMs: 1000, kindCooldownMs: 5000, sourceCooldownMs: 3000 }
  })

  assert.ok(emotions.express(agent, 'focused', { now: 0, source: 'work' }))
  assert.equal(emotions.express(agent, 'excited', { now: 999, source: 'play' }), null)
  assert.equal(emotions.express(agent, 'focused', { now: 2000, source: 'other' }), null)
  assert.equal(emotions.express(agent, 'happy', { now: 2000, source: 'work' }), null)
  assert.ok(emotions.express(agent, 'happy', { now: 5001, source: 'work' }))
  assert.equal(emotions.snapshot(agent, 5001).history.length, 2)
})

test('an active equal-priority emotion is not churned by another cue', () => {
  const agent = entity()
  const emotions = new AvatarEmotionSystem({ random: () => 0, limits: { minGapMs: 0, kindCooldownMs: 0, sourceCooldownMs: 0 } })
  assert.ok(emotions.express(agent, 'happy', { now: 10, source: 'a', durationMs: 2000 }))
  assert.equal(emotions.express(agent, 'focused', { now: 20, source: 'b' }), null)
  assert.equal(emotions.current(agent, 20).kind, 'happy')
  assert.ok(emotions.express(agent, 'annoyed', { now: 30, source: 'impact' }))
  assert.equal(emotions.current(agent, 30).kind, 'annoyed')
})

test('reaction locks cancel and suppress emotion until recovery', () => {
  const agent = entity()
  const emotions = new AvatarEmotionSystem({ random: () => 0, limits: { minGapMs: 0, kindCooldownMs: 0, sourceCooldownMs: 0 } })
  assert.ok(emotions.express(agent, 'proud', { now: 100, source: 'win' }))
  agent.meta.reactionUntil = 900
  emotions.update({ now: 200, entities: [agent] })
  assert.equal(emotions.current(agent, 200), null)
  assert.equal(emotions.express(agent, 'annoyed', { now: 800, source: 'hit' }), null)
  assert.ok(emotions.express(agent, 'nervous', { now: 901, source: 'recover' }))
})

test('semantic cue rules cover work, social, play and failure emotions', () => {
  assert.deepEqual(emotionRuleForCue('goal-start', { goal: 'work' }).candidates.map(x => x.kind), ['focused'])
  assert.ok(emotionRuleForCue('social-start').candidates.some(x => x.kind === 'happy'))
  assert.ok(emotionRuleForCue('activity-start', { activity: 'portablePlay' }).candidates.some(x => x.kind === 'excited'))
  assert.deepEqual(emotionRuleForCue('goal-failed').candidates.map(x => x.kind).sort(), ['annoyed', 'nervous'])
  assert.deepEqual(Object.keys(AVATAR_EMOTIONS).sort(), ['annoyed', 'excited', 'focused', 'happy', 'nervous', 'proud'])
})

test('ambient observation is scheduled and cannot roll every frame', () => {
  const agent = entity()
  const emotions = new AvatarEmotionSystem({
    random: () => 0,
    limits: { minGapMs: 0, kindCooldownMs: 0, sourceCooldownMs: 0, ambientMinMs: 1000, ambientMaxMs: 1000 }
  })

  assert.equal(emotions.observe(agent, { now: 0, activity: 'work' }), null)
  assert.equal(emotions.observe(agent, { now: 999, activity: 'work' }), null)
  const first = emotions.observe(agent, { now: 2200, activity: 'work' })
  assert.equal(first.kind, 'focused')
  assert.equal(emotions.observe(agent, { now: 2201, activity: 'work' }), null)
  assert.ok(emotions.snapshot(agent, 2201).nextAmbientAt >= 3200)
})

test('forget and reset remove state and mirrored metadata', () => {
  const one = entity('one')
  const two = entity('two')
  const emotions = new AvatarEmotionSystem({ random: () => 0 })
  emotions.express(one, 'happy', { now: 0, source: 'a' })
  emotions.express(two, 'proud', { now: 0, source: 'b' })
  assert.equal(emotions.forget(one), true)
  assert.equal(one.meta.avatarEmotion, undefined)
  assert.equal(emotions.snapshot(one), null)
  emotions.reset([two])
  assert.equal(two.meta.avatarEmotion, undefined)
  assert.equal(emotions.snapshot(two), null)
})

test('canvas renderer draws the active emotion and stays silent after expiry', () => {
  const agent = entity()
  const emotions = new AvatarEmotionSystem({ random: () => .5 })
  const drawn = []
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key === 'fillText') return value => drawn.push(value)
      if (key in target) return target[key]
      return () => {}
    },
    set(target, key, value) { target[key] = value; return true }
  })

  emotions.express(agent, 'excited', { now: 10, source: 'render', durationMs: 1000 })
  assert.equal(emotions.draw(ctx, agent, 400, { reduceMotion: true }), true)
  assert.deepEqual(drawn, [AVATAR_EMOTIONS.excited.emoji])
  assert.equal(emotions.draw(ctx, agent, 1010), false)
})

test('canvas renderer keeps avatar identity while overlaying a facial expression', () => {
  const agent = entity('designer')
  const emotions = new AvatarEmotionSystem({ random: () => .5 })
  const calls = []
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key === 'drawImage') return (...args) => calls.push(['drawImage', ...args])
      if (key === 'fillText') return (...args) => calls.push(['fillText', ...args])
      if (key in target) return target[key]
      return () => {}
    },
    set(target, key, value) { target[key] = value; return true }
  })
  const faceImage = { complete: true, naturalWidth: 96 }

  emotions.express(agent, 'nervous', { now: 0, source: 'portrait-test' })
  assert.equal(emotions.draw(ctx, agent, 500, { faceImage }), true)
  assert.equal(calls.filter(([name]) => name === 'drawImage').length, 1)
  assert.ok(calls.some(([name, value]) => name === 'fillText' && value === AVATAR_EMOTIONS.nervous.emoji))
})

test('a frame-rate goal loop cannot turn into an emotion loop', () => {
  const agent = entity()
  const emotions = new AvatarEmotionSystem({ random: () => 0 })
  for (let now = 0; now < 5000; now += 16) {
    emotions.cue(agent, 'goal-start', { now, goal: 'work' })
  }
  assert.equal(emotions.snapshot(agent, 5000).history.length, 1)

  for (let now = 5000; now < 90000; now += 500) {
    emotions.cue(agent, 'goal-failed', { now, goal: 'work' })
  }
  assert.ok(emotions.snapshot(agent, 90000).history.length <= 6)
})
