import fs from 'fs'
import * as cheerio from 'cheerio'

const BASE = 'https://www.flashscore.mobi'
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0)
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'
const INCLUDE_LIVE = false

// --- helpers ---

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9'
    }
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
  return await r.text()
}

const absUrl = (href) => {
  try {
    return new URL(href, BASE).toString()
  } catch {
    return null
  }
}

function extractId(url = '') {
  const m =
    /\/match\/([^/?#]+)\//i.exec(url) ||
    /\/match\/([^/?#]+)\b/i.exec(url)
  return m ? m[1] : null
}

function normalizeTeams(raw = '') {
  // "PSV - NAC Breda"
  const parts = raw.split('-').map(s => s.trim())
  if (parts.length >= 2) {
    return { home: parts[0], away: parts.slice(1).join(' - ') }
  }
  return { home: raw.trim(), away: '' }
}

function kickoffToIso(timeTxt) {
  // timeTxt: "19:00"
  const today = new Date()
  const yyyy = today.getFullYear()
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${timeTxt}`
}

// --- parser ---

function parseList(html) {
  const $ = cheerio.load(html, { decodeEntities: false })
  const root = $('#score-data')
  const out = []

  if (!root.length) return out

  let compText = ''

  root.contents().each((_, node) => {
    // competition header
    if (node.type === 'tag' && node.name === 'h4') {
      compText = $(node).text().trim()
      return
    }

    // time marker
    if (node.type === 'tag' && node.name === 'span') {
      const timeTxt = $(node).text().trim()
      if (!/^\d{1,2}:\d{2}$/.test(timeTxt)) return

      let teamsText = ''
      let aEl = null
      let p = node.nextSibling

      while (p) {
        if (
          p.type === 'tag' &&
          p.name === 'a' &&
          /^\/match\//i.test($(p).attr('href') || '')
        ) {
          aEl = p
          break
        }
        if (p.type === 'text') {
          teamsText += String(p.data || '').trim()
        }
        p = p.nextSibling
      }

      teamsText = teamsText.replace(/\s+/g, ' ').trim()
      if (!teamsText || !aEl) return

      const href = $(aEl).attr('href')
      const url = absUrl(href)
      const id = extractId(url)
      if (!id) return

      const aClass = (($(aEl).attr('class') || '') + ' ').toLowerCase()
      const status = aClass.includes('live')
        ? 'live'
        : aClass.includes('fin')
        ? 'fin'
        : 'sched'

      if (!INCLUDE_LIVE && status !== 'sched') return

      const { home, away } = normalizeTeams(teamsText)

      out.push({
        id,
        home,
        away,
        league: compText,
        kickoff: kickoffToIso(timeTxt)
      })
    }
  })

  return out
}

// --- main ---

async function run() {
  const url = `${BASE}/?d=${DAY_OFFSET}&s=1`
  const html = await fetchText(url)

  const events = parseList(html)

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
