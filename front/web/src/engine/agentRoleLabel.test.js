import test from 'node:test'
import assert from 'node:assert/strict'
import { drawAgentRoleLabel, getAgentRoleLabel } from './agentRoleLabel.js'

function canvasSpy() {
  const calls = []
  return {
    calls,
    save() { calls.push(['save']) },
    restore() { calls.push(['restore']) },
    beginPath() {},
    roundRect(...args) { calls.push(['roundRect', ...args]) },
    fill() { calls.push(['fill', this.fillStyle]) },
    fillText(...args) { calls.push(['fillText', ...args, this.fillStyle]) },
    measureText(text) { return { width: text.length * 10 } },
    font: '', fillStyle: '', textAlign: '', textBaseline: ''
  }
}

test('role label keeps canonical role text and agent color', () => {
  assert.deepEqual(
    getAgentRoleLabel({ color: '#41c7b8', meta: { role: ' 시니어 개발자 ' } }),
    { text: '시니어 개발자', color: '#41c7b8' }
  )
  assert.equal(getAgentRoleLabel({ color: '#fff', meta: {} }), null)
})

test('role chip is drawn above the visible avatar head', () => {
  const ctx = canvasSpy()
  const entity = { x: 240, y: 300, color: '#b78cff', meta: { role: '디자이너' } }
  const result = drawAgentRoleLabel(ctx, entity, { drawHeight: 72, bob: 2 })

  assert.equal(result.text, '디자이너')
  assert.equal(result.color, '#b78cff')
  assert.ok(result.y + result.height < entity.y - 72 + 2)
  assert.ok(ctx.calls.some(([name, text]) => name === 'fillText' && text === '디자이너'))
  assert.ok(ctx.calls.some(([name, color]) => name === 'fill' && color === '#b78cff'))
})

test('visitors and other entities without a role keep their existing labels only', () => {
  const ctx = canvasSpy()
  assert.equal(drawAgentRoleLabel(ctx, { x: 20, y: 30, color: '#fff', meta: {} }), null)
  assert.equal(ctx.calls.length, 0)
})
