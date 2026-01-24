import fs from 'fs'
import * as cheerio from 'cheerio'

// Fix pentru Node 20 + undici
global.File = class File {}

const URL = 'https://www.flashscore.mobi/?sport=soccer'

function normalizeKickoff(raw) {
  // format: "24.01. 19:00"
  const year = new Date().getFullYear()
  const [dmy, time] = raw.split(' ')
  const [dd, mm] = dmy.split('.')
  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')} ${time}`
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  })
  return await res.text()
}

async function run() {
  const html = await fetchHtml(URL)
  const $ = cheerio.load(html)

  const events = []

  $('a.match-link').each((_, el) => {
    const timeText = $(el).find('.match-time').text().trim()
    const home = $(el).find('.match-home').text().trim()
    const away = $(el).find('.match-away').text().trim()
    const href = $(el).attr('href')

    if (!timeText || !home || !away || !href) return
    if (!timeText.includes(':')) return // skip LIVE / FT

    const idMatch = href.match(/match\/([^/]+)/)
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
