import fs from 'fs'
import * as cheerio from 'cheerio'

// FIX pt Node 20 + fetch
global.File = class File {}

const BASE_URL = 'https://www.flashscore.mobi/football/'

function normalizeKickoff(raw) {
  // format mobi: "24.01. 18:30"
  const year = new Date().getFullYear()
  const [dmy, time] = raw.split(' ')
  const [dd, mm] = dmy.split('.')
  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')} ${time}`
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  })
  return await res.text()
}

async function run() {
  const html = await fetchHtml(BASE_URL)
  const $ = cheerio.load(html)

  const events = []

  $('.event').each((_, el) => {
    const timeText = $(el).find('.time').text().trim()
    const home = $(el).find('.team-home').text().trim()
    const away = $(el).find('.team-away').text().trim()
    const link = $(el).find('a').attr('href')

    if (!timeText || !home || !away || !link) return
    if (!timeText.includes(':')) return // skip LIVE / FT

    const idMatch = link.match(/match\/([^/]+)/)
    if (!idMatch) return

    events.push({
      id: idMatch[1],
      home,
      away,
      kickoff: normalizeKickoff(timeText)
    })
  })

  fs.mkdirSync('artifacts', { recursive: true })
  fs.writeFileSync(
    'artifacts/flashscore_today.json',
    JSON.stringify(events, null, 2)
  )

  console.log(`[flashscore.mobi] events today: ${events.length}`)
}

run().catch(err => {
  console.error('[flashscore.mobi] failed', err)
  process.exit(1)
})
