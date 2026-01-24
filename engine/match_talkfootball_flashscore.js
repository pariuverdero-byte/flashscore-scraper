import fs from 'fs'

/* =========================
   Utils
========================= */

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/fc|cf|sc|ac/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function toTimestamp(dateStr) {
  return new Date(dateStr.replace(' ', 'T')).getTime()
}

function kickoffClose(a, b, minutes = 30) {
  return Math.abs(toTimestamp(a) - toTimestamp(b)) <= minutes * 60 * 1000
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
   Matching
========================= */

const matched = []
const dropped = []

for (const tf of talkfootball) {
  const tfHome = normalize(tf.home)
  const tfAway = normalize(tf.away)

  const candidate = flashscore.find(fsEvent => {
    const fsHome = normalize(fsEvent.home)
    const fsAway = normalize(fsEvent.away)

    if (tfHome !== fsHome) return false
    if (tfAway !== fsAway) return false
    if (!kickoffClose(tf.kickoff, fsEvent.kickoff)) return false

    return true
  })

  if (candidate) {
    matched.push({
      ...tf,
      flashscore_id: candidate.id,
      flashscore_league: candidate.league,
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
