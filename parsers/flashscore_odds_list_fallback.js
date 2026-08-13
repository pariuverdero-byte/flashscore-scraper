// parsers/flashscore_odds_list_fallback.js
// FINAL — Flashscore mobile Odds-list fallback
//
// Source:
//   https://www.flashscore.mobi/?d=<DAY_OFFSET>&s=5
//
// Reads real 1X2 odds from:
//   <span>19:00</span>
//   Team A - Team B
//   <a href="/match/XXXX/?s=5&d=-1">score</a>
//   <span class="mobi-odds">[ <a>1</a> | <a>X</a> | <a>2</a> ]</span>
//
// Safety:
// - selection enters pool ONLY if exact Flashscore match_id exists in matches.json
// - fallback metadata remains internal
// - production accepts only scheduled matches
// - historical DAY_OFFSET < 0 can use finished matches for testing

import fs from "fs/promises";
import * as cheerio from "cheerio";

const DAY_OFFSET = Number(process.env.DAY_OFFSET || "0");

const MIN_POOL = Math.max(
  4,
  Number(process.env.FLASHSCORE_FALLBACK_MIN_POOL || "8")
);

const TARGET_POOL = Math.max(
  MIN_POOL,
  Number(process.env.FLASHSCORE_FALLBACK_TARGET_POOL || "12")
);

const BASE = "https://www.flashscore.mobi";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

function clean(value = "") {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value = "") {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(
      await fs.readFile(path, "utf8")
    );
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

function matchIdOf(match) {
  return clean(
    match?.id ||
    match?.match_id ||
    match?.flashscore_id ||
    ""
  );
}

function extractMatchId(href = "") {
  const match =
    String(href).match(
      /\/match\/([^/?#]+)(?:\/|\?|$)/i
    );

  return match?.[1] || "";
}

function isTime(value = "") {
  return /^\d{1,2}:\d{2}$/.test(
    clean(value)
  );
}

function validOdd(
  value,
  min = 1.22,
  max = 1.90
) {
  const odd = Number(value);

  return (
    Number.isFinite(odd) &&
    odd >= min &&
    odd <= max
  );
}

async function fetchOddsPage() {
  const url =
    `${BASE}/?d=${DAY_OFFSET}&s=5`;

  const response = await fetch(url, {
    redirect: "follow",

    headers: {
      "User-Agent": UA,
      "Accept-Language":
        "en-US,en;q=0.9,ro;q=0.8",
      Accept:
        "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} for ${url}`
    );
  }

  return {
    url,
    html: await response.text()
  };
}

function getCompetitionText($, node) {
  let previous =
    node.previousSibling;

  while (previous) {
    if (
      previous.type === "tag" &&
      previous.name === "h4"
    ) {
      return clean(
        $(previous)
          .clone()
          .children()
          .remove()
          .end()
          .text()
      );
    }

    previous =
      previous.previousSibling;
  }

  return "";
}

function splitCompetition(text = "") {
  const value =
    clean(text)
      .replace(/\bStandings\b/gi, "")
      .trim();

  const colon =
    value.indexOf(":");

  if (colon < 0) {
    return {
      country: "",
      competition: value
    };
  }

  return {
    country:
      clean(
        value.slice(0, colon)
      ),

    competition:
      clean(
        value.slice(colon + 1)
      )
  };
}

function collectTeamsBetween(
  $,
  timeNode,
  matchAnchor
) {
  let node =
    timeNode.nextSibling;

  let text = "";

  while (
    node &&
    node !== matchAnchor
  ) {
    if (node.type === "text") {
      text +=
        ` ${node.data || ""}`;
    } else if (
      node.type === "tag" &&
      node.name === "img"
    ) {
      // Ignore red-card icons etc.
    } else if (
      node.type === "tag"
    ) {
      text +=
        ` ${$(node).text()}`;
    }

    node =
      node.nextSibling;
  }

  return clean(text);
}

function findNextMatchAnchor(
  $,
  timeNode
) {
  let node =
    timeNode.nextSibling;

  while (node) {
    if (
      node.type === "tag" &&
      (
        node.name === "br" ||
        node.name === "h4" ||
        node.name === "span"
      )
    ) {
      /*
       * A normal time is followed by team text
       * and then the score anchor before the
       * next BR/span.
       *
       * We intentionally stop if a new structural
       * block starts before finding the match.
       */
      if (
        node.name === "span"
      ) {
        const cls =
          $(node).attr("class") || "";

        if (
          cls.includes("mobi-odds")
        ) {
          node =
            node.nextSibling;

          continue;
        }
      }

      break;
    }

    if (
      node.type === "tag" &&
      node.name === "a"
    ) {
      const href =
        $(node).attr("href") || "";

      if (
        /^\/match\//i.test(href)
      ) {
        return node;
      }
    }

    node =
      node.nextSibling;
  }

  return null;
}

function findOddsSpan(
  $,
  matchAnchor
) {
  let node =
    matchAnchor.nextSibling;

  while (node) {
    if (
      node.type === "tag" &&
      node.name === "br"
    ) {
      return null;
    }

    if (
      node.type === "tag" &&
      node.name === "span"
    ) {
      const cls =
        $(node).attr("class") || "";

      if (
        cls
          .split(/\s+/)
          .includes("mobi-odds")
      ) {
        return node;
      }
    }

    node =
      node.nextSibling;
  }

  return null;
}

function parseOddsFromSpan(
  $,
  oddsSpan
) {
  const odds = [];

  $(oddsSpan)
    .find("a")
    .each((_, anchor) => {
      const text =
        clean(
          $(anchor).text()
        )
          .replace(",", ".");

      if (
        !/^\d+(?:\.\d+)?$/.test(text)
      ) {
        return;
      }

      const odd =
        Number(text);

      if (
        Number.isFinite(odd) &&
        odd >= 1.01 &&
        odd <= 100
      ) {
        odds.push(odd);
      }
    });

  return odds;
}

function parseOddsList(html) {
  const $ =
    cheerio.load(
      html,
      {
        decodeEntities: false
      }
    );

  const root =
    $("#score-data");

  if (!root.length) {
    console.warn(
      "[FS-ODDS] #score-data not found"
    );

    return [];
  }

  const rows = [];

  root
    .find("span")
    .each((_, span) => {
      /*
       * Ignore mobi-odds spans themselves.
       */
      const cls =
        $(span).attr("class") || "";

      if (
        cls
          .split(/\s+/)
          .includes("mobi-odds")
      ) {
        return;
      }

      const time =
        clean(
          $(span).text()
        );

      if (!isTime(time)) {
        return;
      }

      const matchAnchor =
        findNextMatchAnchor(
          $,
          span
        );

      if (!matchAnchor) {
        return;
      }

      const href =
        $(matchAnchor)
          .attr("href") || "";

      const matchId =
        extractMatchId(href);

      if (!matchId) {
        return;
      }

      const teams =
        collectTeamsBetween(
          $,
          span,
          matchAnchor
        );

      if (
        !teams ||
        !teams.includes(" - ")
      ) {
        return;
      }

      const oddsSpan =
        findOddsSpan(
          $,
          matchAnchor
        );

      if (!oddsSpan) {
        return;
      }

      const odds =
        parseOddsFromSpan(
          $,
          oddsSpan
        );

      if (odds.length < 3) {
        return;
      }

      const competitionText =
        getCompetitionText(
          $,
          span
        );

      const {
        country,
        competition
      } =
        splitCompetition(
          competitionText
        );

      rows.push({
        match_id: matchId,

        teams,
        time,

        country,
        competition,

        home:
          Number(odds[0]),

        draw:
          Number(odds[1]),

        away:
          Number(odds[2])
      });
    });

  return rows;
}

function makeSelection(
  match,
  row,
  side,
  odd
) {
  const id =
    matchIdOf(match);

  const marketRaw =
    side === "1"
      ? "Victorie gazde"
      : "Victorie oaspeti";

  const url =
    clean(
      match?.url ||
      match?.flashscore_url
    ) ||
    `${BASE}/match/${id}/`;

  return {
    id,
    match_id: id,

    flashscore_url: url,
    url,

    teams:
      clean(match?.teams) ||
      row.teams,

    time:
      clean(match?.time) ||
      row.time,

    country:
      clean(match?.country) ||
      row.country,

    competition:
      clean(
        match?.competition ||
        match?.league
      ) ||
      row.competition,

    bet_type: "1x2",
    market_raw: marketRaw,

    odd:
      Number(
        Number(odd)
          .toFixed(3)
      ),

    /*
     * INTERNAL ONLY.
     */
    source:
      "flashscore_odds_fallback",

    fallback_level: 3,

    meta: {
      bet_text: marketRaw,

      source:
        "flashscore_odds_fallback",

      fallback_level: 3,

      odds_origin:
        "flashscore_odds_list",

      visitor_visible: false
    }
  };
}

function selectionKey(
  selection
) {
  return [
    clean(
      selection?.match_id
    ),
    normalize(
      selection?.market_raw
    )
  ].join("|");
}

function dedupe(
  selections
) {
  const seen =
    new Set();

  const output = [];

  for (
    const selection
    of selections
  ) {
    const key =
      selectionKey(
        selection
      );

    if (
      !key ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    output.push(
      selection
    );
  }

  return output;
}

(async () => {
  const master =
    await readJson(
      "master_pool.json",
      {
        source:
          "master_pool",

        selections: []
      }
    );

  const existing =
    Array.isArray(
      master?.selections
    )
      ? master.selections
      : [];

  if (
    existing.length >=
    MIN_POOL
  ) {
    console.log(
      `[FS-ODDS] skipped: ` +
      `existing pool=${existing.length} >= ${MIN_POOL}`
    );

    return;
  }

  const rawMatches =
    await readJson(
      "matches.json",
      {
        matches: []
      }
    );

  const matches =
    getMatches(
      rawMatches
    );

  console.log(
    `[FS-ODDS] Flashscore matches loaded=${matches.length}`
  );

  const matchMap =
    new Map();

  for (
    const match
    of matches
  ) {
    const id =
      matchIdOf(
        match
      );

    if (id) {
      matchMap.set(
        id,
        match
      );
    }
  }

  const {
    url,
    html
  } =
    await fetchOddsPage();

  await fs.writeFile(
    "flashscore_odds_list.html",
    html,
    "utf8"
  );

  const rows =
    parseOddsList(
      html
    );

  console.log(
    `[FS-ODDS] rows with 1X2 odds=${rows.length}`
  );

  /*
   * Diagnostic:
   * how many IDs on odds page are present
   * in our matches.json?
   */
  const exactRows =
    rows.filter(
      row =>
        matchMap.has(
          row.match_id
        )
    );

  console.log(
    `[FS-ODDS] exact match_id rows=${exactRows.length}`
  );

  if (rows.length) {
    console.log(
      `[FS-ODDS] sample: ` +
      `${rows[0].teams} | ` +
      `${rows[0].home}/${rows[0].draw}/${rows[0].away} | ` +
      `${rows[0].match_id}`
    );
  }

  const historicalTest =
    DAY_OFFSET < 0;

  const candidates = [];

  for (
    const row
    of exactRows
  ) {
    const match =
      matchMap.get(
        row.match_id
      );

    if (!match) {
      continue;
    }

    /*
     * Production safety.
     */
    if (!historicalTest) {
      const status =
        clean(
          match?.status ||
          "sched"
        ).toLowerCase();

      if (
        ![
          "sched",
          "scheduled"
        ].includes(status)
      ) {
        continue;
      }
    }

    /*
     * For now fallback uses only
     * verifier-safe 1X2 picks.
     *
     * Odds band chosen to provide
     * enough combinations for Cota 2
     * and Biletul Zilei.
     */
    if (
      validOdd(
        row.home,
        1.22,
        1.90
      )
    ) {
      candidates.push(
        makeSelection(
          match,
          row,
          "1",
          row.home
        )
      );
    }

    if (
      validOdd(
        row.away,
        1.22,
        1.90
      )
    ) {
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

  /*
   * Prefer odds near 1.55.
   */
  candidates.sort(
    (a, b) =>
      Math.abs(
        a.odd - 1.55
      ) -
      Math.abs(
        b.odd - 1.55
      )
  );

  const combined =
    dedupe(
      existing
    );

  const existingKeys =
    new Set(
      combined.map(
        selection =>
          selectionKey(
            selection
          )
      )
    );

  const added = [];

  for (
    const selection
    of candidates
  ) {
    if (
      combined.length >=
      TARGET_POOL
    ) {
      break;
    }

    const key =
      selectionKey(
        selection
      );

    if (
      existingKeys.has(key)
    ) {
      continue;
    }

    existingKeys.add(key);

    combined.push(
      selection
    );

    added.push(
      selection
    );
  }

  const output = {
    ...master,

    source:
      "master_pool",

    source_mode:
      added.length
        ? `${
            master.source_mode ||
            "existing"
          }_plus_flashscore_odds_fallback`
        : (
            master.source_mode ||
            "existing"
          ),

    sources_used: [
      ...new Set([
        ...(
          master.sources_used ||
          []
        ),

        ...(
          added.length
            ? [
                "flashscore_odds_fallback"
              ]
            : []
        )
      ])
    ],

    fallback: {
      used:
        added.length > 0,

      level:
        added.length > 0
          ? 3
          : null,

      added:
        added.length,

      internal_only:
        true,

      odds_url:
        url
    },

    selections:
      combined
  };

  await fs.writeFile(
    "master_pool.json",

    JSON.stringify(
      output,
      null,
      2
    ),

    "utf8"
  );

  const audit = {
    used:
      added.length > 0,

    odds_rows:
      rows.length,

    exact_match_id_rows:
      exactRows.length,

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
  };

  await fs.writeFile(
    "flashscore_odds_fallback.json",

    JSON.stringify(
      audit,
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
    `${error?.stack || error?.message || error}`
  );
});
