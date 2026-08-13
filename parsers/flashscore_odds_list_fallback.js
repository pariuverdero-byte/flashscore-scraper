// parsers/flashscore_odds_list_fallback.js
// Last-resort pool fallback using Flashscore's Odds LIST page.
// Internal metadata only; visitor-facing output remains unchanged.

import fs from "fs/promises";
import * as cheerio from "cheerio";

const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);
const MIN_POOL = Math.max(
  4,
  Number(process.env.FLASHSCORE_FALLBACK_MIN_POOL || 8)
);
const TARGET_POOL = Math.max(
  MIN_POOL,
  Number(process.env.FLASHSCORE_FALLBACK_TARGET_POOL || 12)
);

const BASE = "https://www.flashscore.mobi";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const safe = v =>
  String(v ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const norm = v =>
  safe(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function readJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function getMatches(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.matches)) return raw.matches;
  if (Array.isArray(raw?.fixtures)) return raw.fixtures;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

function extractId(href = "") {
  const m =
    /\/match\/([^/?#]+)\//i.exec(href) ||
    /\/match\/([^/?#]+)/i.exec(href);

  return m ? m[1] : "";
}

function splitCompetition(raw = "") {
  const t = safe(raw)
    .replace(/\bStandings\b/i, "")
    .trim();

  const parts = t.split(":");

  if (parts.length >= 2) {
    return {
      country: safe(parts[0]),
      competition: safe(parts.slice(1).join(":"))
    };
  }

  return {
    country: "",
    competition: t
  };
}

function validOdd(v, min = 1.22, max = 1.90) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max;
}

async function fetchOddsPage() {
  const url = `${BASE}/?d=${DAY_OFFSET}&s=5`;

  const r = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9,ro;q=0.8"
    }
  });

  if (!r.ok) {
    throw new Error(`HTTP ${r.status} for ${url}`);
  }

  return {
    url,
    html: await r.text()
  };
}

function parseOddsList(html) {
  const $ = cheerio.load(html, {
    decodeEntities: false
  });

  const root = $("#score-data");
  const out = [];

  if (!root.length) {
    return out;
  }

  let competitionText = "";

  const nodes = root.contents().toArray();

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    if (
      node.type === "tag" &&
      node.name === "h4"
    ) {
      competitionText = safe($(node).text());
      continue;
    }

    if (
      node.type !== "tag" ||
      node.name !== "span"
    ) {
      continue;
    }

    const time = safe($(node).text());

    if (!/^\d{1,2}:\d{2}$/.test(time)) {
      continue;
    }

    let teams = "";
    let matchAnchor = null;
    let matchAnchorIndex = -1;

    for (let j = i + 1; j < nodes.length; j++) {
      const n = nodes[j];

      if (
        n.type === "tag" &&
        (n.name === "span" || n.name === "h4")
      ) {
        break;
      }

      if (
        n.type === "tag" &&
        n.name === "a" &&
        /^\/match\//i.test(
          $(n).attr("href") || ""
        )
      ) {
        matchAnchor = n;
        matchAnchorIndex = j;
        break;
      }

      if (n.type === "text") {
        teams += " " + safe(n.data || "");
      }
    }

    if (!matchAnchor) {
      continue;
    }

    teams = safe(teams)
      .replace(/^[-–—]+|[-–—]+$/g, "")
      .trim();

    const href =
      $(matchAnchor).attr("href") || "";

    const matchId =
      extractId(href);

    if (!matchId || !teams) {
      continue;
    }

    const odds = [];

    for (
      let j = matchAnchorIndex + 1;
      j < nodes.length;
      j++
    ) {
      const n = nodes[j];

      if (
        n.type === "tag" &&
        (n.name === "span" || n.name === "h4")
      ) {
        break;
      }

      if (
        n.type === "tag" &&
        n.name === "a"
      ) {
        const text =
          safe($(n).text())
            .replace(",", ".");

        if (/^\d+\.\d+$/.test(text)) {
          const odd = Number(text);

          if (
            Number.isFinite(odd) &&
            odd >= 1.01 &&
            odd <= 100
          ) {
            odds.push(odd);
          }
        }
      }
    }

    if (odds.length < 3) {
      continue;
    }

    const {
      country,
      competition
    } = splitCompetition(competitionText);

    out.push({
      match_id: matchId,
      teams,
      time,
      country,
      competition,
      home: odds[0],
      draw: odds[1],
      away: odds[2]
    });
  }

  return out;
}

function makeSelection(match, row, side, odd) {
  const market =
    side === "1"
      ? "Victorie gazde"
      : "Victorie oaspeti";

  const id = safe(match.id);

  const url =
    safe(match.url) ||
    `https://www.flashscore.mobi/match/${id}/`;

  return {
    id,
    match_id: id,
    flashscore_url: url,
    url,

    teams:
      safe(match.teams) ||
      safe(row.teams),

    time:
      safe(match.time) ||
      safe(row.time),

    country:
      safe(match.country) ||
      safe(row.country),

    competition:
      safe(match.competition || match.league) ||
      safe(row.competition),

    bet_type: "1x2",
    market_raw: market,
    odd: Number(Number(odd).toFixed(3)),

    // INTERNAL ONLY
    source: "flashscore_odds_fallback",
    fallback_level: 3,

    meta: {
      bet_text: market,
      source: "flashscore_odds_fallback",
      fallback_level: 3,
      odds_origin: "flashscore_odds_list",
      visitor_visible: false
    }
  };
}

function dedupe(items) {
  const seen = new Set();
  const out = [];

  for (const s of items) {
    const key =
      `${safe(s.match_id)}|${norm(s.market_raw)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(s);
  }

  return out;
}

(async () => {
  const master =
    await readJson(
      "master_pool.json",
      {
        source: "master_pool",
        selections: []
      }
    );

  const existing =
    Array.isArray(master.selections)
      ? master.selections
      : [];

  if (existing.length >= MIN_POOL) {
    console.log(
      `[FS-ODDS] skipped: pool already ${existing.length}`
    );
    return;
  }

  const rawMatches =
    await readJson(
      "matches.json",
      { matches: [] }
    );

  const matches =
    getMatches(rawMatches);

  const matchMap =
    new Map(
      matches.map(m => [
        safe(
          m.id ||
          m.match_id ||
          m.flashscore_id
        ),
        m
      ])
    );

  const { url, html } =
    await fetchOddsPage();

  await fs.writeFile(
    "flashscore_odds_list.html",
    html,
    "utf8"
  );

  const rows =
    parseOddsList(html);

  console.log(
    `[FS-ODDS] rows with 1X2 odds: ${rows.length}`
  );

  const historicalTest =
    DAY_OFFSET < 0;

  const candidates = [];

  for (const row of rows) {
    const match =
      matchMap.get(row.match_id);

    // Critical safety rule:
    // no exact Flashscore ID match = no pool.
    if (!match) {
      continue;
    }

    // Production: do not bet matches already started.
    // Historical tests are allowed for DAY_OFFSET < 0.
    if (
      !historicalTest &&
      safe(match.status || "sched") !== "sched"
    ) {
      continue;
    }

    if (validOdd(row.home)) {
      candidates.push(
        makeSelection(
          match,
          row,
          "1",
          row.home
        )
      );
    }

    if (validOdd(row.away)) {
      candidates.push(
        makeSelection(
          match,
          row,
          "2",
          row.away
        )
      );
    }
  }

  candidates.sort(
    (a, b) =>
      Math.abs(a.odd - 1.55) -
      Math.abs(b.odd - 1.55)
  );

  const combined =
    dedupe(existing);

  const existingKeys =
    new Set(
      combined.map(
        s =>
          `${safe(s.match_id)}|${norm(s.market_raw)}`
      )
    );

  const added = [];

  for (const s of candidates) {
    if (combined.length >= TARGET_POOL) {
      break;
    }

    const key =
      `${safe(s.match_id)}|${norm(s.market_raw)}`;

    if (existingKeys.has(key)) {
      continue;
    }

    existingKeys.add(key);
    combined.push(s);
    added.push(s);
  }

  const out = {
    ...master,

    source_mode:
      added.length
        ? `${master.source_mode || "existing"}_plus_flashscore_odds_fallback`
        : master.source_mode || "existing",

    sources_used: [
      ...new Set([
        ...(master.sources_used || []),
        ...(added.length
          ? ["flashscore_odds_fallback"]
          : [])
      ])
    ],

    fallback: {
      used: added.length > 0,
      level: added.length > 0 ? 3 : null,
      added: added.length,
      internal_only: true,
      odds_url: url
    },

    selections: combined
  };

  await fs.writeFile(
    "master_pool.json",
    JSON.stringify(out, null, 2),
    "utf8"
  );

  await fs.writeFile(
    "flashscore_odds_fallback.json",
    JSON.stringify(
      {
        used: added.length > 0,
        odds_rows: rows.length,
        existing_pool_size:
          existing.length,
        candidate_count:
          candidates.length,
        added:
          added.length,
        final_pool_size:
          combined.length,
        selections:
          added
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(
    `[FS-ODDS] candidates=${candidates.length} ` +
    `added=${added.length} ` +
    `final_pool=${combined.length}`
  );
})().catch(error => {
  console.warn(
    `[FS-ODDS] non-blocking error: ` +
    `${error?.message || error}`
  );
});
