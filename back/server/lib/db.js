// DOTCADE — JSON file DB (single-user, debounced writes)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
const DB_PATH = path.join(DATA_DIR, 'db.json')

const EMPTY = { games: [], meetings: [], chats: {}, settings: {} }

class DB {
  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    try {
      this.data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
    } catch {
      this.data = structuredClone(EMPTY)
    }
    for (const k of Object.keys(EMPTY)) if (!(k in this.data)) this.data[k] = structuredClone(EMPTY[k])
    this._t = null
  }
  save() {
    clearTimeout(this._t)
    this._t = setTimeout(() => {
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 1))
    }, 250)
  }
  game(id) { return this.data.games.find(g => g.id === id) }
}

export const db = new DB()
export { DATA_DIR }
