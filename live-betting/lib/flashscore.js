import * as cheerio from 'cheerio';
import { safeNumber, splitTeams } from './utils.js';

const BASE = 'https://www.flashscore.mobi';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/125 Safari/537.36';

/**
 * Download one Flashscore page.
 */
export async function fetchText(url, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9,ro;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function absoluteUrl(href = '') {
  try {
    return new URL(href, BASE).toString();
  } catch {
    return null;
  }
}

function extractId(url = '') {
  const match = /\/match\/([^/?#]+)/i.exec(url);
  return match ? match[1] : null;
}

function parseCompetition(raw = '') {
  const clean = raw
    .replace(/\bStandings\b/i, '')
    .replace(/\s+».*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = clean.split(':');

  if (parts.length < 2) {
    return {
      country: '',
      competition: clean,
    };
  }

  return {
    country: parts.shift().trim(),
    competition: parts.join(':').trim(),
  };
}

function parseStatus(anchorClass = '', text = '') {
  const cls = String(anchorClass).toLowerCase();
  const value = String(text).trim().toLowerCase();

  if (
    cls.includes('live') ||
    /\d{1,3}(?:\+\d{1,2})?'/.test(value) ||
    /half time|break|interval|paused/i.test(value)
  ) {
    return 'live';
  }

  if (
    cls.includes('fin') ||
    /finished|after penalties|penalties|aet|after extra time/i.test(value)
  ) {
    return 'finished';
  }

  return 'scheduled';
}

/**
 * Extract minute from values such as:
 * 23'
 * 45+2'
 * Half Time
 */
function parseMinute(value = '') {
  const text = String(value)
    .replace(/\s+/g, ' ')
    .trim();

  const minuteMatch = /(?:^|\s)(\d{1,3})(?:\+\d{1,2})?['’](?:\s|$)/.exec(text);

  if (minuteMatch) {
    return Number(minuteMatch[1]);
  }

  if (/half time|break|interval/i.test(text)) {
    return 45;
  }

  if (/extra time break/i.test(text)) {
    return 105;
  }

  return null;
}

/**
 * Parse the Flashscore mobile daily/live list.
 */
export function parseScoreList(html) {
  const $ = cheerio.load(html, {
    decodeEntities: false,
  });

  const root = $('#score-data');
  const matches = [];
  let competitionHeader = '';

  root.contents().each((_, node) => {
    if (node.type === 'tag' && node.name === 'h4') {
      competitionHeader = $(node)
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      return;
    }

    if (node.type !== 'tag' || node.name !== 'span') {
      return;
    }

    const marker = $(node)
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    let teamsText = '';
    let anchor = null;
    let cursor = node.nextSibling;

    while (cursor) {
      if (
        cursor.type === 'tag' &&
        cursor.name === 'a' &&
        /^\/match\//i.test($(cursor).attr('href') || '')
      ) {
        anchor = cursor;
        break;
      }

      if (cursor.type === 'text') {
        teamsText += ` ${String(cursor.data || '')}`;
      }

      cursor = cursor.nextSibling;
    }

    if (!anchor) {
      return;
    }

    const href = $(anchor).attr('href') || '';
    const url = absoluteUrl(href);
    const id = extractId(url);

    teamsText = teamsText
      .replace(/\s+/g, ' ')
      .replace(/^[-–\s]+|[-–\s]+$/g, '')
      .trim();

    if (!id || !teamsText) {
      return;
    }

    const status = parseStatus(
      $(anchor).attr('class') || '',
      marker,
    );

    const minute = parseMinute(marker);

    const { country, competition } =
      parseCompetition(competitionHeader);

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
      minute,
    });
  });

  return matches;
}

function emptyStats() {
  return {
    xg: 0,
    xgot: 0,
    shots: 0,
    shotsOnTarget: 0,
    shotsOffTarget: 0,
    blockedShots: 0,
    bigChances: 0,
    shotsInBox: 0,
    shotsOutsideBox: 0,
    boxTouches: 0,
    corners: 0,
    possession: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    attacks: 0,
    dangerousAttacks: 0,
    offsides: 0,
    goalkeeperSaves: 0,
  };
}

/**
 * Convert values such as:
 * 59%
 * 69% (221/320)
 * 1.14
 * 11
 */
function parseStatNumber(value) {
  const text = String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(',', '.')
    .trim();

  const percentage = /^(-?\d+(?:\.\d+)?)\s*%/.exec(text);

  if (percentage) {
    return Number(percentage[1]);
  }

  const number = /-?\d+(?:\.\d+)?/.exec(text);

  return number ? Number(number[0]) : 0;
}

function normalizeLabel(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[:：]+$/, '')
    .trim()
    .toLowerCase();
}

function getStatKey(label = '') {
  const value = normalizeLabel(label);

  const mappings = [
    [/^expected goals(?:\s*\(xg\))?$|^xg$/i, 'xg'],
    [/^xg on target(?:\s*\(xgot\))?$|^xgot$/i, 'xgot'],
    [/^total shots$|^shots total$/i, 'shots'],
    [/^shots on target$/i, 'shotsOnTarget'],
    [/^shots off target$/i, 'shotsOffTarget'],
    [/^blocked shots$/i, 'blockedShots'],
    [/^big chances$/i, 'bigChances'],
    [/^shots inside the box$/i, 'shotsInBox'],
    [/^shots outside the box$/i, 'shotsOutsideBox'],
    [/^touches in opposition box$/i, 'boxTouches'],
    [/^corner kicks$|^corners$/i, 'corners'],
    [/^ball possession$|^possession$/i, 'possession'],
    [/^fouls$/i, 'fouls'],
    [/^yellow cards$/i, 'yellowCards'],
    [/^red cards$/i, 'redCards'],
    [/^attacks$/i, 'attacks'],
    [/^dangerous attacks$/i, 'dangerousAttacks'],
    [/^offsides$/i, 'offsides'],
    [/^goalkeeper saves$|^saves$/i, 'goalkeeperSaves'],
  ];

  for (const [pattern, key] of mappings) {
    if (pattern.test(value)) {
      return key;
    }
  }

  return null;
}

function applyStat(target, label, rawValue) {
  const key = getStatKey(label);

  if (!key) {
    return false;
  }

  target[key] = parseStatNumber(rawValue);
  return true;
}

function looksLikeValue(value = '') {
  const text = String(value)
    .replace(/\u00a0/g, ' ')
    .trim();

  return /^-?\d+(?:[.,]\d+)?(?:\s*%)?(?:\s*\([^)]*\))?$/.test(text);
}

/**
 * Extract visible text tokens in their DOM order.
 *
 * Flashscore currently renders many statistics as:
 * home value
 * label
 * away value
 *
 * instead of a classic HTML table.
 */
function extractTextTokens($) {
  const tokens = [];

  $('body')
    .find('*')
    .contents()
    .each((_, node) => {
      if (node.type !== 'text') {
        return;
      }

      const parentName = node.parent?.name || '';

      if (
        ['script', 'style', 'noscript', 'svg'].includes(parentName)
      ) {
        return;
      }

      const text = String(node.data || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!text) {
        return;
      }

      tokens.push(text);
    });

  return tokens;
}

/**
 * Old Flashscore HTML format:
 *
 * <tr>
 *   <td>11</td>
 *   <td>Total shots</td>
 *   <td>7</td>
 * </tr>
 */
function parseTableStats($, home, away) {
  let parsedRows = 0;

  $('tr').each((_, row) => {
    const cells = $(row).find('td');

    if (cells.length < 3) {
      return;
    }

    const left = $(cells[0]).text().trim();
    const label = $(cells[1]).text().trim();
    const right = $(cells[cells.length - 1]).text().trim();

    if (!getStatKey(label)) {
      return;
    }

    applyStat(home, label, left);
    applyStat(away, label, right);
    parsedRows += 1;
  });

  return parsedRows;
}

/**
 * Current Flashscore HTML format:
 *
 * 11
 * Total shots
 * 7
 */
function parseLinearStats($, home, away) {
  const tokens = extractTextTokens($);
  let parsedRows = 0;

  for (let index = 1; index < tokens.length - 1; index += 1) {
    const label = tokens[index];
    const key = getStatKey(label);

    if (!key) {
      continue;
    }

    let leftIndex = index - 1;
    let rightIndex = index + 1;

    while (
      leftIndex >= 0 &&
      !looksLikeValue(tokens[leftIndex]) &&
      index - leftIndex <= 4
    ) {
      leftIndex -= 1;
    }

    while (
      rightIndex < tokens.length &&
      !looksLikeValue(tokens[rightIndex]) &&
      rightIndex - index <= 4
    ) {
      rightIndex += 1;
    }

    if (
      leftIndex < 0 ||
      rightIndex >= tokens.length ||
      !looksLikeValue(tokens[leftIndex]) ||
      !looksLikeValue(tokens[rightIndex])
    ) {
      continue;
    }

    home[key] = parseStatNumber(tokens[leftIndex]);
    away[key] = parseStatNumber(tokens[rightIndex]);
    parsedRows += 1;
  }

  return parsedRows;
}

function extractScore($, pageText = '') {
  const candidates = [];

  $('h1, h2, h3, div, span, b, strong').each((_, element) => {
    const value = $(element)
      .clone()
      .children()
      .remove()
      .end()
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    if (/^\d+\s*[-:]\s*\d+(?:\s*\([^)]*\))?$/.test(value)) {
      candidates.push(value);
    }
  });

  const direct = candidates[0] || '';

  const scoreMatch =
    /^(\d+)\s*[-:]\s*(\d+)/.exec(direct) ||
    /(?:^|\s)(\d+)\s*[-:]\s*(\d+)(?:\s|\(|$)/.exec(pageText);

  if (!scoreMatch) {
    return {
      home: 0,
      away: 0,
    };
  }

  return {
    home: Number(scoreMatch[1]),
    away: Number(scoreMatch[2]),
  };
}

function extractMinuteFromPage($, fallback = {}) {
  const candidates = [
    fallback.marker,
    fallback.minute,
    $('span.mstat').first().text(),
    $('.mstat').first().text(),
    $('.detailScore__status').first().text(),
    $('body').text().slice(0, 600),
  ]
    .filter((value) => value !== null && value !== undefined)
    .join(' ');

  return parseMinute(candidates);
}

/**
 * Parse one Flashscore match stats page.
 */
export function parseMatchPage(html, fallback = {}) {
  const $ = cheerio.load(html, {
    decodeEntities: false,
  });

  const pageText = $('body')
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const minute =
    extractMinuteFromPage($, fallback) ??
    fallback.minute ??
    null;

  const score = extractScore($, pageText);

  const home = emptyStats();
  const away = emptyStats();

  const tableRows = parseTableStats($, home, away);

  if (tableRows === 0) {
    parseLinearStats($, home, away);
  }

  const meaningfulStats =
    home.shots +
    away.shots +
    home.shotsOnTarget +
    away.shotsOnTarget +
    home.corners +
    away.corners +
    home.possession +
    away.possession +
    home.xg +
    away.xg;

  return {
    ...fallback,
    minute,
    score,
    stats: {
      home,
      away,
    },
    statsAvailable: meaningfulStats > 0,
  };
}

/**
 * Get all currently live football matches.
 */
export async function fetchLiveMatches() {
  const html = await fetchText(`${BASE}/?d=0&s=1`);

  return parseScoreList(html).filter(
    (match) => match.status === 'live',
  );
}

/**
 * Get current score, minute and statistics for one match.
 *
 * Flashscore mobile uses ?t=stats for the current statistics page.
 */
export async function fetchMatchState(match) {
  const url = `${BASE}/match/${match.id}/?t=stats`;
  const html = await fetchText(url);

  return parseMatchPage(html, {
    ...match,
    statsUrl: url,
  });
}
