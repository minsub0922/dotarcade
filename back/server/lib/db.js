// DOTCADE — JSON file DB (프로필별 인스턴스, debounced writes)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')

const EMPTY = { games: [], meetings: [], chats: {}, settings: {} }

export class DB {
  constructor(dbPath) {
    this.path = dbPath
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    try {
      this.data = JSON.parse(fs.readFileSync(dbPath, 'utf8'))
    } catch {
      this.data = structuredClone(EMPTY)
    }
    for (const k of Object.keys(EMPTY)) if (!(k in this.data)) this.data[k] = structuredClone(EMPTY[k])
    this._t = null
  }
  save() {
    clearTimeout(this._t)
    this._t = setTimeout(() => this.flush(), 250)
  }
  flush() {
    clearTimeout(this._t)
    this._t = null
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 1))
  }
  game(id) { return this.data.games.find(g => g.id === id) }
}

export { DATA_DIR }
