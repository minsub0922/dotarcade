import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PLAYER, TEAM, VISITORS } from '../data/personas.js'

const SPRITES_ROOT = fileURLToPath(new URL('../../public/assets/sprites_v2/', import.meta.url))
const DIRECTIONS = ['down', 'left', 'right', 'up']
const FRAMES = ['idle', 'stepL', 'stepR']

const sorted = values => [...values].sort()
const pngSize = file => {
  const bytes = readFileSync(file)
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${file} must be a PNG`
  )
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

test('every runtime avatar owns one complete canonical walking atlas', () => {
  const roster = [PLAYER, ...TEAM, ...VISITORS]
  const spriteIds = sorted(roster.map(avatar => avatar.sprite || avatar.id))
  assert.equal(new Set(spriteIds).size, 26)

  const manifest = JSON.parse(readFileSync(`${SPRITES_ROOT}/sprites.json`, 'utf8'))
  const walkManifest = JSON.parse(readFileSync(`${SPRITES_ROOT}/walk.json`, 'utf8'))
  const assetDirectories = sorted(readdirSync(SPRITES_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name))

  assert.deepEqual(sorted(Object.keys(manifest)), spriteIds)
  assert.deepEqual(sorted(Object.keys(walkManifest.characters)), spriteIds)
  assert.deepEqual(assetDirectories, spriteIds)

  for (const id of spriteIds) {
    const root = `${SPRITES_ROOT}/${id}`
    assert.deepEqual(pngSize(`${root}/walk-sheet.png`), [144, 288], `${id} atlas size`)
    for (const direction of DIRECTIONS) {
      assert.ok(existsSync(`${root}/${direction}.png`), `${id}/${direction} still is missing`)
      for (const frame of FRAMES) {
        assert.deepEqual(
          pngSize(`${root}/walk/${direction}/${frame}.png`),
          [48, 72],
          `${id}/${direction}/${frame} frame size`
        )
      }
    }
  }
})
