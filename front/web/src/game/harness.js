// DOTCADE — 게임 iframe 마운트 유틸 (public/harness.js의 buildGameSrcdoc 사용)
export function mountGame(el, code, opts = {}) {
  const { srcdoc, token } = window.buildGameSrcdoc(code, opts)
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.style.cssText = opts.style || 'width:100%;height:100%;border:0;display:block;'
  iframe.srcdoc = srcdoc
  el.appendChild(iframe)

  const listeners = new Set()
  const onMsg = ev => {
    const d = ev.data || {}
    if (d.gp !== token) return
    for (const fn of listeners) fn(d)
  }
  window.addEventListener('message', onMsg)

  return {
    iframe, token,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    sendKey(codeK, down) { iframe.contentWindow?.postMessage({ gp: token, type: 'key', code: codeK, down }, '*') },
    stop() { iframe.contentWindow?.postMessage({ gp: token, type: 'stop' }, '*') },
    dispose() {
      window.removeEventListener('message', onMsg)
      iframe.remove()
    }
  }
}
