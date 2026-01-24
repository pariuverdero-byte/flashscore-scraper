import fs from 'fs'

/* =========================
   Utils
========================= */

function normalizeTeam(str = '') {
  return str
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/fc|cf|sc|ac/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tfKickoffToIso(tfKickoff, dayOffset = 0) {
  // "01/24 19:00" → "YYYY-MM-DD HH:MM" + offset
  const base = new Date()
  base.setDate(base.getDate() + dayOffset)

  const year = base.getFullYear()
  const [md, time] = tfKickoff.split(' ')
  const [mm, dd] = md.split('/')

  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')} ${time}`
}

function toTs(dateStr) {
  return new Date(dateStr.replace(' ', 'T')).getTime()
}

function kickoffClose(a, b, minutes = 90) {
  return Math.abs(toTs(a) - toTs(b)) <= minutes * 60 * 1000
}

/* =========================
   Load data
========================= */

const talkfootball = JSON.parse(
  fs.readFileSync('artifacts/talkfootball_pool.json', 'utf8')
)

const flashscore = JSON.parse(
  fs.readFileSync('artifacts/flashscore_today.json', 'utf8')
)

/* =========================
   Matching with DAY_OFFSET fallback
========================= */

const matched = []
const dropped = []

const OFFSETS = [0, -1, 1]

for (const tf of talkfootball) {
  const tfHome = normalizeTeam(tf.home)
  const tfAway = normalizeTeam(tf.away)

  let found = null
  let usedOffset = null

  for (const offset of OFFSETS) {
    const tfKickoffIso = tfKickoffToIso(tf.kickoff, offset)

    const candidate = flashscore.find(fsEv => {
      const fsHome = normalizeTeam(fsEv.home)
      const fsAway = normalizeTeam(fsEv.away)

      if (tfHome !== fsHome) return false
      if (tfAway !== fsAway) return false
      if (!kickoffClose(tfKickoffIso, fsEv.kickoff)) return false

      return true
    })

    if (candidate) {
      found = candidate
      usedOffset = offset
      break
    }
  }

  if (found) {
    matched.push({
      ...tf,
      kickoff_iso: tfKickoffToIso(tf.kickoff, usedOffset),
      flashscore_id: found.id,
      flashscore_kickoff: found.kickoff,
      matched_day_offset: usedOffset,
      status: 'matched'
    })
  } else {
    dropped.push({
      ...tf,
      status: 'dropped_not_on_flashscore'
    })
  }
}

/* =========================
   Output
========================= */

fs.writeFileSync(
  'artifacts/talkfootball_matched.json',
  JSON.stringify(matched, null, 2)
)

fs.writeFileSync(
  'artifacts/talkfootball_dropped.json',
  JSON.stringify(dropped, null, 2)
)

console.log(`[matcher] matched: ${matched.length}`)
console.log(`[matcher] dropped: ${dropped.length}`)
