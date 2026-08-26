import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function fakeCanvas() {
  const canvas = { width: 480, height: 320, style: {}, frame: 1 }
  const ctx = {
    font: '12px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
    fillText() {}, strokeText() {},
    measureText(text) {
      return { width: String(text).length * 7, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 }
    },
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    getImageData(x, y, w, h) {
      const pixels = new Uint8ClampedArray(Math.max(1, w * h * 4))
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = canvas.frame * 16
        pixels[i + 1] = canvas.frame * 12
        pixels[i + 2] = canvas.frame * 8
        pixels[i + 3] = 255
      }
      return { data: pixels }
    }
  }
  canvas.getContext = () => ctx
  return canvas
}

function eventTarget() {
  const listeners = new Map()
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(fn)
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).filter(value => value !== fn))
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event)
      return true
    },
    fire(type, event = {}) {
      for (const fn of listeners.get(type) || []) fn({ type, ...event })
    }
  }
}

test('quality probe really visits party and codex through the standard title navigation', async () => {
  const hostWindow = {}
  globalThis.window = hostWindow
  await import(`../../public/harness.js?quality-test=${Date.now()}`)
  const buildGameSrcdoc = hostWindow.buildGameSrcdoc
  delete globalThis.window

  const gameCode = `
    window.game = {
      meta: {
        title: 'Probe fixture', controls: ['ArrowDown','Space','Escape'],
        viewport: { w: 480, h: 320 },
        visual: { screens: ['title','gameplay','result','party','codex'] }
      },
      start(canvas, api) {
        const ctx = canvas.getContext('2d')
        const values = { title: 1, gameplay: 12, party: 5, codex: 9 }
        let screen = 'title', menuIndex = 0
        const drawAndReport = () => {
          canvas.frame = values[screen] || 14
          ctx.fillText(screen.toUpperCase(), 24, 28)
          api.emit('screen', { id: screen })
        }
        const setScreen = id => { screen = id; drawAndReport() }
        window.addEventListener('keydown', event => {
          if (screen === 'title' && event.code === 'ArrowDown') menuIndex = (menuIndex + 1) % 3
          else if (screen === 'title' && event.code === 'Space') setScreen(['gameplay','party','codex'][menuIndex])
          else if ((screen === 'party' || screen === 'codex') && event.code === 'Escape') {
            menuIndex = 0
            setScreen('title')
          }
        })
        drawAndReport()
      },
      stop() {}
    }
  `
  const { srcdoc, token } = buildGameSrcdoc(gameCode, {
    mode: 'bot', quality: true,
    bot: { durationMs: 60, aggression: 0, intervalMs: 40, holdMs: 20 }
  })
  const scripts = [...srcdoc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])
  assert.equal(scripts.length, 2)

  const canvas = fakeCanvas()
  const windowTarget = eventTarget()
  const documentTarget = eventTarget()
  const messages = []
  class FakeKeyboardEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init) }
    preventDefault() {}
  }
  const scaledTimeout = (fn, ms = 0, ...args) => setTimeout(fn, Math.min(5, ms), ...args)
  const context = vm.createContext({
    console, Date, Math, Object, Array, Number, String, Boolean, RegExp, JSON, Set, Map,
    Uint8ClampedArray, isFinite, innerWidth: 800, innerHeight: 600,
    setTimeout: scaledTimeout, clearTimeout,
    KeyboardEvent: FakeKeyboardEvent,
    parent: { postMessage(message) { messages.push(message) } },
    document: {
      ...documentTarget, readyState: 'loading',
      getElementById() { return canvas }
    }
  })
  Object.assign(context, windowTarget)
  context.window = context
  context.globalThis = context

  vm.runInContext(scripts[0], context)
  vm.runInContext(scripts[1], context)
  documentTarget.fire('DOMContentLoaded')
  await wait(240)

  const reached = messages
    .filter(message => message.gp === token && message.type === 'game-event' && message.event?.type === 'screen')
    .map(message => message.event.payload?.id)
  assert.deepEqual(reached.slice(0, 6), ['title', 'party', 'title', 'codex', 'title', 'gameplay'])

  const qualityMessages = messages.filter(message => message.gp === token && message.type === 'qualitycheck')
  assert.ok(qualityMessages.length > 0)
  const visited = new Set(qualityMessages.at(-1).quality.screens.samples.map(sample => sample.id))
  assert.ok(visited.has('party'))
  assert.ok(visited.has('codex'))
  assert.ok(visited.has('gameplay'))
})
