import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const run = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const rawDir = path.join(root, 'artifacts/video/raw')
const workDir = path.join(root, 'artifacts/video/work')
const captionDir = path.join(root, 'artifacts/video/captions')
const manifestPath = path.join(rawDir, 'recording-manifest.json')
const editPlanPath = path.join(workDir, 'edit-plan.json')
const output = path.join(root, 'artifacts/DOTCADE-feature-tour-ko.mp4')
const ffmpeg = process.env.FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg'
const ffprobe = process.env.FFPROBE_BIN || '/opt/homebrew/bin/ffprobe'
const rsvg = process.env.RSVG_BIN || '/opt/homebrew/bin/rsvg-convert'
const assembleRequested = process.env.DOTCADE_ASSEMBLE === '1'
const requiredSegments = [
  '01_walk',
  '02_vehicles',
  '03_impacts',
  '04_social',
  '05_pocket',
  '06_simulation',
  '07_meeting',
  '08_report'
]
const plannedMaxSeconds = 168

const round = value => Math.round(Number(value) * 1000) / 1000
const esc = value => String(value || '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

async function exists(file) {
  try {
    await access(file, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function preflight() {
  const tools = Object.fromEntries(await Promise.all([
    ['ffmpeg', ffmpeg], ['ffprobe', ffprobe], ['rsvg-convert', rsvg]
  ].map(async ([name, file]) => [name, { file, available: await exists(file) }])))
  const raw = Object.fromEntries(await Promise.all(requiredSegments.map(async name => [name, await exists(path.join(rawDir, `${name}.webm`))])))
  const report = {
    mode: assembleRequested ? 'assemble' : 'preflight-only',
    plannedMaxSeconds,
    hardDurationLimitSeconds: 179,
    resolution: '1280x720',
    fps: 30,
    manifestAvailable: await exists(manifestPath),
    raw,
    tools,
    output
  }
  console.log(`ASSEMBLY_PREFLIGHT ${JSON.stringify(report, null, 2)}`)
  if (Object.values(tools).some(tool => !tool.available)) throw new Error('assembly preflight failed: required video tool is missing')
  return report
}

await Promise.all([mkdir(workDir, { recursive: true }), mkdir(captionDir, { recursive: true })])
const preflightReport = await preflight()
if (!assembleRequested) {
  console.log('ASSEMBLY_SKIPPED Set DOTCADE_ASSEMBLE=1 only after all recording segments pass review.')
  process.exit(0)
}
if (!preflightReport.manifestAvailable || Object.values(preflightReport.raw).some(value => !value)) {
  throw new Error('assembly requires recording-manifest.json and all eight raw segments')
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.schemaVersion !== 2) throw new Error(`unsupported recording manifest schema: ${manifest.schemaVersion}`)

function segment(name) {
  const value = manifest.segments?.[name]
  if (!value || value.status !== 'saved') throw new Error(`segment ${name} is missing or did not finish cleanly`)
  return value
}

function markTime(name, event) {
  const hit = segment(name).marks?.find(mark => mark.event === event)
  if (!hit) throw new Error(`missing mark ${name}:${event}`)
  return Number(hit.at)
}

function terminalTime(name) {
  const hit = segment(name).marks?.find(mark => mark.event === 'terminal_done')
  if (!hit) throw new Error(`missing successful terminal mark for ${name}`)
  return Number(hit.at)
}

function markedWindow(name, startEvent, endEvent, padBefore = 0, padAfter = 0) {
  const start = Math.max(0, markTime(name, startEvent) - padBefore)
  const end = markTime(name, endEvent) + padAfter
  if (!(end > start + .15)) throw new Error(`invalid marked window ${name}:${startEvent}..${endEvent}`)
  return { segment: name, start: round(start), end: round(end) }
}

function phaseWindow(startEvent, endEvent) {
  const start = markTime('07_meeting', startEvent)
  const end = endEvent === 'terminal_done' ? terminalTime('07_meeting') : markTime('07_meeting', endEvent)
  if (!(end > start + .15)) throw new Error(`invalid meeting phase window ${startEvent}..${endEvent}`)
  return { segment: '07_meeting', start: round(start), end: round(end) }
}

function fitSpeed(window, baseSpeed, maxFinalSeconds) {
  const duration = window.end - window.start
  return round(Math.max(baseSpeed, duration / maxFinalSeconds))
}

const windows = {
  walk: markedWindow('01_walk', 'scene_start', 'scene_end', .45, .5),
  vehicles: markedWindow('02_vehicles', 'scene_start', 'scene_end', .45, .55),
  impacts: markedWindow('03_impacts', 'scene_start', 'scene_end', .4, .55),
  social: markedWindow('04_social', 'scene_start', 'scene_end', .45, .55),
  pocket: markedWindow('05_pocket', 'scene_start', 'scene_end', .4, .45),
  simStart: markedWindow('06_simulation', 'run_start', 'world_view', .35, .1),
  simWorld: markedWindow('06_simulation', 'world_view', 'world_end', 0, .15),
  simLive: markedWindow('06_simulation', 'live_panel', 'live_evidence', .1, .25),
  agenda: {
    segment: '07_meeting',
    start: round(Math.max(0, markTime('07_meeting', 'agenda_ready') - 1.15)),
    end: round(markTime('07_meeting', 'phase_research'))
  },
  research: phaseWindow('phase_research', 'phase_concept'),
  negotiate: phaseWindow('phase_concept', 'phase_prd'),
  documents: phaseWindow('phase_prd', 'phase_review'),
  implementation: phaseWindow('phase_review', 'phase_qa'),
  qa: phaseWindow('phase_qa', 'terminal_done'),
  generated: markedWindow('07_meeting', 'generated_game_start', 'generated_game_end', .25, .4),
  report: markedWindow('08_report', 'scene_start', 'scene_end', .25, .35)
}

const speeds = {
  // Mock/live backends can differ dramatically in wall-clock time. Preserve at
  // least two readable seconds per caption when phases are already short, while
  // still fitting an unexpectedly long live run into the fixed final budget.
  research: fitSpeed(windows.research, 1, 4),
  negotiate: fitSpeed(windows.negotiate, 3, 6),
  documents: fitSpeed(windows.documents, 1.5, 6),
  implementation: fitSpeed(windows.implementation, 1.5, 5),
  qa: fitSpeed(windows.qa, 3, 5)
}

const badge = speed => speed <= 1.05 ? '실시간' : `×${Number.isInteger(speed) ? speed : speed.toFixed(1)} 배속`

function captionSvg({ kicker, line1, line2 = '', badge: badgeText = '' }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <filter id="shadow" x="-20%" y="-30%" width="140%" height="170%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="8"/><feOffset dy="5" result="o"/>
      <feColorMatrix in="o" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .4 0"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <rect x="64" y="604" width="1152" height="94" rx="20" fill="#11131c" fill-opacity=".91" stroke="#ffffff" stroke-opacity=".16"/>
    <rect x="82" y="620" width="6" height="60" rx="3" fill="#83f0b2"/>
    <text x="108" y="633" fill="#83f0b2" font-family="Apple SD Gothic Neo, sans-serif" font-size="12" font-weight="800" letter-spacing="1.8">${esc(kicker)}</text>
    <text x="108" y="660" fill="#ffffff" font-family="Apple SD Gothic Neo, sans-serif" font-size="22" font-weight="800">${esc(line1)}</text>
    ${line2 ? `<text x="108" y="683" fill="#c7cbd7" font-family="Apple SD Gothic Neo, sans-serif" font-size="15" font-weight="600">${esc(line2)}</text>` : ''}
  </g>
  ${badgeText ? `<g filter="url(#shadow)"><rect x="1050" y="84" width="156" height="48" rx="24" fill="#7258ef"/><text x="1128" y="115" text-anchor="middle" fill="#ffffff" font-family="Apple SD Gothic Neo, sans-serif" font-size="19" font-weight="900">${esc(badgeText)}</text></g>` : ''}
</svg>`
}

function titleSvg({ eyebrow, title, subtitle, footer }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#151622"/><stop offset=".52" stop-color="#24203e"/><stop offset="1" stop-color="#123c37"/></linearGradient>
    <radialGradient id="glow"><stop stop-color="#7e63f5" stop-opacity=".5"/><stop offset="1" stop-color="#7e63f5" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <circle cx="1000" cy="90" r="410" fill="url(#glow)"/>
  <g transform="translate(118 174)">
    <rect width="82" height="82" rx="22" fill="#f8f8f3"/>
    <rect x="18" y="18" width="18" height="18" rx="5" fill="#7158ef"/><rect x="46" y="18" width="18" height="18" rx="5" fill="#f4b84f"/>
    <rect x="18" y="46" width="18" height="18" rx="5" fill="#72dfa0"/><rect x="46" y="46" width="18" height="18" rx="5" fill="#ea6685"/>
  </g>
  <text x="226" y="214" fill="#8cf0b6" font-family="Apple SD Gothic Neo, sans-serif" font-size="15" font-weight="800" letter-spacing="4">${esc(eyebrow)}</text>
  <text x="118" y="342" fill="#ffffff" font-family="Apple SD Gothic Neo, sans-serif" font-size="72" font-weight="900">${esc(title)}</text>
  <text x="122" y="400" fill="#d3d7e1" font-family="Apple SD Gothic Neo, sans-serif" font-size="27" font-weight="650">${esc(subtitle)}</text>
  <rect x="118" y="476" width="780" height="2" fill="#ffffff" fill-opacity=".18"/>
  <text x="122" y="526" fill="#aeb5c5" font-family="Apple SD Gothic Neo, sans-serif" font-size="18" font-weight="600">${esc(footer)}</text>
  <text x="118" y="642" fill="#ffffff" fill-opacity=".38" font-family="ui-monospace, monospace" font-size="13" letter-spacing="2">DOTCADE · MULTI-AGENT GAME STUDIO</text>
</svg>`
}

const assets = {
  intro: titleSvg({
    eyebrow: 'DOTCADE FEATURE TOUR',
    title: 'AI가 만들고, 플레이하고, 평가한다',
    subtitle: '자율 NPC 기반 멀티에이전트 게임 스튜디오',
    footer: '자연 보행 · 오피스 자유도 · 실제 AI 플레이테스트 · 자동 게임 제작'
  }),
  walk: captionSvg({
    kicker: 'NATURAL 3-FRAME GAIT',
    line1: '이동 거리와 발 접지를 맞춘 방향별 3프레임 보행',
    line2: '플레이어와 자율 NPC 모두 미끄러짐 없이 같은 보행 규칙을 사용합니다.'
  }),
  vehicles: captionSvg({
    kicker: 'RIDEABLE OFFICE',
    line1: '자전거와 킥보드에 직접 탑승해 더 빠르게 이동',
    line2: '승하차 전환 · 자전거 페달 · 킥보드 푸시 모션이 각각 다르게 이어집니다.'
  }),
  impacts: captionSvg({
    kicker: 'PHYSICS + EMOTIONAL REACTION',
    line1: '책·쓰레기통 투척에 회피·넉백·스턴과 표정으로 반응',
    line2: '역할과 성격에 따라 대사, 감정, 후속 행동까지 달라집니다.'
  }),
  social: captionSvg({
    kicker: 'ACTIVE SOCIAL NPC',
    line1: 'NPC가 대화를 목표로 선택하고 2~3턴 동안 서로 반응',
    line2: '대화가 끝나면 잠금을 해제하고 각자의 다음 목표로 돌아갑니다.'
  }),
  pocket: captionSvg({
    kicker: 'DOTCADE POCKET',
    line1: '팀원도 휴대기로 놀고, 플레이어도 게임팩을 바로 실행',
    line2: '오락실과 동일한 실제 게임 런을 휴대기 UI에 연결합니다.'
  }),
  simStart: captionSvg({
    kicker: 'AI PLAYTEST LEAGUE',
    line1: '20명의 AI 평가자가 캐비닛·POCKET으로 자율 이동',
    line2: '12 CABINET + 8 POCKET, 동일 게임을 서로 다른 환경에서 실행합니다.'
  }),
  simWorld: captionSvg({
    kicker: 'BOUNDED AUTONOMOUS PLANNING',
    line1: '목표 선택 → 경로 계획 → 이동 → 도착 증거',
    line2: '막히면 제한된 횟수만 재계획해 무한 루프를 피합니다.'
  }),
  simLive: captionSvg({
    kicker: 'REAL AI GAME RUN',
    line1: '5가지 전략이 실제 입력으로 플레이하고 LIVE 텔레메트리 생성',
    line2: 'Explorer · Score Hunter · Survivor · Bug Breaker · Learner'
  }),
  agenda: captionSvg({
    kicker: 'ONE-LINE GAME BRIEF',
    line1: '복잡한 설정 없이 한 줄 안건으로 실제 게임 제작 시작',
    line2: '팀을 소집하면 리서치부터 구현·QA·릴리즈까지 연결됩니다.'
  }),
  research: captionSvg({
    kicker: 'WEB SEARCH + RAG',
    line1: '웹검색과 RAG로 주요 기술·기존 자료를 먼저 수집',
    line2: '팀원별 관점으로 조사하고 핵심 기술 키워드를 추출합니다.',
    badge: badge(speeds.research)
  }),
  negotiate: captionSvg({
    kicker: 'MULTI-AGENT NEGOTIATION',
    line1: '기획·디자인·개발 에이전트가 방향과 우선순위를 협상',
    line2: '오래 걸리는 실제 토론은 전 과정을 유지한 채 배속합니다.',
    badge: badge(speeds.negotiate)
  }),
  documents: captionSvg({
    kicker: 'DECISION → SPEC',
    line1: '합의된 방향을 PRD·UX·아키텍처로 구체화',
    line2: '선택한 KPI와 제약이 모든 제작 문서에 일관되게 반영됩니다.',
    badge: badge(speeds.documents)
  }),
  implementation: captionSvg({
    kicker: 'IMPLEMENTATION STREAM',
    line1: '팀장 승인 뒤 코드 생성과 실행 검증을 진행',
    line2: '실제 구현 로그와 단계 전환을 유지하면서 대기 시간만 압축합니다.',
    badge: badge(speeds.implementation)
  }),
  qa: captionSvg({
    kicker: 'QA → RELEASE',
    line1: '문법·런타임·봇 플레이 스모크 테스트 뒤 릴리즈',
    line2: '실행 가능한 결과가 확인되어야 새 게임팩으로 등록됩니다.',
    badge: badge(speeds.qa)
  }),
  generated: captionSvg({
    kicker: 'PLAYABLE RESULT',
    line1: '회의 결과는 문서가 아니라 즉시 플레이 가능한 게임',
    line2: '생성된 게임팩을 같은 화면에서 직접 조작해 검증합니다.'
  }),
  report: captionSvg({
    kicker: 'EVIDENCE-BASED EVALUATION',
    line1: '실플레이 기록과 6축 평가를 종합해 개선점을 도출',
    line2: '전략별 행동·오류·점수·제안이 다음 업그레이드 회의로 이어집니다.'
  }),
  outro: titleSvg({
    eyebrow: 'THE CORE LOOP',
    title: '만들기 → 플레이 → 평가 → 개선',
    subtitle: 'AI 게임 스튜디오, DOTCADE',
    footer: 'Autonomous NPC · Multi-Agent Production · Synthetic Red-Team Playtest'
  })
}

for (const [name, svg] of Object.entries(assets)) {
  const svgPath = path.join(captionDir, `${name}.svg`)
  const pngPath = path.join(captionDir, `${name}.png`)
  await writeFile(svgPath, svg)
  await run(rsvg, ['-w', '1280', '-h', '720', svgPath, '-o', pngPath])
}

const raw = name => path.join(rawDir, `${name}.webm`)
const cap = name => path.join(captionDir, `${name}.png`)
const clips = []
const editPlan = {
  schemaVersion: 2,
  sourceManifest: manifestPath,
  plannedMaxSeconds,
  hardDurationLimitSeconds: 179,
  generatedAt: new Date().toISOString(),
  clips: []
}

async function stillClip(name, asset, duration) {
  const target = path.join(workDir, `${name}.mp4`)
  await run(ffmpeg, [
    '-y', '-loop', '1', '-framerate', '30', '-i', cap(asset), '-t', String(duration),
    '-vf', `fade=t=in:st=0:d=0.45,fade=t=out:st=${Math.max(0, duration - 0.55)}:d=0.55,format=yuv420p`,
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', target
  ], { maxBuffer: 20 * 1024 * 1024 })
  clips.push(target)
  editPlan.clips.push({ name, kind: 'still', asset, duration, output: target })
}

async function videoClip(name, window, speed, asset) {
  const target = path.join(workDir, `${name}.mp4`)
  const filter = `[0:v]trim=start=${window.start}:end=${window.end},setpts=(PTS-STARTPTS)/${speed},fps=30,scale=1280:720:flags=lanczos,setsar=1[base];[1:v]format=rgba[caption];[base][caption]overlay=0:0:shortest=1,format=yuv420p[out]`
  await run(ffmpeg, [
    '-y', '-i', raw(window.segment), '-loop', '1', '-framerate', '30', '-i', cap(asset),
    '-filter_complex', filter, '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', target
  ], { maxBuffer: 40 * 1024 * 1024 })
  clips.push(target)
  editPlan.clips.push({
    name,
    kind: 'video',
    segment: window.segment,
    sourceStart: window.start,
    sourceEnd: window.end,
    sourceDuration: round(window.end - window.start),
    speed,
    finalDuration: round((window.end - window.start) / speed),
    asset,
    output: target
  })
}

await stillClip('clip00_intro', 'intro', 5)
await videoClip('clip01_walk', windows.walk, 1, 'walk')
await videoClip('clip02_vehicles', windows.vehicles, 1, 'vehicles')
await videoClip('clip03_impacts', windows.impacts, 1, 'impacts')
await videoClip('clip04_social', windows.social, 1, 'social')
await videoClip('clip05_pocket', windows.pocket, 1, 'pocket')
await videoClip('clip06_sim_start', windows.simStart, 1, 'simStart')
await videoClip('clip07_sim_world', windows.simWorld, 1, 'simWorld')
await videoClip('clip08_sim_live', windows.simLive, 1, 'simLive')
await videoClip('clip09_agenda', windows.agenda, 1, 'agenda')
await videoClip('clip10_research', windows.research, speeds.research, 'research')
await videoClip('clip11_negotiate', windows.negotiate, speeds.negotiate, 'negotiate')
await videoClip('clip12_documents', windows.documents, speeds.documents, 'documents')
await videoClip('clip13_implementation', windows.implementation, speeds.implementation, 'implementation')
await videoClip('clip14_qa', windows.qa, speeds.qa, 'qa')
await videoClip('clip15_generated', windows.generated, 1, 'generated')
await videoClip('clip16_report', windows.report, 1, 'report')
await stillClip('clip17_outro', 'outro', 6)

editPlan.estimatedDuration = round(editPlan.clips.reduce((sum, clip) => sum + (clip.finalDuration ?? clip.duration ?? 0), 0))
if (editPlan.estimatedDuration > plannedMaxSeconds) {
  throw new Error(`edit plan is ${editPlan.estimatedDuration}s; expected at most ${plannedMaxSeconds}s`)
}
await writeFile(editPlanPath, `${JSON.stringify(editPlan, null, 2)}\n`)

const concatInputs = clips.flatMap(clip => ['-i', clip])
const prep = clips.map((_, index) => `[${index}:v]setpts=PTS-STARTPTS[v${index}]`).join(';')
const joined = clips.map((_, index) => `[v${index}]`).join('')
const filter = `${prep};${joined}concat=n=${clips.length}:v=1:a=0,format=yuv420p[out]`
await run(ffmpeg, [
  '-y', ...concatInputs, '-filter_complex', filter, '-map', '[out]', '-an',
  '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
  '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output
], { maxBuffer: 60 * 1024 * 1024 })

const { stdout } = await run(ffprobe, [
  '-v', 'error', '-show_entries', 'format=duration,size,bit_rate',
  '-show_entries', 'stream=codec_name,width,height,pix_fmt,avg_frame_rate', '-of', 'json', output
])
const probe = JSON.parse(stdout)
const duration = Number(probe.format?.duration)
const stream = probe.streams?.[0] || {}
if (!Number.isFinite(duration) || duration > 179) throw new Error(`assembled duration ${duration}s exceeds the 3-minute limit`)
if (stream.width !== 1280 || stream.height !== 720 || stream.pix_fmt !== 'yuv420p') {
  throw new Error(`unexpected output format: ${stream.width}x${stream.height} ${stream.pix_fmt}`)
}

editPlan.output = output
editPlan.probe = probe
editPlan.actualDuration = round(duration)
await writeFile(editPlanPath, `${JSON.stringify(editPlan, null, 2)}\n`)
console.log(JSON.stringify(probe, null, 2))
console.log(`ASSEMBLY_COMPLETE ${output}`)
