// verify_and_update_wp.js
// Node.js 18 / 20
// Verifica biletele publicate in WordPress si actualizeaza statusul cu ✅ / ❌
//
// FIX major:
// - citeste pariul prioritar din data-market / data-stat / data-side / data-threshold
// - NU mai depinde de formularea AI afisata in articol
// - foloseste data-id pentru Flashscore match ID
// - pastreaza compatibilitate cu articolele vechi
// - log detaliat pentru rows / pending / parsed / finished / evaluated
// - nu adauga <html><head><body> in continutul WordPress

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* =========================================================
 * CONFIG
 * ========================================================= */

const WP_BASE = String(process.env.WP_BASE || "").replace(/\/$/, "");
const WP_USER = process.env.WP_USER || "";
const WP_APP_PASS = process.env.WP_APP_PASS || "";

const FS_BASE = "https://www.flashscore.mobi/match/";

const RECHECK_ONCE =
  /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");

const RECHECK_LAST_N = Math.max(
  1,
  Number(process.env.RECHECK_LAST_N || 30)
);

const MAX_ROWS_PER_POST = Math.max(
  1,
  Number(process.env.MAX_ROWS_PER_POST || 10)
);

const WP_TIMEOUT_MS = Math.max(
  3000,
  Number(process.env.WP_TIMEOUT_MS || 15000)
);

const FS_TIMEOUT_MS = Math.max(
  3000,
  Number(process.env.FS_TIMEOUT_MS || 10000)
);

const WP_RETRIES = Math.max(
  0,
  Number(process.env.WP_RETRIES || 2)
);

const WP_RETRY_DELAY_MS = Math.max(
  500,
  Number(process.env.WP_RETRY_DELAY_MS || 3000)
);

const NON_BLOCKING =
  !/^(0|false|no)$/i.test(
    process.env.VERIFY_NON_BLOCKING || "true"
  );

const WIN = "win";
const LOSS = "loss";

/* =========================================================
 * CONFIG VALIDATION
 * ========================================================= */

function validateConfiguration() {
  const missing = [];

  if (!WP_BASE) missing.push("WP_BASE");
  if (!WP_USER) missing.push("WP_USER");
  if (!WP_APP_PASS) missing.push("WP_APP_PASS");

  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

/* =========================================================
 * HELPERS
 * ========================================================= */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s.+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, maxLength = 250) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLength) return text;

  return `${text.slice(0, maxLength - 3)}...`;
}

function createAbortController(timeoutMs) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  return {
    controller,
    clear: () => clearTimeout(timeout)
  };
}

/* =========================================================
 * WORDPRESS
 * ========================================================= */

const auth =
  "Basic " +
  Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const WP_HEADERS = {
  Authorization: auth,
  Accept: "application/json",
  "User-Agent": "PariuVerde-WordPress-Verifier/2.0",
  "Cache-Control": "no-cache",
  Pragma: "no-cache"
};

async function wordpressRequest(
  url,
  {
    method = "GET",
    body = undefined,
    retries = WP_RETRIES
  } = {}
) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { controller, clear } =
      createAbortController(WP_TIMEOUT_MS);

    try {
      console.log(
        `[WP] ${method} ${url} ` +
        `(attempt ${attempt + 1}/${retries + 1})`
      );

      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          ...WP_HEADERS,
          ...(body !== undefined
            ? { "Content-Type": "application/json" }
            : {})
        },
        body:
          body !== undefined
            ? JSON.stringify(body)
            : undefined
      });

      const text = await response.text();

      if (!response.ok) {
        throw new Error(
          `WordPress HTTP ${response.status}: ${truncate(text)}`
        );
      }

      if (!text.trim()) return null;

      try {
        return JSON.parse(text);
      } catch {
        if (
          /sgcaptcha|captcha|cf-chl-|challenge-platform/i.test(text)
        ) {
          throw new Error(
            "WordPress REST API blocked by CAPTCHA/security layer."
          );
        }

        throw new Error(
          `WordPress returned invalid JSON: ${truncate(text)}`
        );
      }
    } catch (error) {
      lastError = error;

      if (error?.name === "AbortError") {
        lastError = new Error(
          `WordPress request timed out after ${WP_TIMEOUT_MS} ms`
        );
      }

      console.warn(
        `[WP] Request failed: ${lastError.message}`
      );

      if (attempt < retries) {
        const delay =
          WP_RETRY_DELAY_MS * (attempt + 1);

        console.log(
          `[WP] Retrying in ${delay} ms...`
        );

        await sleep(delay);
      }
    } finally {
      clear();
    }
  }

  throw lastError;
}

function wordpressGet(url) {
  return wordpressRequest(url);
}

function wordpressPut(url, body) {
  return wordpressRequest(url, {
    method: "PUT",
    body
  });
}

/* =========================================================
 * ROW / MATCH HELPERS
 * ========================================================= */

function getMatchId($row) {
  /*
   * IMPORTANT:
   * generate_wp.js already saves:
   *
   * data-id="FLASH_SCORE_ID"
   *
   * This is the canonical source.
   */

  const direct = String(
    $row.attr("data-id") ||
    $row.attr("data-match-id") ||
    ""
  ).trim();

  if (/^[A-Za-z0-9]+$/.test(direct)) {
    return direct;
  }

  /*
   * Fallback for old articles.
   */

  const href =
    $row
      .find("a[href*='flashscore']")
      .first()
      .attr("href") || "";

  const match =
    href.match(/\/match\/([A-Za-z0-9]+)/i);

  return match ? match[1] : null;
}

function isPending($cell) {
  const text = String($cell.text() || "").trim();

  return (
    !text.includes("✅") &&
    !text.includes("❌")
  );
}

function parseScore(text) {
  const match = String(text || "").match(
    /(\d+)\s*[:\-]\s*(\d+)/
  );

  if (!match) return null;

  return {
    h: Number(match[1]),
    a: Number(match[2])
  };
}

function extractTeams($row) {
  const raw = String(
    $row.find("td").eq(0).text() || ""
  )
    .replace(/\s+/g, " ")
    .trim();

  const parts = raw.split(/\s+[-–—]\s+/);

  if (parts.length < 2) return null;

  return {
    home: parts[0].trim(),
    away: parts.slice(1).join(" - ").trim()
  };
}

/* =========================================================
 * STRUCTURAL BET PARSER
 * ========================================================= */

function numberValue(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const n = Number(
    String(value).replace(",", ".")
  );

  return Number.isFinite(n)
    ? n
    : null;
}

/*
 * Parses the deterministic market saved by generate_wp.js.
 *
 * Examples currently present in your project:
 *
 * 1
 * X
 * 2
 * 1X
 * X2
 * 12
 * O2.5
 * U2.5
 * OVER_1_5
 * OVER_2_5
 * BTTS
 * BTTS_AND_WIN
 *
 * Also supports STAT rows using:
 * data-stat
 * data-side
 * data-threshold
 */

function parseStructuralBet($row) {
  const originalMarket = String(
    $row.attr("data-market") || ""
  ).trim();

  const market = originalMarket.toUpperCase();

  const stat = normalize(
    $row.attr("data-stat") || ""
  );

  const side = normalize(
    $row.attr("data-side") || ""
  );

  const threshold = numberValue(
    $row.attr("data-threshold")
  );

  /* -------------------------
   * 1X2
   * ------------------------- */

  if (
    market === "1" ||
    market === "HOME" ||
    market === "HOME_WIN"
  ) {
    return {
      type: "1x2",
      side: "1"
    };
  }

  if (
    market === "X" ||
    market === "DRAW"
  ) {
    return {
      type: "1x2",
      side: "x"
    };
  }

  if (
    market === "2" ||
    market === "AWAY" ||
    market === "AWAY_WIN"
  ) {
    return {
      type: "1x2",
      side: "2"
    };
  }

  /* -------------------------
   * Double chance
   * ------------------------- */

  if (
    market === "1X" ||
    market === "DC_1X"
  ) {
    return {
      type: "double",
      sides: ["1", "x"]
    };
  }

  if (
    market === "X2" ||
    market === "DC_X2"
  ) {
    return {
      type: "double",
      sides: ["x", "2"]
    };
  }

  if (
    market === "12" ||
    market === "DC_12"
  ) {
    return {
      type: "double",
      sides: ["1", "2"]
    };
  }

  /* -------------------------
   * O2.5 / U2.5
   * ------------------------- */

  let match =
    market.match(/^O(\d+(?:\.\d+)?)$/);

  if (match) {
    return {
      type: "goals",
      over: true,
      val: Number(match[1])
    };
  }

  match =
    market.match(/^U(\d+(?:\.\d+)?)$/);

  if (match) {
    return {
      type: "goals",
      over: false,
      val: Number(match[1])
    };
  }

  /* -------------------------
   * OVER_2_5 / UNDER_2_5
   * ------------------------- */

  match =
    market.match(
      /^OVER[_\s-]?(\d+)[_.](\d+)$/
    );

  if (match) {
    return {
      type: "goals",
      over: true,
      val: Number(
        `${match[1]}.${match[2]}`
      )
    };
  }

  match =
    market.match(
      /^UNDER[_\s-]?(\d+)[_.](\d+)$/
    );

  if (match) {
    return {
      type: "goals",
      over: false,
      val: Number(
        `${match[1]}.${match[2]}`
      )
    };
  }

  /* -------------------------
   * BTTS
   * ------------------------- */

  if (
    market === "BTTS" ||
    market === "GG" ||
    market === "BTTS_YES"
  ) {
    return {
      type: "btts",
      yes: true
    };
  }

  if (
    market === "BTTS_NO" ||
    market === "NG"
  ) {
    return {
      type: "btts",
      yes: false
    };
  }

  /* -------------------------
   * STAT markets
   * ------------------------- */

  if (
    stat.includes("corner") ||
    market.includes("CORNER")
  ) {
    if (threshold === null) {
      return null;
    }

    const over =
      !(
        market.includes("UNDER") ||
        market.startsWith("U") ||
        stat.includes("under")
      );

    return {
      type: "corners",
      over,
      val: threshold
    };
  }

  if (
    stat.includes("card") ||
    stat.includes("cartonas") ||
    market.includes("CARD")
  ) {
    if (threshold === null) {
      return null;
    }

    const over =
      !(
        market.includes("UNDER") ||
        market.startsWith("U") ||
        stat.includes("under")
      );

    return {
      type: "cards",
      over,
      val: threshold
    };
  }

  /*
   * Team goals, daca exista side + threshold.
   */

  if (
    threshold !== null &&
    (
      stat.includes("goal") ||
      stat.includes("gol")
    ) &&
    side
  ) {
    const over =
      !(
        market.includes("UNDER") ||
        stat.includes("under")
      );

    let teamSide = null;

    if (
      side === "home" ||
      side === "gazde" ||
      side === "1"
    ) {
      teamSide = "home";
    }

    if (
      side === "away" ||
      side === "oaspeti" ||
      side === "2"
    ) {
      teamSide = "away";
    }

    if (teamSide) {
      return {
        type: "team_goals",
        side: teamSide,
        over,
        val: threshold
      };
    }
  }

  return null;
}

/* =========================================================
 * FALLBACK TEXT PARSER
 * Used only for old WordPress posts
 * ========================================================= */

function parseBetText(text, teams = null) {
  const value = normalize(text);

  if (!value) return null;

  /* 1X2 */

  if (
    value === "1" ||
    value.includes("home win") ||
    value.includes("victorie gazde")
  ) {
    return {
      type: "1x2",
      side: "1"
    };
  }

  if (
    value === "2" ||
    value.includes("away win") ||
    value.includes("victorie oaspeti")
  ) {
    return {
      type: "1x2",
      side: "2"
    };
  }

  if (
    value === "x" ||
    value.includes("draw") ||
    value.includes("egal")
  ) {
    return {
      type: "1x2",
      side: "x"
    };
  }

  /* double chance */

  if (/(^|\s)1x(\s|$)/i.test(value)) {
    return {
      type: "double",
      sides: ["1", "x"]
    };
  }

  if (/(^|\s)x2(\s|$)/i.test(value)) {
    return {
      type: "double",
      sides: ["x", "2"]
    };
  }

  if (/(^|\s)12(\s|$)/i.test(value)) {
    return {
      type: "double",
      sides: ["1", "2"]
    };
  }

  /* BTTS */

  if (
    value.includes("both teams") ||
    value.includes("ambele") ||
    value.includes("btts") ||
    value === "gg"
  ) {
    return {
      type: "btts",
      yes:
        !/\b(no|nu|ng)\b/i.test(value)
    };
  }

  /* over / under */

  let match = value.match(
    /\b(over|peste|minim|at least)\s*(\d+(?:[.,]\d+)?)/
  );

  if (match) {
    const val = Number(
      match[2].replace(",", ".")
    );

    if (/corner|cornere/.test(value)) {
      return {
        type: "corners",
        over: true,
        val
      };
    }

    if (/card|cartonas/.test(value)) {
      return {
        type: "cards",
        over: true,
        val
      };
    }

    return {
      type: "goals",
      over: true,
      val
    };
  }

  match = value.match(
    /\b(under|sub)\s*(\d+(?:[.,]\d+)?)/
  );

  if (match) {
    const val = Number(
      match[2].replace(",", ".")
    );

    if (/corner|cornere/.test(value)) {
      return {
        type: "corners",
        over: false,
        val
      };
    }

    if (/card|cartonas/.test(value)) {
      return {
        type: "cards",
        over: false,
        val
      };
    }

    return {
      type: "goals",
      over: false,
      val
    };
  }

  /*
   * O2.5 / U2.5
   */

  match = value.match(
    /\bo\s*(\d+(?:\.\d+)?)\b/i
  );

  if (match) {
    return {
      type: "goals",
      over: true,
      val: Number(match[1])
    };
  }

  match = value.match(
    /\bu\s*(\d+(?:\.\d+)?)\b/i
  );

  if (match) {
    return {
      type: "goals",
      over: false,
      val: Number(match[1])
    };
  }

  /*
   * Team goals fallback
   */

  if (teams) {
    const home = normalize(teams.home);
    const away = normalize(teams.away);

    let teamSide = null;

    if (home && value.includes(home)) {
      teamSide = "home";
    }

    if (away && value.includes(away)) {
      teamSide = "away";
    }

    if (teamSide) {
      const teamMatch =
        value.match(
          /\b(over|peste)\s*(\d+(?:\.\d+)?)/
        );

      if (teamMatch) {
        return {
          type: "team_goals",
          side: teamSide,
          over: true,
          val: Number(teamMatch[2])
        };
      }
    }
  }

  return null;
}

/* =========================================================
 * FLASHSCORE
 * ========================================================= */

function parseFinalStats(html) {
  const $ = cheerio.load(html || "");

  let corners = null;
  let yellow = null;
  let red = null;
  let genericCards = null;

  $("tr").each((_, tr) => {
    const tds = $(tr).find("td");

    if (tds.length !== 3) return;

    const left = Number(
      $(tds[0])
        .text()
        .trim()
        .replace(",", ".")
    );

    const label = normalize(
      $(tds[1]).text()
    );

    const right = Number(
      $(tds[2])
        .text()
        .trim()
        .replace(",", ".")
    );

    if (
      !Number.isFinite(left) ||
      !Number.isFinite(right)
    ) {
      return;
    }

    if (
      label.includes("corner kick") ||
      label === "corners" ||
      label.includes("cornere")
    ) {
      corners = left + right;
    }

    else if (
      label.includes("yellow card") ||
      label.includes("cartonase galbene")
    ) {
      yellow = left + right;
    }

    else if (
      label.includes("red card") ||
      label.includes("cartonase rosii")
    ) {
      red = left + right;
    }

    else if (
      label === "cards" ||
      label === "total cards" ||
      label === "cartonase"
    ) {
      genericCards = left + right;
    }
  });

  const cards =
    genericCards ??
    (
      yellow !== null ||
      red !== null
        ? (yellow || 0) + (red || 0)
        : null
    );

  return {
    corners,
    cards,
    yellow,
    red
  };
}

async function fetchHtml(
  url,
  timeoutMs = FS_TIMEOUT_MS
) {
  const { controller, clear } =
    createAbortController(timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept:
          "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
      }
    });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    return await response.text();
  } finally {
    clear();
  }
}

function extractFinishedScore(html) {
  const $ = cheerio.load(html || "");

  /*
   * Remove scripts and styles to reduce garbage.
   */

  $("script, style, noscript").remove();

  let body = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim();

  /*
   * Avoid parsing "first leg result" as FT.
   */

  body = body
    .replace(
      /First leg result\s*:\s*\d+\s*[-:]\s*\d+/gi,
      " "
    )
    .replace(
      /Rezultatul primei manse\s*:\s*\d+\s*[-:]\s*\d+/gi,
      " "
    );

  const finished =
    /\bFinished\b|\bFT\b|\bAET\b|After Penalties|After Extra Time|Final/i.test(
      body
    );

  if (!finished) {
    return null;
  }

  /*
   * Look for score patterns.
   */

  const scorePatterns = [
    /Finished.*?(\d+)\s*[-:]\s*(\d+)/i,
    /\bFT\b.*?(\d+)\s*[-:]\s*(\d+)/i,
    /(\d+)\s*[-:]\s*(\d+).*?\bFinished\b/i,
    /(\d+)\s*[-:]\s*(\d+).*?\bFT\b/i
  ];

  for (const pattern of scorePatterns) {
    const match = body.match(pattern);

    if (match) {
      return {
        h: Number(match[1]),
        a: Number(match[2])
      };
    }
  }

  /*
   * Last-resort fallback.
   */

  return parseScore(body);
}

async function fetchFlashscore(matchId) {
  const base =
    `${FS_BASE}${matchId}/`;

  try {
    const scoreUrl =
      `${base}?s=1`;

    const html =
      await fetchHtml(scoreUrl);

    const ft =
      extractFinishedScore(html);

    if (!ft) {
      return null;
    }

    let stats = {
      corners: null,
      cards: null,
      yellow: null,
      red: null
    };

    try {
      const statsHtml =
        await fetchHtml(
          `${base}?s=2`
        );

      stats =
        parseFinalStats(statsHtml);
    } catch (error) {
      console.warn(
        `[FS] ${matchId}: stats unavailable: ${error.message}`
      );
    }

    console.log(
      `[FS] ${matchId}: FT ${ft.h}-${ft.a}` +
      (
        stats.corners !== null
          ? ` | corners=${stats.corners}`
          : ""
      ) +
      (
        stats.cards !== null
          ? ` | cards=${stats.cards}`
          : ""
      )
    );

    return {
      ft,
      ...stats
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      console.warn(
        `[FS] ${matchId}: request timed out`
      );
    } else {
      console.warn(
        `[FS] ${matchId}: ${error.message}`
      );
    }

    return null;
  }
}

/* =========================================================
 * BET EVALUATION
 * ========================================================= */

function evalThreshold(
  actual,
  bet
) {
  /*
   * Betting lines such as 2.5:
   *
   * OVER 2.5 => 3+
   * UNDER 2.5 => 0,1,2
   *
   * If integer threshold somehow appears:
   * over 2 => require >2
   * under 2 => require <2
   *
   * Pushes are not currently generated by the ticket engine.
   */

  if (bet.over) {
    return actual > bet.val
      ? WIN
      : LOSS;
  }

  return actual < bet.val
    ? WIN
    : LOSS;
}

function evalBet(bet, data) {
  if (!bet || !data?.ft) {
    return null;
  }

  const ft = data.ft;

  const totalGoals =
    ft.h + ft.a;

  if (bet.type === "1x2") {
    const result =
      ft.h > ft.a
        ? "1"
        : ft.h < ft.a
          ? "2"
          : "x";

    return result === bet.side
      ? WIN
      : LOSS;
  }

  if (bet.type === "double") {
    const result =
      ft.h > ft.a
        ? "1"
        : ft.h < ft.a
          ? "2"
          : "x";

    return bet.sides.includes(result)
      ? WIN
      : LOSS;
  }

  if (bet.type === "btts") {
    const yes =
      ft.h > 0 &&
      ft.a > 0;

    return yes === bet.yes
      ? WIN
      : LOSS;
  }

  if (bet.type === "goals") {
    return evalThreshold(
      totalGoals,
      bet
    );
  }

  if (bet.type === "team_goals") {
    const goals =
      bet.side === "home"
        ? ft.h
        : ft.a;

    return evalThreshold(
      goals,
      bet
    );
  }

  if (bet.type === "corners") {
    if (
      !Number.isFinite(
        data.corners
      )
    ) {
      return null;
    }

    return evalThreshold(
      data.corners,
      bet
    );
  }

  if (bet.type === "cards") {
    if (
      !Number.isFinite(
        data.cards
      )
    ) {
      return null;
    }

    return evalThreshold(
      data.cards,
      bet
    );
  }

  if (bet.type === "combo") {
    const results =
      bet.parts.map(
        (part) =>
          evalBet(part, data)
      );

    if (
      results.some(
        (result) => !result
      )
    ) {
      return null;
    }

    return results.every(
      (result) =>
        result === WIN
    )
      ? WIN
      : LOSS;
  }

  return null;
}

/* =========================================================
 * PROCESS POST
 * ========================================================= */

async function processPost(postSummary) {
  const postId =
    postSummary.id;

  const postUrl =
    `${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`;

  let post;

  try {
    post =
      await wordpressGet(postUrl);
  } catch (error) {
    console.warn(
      `[POST ${postId}] Read failed: ${error.message}`
    );

    return {
      postId,
      status: "read_failed",
      rowsFound: 0,
      pendingRows: 0,
      parsedRows: 0,
      finishedRows: 0,
      evaluated: 0,
      noMatchId: 0,
      unsupported: 0
    };
  }

  const content =
    post?.content?.raw ||
    post?.content?.rendered ||
    "";

  if (!content) {
    return {
      postId,
      status: "empty",
      rowsFound: 0,
      pendingRows: 0,
      parsedRows: 0,
      finishedRows: 0,
      evaluated: 0,
      noMatchId: 0,
      unsupported: 0
    };
  }

  /*
   * IMPORTANT:
   *
   * false => load as HTML fragment.
   *
   * Otherwise Cheerio can add
   * <html><head><body> around WordPress content.
   */

  const $ =
    cheerio.load(
      content,
      null,
      false
    );

  const rows = [];

  /*
   * Current format.
   */

  $("table.bilet-pariu tbody tr").each(
    (_, row) => {
      rows.push(row);
    }
  );

  /*
   * Fallback for any template variation.
   */

  if (!rows.length) {
    $("tr[data-id]").each(
      (_, row) => {
        rows.push(row);
      }
    );
  }

  if (!rows.length) {
    return {
      postId,
      status: "no_ticket",
      rowsFound: 0,
      pendingRows: 0,
      parsedRows: 0,
      finishedRows: 0,
      evaluated: 0,
      noMatchId: 0,
      unsupported: 0
    };
  }

  let pendingRows = 0;
  let parsedRows = 0;
  let finishedRows = 0;
  let evaluated = 0;

  let noMatchId = 0;
  let unsupported = 0;

  let checked = 0;
  let changed = false;

  for (const row of rows) {
    if (
      checked >=
      MAX_ROWS_PER_POST
    ) {
      break;
    }

    const $row =
      $(row);

    const cells =
      $row.find("td");

    if (cells.length < 2) {
      continue;
    }

    /*
     * Status is ALWAYS last column.
     * Do not hard-code eq(5).
     */

    const $status =
      cells.last();

    if (
      !RECHECK_ONCE &&
      !isPending($status)
    ) {
      continue;
    }

    pendingRows++;

    const matchId =
      getMatchId($row);

    if (!matchId) {
      noMatchId++;

      console.warn(
        `[POST ${postId}] Row skipped: no Flashscore match ID`
      );

      continue;
    }

    /*
     * Primary parser:
     * deterministic HTML data attributes.
     */

    let bet =
      parseStructuralBet($row);

    /*
     * Fallback for old posts only.
     */

    if (!bet) {
      const teams =
        extractTeams($row);

      const betText =
        cells.length >= 4
          ? (
              cells
                .eq(3)
                .find("strong")
                .first()
                .text() ||
              cells.eq(3).text()
            )
          : "";

      bet =
        parseBetText(
          betText,
          teams
        );
    }

    if (!bet) {
      unsupported++;

      console.warn(
        `[POST ${postId}] Unsupported bet | match=${matchId}` +
        ` | market=${$row.attr("data-market") || "-"}` +
        ` | stat=${$row.attr("data-stat") || "-"}` +
        ` | side=${$row.attr("data-side") || "-"}` +
        ` | threshold=${$row.attr("data-threshold") || "-"}`
      );

      continue;
    }

    parsedRows++;
    checked++;

    console.log(
      `[POST ${postId}] Checking ${matchId}` +
      ` | market=${$row.attr("data-market") || "-"}` +
      ` | parsed=${JSON.stringify(bet)}`
    );

    const data =
      await fetchFlashscore(
        matchId
      );

    /*
     * Match not finished yet.
     */

    if (!data) {
      continue;
    }

    finishedRows++;

    const result =
      evalBet(
        bet,
        data
      );

    /*
     * Example:
     * corners market but Flashscore stats unavailable.
     */

    if (!result) {
      console.warn(
        `[POST ${postId}] ${matchId}: finished but market could not be evaluated`
      );

      continue;
    }

    $status.text(
      result === WIN
        ? "✅"
        : "❌"
    );

    /*
     * Also keep row metadata synchronized.
     */

    $row.attr(
      "data-status",
      result === WIN
        ? "win"
        : "loss"
    );

    changed = true;
    evaluated++;

    console.log(
      `[POST ${postId}] ${matchId} => ${
        result === WIN
          ? "WIN ✅"
          : "LOSS ❌"
      }`
    );
  }

  console.log(
    `[POST ${postId}]` +
    ` rows=${rows.length}` +
    ` pending=${pendingRows}` +
    ` parsed=${parsedRows}` +
    ` finished=${finishedRows}` +
    ` evaluated=${evaluated}` +
    ` no_id=${noMatchId}` +
    ` unsupported=${unsupported}`
  );

  if (!changed) {
    return {
      postId,
      status: "no_changes",
      rowsFound: rows.length,
      pendingRows,
      parsedRows,
      finishedRows,
      evaluated,
      noMatchId,
      unsupported
    };
  }

  try {
    const updatedContent =
      $.html();

    await wordpressPut(
      `${WP_BASE}/wp-json/wp/v2/posts/${postId}`,
      {
        content: updatedContent
      }
    );

    console.log(
      `[POST ${postId}] WordPress updated successfully.`
    );

    return {
      postId,
      status: "updated",
      rowsFound: rows.length,
      pendingRows,
      parsedRows,
      finishedRows,
      evaluated,
      noMatchId,
      unsupported
    };
  } catch (error) {
    console.warn(
      `[POST ${postId}] WordPress update failed: ${error.message}`
    );

    return {
      postId,
      status: "update_failed",
      rowsFound: rows.length,
      pendingRows,
      parsedRows,
      finishedRows,
      evaluated,
      noMatchId,
      unsupported
    };
  }
}

/* =========================================================
 * MAIN
 * ========================================================= */

async function main() {
  validateConfiguration();

  console.log("");
  console.log(
    "=========================================="
  );
  console.log(
    "WORDPRESS TICKET VERIFICATION"
  );
  console.log(
    "=========================================="
  );

  console.log(
    `[CONFIG] WordPress: ${WP_BASE}`
  );

  console.log(
    `[CONFIG] Recheck once: ${RECHECK_ONCE}`
  );

  console.log(
    `[CONFIG] Post limit: ${RECHECK_LAST_N}`
  );

  console.log(
    `[CONFIG] Maximum rows per post: ${MAX_ROWS_PER_POST}`
  );

  const postsUrl =
    `${WP_BASE}/wp-json/wp/v2/posts` +
    `?per_page=${Math.min(RECHECK_LAST_N, 100)}` +
    `&orderby=date&order=desc`;

  let posts;

  try {
    posts =
      await wordpressGet(
        postsUrl
      );
  } catch (error) {
    console.error(
      `[VERIFY] Cannot load WordPress posts: ${error.message}`
    );

    if (NON_BLOCKING) {
      console.warn(
        "[VERIFY] Non-blocking mode enabled."
      );

      return {
        status: "wordpress_error",
        processed: 0
      };
    }

    throw error;
  }

  if (!Array.isArray(posts)) {
    throw new Error(
      "WordPress posts endpoint did not return an array."
    );
  }

  console.log(
    `[WP] Posts loaded: ${posts.length}`
  );

  const results = [];

  for (const post of posts) {
    try {
      const result =
        await processPost(post);

      results.push(result);
    } catch (error) {
      console.error(
        `[POST ${post?.id}] Unexpected error: ${error.message}`
      );

      results.push({
        postId: post?.id,
        status: "error",
        rowsFound: 0,
        pendingRows: 0,
        parsedRows: 0,
        finishedRows: 0,
        evaluated: 0,
        noMatchId: 0,
        unsupported: 0
      });
    }
  }

  /* =======================================================
   * SUMMARY
   * ======================================================= */

  const sum =
    (key) =>
      results.reduce(
        (total, item) =>
          total +
          Number(
            item[key] || 0
          ),
        0
      );

  const updated =
    results.filter(
      (r) =>
        r.status === "updated"
    ).length;

  const errors =
    results.filter(
      (r) =>
        [
          "read_failed",
          "update_failed",
          "error"
        ].includes(r.status)
    ).length;

  const rowsFound =
    sum("rowsFound");

  const pendingRows =
    sum("pendingRows");

  const parsedRows =
    sum("parsedRows");

  const finishedRows =
    sum("finishedRows");

  const evaluated =
    sum("evaluated");

  const noMatchId =
    sum("noMatchId");

  const unsupported =
    sum("unsupported");

  console.log("");
  console.log(
    "=========================================="
  );
  console.log(
    "VERIFICATION SUMMARY"
  );
  console.log(
    "=========================================="
  );

  console.log(
    `Posts processed: ${results.length}`
  );

  console.log(
    `Posts updated: ${updated}`
  );

  console.log(
    `Ticket rows found: ${rowsFound}`
  );

  console.log(
    `Pending rows: ${pendingRows}`
  );

  console.log(
    `Bets parsed: ${parsedRows}`
  );

  console.log(
    `Finished matches fetched: ${finishedRows}`
  );

  console.log(
    `Matches evaluated: ${evaluated}`
  );

  console.log(
    `Rows without match ID: ${noMatchId}`
  );

  console.log(
    `Unsupported bet rows: ${unsupported}`
  );

  console.log(
    `Post errors: ${errors}`
  );

  /*
   * Detect exactly the situation from your current workflow:
   *
   * Posts processed: 30
   * Matches evaluated: 0
   * Post errors: 0
   *
   * but rows actually exist.
   */

  let finalStatus =
    errors > 0
      ? "completed_with_errors"
      : "success";

  if (
    rowsFound > 0 &&
    pendingRows > 0 &&
    parsedRows === 0
  ) {
    finalStatus =
      "warning_no_parsed_bets";

    console.warn("");
    console.warn(
      "[VERIFY WARNING] Ticket rows exist, but none could be parsed."
    );
  }

  else if (
    rowsFound > 0 &&
    parsedRows > 0 &&
    finishedRows === 0
  ) {
    finalStatus =
      "success_waiting_for_finished_matches";

    console.log("");
    console.log(
      "[VERIFY] Bets parsed correctly, but no checked match is finished yet."
    );
  }

  else if (
    finishedRows > 0 &&
    evaluated === 0
  ) {
    finalStatus =
      "warning_finished_not_evaluated";

    console.warn("");
    console.warn(
      "[VERIFY WARNING] Finished matches were found but no market could be evaluated."
    );
  }

  return {
    status: finalStatus,
    processed: results.length,
    updated,
    rowsFound,
    pendingRows,
    parsedRows,
    finishedRows,
    evaluated,
    noMatchId,
    unsupported,
    errors
  };
}

/* =========================================================
 * RUN
 * ========================================================= */

main()
  .then((summary) => {
    console.log(
      `[VERIFY] Final status: ${
        summary?.status ||
        "completed"
      }`
    );
  })
  .catch((error) => {
    console.error("");
    console.error(
      "[VERIFY] Fatal error:"
    );

    console.error(
      error?.stack ||
      error?.message ||
      String(error)
    );

    if (NON_BLOCKING) {
      console.warn(
        "[VERIFY] Non-blocking mode enabled. Exiting with code 0."
      );

      process.exit(0);
    }

    process.exit(1);
  });
