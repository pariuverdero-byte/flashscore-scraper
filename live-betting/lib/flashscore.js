import * as cheerio from 'cheerio';
import { safeNumber, splitTeams } from './utils.js';

const BASE = 'https://www.flashscore.mobi';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

export async function fetchText(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9,ro;q=0.8',
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function absoluteUrl(href = '') {
  try { return new URL(href, BASE).toString(); } catch { return null; }
}

function extractId(url = '') {
  const match = /\/match\/([^/?#]+)/i.exec(url);
  return match ? match[1] : null;
}

function parseCompetition(raw = '') {
  const clean = raw.replace(/\bStandings\b/i, '').replace(/\s+».*$/, '').trim();
  const parts = clean.split(':');
  if (parts.length < 2) return { country: '', competition: clean };
  return { country: parts.shift().trim(), competition: parts.join(':').trim() };
}

function parseStatus(anchorClass = '', text = '') {
  const cls = anchorClass.toLowerCase();
  const value = text.trim().toLowerCase();
  if (cls.includes('live') || /\d{1,3}'|half|break|pen\.?/i.test(value)) return 'live';
  if (cls.includes('fin') || /finished|after penalties|aet/i.test(value)) return 'finished';
  return 'scheduled';
}

export function parseScoreList(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const root = $('#score-data');
  const matches = [];
  let competitionHeader = '';

  root.contents().each((_, node) => {
    if (node.type === 'tag' && node.name === 'h4') {
      competitionHeader = $(node).text().trim();
      return;
    }
    if (node.type !== 'tag' || node.name !== 'span') return;

    const marker = $(node).text().replace(/\s+/g, ' ').trim();
    let teamsText = '';
    let anchor = null;
    let cursor = node.nextSibling;
    while (cursor) {
      if (cursor.type === 'tag' && cursor.name === 'a' && /^\/match\//i.test($(cursor).attr('href') || '')) {
        anchor = cursor;
        break;
      }
      if (cursor.type === 'text') teamsText += ` ${String(cursor.data || '')}`;
      cursor = cursor.nextSibling;
    }
    if (!anchor) return;

    const href = $(anchor).attr('href') || '';
    const url = absoluteUrl(href);
    const id = extractId(url);
    teamsText = teamsText.replace(/\s+/g, ' ').replace(/^[-–\s]+|[-–\s]+$/g, '').trim();
    if (!id || !teamsText) return;

    const status = parseStatus($(anchor).attr('class') || '', marker);
    const { country, competition } = parseCompetition(competitionHeader);
    const { home, away } = splitTeams(teamsText);

    matches.push({
      id,
      url,
      home,
      away,
      teams: `${home} – ${away}`,
      country,
      competition,
      status,
      marker,
    });
  });
  return matches;
}

function emptyStats() {
  return {
    xg: 0,
    shots: 0,
    shotsOnTarget: 0,
    shotsOffTarget: 0,
    blockedShots: 0,
    bigChances: 0,
    shotsInBox: 0,
    boxTouches: 0,
    corners: 0,
    possession: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    attacks: 0,
    dangerousAttacks: 0,
  };
}

function applyStat(target, label, value) {
  const map = [
    [/expected goals|xg$/i, 'xg'],
    [/total shots|shots total/i, 'shots'],
    [/shots on target/i, 'shotsOnTarget'],
    [/shots off target/i, 'shotsOffTarget'],
    [/blocked shots/i, 'blockedShots'],
    [/big chances/i, 'bigChances'],
    [/shots inside the box/i, 'shotsInBox'],
    [/touches in opposition box/i, 'boxTouches'],
    [/corner kicks|corners/i, 'corners'],
    [/ball possession|possession/i, 'possession'],
    [/^fouls$/i, 'fouls'],
    [/yellow cards/i, 'yellowCards'],
    [/red cards/i, 'redCards'],
    [/^attacks$/i, 'attacks'],
    [/dangerous attacks/i, 'dangerousAttacks'],
  ];
  for (const [pattern, key] of map) {
    if (pattern.test(label)) {
      target[key] = safeNumber(value);
      break;
    }
  }
}

export function parseMatchPage(html, fallback = {}) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const pageText = $('body').text().replace(/\s+/g, ' ');
  const minuteCandidates = [
    $('span.mstat').first().text(),
    $('.mstat').first().text(),
    $('.detailScore__status').first().text(),
  ].filter(Boolean).join(' ');
  const minuteMatch = /(\d{1,3})(?:\+\d{1,2})?'/.exec(minuteCandidates);
  const minute = minuteMatch ? Number(minuteMatch[1]) : (/half time|break/i.test(minuteCandidates) ? 45 : null);

  let scoreHome = 0;
  let scoreAway = 0;
  const scoreText = $('body').find('div,span,b,strong').filter((_, el) => /^\s*\d+\s*[-:]\s*\d+\s*$/.test($(el).text())).first().text();
  const scoreMatch = /(\d+)\s*[-:]\s*(\d+)/.exec(scoreText || pageText);
  if (scoreMatch) {
    scoreHome = Number(scoreMatch[1]);
    scoreAway = Number(scoreMatch[2]);
  }

  const home = emptyStats();
  const away = emptyStats();
  $('tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length !== 3) return;
    const left = $(cells[0]).text().trim();
    const label = $(cells[1]).text().trim().toLowerCase();
    const right = $(cells[2]).text().trim();
    if (!label) return;
    applyStat(home, label, left);
    applyStat(away, label, right);
  });

  return {
    ...fallback,
    minute,
    score: { home: scoreHome, away: scoreAway },
    stats: { home, away },
    statsAvailable: home.shots + away.shots + home.corners + away.corners > 0,
  };
}

export async function fetchLiveMatches() {
  const html = await fetchText(`${BASE}/?d=0&s=1`);
  return parseScoreList(html).filter((match) => match.status === 'live');
}

export async function fetchMatchState(match) {
  const html = await fetchText(`${BASE}/match/${match.id}/?s=2`);
  return parseMatchPage(html, match);
}
