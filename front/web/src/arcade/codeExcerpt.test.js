import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluationCodeExcerpt } from './codeExcerpt.js'

test('evaluation excerpt preserves late depth and UI renderers', () => {
  const filler = 'const unused = 0\n'.repeat(500)
  const code = `const meta = { title: 'demo' }\n${filler}\nfunction drawFarLayer(){ return 'sky' }\n${filler}\nfunction drawParty(){ return 'cards' }\nfunction drawResult(){ return 'score' }`
  const excerpt = evaluationCodeExcerpt(code)
  assert.match(excerpt, /title: 'demo'/)
  assert.match(excerpt, /drawFarLayer/)
  assert.match(excerpt, /drawParty/)
  assert.match(excerpt, /drawResult/)
  assert.ok(excerpt.length < 8000)
})

test('short code remains unchanged', () => {
  assert.equal(evaluationCodeExcerpt('function draw(){}'), 'function draw(){}')
})
