import * as cheerio from 'cheerio';
import { fetchText } from './flashscore.js';

const BASE = 'https://www.flashscore.mobi';
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function cleanText(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberFrom(value) {
  const match = String(value ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function scoreFromText(text = '') {
  const matches = [...String(text).matchAll(/(?:^|\s)(\d{1,2})\s*[-:]\s*(\d{1,2})(?:\s|$)/g)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  return { home: Number(last[1]), away: Number(last[2]) };
}

function resultFromScore(score, teamAppearsFirst) {
  if (!score) return null;
  if (score.home === score.away) return 'D';
  const firstWon = score.home > score.away;
  return firstWon === teamAppearsFirst ? 'W' : 'L';
}

function opponentFromRow(text, team, otherKnownTeam = '') {
  let value = cleanText(text);
  value = value.replace(new RegExp(team.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
  if (otherKnownTeam) {
    value = value.replace(new RegExp(otherKnownTeam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ` ${otherKnownTeam} `);
  }
  value = value
    .replace(/\b\d{1,2}[.:/-]\d{1,2}(?:[.:/-]\d{2,4})?\b/g, ' ')
    .replace(/\b\d{1,2}\s*[-:]\s*\d{1,2}\b/g, ' ')
    .replace(/\b(?:finished|ft|aet|pen|postp|cancelled)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = value.split(/\s{2,}|\s[-–]\s/).map(cleanText).filter(Boolean);
  return parts.find((part) => normalize(part) !== normalize(team)) || '';
}

function tableRows($) {
  const rows = [];
  $('tr').each((_, row) => {
    const cells = $(row).find('th,td').map((__, cell) => {
      const children = $(cell).children().map((___, child) => cleanText($(child).text())).get().filter(Boolean);
      // Flashscore's H2H rows place date, teams and score in sibling elements
      // without literal whitespace. Cheerio's cell.text() therefore produced
      // strings such as "Manchester Utd2-2", which the score parser rejected.
      return children.length > 1
        ? cleanText(children.join(' | '))
        : cleanText($(cell).text());
    }).get().filter(Boolean);
    if (cells.length) rows.push({ cells, text: cleanText(cells.join(' | ')) });
  });

  if (rows.length) return rows;

  $('li, .row, [class*="row"], [class*="table"] > div').each((_, row) => {
    const text = cleanText($(row).text());
    if (text && text.length < 300) rows.push({ cells: [text], text });
  });
  return rows;
}

function parseStandingRow(row, teamName) {
  const rowNorm = normalize(row.text);
  const teamNorm = normalize(teamName);
  if (!teamNorm || !rowNorm.includes(teamNorm)) return null;

  const values = row.cells
    .flatMap((cell) => [...String(cell).matchAll(/\b\d+\b/g)].map((match) => Number(match[0])));

  const positionMatch = row.text.match(/^\s*(\d{1,3})\s*[.)]?\s/);
  const position = positionMatch ? Number(positionMatch[1]) : (values[0] ?? null);

  return {
    position,
    played: values.length >= 3 ? values[1] : null,
    points: values.length >= 2 ? values[values.length - 1] : null,
    raw: row.text,
  };
}

export function parseStandings(html, match) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const rows = tableRows($);
  return {
    home: rows.map((row) => parseStandingRow(row, match.home)).find(Boolean) || null,
    away: rows.map((row) => parseStandingRow(row, match.away)).find(Boolean) || null,
  };
}

function inferTeamsOrder(text, homeName, awayName) {
  const normalized = normalize(text);
  const homeIndex = normalized.indexOf(normalize(homeName));
  const awayIndex = normalized.indexOf(normalize(awayName));
  if (homeIndex < 0 || awayIndex < 0) return null;
  return homeIndex < awayIndex;
}

function makeMatchItem(row, perspectiveTeam, knownOpponent = '') {
  const score = scoreFromText(row.text);
  if (!score) return null;

  const perspectiveIndex = normalize(row.text).indexOf(normalize(perspectiveTeam));
  if (perspectiveIndex < 0) return null;

  const scoreText = `${score.home}-${score.away}`;
  const scoreIndex = normalize(row.text).lastIndexOf(normalize(scoreText));
  const teamAppearsFirst = scoreIndex < 0 ? true : perspectiveIndex < scoreIndex;

  return {
    result: resultFromScore(score, teamAppearsFirst),
    score: scoreText,
    opponent: opponentFromRow(row.text, perspectiveTeam, knownOpponent),
    raw: row.text,
  };
}

export function parseFormAndH2H(html, match) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const rows = tableRows($);
  const homeNorm = normalize(match.home);
  const awayNorm = normalize(match.away);

  const homeForm = [];
  const awayForm = [];
  const h2hItems = [];

  for (const row of rows) {
    const rowNorm = normalize(row.text);
    const hasHome = rowNorm.includes(homeNorm);
    const hasAway = rowNorm.includes(awayNorm);
    const score = scoreFromText(row.text);
    if (!score) continue;

    if (hasHome && hasAway) {
      const homeFirst = inferTeamsOrder(row.text, match.home, match.away);
      if (homeFirst !== null) {
        const actualHomeGoals = homeFirst ? score.home : score.away;
        const actualAwayGoals = homeFirst ? score.away : score.home;
        h2hItems.push({
          score: `${actualHomeGoals}-${actualAwayGoals}`,
          homeGoals: actualHomeGoals,
          awayGoals: actualAwayGoals,
          raw: row.text,
        });
      }
      continue;
    }

    if (hasHome && homeForm.length < 5) {
      const item = makeMatchItem(row, match.home);
      if (item) homeForm.push(item);
    }

    if (hasAway && awayForm.length < 5) {
      const item = makeMatchItem(row, match.away);
      if (item) awayForm.push(item);
    }
  }

  const h2h = h2hItems.slice(0, 5);
  return {
    form: {
      home: homeForm.slice(0, 5),
      away: awayForm.slice(0, 5),
    },
    h2h: {
      meetings: h2h.length,
      homeWins: h2h.filter((item) => item.homeGoals > item.awayGoals).length,
      draws: h2h.filter((item) => item.homeGoals === item.awayGoals).length,
      awayWins: h2h.filter((item) => item.homeGoals < item.awayGoals).length,
      items: h2h,
    },
  };
}

function decimalOdds(values) {
  return values
    .map(numberFrom)
    .filter((value) => Number.isFinite(value) && value >= 1.01 && value <= 100);
}

export function parseOdds(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const rows = tableRows($);
  const result = {
    home: null,
    draw: null,
    away: null,
    over25: null,
    under25: null,
  };

  for (const row of rows) {
    const label = normalize(row.cells[0] || row.text);
    const odds = decimalOdds(row.cells.slice(1));

    if ((/^1x2$/.test(label) || /match result|full time result|1 x 2/.test(label)) && odds.length >= 3) {
      [result.home, result.draw, result.away] = odds.slice(0, 3);
    }

    if (/over 2 5|peste 2 5/.test(label) && odds.length) result.over25 = odds[0];
    if (/under 2 5|sub 2 5/.test(label) && odds.length) result.under25 = odds[0];

    if (/^1$|home/.test(label) && odds.length && result.home === null) result.home = odds[0];
    if (/^x$|draw/.test(label) && odds.length && result.draw === null) result.draw = odds[0];
    if (/^2$|away/.test(label) && odds.length && result.away === null) result.away = odds[0];
  }

  if (result.home === null || result.draw === null || result.away === null) {
    const text = cleanText($('body').text());
    const match = text.match(/(?:1\s+)(\d+[.,]\d+)\s+(?:X\s+)(\d+[.,]\d+)\s+(?:2\s+)(\d+[.,]\d+)/i);
    if (match) {
      result.home = numberFrom(match[1]);
      result.draw = numberFrom(match[2]);
      result.away = numberFrom(match[3]);
    }
  }

  return result;
}

function hasAnyPrematchData(data) {
  return Boolean(
    data?.standings?.home ||
    data?.standings?.away ||
    data?.form?.home?.length ||
    data?.form?.away?.length ||
    data?.h2h?.meetings ||
    data?.odds?.home ||
    data?.odds?.draw ||
    data?.odds?.away ||
    data?.odds?.over25 ||
    data?.odds?.under25
  );
}

async function safeFetch(url) {
  try {
    return await fetchText(url, { timeoutMs: 18000 });
  } catch (error) {
    console.warn(`[prematch] ${url}: ${error.message}`);
    return '';
  }
}

export async function fetchPrematchData(match) {
  const base = `${BASE}/match/${match.id}/`;
  const [summaryHtml, h2hHtml, standingsHtml, oddsHtml] = await Promise.all([
    safeFetch(base),
    safeFetch(`${base}?t=h2h`),
    safeFetch(`${base}?t=standings`),
    safeFetch(`${base}?t=odds`),
  ]);

  const standings = parseStandings(standingsHtml || summaryHtml, match);
  const formAndH2H = parseFormAndH2H(h2hHtml || summaryHtml, match);
  const odds = parseOdds(oddsHtml || summaryHtml);

  const data = {
    collectedAt: new Date().toISOString(),
    standings,
    form: formAndH2H.form,
    h2h: formAndH2H.h2h,
    odds,
  };

  return hasAnyPrematchData(data) ? data : null;
}

export function isPrematchCacheFresh(entry, ttlMs = DEFAULT_TTL_MS) {
  if (!entry?.collectedAt) return false;
  const age = Date.now() - new Date(entry.collectedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < ttlMs;
}

export async function enrichWithPrematch(matches, cache = {}, options = {}) {
  const ttlMs = Number(options.ttlMs || DEFAULT_TTL_MS);
  const maxFetches = Math.max(0, Number(options.maxFetches ?? 3));
  const updatedCache = { ...cache };
  let fetched = 0;

  const enriched = [];
  for (const match of matches) {
    let prematch = updatedCache[match.id] || null;

    if (!isPrematchCacheFresh(prematch, ttlMs) && fetched < maxFetches) {
      fetched += 1;
      const fresh = await fetchPrematchData(match);
      if (fresh) {
        prematch = fresh;
        updatedCache[match.id] = fresh;
      }
    }

    enriched.push({ ...match, prematch: prematch || null });
  }

  return { matches: enriched, cache: updatedCache, fetched };
}
