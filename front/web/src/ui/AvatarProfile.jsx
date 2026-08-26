import React, { useCallback, useEffect, useRef } from 'react'
import { getAvatarProfile } from './avatarProfile.js'

export { getAvatarProfile } from './avatarProfile.js'

export default function AvatarProfile({ avatar, onClose }) {
  const closeRef = useRef(null)
  const profile = getAvatarProfile(avatar)
  const close = useCallback(() => onClose?.(), [onClose])

  useEffect(() => {
    if (!profile) return undefined
    closeRef.current?.focus()
    const onKeyDown = event => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [profile?.id, close])

  if (!profile) return null

  return (
    <div
      className="modal-back avatar-profile-back"
      onClick={event => event.target === event.currentTarget && close()}
    >
      <section
        className="modal avatar-profile"
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-profile-title"
        style={{ '--avatar-color': profile.color, '--agent-color': profile.color }}
      >
        <header className="modal-head agent-panel-head avatar-profile-head">
          <img className="face" src={profile.imageSrc} alt={`${profile.name} 아바타`} />
          <div className="modal-title-block">
            <span className="modal-kicker">ONLINE AVATAR</span>
            <b id="avatar-profile-title">{profile.name}</b>
            <span className="tiny muted">{profile.title}</span>
          </div>
          <button ref={closeRef} type="button" className="x" onClick={close} aria-label="아바타 정보 닫기">✕</button>
        </header>

        <div className="detail-body avatar-profile-body">
          <div className="info-grid avatar-profile-facts">
            <span>접속 상태<br /><b>{profile.online ? '● ' : '○ '}{profile.status}</b></span>
            <span>담당 역할<br /><b>{profile.role || profile.title}</b></span>
            {profile.age != null && <span>나이<br /><b>{profile.age}세</b></span>}
            {profile.activity && <span>현재 상태<br /><b>{profile.activity}</b></span>}
          </div>

          {profile.specialty && (
            <div className="field avatar-profile-specialty">
              <label>프로젝트 담당</label>
              <div className="sys-line">{profile.specialty}</div>
            </div>
          )}

          {profile.summary && (
            <div className="field avatar-profile-summary">
              <label>아바타 소개</label>
              <p className="tiny muted">{profile.summary}</p>
            </div>
          )}

          {!profile.specialty && !profile.summary && (
            <div className="sys-line">현재 공개된 추가 프로필 정보가 없습니다.</div>
          )}
        </div>
      </section>
    </div>
  )
}
