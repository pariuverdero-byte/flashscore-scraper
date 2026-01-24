import fs from 'fs'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://talkfootball.co.uk'

const SOURCES = [
  { market: '1X2', path: '/predictions/fulltime-1X2/' },
  { market: 'BTTS', path: '/predictions/btts/' },
  { market: 'OVER_1_5', path: '/predictions/match-goals-over-1.5/' }
]

const MAJOR_LEAGUES = [
  'Premier League',
  'Championship',
  'La Liga',
  'Serie A',
  'Serie B',
  'Bundesliga',
  'Ligue 1',
  'Eredivisie',
  'Primeira Liga',
  'MLS',
  'Brasileirao',
  'Liga Profesional',
  'Super Lig'
]

const MAX_PER_MARKET = 3

function normalizePick(market, raw) {
  const txt = raw.toLowerCase()

  if (market === '1X2') {
    if (txt.includes('1x')) return '1X'
    if (txt.includes('2x')) return '2X'
    if (txt.startsWith('1')) return '1'
    if (txt.startsWith('2')) return '2'
    if (txt.startsWith('x')) return 'X'
  }

  if (market === 'BTTS') {
    if (txt.includes('yes')) return 'BTTS_YES'
    if (txt.includes('no')) return 'BTTS_NO'
  }

  if (market === 'OVER_1_5') return 'OVER_1_5'

  return null
}

async function fetchHtml(path) {
  const res = await fetch(BASE_URL + path)
  return await res.text()
}

async function scrapeMarket({ market, path }) {
  const html = await fetchHtml(path)
  const $ = cheerio.load(html)

  const selected = []
  const usedLeagues = new Set()

  $('table.predictions-table tbody tr[itemtype]').each((_, row) => {
    if (selected.length >= MAX_PER_MARKET) return

    const matchText = $(row).find('td:nth-child(2)').text().trim()
    const league = $(row).find('.league').text().trim()
    const confidence = $(row).find('td:nth-last-child(2)').text().trim()
    const predictionRaw = $(row).find('td:last-child strong').text().trim()

    if (!matchText || !league || confidence !== '100%') return
    if (!MAJOR_LEAGUES.includes(league)) return
    if (usedLeagues.has(league)) return

    const [home, away] = matchText.split(' - ').map(t => t.trim())
    const pick = normalizePick(market, predictionRaw)
    if (!pick) return

    const date = $(row).find('.date').text().trim()
    const time = $(row).find('.time').text().trim()

    selected.push({
      source: 'talkfootball',
      market,
      match: matchText,
      home,
      away,
      league,
      kickoff: `${date} ${time}`,
      pick,
      confidence: 100
    })

    usedLeagues.add(league)
  })

  return selected
}

async function run() {
  const pool = []

  for (const source of SOURCES) {
    const events = await scrapeMarket(source)
    pool.push(...events)
    console.log(`[talkfootball] ${source.market}: ${events.length}`)
  }

  fs.mkdirSync('artifacts', { recursive: true })
  fs.writeFileSync('artifacts/talkfootball_pool.json', JSON.stringify(pool, null, 2))

  console.log(`[talkfootball] total: ${pool.length}`)
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
