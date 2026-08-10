import React from 'react'
import { useStore } from '../state/store.js'

export default function Toasts() {
  const toasts = useStore(s => s.toasts)
  return (
    <div className="toasts">
      {toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.text}</div>)}
    </div>
  )
}
