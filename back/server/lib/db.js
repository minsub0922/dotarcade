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
      // Preserve a corrupt legacy file for diagnosis instead of silently
      // overwriting the only copy with an empty database.
      if (fs.existsSync(dbPath)) {
        const quarantine = `${dbPath}.corrupt-${Date.now()}`
        try { fs.renameSync(dbPath, quarantine) } catch { /* keep original if quarantine fails */ }
      }
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
    const dir = path.dirname(this.path)
    const temp = path.join(dir, `.${path.basename(this.path)}.${process.pid}.${Date.now()}.tmp`)
    let fd = null
    try {
      fd = fs.openSync(temp, 'w')
      fs.writeFileSync(fd, JSON.stringify(this.data, null, 1), 'utf8')
      fs.fsyncSync(fd)
      fs.closeSync(fd)
      fd = null
      fs.renameSync(temp, this.path)
      // Persist the rename itself where the platform supports directory fsync.
      let dirFd = null
      try {
        dirFd = fs.openSync(dir, 'r')
        fs.fsyncSync(dirFd)
      } catch { /* unsupported on some filesystems */ }
      finally { if (dirFd != null) fs.closeSync(dirFd) }
    } catch (error) {
      if (fd != null) try { fs.closeSync(fd) } catch { /* already closed */ }
      try { fs.unlinkSync(temp) } catch { /* temp may not exist */ }
      throw error
    }
  }
  game(id) { return this.data.games.find(g => g.id === id) }
}

export { DATA_DIR }
