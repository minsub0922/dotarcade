import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DB } from './db.js'

function withTempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotcade-db-test-'))
  try { return run(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

test('flush atomically replaces the profile DB with valid JSON and no temp residue', () => {
  withTempDir(dir => {
    const dbPath = path.join(dir, 'profile', 'db.json')
    const db = new DB(dbPath)
    db.data.meetings.push({ id: 'meeting-durable', revision: 7, checkpoint: { context: { agents: 5 } } })
    db.flush()

    assert.deepEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')), db.data)
    assert.deepEqual(
      fs.readdirSync(path.dirname(dbPath)).filter(name => name.endsWith('.tmp')),
      []
    )
  })
})

test('a corrupt profile DB is quarantined instead of being overwritten', () => {
  withTempDir(dir => {
    const dbPath = path.join(dir, 'db.json')
    fs.writeFileSync(dbPath, '{"meetings": [truncated')

    const db = new DB(dbPath)
    assert.deepEqual(db.data.meetings, [])
    assert.equal(fs.existsSync(dbPath), false)
    const quarantined = fs.readdirSync(dir).filter(name => name.startsWith('db.json.corrupt-'))
    assert.equal(quarantined.length, 1)
    assert.equal(fs.readFileSync(path.join(dir, quarantined[0]), 'utf8'), '{"meetings": [truncated')

    db.flush()
    assert.deepEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).meetings, [])
  })
})
