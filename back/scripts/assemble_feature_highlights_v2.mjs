import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const exec = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const rawDir = path.join(root, 'artifacts/video/raw')
const workDir = path.join(root, 'artifacts/video/work-story')
const captionDir = path.join(root, 'artifacts/video/captions-story')
const manifestPath = path.join(rawDir, 'recording-manifest.json')
const output = path.join(root, 'artifacts/DOTCADE-studio-story-ko.mp4')
const poster = path.join(root, 'artifacts/DOTCADE-studio-story-ko-poster.png')
const contactSheet = path.join(root, 'artifacts/video/DOTCADE-studio-story-ko-contact-sheet.png')
const editPlanPath = path.join(workDir, 'edit-plan.json')
const ffmpeg = process.env.FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg'
const ffprobe = process.env.FFPROBE_BIN || '/opt/homebrew/bin/ffprobe'
const rsvg = process.env.RSVG_BIN || '/opt/homebrew/bin/rsvg-convert'
const WIDTH = 1280
const HEIGHT = 720
const FPS = 30
const fullRunName = process.env.DOTCADE_FULL_RUN_NAME || process.env.DOTCADE_RECORD_NAME || 'studio_story_full_run'

const sources = {
  fullRun: path.join(rawDir, `${fullRunName}.webm`),
  fullRunMarks: path.join(rawDir, `${fullRunName}.marks.json`)
}

const round = value => Math.round(Number(value) * 1000) / 1000
const xml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

async function exists(file) {
  try {
    await access(file, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function runTool(tool, args, maxBuffer = 64 * 1024 * 1024) {
  return exec(tool, args, { maxBuffer })
}

await Promise.all([
  mkdir(workDir, { recursive: true }),
  mkdir(captionDir, { recursive: true })
])

const required = [
  manifestPath,
  ...Object.values(sources),
  ...['01_walk', '02_vehicles', '03_impacts', '04_social', '05_pocket']
    .map(name => path.join(rawDir, `${name}.webm`)),
  ffmpeg,
  ffprobe,
  rsvg
]
const missing = []
for (const file of required) if (!await exists(file)) missing.push(file)
if (missing.length) throw new Error(`highlight assembly is missing required inputs:\n${missing.join('\n')}`)

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.schemaVersion !== 2) throw new Error(`unsupported recording manifest schema ${manifest.schemaVersion}`)
const fullRunManifest = JSON.parse(await readFile(sources.fullRunMarks, 'utf8'))
const storyGame = fullRunManifest.game
if (!storyGame?.id || !storyGame?.title || storyGame.title.startsWith('방금')) {
  throw new Error(`full-run game identity is invalid: ${JSON.stringify(storyGame)}`)
}

function fullRunMark(label) {
  const item = fullRunManifest.marks?.find(value => value.label === label)
  if (!item) throw new Error(`missing full-run mark ${label}`)
  return Number(item.seconds)
}

function fullRunExtra(label) {
  const item = fullRunManifest.marks?.find(value => value.label === label)
  if (!item) throw new Error(`missing full-run mark ${label}`)
  return item.extra || {}
}

const reportStats = fullRunExtra('report_done')
const savedFeedback = fullRunExtra('persistent_feedback')
if (reportStats.status !== 'done' || reportStats.reports !== 20 || savedFeedback.reports !== 20 || !savedFeedback.found) {
  throw new Error(`full-run feedback is incomplete: ${JSON.stringify({ reportStats, savedFeedback })}`)
}

function segment(name) {
  const item = manifest.segments?.[name]
  if (!item || item.status !== 'saved') throw new Error(`recording segment ${name} is unavailable`)
  return item
}

function mark(name, event) {
  const item = segment(name).marks?.find(value => value.event === event)
  if (!item) throw new Error(`missing recording mark ${name}:${event}`)
  return Number(item.at)
}

function window(name, startEvent, endEvent, before = 0, after = 0) {
  const start = Math.max(0, mark(name, startEvent) - before)
  const end = mark(name, endEvent) + after
  if (!(end > start + 0.15)) throw new Error(`invalid window ${name}:${startEvent}..${endEvent}`)
  return { segment: name, start: round(start), end: round(end) }
}

const windows = {
  walk: { segment: '01_walk', start: 1.4, end: 6.9 },
  vehicles: { segment: '02_vehicles', start: 1.9, end: 7.05 },
  impacts: { segment: '03_impacts', start: 2.25, end: 8.1 },
  social: { segment: '04_social', start: 1.45, end: 6.4 },
  pocket: { segment: '05_pocket', start: 4.25, end: 11.75 },
  agenda: {
    file: sources.fullRun,
    start: Math.max(0, fullRunMark('agenda_ready') - 0.2),
    end: fullRunMark('meeting_phase_research') + 0.12
  },
  research: {
    file: sources.fullRun,
    start: fullRunMark('meeting_phase_research'),
    end: fullRunMark('reference_done') + 1.8
  },
  direction: {
    file: sources.fullRun,
    start: fullRunMark('reference_done') + 1.4,
    end: fullRunMark('meeting_phase_concept') + 0.5
  },
  negotiate: {
    file: sources.fullRun,
    start: fullRunMark('meeting_phase_concept'),
    end: fullRunMark('meeting_phase_prd')
  },
  decisionDocs: {
    file: sources.fullRun,
    start: fullRunMark('meeting_phase_prd'),
    end: fullRunMark('build_started')
  },
  productionGate: {
    file: sources.fullRun,
    start: fullRunMark('build_started') - 0.5,
    end: fullRunMark('meeting_phase_impl') + 0.8
  },
  buildFinal: {
    file: sources.fullRun,
    start: fullRunMark('meeting_phase_impl'),
    end: fullRunMark('meeting_done') + 0.15
  },
  generatedIntro: {
    file: sources.fullRun,
    start: Math.max(0, fullRunMark('game_title') - 0.18),
    end: fullRunMark('game_first_input') + 2.1
  },
  generatedPlay: {
    file: sources.fullRun,
    start: fullRunMark('game_first_input') + 1.4,
    end: fullRunMark('gameplay_end') + 0.08
  },
  simStart: {
    file: sources.fullRun,
    start: fullRunMark('created_game_selected'),
    end: fullRunMark('progress_2') + 0.08
  },
  simWorld: {
    file: sources.fullRun,
    start: fullRunMark('world_view'),
    end: fullRunMark('live_panel') + 0.08
  },
  simLiveEarly: {
    file: sources.fullRun,
    start: fullRunMark('live_panel'),
    end: fullRunMark('progress_10') + 0.1
  },
  simLiveFinish: {
    file: sources.fullRun,
    start: fullRunMark('progress_10'),
    end: fullRunMark('progress_20') + 0.1
  },
  summarizing: {
    file: sources.fullRun,
    start: fullRunMark('progress_20') - 0.3,
    end: fullRunMark('report_done') + 0.45
  },
  reportOverview: {
    file: sources.fullRun,
    start: fullRunMark('report_overview'),
    end: fullRunMark('report_recommendations')
  },
  reportRecommendations: {
    file: sources.fullRun,
    start: fullRunMark('report_recommendations'),
    end: fullRunMark('persistent_feedback') + 0.1
  },
  persistentFeedback: {
    file: sources.fullRun,
    start: fullRunMark('persistent_feedback'),
    end: fullRunMark('scene_end')
  }
}

function focusMarkup(focus) {
  if (!focus) return ''
  const labelWidth = Math.max(132, Math.min(340, focus.label.length * 13 + 32))
  const labelY = Math.max(72, focus.y - 34)
  return `
    <g filter="url(#smallShadow)">
      <rect x="${focus.x}" y="${focus.y}" width="${focus.w}" height="${focus.h}" rx="14"
        fill="#7b65f4" fill-opacity=".07" stroke="#f6c85f" stroke-width="3" stroke-dasharray="9 6"/>
      <rect x="${focus.x}" y="${labelY}" width="${labelWidth}" height="28" rx="14" fill="#f6c85f"/>
      <text x="${focus.x + 16}" y="${labelY + 19}" fill="#17131f" font-size="13" font-weight="900">${xml(focus.label)}</text>
    </g>`
}

function captionSvg({ section, line1, line2, badge = '', focus = null }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="captionFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#080a10" stop-opacity="0"/>
      <stop offset=".34" stop-color="#080a10" stop-opacity=".56"/>
      <stop offset="1" stop-color="#080a10" stop-opacity=".94"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-30%" width="140%" height="180%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="5"/><feOffset dy="3" result="offset"/>
      <feColorMatrix in="offset" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .52 0"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="smallShadow" x="-20%" y="-30%" width="140%" height="180%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="3"/><feOffset dy="2" result="offset"/>
      <feColorMatrix in="offset" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .6 0"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g font-family="Apple SD Gothic Neo, Noto Sans KR, sans-serif">
    ${section ? `<g filter="url(#smallShadow)">
      <rect x="42" y="38" width="252" height="34" rx="17" fill="#0d0f17" fill-opacity=".8" stroke="#ffffff" stroke-opacity=".12"/>
      <circle cx="62" cy="55" r="6" fill="#83f0b2"/>
      <text x="78" y="60" fill="#ffffff" font-size="12" font-weight="850" letter-spacing="1.15">DOTCADE · ${xml(section)}</text>
    </g>` : ''}
    ${badge ? `<g filter="url(#smallShadow)"><rect x="1060" y="40" width="174" height="34" rx="17" fill="#7258ef" fill-opacity=".92"/><text x="1147" y="62" text-anchor="middle" fill="#ffffff" font-size="13" font-weight="850">${xml(badge)}</text></g>` : ''}
    ${focusMarkup(focus)}
    <rect x="0" y="532" width="1280" height="188" fill="url(#captionFade)"/>
    <g filter="url(#shadow)">
      <rect x="54" y="610" width="5" height="66" rx="2.5" fill="#83f0b2"/>
      <text x="78" y="636" fill="#ffffff" font-size="24" font-weight="850">${xml(line1)}</text>
      <text x="78" y="670" fill="#d6dae3" font-size="17" font-weight="620">${xml(line2)}</text>
    </g>
  </g>
</svg>`
}

function productionMilestoneSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <radialGradient id="spot"><stop stop-color="#7258ef" stop-opacity=".42"/><stop offset="1" stop-color="#0b0d14" stop-opacity="0"/></radialGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-opacity=".65"/></filter>
  </defs>
  <rect width="1280" height="720" fill="#080a10" fill-opacity=".52"/>
  <circle cx="640" cy="350" r="340" fill="url(#spot)"/>
  <g font-family="Apple SD Gothic Neo, Noto Sans KR, sans-serif" text-anchor="middle" filter="url(#shadow)">
    <rect x="528" y="250" width="224" height="34" rx="17" fill="#83f0b2"/>
    <text x="640" y="273" fill="#10131a" font-size="13" font-weight="900" letter-spacing="2">대표 승인 완료</text>
    <text x="640" y="362" fill="#ffffff" font-size="54" font-weight="950">본격 게임 제작 시작!</text>
    <text x="640" y="410" fill="#d8dce6" font-size="20" font-weight="650">기획과 설계를 실제 플레이 가능한 첫 빌드로 옮깁니다.</text>
    <path d="M540 464 H740" stroke="#83f0b2" stroke-width="4" stroke-linecap="round"/>
    <circle cx="540" cy="464" r="8" fill="#83f0b2"/><circle cx="640" cy="464" r="8" fill="#83f0b2"/><circle cx="740" cy="464" r="8" fill="#83f0b2"/>
  </g>
</svg>`
}

function titleSvg({ outro = false }) {
  const title = outro ? '만들기 → 플레이 → 평가 → 개선' : '기능이 보이는 AI 게임 스튜디오'
  const subtitle = outro
    ? '레퍼런스 근거와 실제 플레이 데이터가 다음 버전을 만듭니다.'
    : '한 줄 기획부터 자율 NPC·게임 제작·20-agent 실플레이까지'
  const cards = outro
    ? ['EVIDENCE', 'ITERATE', 'REPLAY']
    : ['BRIEF', 'REFERENCE', 'BUILD', 'PLAYTEST', 'IMPROVE']
  const startX = outro ? 302 : 108
  const cardWidth = outro ? 210 : 190
  const gap = outro ? 28 : 18
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#11131c"/><stop offset=".48" stop-color="#25213f"/><stop offset="1" stop-color="#123b37"/></linearGradient>
    <radialGradient id="g"><stop stop-color="#846cf6" stop-opacity=".52"/><stop offset="1" stop-color="#846cf6" stop-opacity="0"/></radialGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-opacity=".34"/></filter>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/><circle cx="1050" cy="90" r="430" fill="url(#g)"/>
  <g font-family="Apple SD Gothic Neo, Noto Sans KR, sans-serif">
    <g transform="translate(108 104)" filter="url(#shadow)">
      <rect width="74" height="74" rx="20" fill="#f8f8f3"/>
      <rect x="15" y="15" width="17" height="17" rx="5" fill="#7158ef"/><rect x="42" y="15" width="17" height="17" rx="5" fill="#f4b84f"/>
      <rect x="15" y="42" width="17" height="17" rx="5" fill="#72dfa0"/><rect x="42" y="42" width="17" height="17" rx="5" fill="#ea6685"/>
    </g>
    <text x="204" y="135" fill="#83f0b2" font-size="15" font-weight="900" letter-spacing="4">DOTCADE · FEATURE HIGHLIGHTS</text>
    <text x="108" y="284" fill="#ffffff" font-size="60" font-weight="950">${xml(title)}</text>
    <text x="112" y="338" fill="#d5d9e4" font-size="25" font-weight="650">${xml(subtitle)}</text>
    ${cards.map((card, index) => {
      const x = startX + index * (cardWidth + gap)
      const colors = ['#7258ef', '#3d8bf2', '#2bbd87', '#f4b84f', '#ea6685']
      const color = colors[index % colors.length]
      return `<g filter="url(#shadow)"><rect x="${x}" y="425" width="${cardWidth}" height="82" rx="18" fill="#11131c" fill-opacity=".9" stroke="${color}" stroke-width="2"/><circle cx="${x + 27}" cy="466" r="10" fill="${color}"/><text x="${x + 49}" y="472" fill="#ffffff" font-size="16" font-weight="900" letter-spacing=".8">${card}</text></g>`
    }).join('')}
    <text x="108" y="626" fill="#ffffff" fill-opacity=".42" font-family="ui-monospace, monospace" font-size="13" letter-spacing="2.2">AUTONOMOUS NPC · REFERENCE CONTRACT · MULTI-AGENT PLAYTEST</text>
  </g>
</svg>`
}

const overlays = {
  walk: captionSvg({ section: '대표의 하루', line1: '여기는 내가 운영하는 게임 회사, DOTCADE.', line2: '나는 이곳의 대표이자 우리 게임을 가장 먼저 플레이하는 사람입니다.' }),
  vehicles: captionSvg({ line1: '출근길이 꼭 얌전할 필요는 없습니다.', line2: '자전거든 킥보드든, 오늘은 마음 가는 대로 사무실을 돌아봅니다.' }),
  impacts: captionSvg({ line1: '바닥의 물건도 그냥 장식은 아닙니다.', line2: '책이나 쓰레기통을 던지면 맞은 팀원이 표정과 행동으로 바로 답합니다.' }),
  social: captionSvg({ line1: '조금 과했다면 직접 말을 걸어보는 편이 낫습니다.', line2: '팀원은 각자의 기분과 상황에 맞춰 이야기를 이어갑니다.' }),
  pocket: captionSvg({ section: '게임팩 한 판', line1: '대표라고 회의만 하는 건 아닙니다.', line2: '게임팩에서 하나를 골라 사무실 휴대기로 우리 게임을 직접 확인합니다.' }),
  agenda: captionSvg({ section: '새 게임 제작 회의', line1: '이제 새로운 게임을 만들 차례입니다.', line2: '별빛 정원에서 빛 조각을 모으고 운석을 피하는 게임을 제안합니다.' }),
  research: captionSvg({ badge: '레퍼런스 탐색 ×1.5', line1: '팀은 아이디어에서 검색어를 뽑아 여러 자료를 동시에 살펴봅니다.', line2: '우리 게임의 방향을 선명하게 만들 근거를 고르는 중입니다.' }),
  direction: captionSvg({ line1: '고른 레퍼런스는 제작 가능한 규칙으로 다시 해석됩니다.', line2: '필수 화면과 조작, 깊이와 피드백 기준을 정하고 방향을 선택합니다.' }),
  negotiate: captionSvg({ section: '멀티에이전트 회의', badge: '회의 요약 ×2', line1: '기획자와 디자이너, 개발자가 서로 다른 의견을 조율합니다.', line2: '무엇을 만들고 무엇을 포기할지 합의해 하나의 게임으로 좁혀갑니다.' }),
  decisionDocs: captionSvg({ line1: '팀의 선택은 기획서와 화면 설계, 개발 계획으로 정리됩니다.', line2: '대표는 구현 전에 목표와 범위, 위험 요소를 마지막으로 확인합니다.' }),
  build: captionSvg({ badge: '제작·검증 ×5', line1: '합의가 끝나자 구현과 실제 화면 검증이 이어집니다.', line2: '직접 플레이할 수 있는 빌드가 확인되어야 제작이 끝납니다.' }),
  gameIntro: captionSvg({ section: '첫 빌드', line1: `완성된 신작은 《${storyGame.title}》.`, line2: '파티와 도감을 갖춘, 별빛 정원의 2.5D 수집형 캐처입니다.' }),
  gamePlay: captionSvg({ line1: '대표인 내가 첫 번째 플레이어가 되어 손맛을 확인합니다.', line2: '방향키로 움직여 빛 조각은 모으고, 붉은 운석은 피하면 됩니다.' }),
  simStart: captionSvg({ section: '오락실 배포', badge: '배포 대기 ×4', line1: `이제 《${storyGame.title}》을 오락실에 배포합니다.`, line2: '대표 한 사람의 감상 대신 스무 명의 실제 플레이 기록으로 판단합니다.' }),
  simWorld: captionSvg({ line1: '플레이어들은 오락기와 휴대기를 찾아 스스로 이동합니다.', line2: '막혀도 다시 길을 찾고, 각자 선택한 자리에서 게임을 시작합니다.' }),
  simLive: captionSvg({ badge: 'AI 플레이 ×2', line1: '같은 게임도 플레이하는 방식은 모두 다릅니다.', line2: '누군가는 점수를 노리고, 누군가는 탐색하며, 누군가는 버그부터 찾아냅니다.' }),
  simFinish: captionSvg({ badge: '평가 완료까지 ×4', line1: '평가가 끝날 때까지 중단하지 않고 스무 명의 런을 모두 모읍니다.', line2: '동일한 게임의 입력·점수·오류와 행동 근거가 차례로 쌓입니다.' }),
  summarizing: captionSvg({ line1: '20명 전원의 플레이가 끝났습니다.', line2: '이제 실제 행동 기록을 모아 출시 판단에 필요한 리포트를 만듭니다.' }),
  reportOverview: captionSvg({ section: '운영 리포트', line1: `《${storyGame.title}》의 평가 결과는 평균 ${reportStats.avg}/10.`, line2: '재미·조작·균형·그래픽·몰입·독창성을 한눈에 비교합니다.' }),
  reportRecommendations: captionSvg({ line1: '강점과 약점, 다음 버전의 우선순위까지 실제 근거로 정리됩니다.', line2: '빈 화면으로 끝나지 않고 스무 명의 개별 한줄평도 모두 남습니다.' }),
  persistentFeedback: captionSvg({ line1: '피드백은 같은 게임팩에 저장되어 다음 업데이트로 이어집니다.', line2: '만들고, 배포하고, 운영하는 것—이게 DOTCADE 대표의 하루입니다.' })
}

await Promise.all([
  ['productionStart', productionMilestoneSvg()],
  ...Object.entries(overlays)
].map(async ([name, svg]) => {
  const svgFile = path.join(captionDir, `${name}.svg`)
  const pngFile = path.join(captionDir, `${name}.png`)
  await writeFile(svgFile, svg)
  await runTool(rsvg, ['-w', String(WIDTH), '-h', String(HEIGHT), svgFile, '-o', pngFile], 8 * 1024 * 1024)
}))

const clips = []
const editPlan = {
  schemaVersion: 4,
  title: 'DOTCADE 게임회사 대표의 하루',
  sourceManifest: manifestPath,
  continuousProductionRun: sources.fullRun,
  continuousProductionMarks: sources.fullRunMarks,
  game: storyGame,
  completedSimulation: reportStats,
  generatedAt: new Date().toISOString(),
  hardDurationLimitSeconds: 179,
  resolution: `${WIDTH}x${HEIGHT}`,
  fps: FPS,
  clips: []
}

const caption = name => path.join(captionDir, `${name}.png`)
const raw = name => path.join(rawDir, `${name}.webm`)

async function graphicClip(name, asset, duration) {
  const target = path.join(workDir, `${name}.mp4`)
  await runTool(ffmpeg, [
    '-y', '-loop', '1', '-framerate', String(FPS), '-i', caption(asset), '-t', String(duration),
    '-vf', `fade=t=in:st=0:d=0.35,fade=t=out:st=${round(duration - 0.35)}:d=0.35,format=yuv420p`,
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', target
  ])
  clips.push(target)
  editPlan.clips.push({ name, kind: 'graphic', asset, duration, output: target })
}

async function recordedClip(name, clipWindow, speed, asset) {
  const target = path.join(workDir, `${name}.mp4`)
  const duration = round((clipWindow.end - clipWindow.start) / speed)
  const filter = [
    `[0:v]trim=start=${clipWindow.start}:end=${clipWindow.end},setpts=(PTS-STARTPTS)/${speed},fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos,setsar=1[base]`,
    '[1:v]format=rgba[caption]',
    '[base][caption]overlay=0:0:shortest=1,format=yuv420p[out]'
  ].join(';')
  await runTool(ffmpeg, [
    '-y', '-i', clipWindow.file || raw(clipWindow.segment), '-loop', '1', '-framerate', String(FPS), '-i', caption(asset),
    '-filter_complex', filter, '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', target
  ])
  clips.push(target)
  editPlan.clips.push({
    name,
    kind: 'recorded',
    segment: clipWindow.segment || null,
    source: clipWindow.file || raw(clipWindow.segment),
    sourceStart: clipWindow.start,
    sourceEnd: clipWindow.end,
    sourceDuration: round(clipWindow.end - clipWindow.start),
    speed,
    duration,
    asset,
    output: target
  })
}

async function screenshotClip(name, source, duration, asset, mode = 'right') {
  const target = path.join(workDir, `${name}.mp4`)
  const frames = Math.ceil(duration * FPS)
  const zoomX = mode === 'right' ? 'iw-iw/zoom' : 'iw/2-iw/(2*zoom)'
  let baseFilter
  if (mode === 'fit') {
    baseFilter = [
      '[0:v]split=2[bg0][fg0]',
      `[bg0]scale=2560:1440:force_original_aspect_ratio=increase,crop=2560:1440,gblur=sigma=42,eq=brightness=-.34,zoompan=z='min(zoom+0.00028,1.045)':x='iw/2-iw/(2*zoom)':y='ih/2-ih/(2*zoom)':d=1:s=${WIDTH}x${HEIGHT}:fps=${FPS}[bg]`,
      '[fg0]scale=1000:650:force_original_aspect_ratio=decrease[fg]',
      '[bg][fg]overlay=(W-w)/2:(H-h)/2[scene]'
    ].join(';')
  } else {
    baseFilter = `[0:v]scale=2560:1440:flags=lanczos,zoompan=z='min(zoom+0.0004,1.075)':x='${zoomX}':y='ih/2-ih/(2*zoom)':d=1:s=${WIDTH}x${HEIGHT}:fps=${FPS}[scene]`
  }
  const filter = [
    baseFilter,
    `[scene]trim=end_frame=${frames},setpts=PTS-STARTPTS[base]`,
    '[1:v]format=rgba[caption]',
    '[base][caption]overlay=0:0:shortest=1,format=yuv420p[out]'
  ].join(';')
  await runTool(ffmpeg, [
    '-y', '-loop', '1', '-framerate', String(FPS), '-i', source,
    '-loop', '1', '-framerate', String(FPS), '-i', caption(asset),
    '-filter_complex', filter, '-map', '[out]', '-t', String(duration), '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', target
  ])
  clips.push(target)
  editPlan.clips.push({ name, kind: 'animated-screenshot', source, mode, duration, asset, output: target })
}

await recordedClip('clip00_walk', windows.walk, 1, 'walk')
await recordedClip('clip01_vehicles', windows.vehicles, 1, 'vehicles')
await recordedClip('clip02_impacts', windows.impacts, 1, 'impacts')
await recordedClip('clip03_social', windows.social, 1, 'social')
await recordedClip('clip04_pocket', windows.pocket, 1, 'pocket')
await recordedClip('clip05_agenda', windows.agenda, 1, 'agenda')
await recordedClip('clip06_research', windows.research, 1.5, 'research')
await recordedClip('clip07_direction', windows.direction, 1.25, 'direction')
await recordedClip('clip08_negotiate', windows.negotiate, 2, 'negotiate')
await recordedClip('clip09_decisions', windows.decisionDocs, 2, 'decisionDocs')
await recordedClip('clip10_production_start', windows.productionGate, 1, 'productionStart')
await recordedClip('clip11_build', windows.buildFinal, 5, 'build')
await recordedClip('clip12_game_intro', windows.generatedIntro, 1, 'gameIntro')
await recordedClip('clip13_gameplay', windows.generatedPlay, 1, 'gamePlay')
await recordedClip('clip14_sim_start', windows.simStart, 4, 'simStart')
await recordedClip('clip15_sim_world', windows.simWorld, 1, 'simWorld')
await recordedClip('clip16_sim_live', windows.simLiveEarly, 2, 'simLive')
await recordedClip('clip17_sim_finish', windows.simLiveFinish, 4, 'simFinish')
await recordedClip('clip18_summarizing', windows.summarizing, 1, 'summarizing')
await recordedClip('clip19_report_overview', windows.reportOverview, 1, 'reportOverview')
await recordedClip('clip20_report_recommendations', windows.reportRecommendations, 1, 'reportRecommendations')
await recordedClip('clip21_persistent_feedback', windows.persistentFeedback, 1, 'persistentFeedback')

editPlan.estimatedDuration = round(editPlan.clips.reduce((sum, clip) => sum + clip.duration, 0))
if (editPlan.estimatedDuration > editPlan.hardDurationLimitSeconds) {
  throw new Error(`estimated edit duration ${editPlan.estimatedDuration}s exceeds 3-minute limit`)
}
await writeFile(editPlanPath, `${JSON.stringify(editPlan, null, 2)}\n`)

const concatInputs = clips.flatMap(file => ['-i', file])
const normalize = clips.map((_, index) => `[${index}:v]setpts=PTS-STARTPTS,fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos,setsar=1[v${index}]`).join(';')
const chain = clips.map((_, index) => `[v${index}]`).join('')
await runTool(ffmpeg, [
  '-y', ...concatInputs,
  '-filter_complex', `${normalize};${chain}concat=n=${clips.length}:v=1:a=0,fade=t=out:st=${Math.max(0, editPlan.estimatedDuration - 0.7)}:d=0.7,format=yuv420p[out]`,
  '-map', '[out]', '-an', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
  '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output
], 96 * 1024 * 1024)

const { stdout } = await runTool(ffprobe, [
  '-v', 'error',
  '-show_entries', 'format=duration,size,bit_rate',
  '-show_entries', 'stream=codec_name,width,height,pix_fmt,avg_frame_rate',
  '-of', 'json', output
])
const probe = JSON.parse(stdout)
const duration = Number(probe.format?.duration)
const stream = probe.streams?.[0] || {}
if (!Number.isFinite(duration) || duration > 179) throw new Error(`final duration ${duration}s exceeds 3-minute limit`)
if (stream.codec_name !== 'h264' || stream.width !== WIDTH || stream.height !== HEIGHT || stream.pix_fmt !== 'yuv420p' || stream.avg_frame_rate !== '30/1') {
  throw new Error(`unexpected final format ${JSON.stringify(stream)}`)
}

await runTool(ffmpeg, ['-v', 'error', '-i', output, '-f', 'null', '-'], 32 * 1024 * 1024)
await runTool(ffmpeg, ['-y', '-ss', '1.7', '-i', output, '-frames:v', '1', '-vf', 'scale=1280:720:flags=lanczos', poster])
const interval = Math.max(1, duration / 12)
await runTool(ffmpeg, [
  '-y', '-i', output,
  '-vf', `fps=1/${interval},scale=320:180:flags=lanczos,tile=4x3:padding=5:margin=5:color=#0b0d14`,
  '-frames:v', '1', contactSheet
])

editPlan.output = output
editPlan.poster = poster
editPlan.contactSheet = contactSheet
editPlan.actualDuration = round(duration)
editPlan.probe = probe
editPlan.decodeVerified = true
await writeFile(editPlanPath, `${JSON.stringify(editPlan, null, 2)}\n`)

console.log(JSON.stringify({ output, poster, contactSheet, duration: round(duration), probe }, null, 2))
