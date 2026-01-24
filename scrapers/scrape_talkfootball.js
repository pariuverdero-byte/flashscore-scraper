// FIX pentru Node + fetch / undici
global.File = class File {}

import fs from 'fs'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://talkfootball.co.uk'

/* =========================
   CONFIG
========================= */

// target total BEFORE Flashscore
const TARGET_POOL_SIZE = 25

const MAX_PER_MARKET = 10
const MAX_PER_LEAGUE = 3
const MIN_CONFIDENCE = 85

const SOURCES = [
  { market: '1X2', path: '/predictions/fulltime-1X2/' },
  { market: 'BTTS', path: '/predictions/btts/' },
  { market: 'OVER_1_5', path: '/predictions/match-goals-over-1.5/' }
]

// Tier 1 – elite
const TIER_1 = [
  'Premier League',
  'La Liga',
  'Serie A',
  'Bundesliga',
  'Ligue 1',
  'Eredivisie'
]

// Tier 2 – solide
const TIER_2 = [
  'Championship',
  'Serie B',
  '2. Bundesliga',
  'Ligue 2',
  'Primeira Liga',
  'Super Lig',
  'Belgium Pro League',
  'Austria Bundesliga',
  'Scotland Premiership',
  'Swiss Super League',
  'MLS',
  'Brasileirao'
]

// Tier 3 – obscure / value hunting
// ⚠️ aici intră tot ce NU e Tier 1 / Tier 2
const ALLOW_OBSCURE = true

/* =========================
   UTILS
========================= */

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

function leagueTier(league) {
  if (TIER_1.includes(league)) return 1
  if (TIER_2.includes(league)) return 2
  return 3
}

/* =========================
   SCRAPE ONE MARKET
========================= */

async function scrapeMarket({ market, path }) {
  const html = await fetchHtml(path)
  const $ = cheerio.load(html)

  const candidates = []

  $('table.predictions-table tbody tr[itemtype]').each((_, row) => {
    const matchText = $(row).find('td:nth-child(2)').text().trim()
    const league = $(row).find('.league').text().trim()
    const confidenceText = $(row).find('td:nth-last-child(2)').text().trim()
    const predictionRaw = $(row).find('td:last-child strong').text().trim()

    if (!matchText || !league) return

    const confidence = parseInt(confidenceText)
    if (isNaN(confidence) || confidence < MIN_CONFIDENCE) return

    const tier = leagueTier(league)
    if (tier === 3 && !ALLOW_OBSCURE) return

    const pick = normalizePick(market, predictionRaw)
    if (!pick) return

    const [home, away] = matchText.split('-').map(t => t.trim())
    const date = $(row).find('.date').text().trim()
    const time = $(row).find('.time').text().trim()

    candidates.push({
      source: 'talkfootball',
      market,
      match: `${home} - ${away}`,
      home,
      away,
      league,
      league_tier: tier,
      kickoff: `${date} ${time}`,
      pick,
      confidence
    })
  })

  // sort: Tier 1 → Tier 2 → Tier 3, confidence desc
  candidates.sort((a, b) => {
    if (a.league_tier !== b.league_tier) {
      return a.league_tier - b.league_tier
    }
    return b.confidence - a.confidence
  })

  const selected = []

  for (const c of candidates) {
    if (selected.length >= MAX_PER_MARKET) break

    const leagueCount = selected.filter(e => e.league === c.league).length
    if (leagueCount >= MAX_PER_LEAGUE) continue

    selected.push(c)
  }

  return selected
}

/* =========================
   MAIN
========================= */

async function run() {
  const pool = []

  for (const source of SOURCES) {
    const events = await scrapeMarket(source)
    pool.push(...events)
    console.log(`[talkfootball] ${source.market}: ${events.length}`)
  }

  // dacă nu am atins targetul, NU mai filtrăm nimic suplimentar
  // Flashscore + matcher vor decide
  const finalPool = pool.slice(0, TARGET_POOL_SIZE)

  fs.mkdirSync('artifacts', { recursive: true })
  fs.writeFileSync(
    'artifacts/talkfootball_pool.json',
    JSON.stringify(finalPool, null, 2)
  )

  console.log(`[talkfootball] total pool before flashscore: ${finalPool.length}`)
}

run().catch(err => {
  console.error('[talkfootball] scrape failed', err)
  process.exit(1)
})
