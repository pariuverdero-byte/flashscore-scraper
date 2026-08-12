// verify_and_update_wp.js
// Node.js 18 / 20
// Full WordPress ticket verifier for PariuVerde / GreenBetTips
// - reads deterministic data-* attributes first
// - falls back to displayed bet text for older posts
// - detects finished Flashscore matches robustly
// - tries multiple Flashscore pages for score/stats
// - updates only the status cell in WordPress
// - detailed diagnostics

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* =========================================================
 * CONFIG
 * ========================================================= */

const WP_BASE = String(process.env.WP_BASE || "").replace(/\/$/, "");
const WP_USER = process.env.WP_USER || "";
const WP_APP_PASS = process.env.WP_APP_PASS || "";

const FS_BASE = "https://www.flashscore.mobi/match/";

const RECHECK_ONCE = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");
const RECHECK_LAST_N = Math.max(1, Number(process.env.RECHECK_LAST_N || 30));
const MAX_ROWS_PER_POST = Math.max(1, Number(process.env.MAX_ROWS_PER_POST || 10));

const WP_TIMEOUT_MS = Math.max(3000, Number(process.env.WP_TIMEOUT_MS || 15000));
const FS_TIMEOUT_MS = Math.max(3000, Number(process.env.FS_TIMEOUT_MS || 12000));

const WP_RETRIES = Math.max(0, Number(process.env.WP_RETRIES || 2));
const WP_RETRY_DELAY_MS = Math.max(
  500,
  Number(process.env.WP_RETRY_DELAY_MS || 3000)
);

const NON_BLOCKING = !/^(0|false|no)$/i.test(
  process.env.VERIFY_NON_BLOCKING || "true"
);

const WIN = "win";
const LOSS = "loss";

const FS_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9,ro;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
};

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
 * GENERIC HELPERS
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

function truncate(value, maxLength = 280) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  return text.length <= maxLength
    ? text
    : `${text.slice(0, maxLength - 3)}...`;
}

function createAbortController(timeoutMs) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  return {
    controller,
    clear: () => clearTimeout(timeout),
  };
}

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

function parseScore(text) {
  const match = String(text || "").match(
    /(\d+)\s*[:\-]\s*(\d+)/
  );

  if (!match) {
    return null;
  }

  return {
    h: Number(match[1]),
    a: Number(match[2]),
  };
}

/* =========================================================
 * WORDPRESS
 * ========================================================= */

const auth =
  "Basic " +
  Buffer.from(
    `${WP_USER}:${WP_APP_PASS}`
  ).toString("base64");

const WP_HEADERS = {
  Authorization: auth,
  Accept: "application/json",
  "User-Agent":
    "PariuVerde-WordPress-Verifier/3.0",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

function isCaptchaHtml(text) {
  const value = String(text || "").toLowerCase();

  return (
    value.includes("sgcaptcha") ||
    value.includes("challenge-platform") ||
    value.includes("cf-chl-") ||
    value.includes("captcha")
  );
}

async function wordpressRequest(
  url,
  {
    method = "GET",
    body = undefined,
    retries = WP_RETRIES,
  } = {}
) {
  let lastError = null;

  for (
    let attempt = 0;
    attempt <= retries;
    attempt += 1
  ) {
    const {
      controller,
      clear,
    } = createAbortController(
      WP_TIMEOUT_MS
    );

    try {
      console.log(
        `[WP] ${method} ${url} ` +
        `(attempt ${attempt + 1}/${retries + 1})`
      );

      const response = await fetch(
        url,
        {
          method,
          signal: controller.signal,

          headers: {
            ...WP_HEADERS,

            ...(body !== undefined
              ? {
                  "Content-Type":
                    "application/json",
                }
              : {}),
          },

          body:
            body !== undefined
              ? JSON.stringify(body)
              : undefined,
        }
      );

      const text =
        await response.text();

      if (!response.ok) {
        throw new Error(
          `WordPress HTTP ${response.status}: ${truncate(text)}`
        );
      }

      if (!text.trim()) {
        return null;
      }

      try {
        return JSON.parse(text);
      } catch {
        if (
          isCaptchaHtml(text)
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
      lastError =
        error?.name === "AbortError"
          ? new Error(
              `WordPress request timed out after ${WP_TIMEOUT_MS} ms`
            )
          : error;

      console.warn(
        `[WP] Request failed: ${lastError.message}`
      );

      if (
        attempt < retries
      ) {
        const delay =
          WP_RETRY_DELAY_MS *
          (attempt + 1);

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

function wordpressPut(
  url,
  body
) {
  return wordpressRequest(
    url,
    {
      method: "PUT",
      body,
    }
  );
}

/* =========================================================
 * WORDPRESS ROW HELPERS
 * ========================================================= */

function getMatchId($row) {
  /*
   * Current source:
   * data-id saved in HTML.
   */

  const direct = String(
    $row.attr("data-id") ||
    $row.attr("data-match-id") ||
    ""
  ).trim();

  if (
    /^[A-Za-z0-9]+$/.test(
      direct
    )
  ) {
    return direct;
  }

  /*
   * Old posts fallback.
   */

  const href =
    $row
      .find(
        "a[href*='flashscore']"
      )
      .first()
      .attr("href") || "";

  const match =
    href.match(
      /\/match\/([A-Za-z0-9]+)/i
    );

  return match
    ? match[1]
    : null;
}

function isPending($cell) {
  const text = String(
    $cell.text() || ""
  ).trim();

  return (
    !text.includes("✅") &&
    !text.includes("❌")
  );
}

function extractTeams($row) {
  const raw = String(
    $row
      .find("td")
      .eq(0)
      .text() || ""
  )
    .replace(/\s+/g, " ")
    .trim();

  const parts =
    raw.split(
      /\s+[-–—]\s+/
    );

  if (
    parts.length < 2
  ) {
    return null;
  }

  return {
    home:
      parts[0].trim(),

    away:
      parts
        .slice(1)
        .join(" - ")
        .trim(),
  };
}

/* =========================================================
 * STRUCTURAL BET PARSER
 * ========================================================= */

function parseStructuralBet(
  $row
) {
  const originalMarket =
    String(
      $row.attr("data-market") ||
      ""
    ).trim();

  const market =
    originalMarket.toUpperCase();

  const stat =
    normalize(
      $row.attr("data-stat") ||
      ""
    );

  const side =
    normalize(
      $row.attr("data-side") ||
      ""
    );

  const threshold =
    numberValue(
      $row.attr("data-threshold")
    );

  /* =====================
   * 1X2
   * ===================== */

  if (
    [
      "1",
      "HOME",
      "HOME_WIN",
    ].includes(market)
  ) {
    return {
      type: "1x2",
      side: "1",
    };
  }

  if (
    [
      "X",
      "DRAW",
    ].includes(market)
  ) {
    return {
      type: "1x2",
      side: "x",
    };
  }

  if (
    [
      "2",
      "AWAY",
      "AWAY_WIN",
    ].includes(market)
  ) {
    return {
      type: "1x2",
      side: "2",
    };
  }

  /* =====================
   * DOUBLE CHANCE
   * ===================== */

  if (
    [
      "1X",
      "DC_1X",
    ].includes(market)
  ) {
    return {
      type: "double",
      sides: ["1", "x"],
    };
  }

  if (
    [
      "X2",
      "DC_X2",
    ].includes(market)
  ) {
    return {
      type: "double",
      sides: ["x", "2"],
    };
  }

  if (
    [
      "12",
      "DC_12",
    ].includes(market)
  ) {
    return {
      type: "double",
      sides: ["1", "2"],
    };
  }

  /* =====================
   * O2.5 / U2.5
   * ===================== */

  let m =
    market.match(
      /^O(\d+(?:\.\d+)?)$/
    );

  if (m) {
    return {
      type: "goals",
      over: true,
      val: Number(m[1]),
    };
  }

  m =
    market.match(
      /^U(\d+(?:\.\d+)?)$/
    );

  if (m) {
    return {
      type: "goals",
      over: false,
      val: Number(m[1]),
    };
  }

  /* =====================
   * OVER_2_5 / UNDER_2_5
   * ===================== */

  m =
    market.match(
      /^OVER[_\s-]?(\d+)[_.](\d+)$/
    );

  if (m) {
    return {
      type: "goals",
      over: true,
      val: Number(
        `${m[1]}.${m[2]}`
      ),
    };
  }

  m =
    market.match(
      /^UNDER[_\s-]?(\d+)[_.](\d+)$/
    );

  if (m) {
    return {
      type: "goals",
      over: false,
      val: Number(
        `${m[1]}.${m[2]}`
      ),
    };
  }

  /* =====================
   * HUMAN-READABLE MARKET
   * ===================== */

  m =
    normalize(
      originalMarket
    ).match(
      /\b(over|peste)\s*(\d+(?:[.,]\d+)?)\b/
    );

  if (
    m &&
    !stat
  ) {
    return {
      type: "goals",
      over: true,
      val: Number(
        m[2].replace(",", ".")
      ),
    };
  }

  m =
    normalize(
      originalMarket
    ).match(
      /\b(under|sub)\s*(\d+(?:[.,]\d+)?)\b/
    );

  if (
    m &&
    !stat
  ) {
    return {
      type: "goals",
      over: false,
      val: Number(
        m[2].replace(",", ".")
      ),
    };
  }

  /* =====================
   * BTTS
   * ===================== */

  if (
    [
      "BTTS",
      "GG",
      "BTTS_YES",
      "BOTH_TEAMS_TO_SCORE",
    ].includes(market)
  ) {
    return {
      type: "btts",
      yes: true,
    };
  }

  if (
    [
      "BTTS_NO",
      "NG",
    ].includes(market)
  ) {
    return {
      type: "btts",
      yes: false,
    };
  }

  /* =====================
   * CORNERS
   * ===================== */

  if (
    stat.includes("corner") ||
    market.includes("CORNER")
  ) {
    if (
      threshold === null
    ) {
      const mm =
        normalize(
          originalMarket
        ).match(
          /(over|under|peste|sub)\s*(\d+(?:[.,]\d+)?)/
        );

      if (!mm) {
        return null;
      }

      return {
        type: "corners",

        over:
          [
            "over",
            "peste",
          ].includes(
            mm[1]
          ),

        val: Number(
          mm[2].replace(",", ".")
        ),
      };
    }

    const over =
      !(
        market.includes("UNDER") ||
        market.startsWith("U") ||
        stat.includes("under") ||
        stat.includes("sub")
      );

    return {
      type: "corners",
      over,
      val: threshold,
    };
  }

  /* =====================
   * CARDS
   * ===================== */

  if (
    stat.includes("card") ||
    stat.includes("cartonas") ||
    market.includes("CARD") ||
    market.includes("CARTON")
  ) {
    if (
      threshold === null
    ) {
      const mm =
        normalize(
          originalMarket
        ).match(
          /(over|under|peste|sub)\s*(\d+(?:[.,]\d+)?)/
        );

      if (!mm) {
        return null;
      }

      return {
        type: "cards",

        over:
          [
            "over",
            "peste",
          ].includes(
            mm[1]
          ),

        val: Number(
          mm[2].replace(",", ".")
        ),
      };
    }

    const over =
      !(
        market.includes("UNDER") ||
        market.startsWith("U") ||
        stat.includes("under") ||
        stat.includes("sub")
      );

    return {
      type: "cards",
      over,
      val: threshold,
    };
  }

  /* =====================
   * TEAM GOALS
   * ===================== */

  if (
    threshold !== null &&
    (
      stat.includes("goal") ||
      stat.includes("gol")
    ) &&
    side
  ) {
    let teamSide =
      null;

    if (
      [
        "home",
        "gazde",
        "1",
      ].includes(side)
    ) {
      teamSide =
        "home";
    }

    if (
      [
        "away",
        "oaspeti",
        "2",
      ].includes(side)
    ) {
      teamSide =
        "away";
    }

    if (teamSide) {
      const over =
        !(
          market.includes("UNDER") ||
          stat.includes("under") ||
          stat.includes("sub")
        );

      return {
        type: "team_goals",
        side: teamSide,
        over,
        val: threshold,
      };
    }
  }

  return null;
}

/* =========================================================
 * FALLBACK TEXT BET PARSER
 * ========================================================= */

function parseBetText(
  text,
  teams = null
) {
  const value =
    normalize(text);

  if (!value) {
    return null;
  }

  if (
    value === "1" ||
    value.includes("home win") ||
    value.includes("victorie gazde")
  ) {
    return {
      type: "1x2",
      side: "1",
    };
  }

  if (
    value === "2" ||
    value.includes("away win") ||
    value.includes("victorie oaspeti")
  ) {
    return {
      type: "1x2",
      side: "2",
    };
  }

  if (
    value === "x" ||
    value.includes("draw") ||
    value.includes("egal")
  ) {
    return {
      type: "1x2",
      side: "x",
    };
  }

  if (
    /(^|\s)1x(\s|$)/i.test(
      value
    )
  ) {
    return {
      type: "double",
      sides: ["1", "x"],
    };
  }

  if (
    /(^|\s)x2(\s|$)/i.test(
      value
    )
  ) {
    return {
      type: "double",
      sides: ["x", "2"],
    };
  }

  if (
    /(^|\s)12(\s|$)/i.test(
      value
    )
  ) {
    return {
      type: "double",
      sides: ["1", "2"],
    };
  }

  if (
    value.includes("both teams") ||
    value.includes("ambele") ||
    value.includes("btts") ||
    value === "gg"
  ) {
    return {
      type: "btts",
      yes:
        !/\b(no|nu|ng)\b/i.test(
          value
        ),
    };
  }

  let m =
    value.match(
      /\b(over|peste|minim|at least)\s*(\d+(?:[.,]\d+)?)/
    );

  if (m) {
    const val =
      Number(
        m[2].replace(",", ".")
      );

    if (
      /corner|cornere/.test(
        value
      )
    ) {
      return {
        type: "corners",
        over: true,
        val,
      };
    }

    if (
      /card|cartonas/.test(
        value
      )
    ) {
      return {
        type: "cards",
        over: true,
        val,
      };
    }

    return {
      type: "goals",
      over: true,
      val,
    };
  }

  m =
    value.match(
      /\b(under|sub)\s*(\d+(?:[.,]\d+)?)/
    );

  if (m) {
    const val =
      Number(
        m[2].replace(",", ".")
      );

    if (
      /corner|cornere/.test(
        value
      )
    ) {
      return {
        type: "corners",
        over: false,
        val,
      };
    }

    if (
      /card|cartonas/.test(
        value
      )
    ) {
      return {
        type: "cards",
        over: false,
        val,
      };
    }

    return {
      type: "goals",
      over: false,
      val,
    };
  }

  m =
    value.match(
      /\bo\s*(\d+(?:\.\d+)?)\b/i
    );

  if (m) {
    return {
      type: "goals",
      over: true,
      val: Number(m[1]),
    };
  }

  m =
    value.match(
      /\bu\s*(\d+(?:\.\d+)?)\b/i
    );

  if (m) {
    return {
      type: "goals",
      over: false,
      val: Number(m[1]),
    };
  }

  if (teams) {
    const home =
      normalize(
        teams.home
      );

    const away =
      normalize(
        teams.away
      );

    let teamSide =
      null;

    if (
      home &&
      value.includes(home)
    ) {
      teamSide =
        "home";
    }

    if (
      away &&
      value.includes(away)
    ) {
      teamSide =
        "away";
    }

    if (teamSide) {
      const tm =
        value.match(
          /\b(over|peste|under|sub)\s*(\d+(?:[.,]\d+)?)/
        );

      if (tm) {
        return {
          type: "team_goals",

          side:
            teamSide,

          over:
            [
              "over",
              "peste",
            ].includes(
              tm[1]
            ),

          val:
            Number(
              tm[2].replace(
                ",",
                "."
              )
            ),
        };
      }
    }
  }

  return null;
}

/* =========================================================
 * FLASHSCORE FETCH
 * ========================================================= */

async function fetchHtml(
  url
) {
  const {
    controller,
    clear,
  } = createAbortController(
    FS_TIMEOUT_MS
  );

  try {
    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,

          redirect:
            "follow",

          headers:
            FS_HEADERS,
        }
      );

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

function cleanPageText($) {
  $(
    "script, style, noscript"
  ).remove();

  return $("body")
    .text()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFinishedStatus(
  text
) {
  const t =
    normalize(text);

  return (
    /\bfinished\b/.test(t) ||
    /\bfull time\b/.test(t) ||
    /\bfinal\b/.test(t) ||
    /\bafter penalties\b/.test(t) ||
    /\bafter extra time\b/.test(t) ||
    /\baet\b/.test(t) ||
    /\bpenalties\b/.test(t) ||
    /^ft\b/.test(t) ||
    /\bft$/.test(t)
  );
}

function extractFinishedScore(
  html
) {
  const $ =
    cheerio.load(
      html || "",
      {
        decodeEntities:
          false,
      }
    );

  const pageText =
    cleanPageText($);

  const statusCandidates =
    [
      $("span.mstat")
        .first()
        .text(),

      $(".mstat")
        .first()
        .text(),

      $(".detailScore__status")
        .first()
        .text(),

      $("[class*='status']")
        .first()
        .text(),
    ]
      .filter(Boolean)
      .join(" ");

  const hasFinishedClass =
    $("a.fin").length > 0 ||
    $(".fin").length > 0 ||
    $("[class~='fin']").length > 0;

  const finished =
    hasFinishedClass ||
    isFinishedStatus(
      statusCandidates
    ) ||
    isFinishedStatus(
      pageText
    );

  if (!finished) {
    return null;
  }

  /*
   * Preferred isolated score elements.
   */

  const selectors = [
    ".detailScore__wrapper",
    ".detailScore__score",
    ".detailScore__matchInfo",
    ".score",
    "h1",
    "h2",
    "h3",
    "strong",
    "b",
  ];

  for (
    const selector
    of selectors
  ) {
    const elements =
      $(selector).toArray();

    for (
      const el
      of elements
    ) {
      const text =
        $(el)
          .text()
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      const m =
        text.match(
          /(?:^|\s)(\d{1,2})\s*[-:]\s*(\d{1,2})(?:\s|$|\()/
        );

      if (m) {
        return {
          h: Number(m[1]),
          a: Number(m[2]),
        };
      }
    }
  }

  /*
   * Score around status.
   */

  const patterns = [
    /(?:Finished|Full Time|Final|FT|AET)[^0-9]{0,80}(\d{1,2})\s*[-:]\s*(\d{1,2})/i,

    /(\d{1,2})\s*[-:]\s*(\d{1,2})[^A-Za-z]{0,80}(?:Finished|Full Time|Final|FT|AET)/i,
  ];

  for (
    const pattern
    of patterns
  ) {
    const m =
      pageText.match(
        pattern
      );

    if (m) {
      return {
        h: Number(m[1]),
        a: Number(m[2]),
      };
    }
  }

  /*
   * Conservative fallback.
   */

  const all =
    [
      ...pageText.matchAll(
        /(?:^|\s)(\d{1,2})\s*[-:]\s*(\d{1,2})(?=\s|$|\()/g
      ),
    ];

  for (
    const m
    of all
  ) {
    const h =
      Number(m[1]);

    const a =
      Number(m[2]);

    if (
      h <= 20 &&
      a <= 20
    ) {
      return {
        h,
        a,
      };
    }
  }

  return null;
}

/* =========================================================
 * FLASHSCORE STATS
 * ========================================================= */

function parseNumericStat(
  value
) {
  const text =
    String(
      value || ""
    )
      .replace("%", "")
      .replace(",", ".")
      .trim();

  const m =
    text.match(
      /-?\d+(?:\.\d+)?/
    );

  return m
    ? Number(m[0])
    : null;
}

function parseFinalStats(
  html
) {
  const $ =
    cheerio.load(
      html || "",
      {
        decodeEntities:
          false,
      }
    );

  let homeCorners =
    null;

  let awayCorners =
    null;

  let homeYellow =
    null;

  let awayYellow =
    null;

  let homeRed =
    null;

  let awayRed =
    null;

  let homeCards =
    null;

  let awayCards =
    null;

  /*
   * Classic mobile format:
   * HOME | LABEL | AWAY
   */

  $("tr").each(
    (
      _,
      tr
    ) => {
      const tds =
        $(tr).find("td");

      if (
        tds.length < 3
      ) {
        return;
      }

      const left =
        parseNumericStat(
          $(tds[0]).text()
        );

      const label =
        normalize(
          $(tds[1]).text()
        );

      const right =
        parseNumericStat(
          $(
            tds[
              tds.length - 1
            ]
          ).text()
        );

      if (
        left === null ||
        right === null ||
        !label
      ) {
        return;
      }

      if (
        label.includes(
          "corner kick"
        ) ||
        label === "corners" ||
        label.includes(
          "cornere"
        )
      ) {
        homeCorners =
          left;

        awayCorners =
          right;
      }

      else if (
        label.includes(
          "yellow card"
        ) ||
        label.includes(
          "cartonase galbene"
        )
      ) {
        homeYellow =
          left;

        awayYellow =
          right;
      }

      else if (
        label.includes(
          "red card"
        ) ||
        label.includes(
          "cartonase rosii"
        )
      ) {
        homeRed =
          left;

        awayRed =
          right;
      }

      else if (
        label === "cards" ||
        label.includes(
          "total cards"
        ) ||
        label === "cartonase"
      ) {
        homeCards =
          left;

        awayCards =
          right;
      }
    }
  );

  /*
   * Generic fallback.
   */

  if (
    homeCorners === null ||
    homeYellow === null
  ) {
    $(
      "div, li, section"
    ).each(
      (
        _,
        el
      ) => {
        const text =
          $(el)
            .text()
            .replace(
              /\s+/g,
              " "
            )
            .trim();

        const n =
          normalize(text);

        if (
          !text ||
          text.length > 180
        ) {
          return;
        }

        const nums =
          [
            ...text.matchAll(
              /\b\d+(?:[.,]\d+)?\b/g
            ),
          ].map(
            (
              match
            ) =>
              Number(
                match[0].replace(
                  ",",
                  "."
                )
              )
          );

        if (
          nums.length < 2
        ) {
          return;
        }

        const left =
          nums[0];

        const right =
          nums[
            nums.length - 1
          ];

        if (
          homeCorners === null &&
          (
            n.includes(
              "corner kicks"
            ) ||
            n.includes(
              "corners"
            ) ||
            n.includes(
              "cornere"
            )
          )
        ) {
          homeCorners =
            left;

          awayCorners =
            right;
        }

        if (
          homeYellow === null &&
          (
            n.includes(
              "yellow cards"
            ) ||
            n.includes(
              "cartonase galbene"
            )
          )
        ) {
          homeYellow =
            left;

          awayYellow =
            right;
        }

        if (
          homeRed === null &&
          (
            n.includes(
              "red cards"
            ) ||
            n.includes(
              "cartonase rosii"
            )
          )
        ) {
          homeRed =
            left;

          awayRed =
            right;
        }

        if (
          homeCards === null &&
          (
            n.includes(
              "total cards"
            ) ||
            n === "cards" ||
            n.includes(
              "cartonase total"
            )
          )
        ) {
          homeCards =
            left;

          awayCards =
            right;
        }
      }
    );
  }

  const corners =
    homeCorners !== null &&
    awayCorners !== null
      ? homeCorners +
        awayCorners
      : null;

  const yellow =
    homeYellow !== null &&
    awayYellow !== null
      ? homeYellow +
        awayYellow
      : null;

  const red =
    homeRed !== null &&
    awayRed !== null
      ? homeRed +
        awayRed
      : null;

  const explicitCards =
    homeCards !== null &&
    awayCards !== null
      ? homeCards +
        awayCards
      : null;

  const cards =
    explicitCards !== null
      ? explicitCards

      : (
          yellow !== null ||
          red !== null
        )
        ? (
            yellow || 0
          ) +
          (
            red || 0
          )

        : null;

  return {
    corners,
    cards,
    yellow,
    red,
  };
}

/* =========================================================
 * FLASHSCORE RESULT FETCHER
 * ========================================================= */

async function fetchFirstUsefulPage(
  urls,
  parser,
  description,
  matchId
) {
  let lastError =
    null;

  for (
    const url
    of urls
  ) {
    try {
      const html =
        await fetchHtml(
          url
        );

      const parsed =
        parser(html);

      if (parsed) {
        console.log(
          `[FS] ${matchId}: ${description} detected via ${url}`
        );

        return {
          parsed,
          html,
          url,
        };
      }
    } catch (error) {
      lastError =
        error;

      console.warn(
        `[FS] ${matchId}: ${description} page failed ${url}: ${error.message}`
      );
    }
  }

  if (lastError) {
    console.warn(
      `[FS] ${matchId}: no usable ${description} page found`
    );
  }

  return null;
}

async function fetchFlashscore(
  matchId
) {
  const base =
    `${FS_BASE}${matchId}/`;

  try {
    /*
     * Try both main page
     * and score tab.
     */

    const scoreResult =
      await fetchFirstUsefulPage(
        [
          base,
          `${base}?s=1`,
        ],

        extractFinishedScore,

        "finished score",

        matchId
      );

    if (!scoreResult) {
      console.log(
        `[FS] ${matchId}: not finished OR final score not detected`
      );

      return null;
    }

    const ft =
      scoreResult.parsed;

    let stats = {
      corners: null,
      cards: null,
      yellow: null,
      red: null,
    };

    /*
     * Try both stats formats.
     * Stats failure does NOT block
     * goals / BTTS / 1X2.
     */

    for (
      const statsUrl
      of [
        `${base}?s=2`,
        `${base}?t=stats`,
      ]
    ) {
      try {
        const statsHtml =
          await fetchHtml(
            statsUrl
          );

        const parsed =
          parseFinalStats(
            statsHtml
          );

        if (
          parsed.corners !== null ||
          parsed.cards !== null ||
          parsed.yellow !== null ||
          parsed.red !== null
        ) {
          stats =
            parsed;

          console.log(
            `[FS] ${matchId}: stats detected via ${statsUrl}`
          );

          break;
        }
      } catch (error) {
        console.warn(
          `[FS] ${matchId}: stats page failed ${statsUrl}: ${error.message}`
        );
      }
    }

    console.log(
      `[FS] ${matchId}: FINISHED ${ft.h}-${ft.a}` +

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
      ...stats,
    };
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      console.warn(
        `[FS] ${matchId}: request timed out`
      );
    } else {
      console.warn(
        `[FS] ${matchId}: ${
          error?.message ||
          error
        }`
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
  if (bet.over) {
    return actual > bet.val
      ? WIN
      : LOSS;
  }

  return actual < bet.val
    ? WIN
    : LOSS;
}

function evalBet(
  bet,
  data
) {
  if (
    !bet ||
    !data?.ft
  ) {
    return null;
  }

  const ft =
    data.ft;

  const totalGoals =
    ft.h + ft.a;

  if (
    bet.type === "1x2"
  ) {
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

  if (
    bet.type === "double"
  ) {
    const result =
      ft.h > ft.a
        ? "1"

        : ft.h < ft.a
          ? "2"

          : "x";

    return bet.sides.includes(
      result
    )
      ? WIN
      : LOSS;
  }

  if (
    bet.type === "btts"
  ) {
    const yes =
      ft.h > 0 &&
      ft.a > 0;

    return yes === bet.yes
      ? WIN
      : LOSS;
  }

  if (
    bet.type === "goals"
  ) {
    return evalThreshold(
      totalGoals,
      bet
    );
  }

  if (
    bet.type === "team_goals"
  ) {
    const goals =
      bet.side === "home"
        ? ft.h
        : ft.a;

    return evalThreshold(
      goals,
      bet
    );
  }

  if (
    bet.type === "corners"
  ) {
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

  if (
    bet.type === "cards"
  ) {
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

  if (
    bet.type === "combo"
  ) {
    const results =
      bet.parts.map(
        (
          part
        ) =>
          evalBet(
            part,
            data
          )
      );

    if (
      results.some(
        (
          result
        ) =>
          !result
      )
    ) {
      return null;
    }

    return results.every(
      (
        result
      ) =>
        result === WIN
    )
      ? WIN
      : LOSS;
  }

  return null;
}

/* =========================================================
 * PROCESS ONE POST
 * ========================================================= */

async function processPost(
  postSummary
) {
  const postId =
    postSummary.id;

  const postUrl =
    `${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`;

  let post;

  try {
    post =
      await wordpressGet(
        postUrl
      );
  } catch (error) {
    console.warn(
      `[POST ${postId}] Read failed: ${error.message}`
    );

    return {
      postId,
      status:
        "read_failed",

      rowsFound: 0,
      pendingRows: 0,
      parsedRows: 0,
      finishedRows: 0,
      evaluated: 0,
      noMatchId: 0,
      unsupported: 0,
      statsUnavailable: 0,
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
      unsupported: 0,
      statsUnavailable: 0,
    };
  }

  /*
   * HTML fragment mode.
   * Prevents <html><body> being added
   * to WordPress content.
   */

  const $ =
    cheerio.load(
      content,
      null,
      false
    );

  let rows =
    $(
      "table.bilet-pariu tbody tr"
    ).toArray();

  if (
    !rows.length
  ) {
    rows =
      $("tr[data-id]")
        .toArray();
  }

  if (
    !rows.length
  ) {
    return {
      postId,
      status:
        "no_ticket",

      rowsFound: 0,
      pendingRows: 0,
      parsedRows: 0,
      finishedRows: 0,
      evaluated: 0,
      noMatchId: 0,
      unsupported: 0,
      statsUnavailable: 0,
    };
  }

  let pendingRows = 0;
  let parsedRows = 0;
  let finishedRows = 0;
  let evaluated = 0;
  let noMatchId = 0;
  let unsupported = 0;
  let statsUnavailable = 0;

  let checked = 0;
  let changed = false;

  for (
    const row
    of rows
  ) {
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

    if (
      cells.length < 2
    ) {
      continue;
    }

    /*
     * Status is last column.
     */

    const $status =
      cells.last();

    if (
      !RECHECK_ONCE &&
      !isPending($status)
    ) {
      continue;
    }

    pendingRows += 1;

    const matchId =
      getMatchId(
        $row
      );

    if (!matchId) {
      noMatchId += 1;

      console.warn(
        `[POST ${postId}] Row skipped: no Flashscore match ID`
      );

      continue;
    }

    /*
     * Primary:
     * data-market etc.
     */

    let bet =
      parseStructuralBet(
        $row
      );

    /*
     * Fallback:
     * old post text.
     */

    if (!bet) {
      const teams =
        extractTeams(
          $row
        );

      const betCell =
        cells.length >= 4
          ? cells.eq(3)

          : cells.eq(
              Math.max(
                0,
                cells.length - 2
              )
            );

      const betText =
        betCell
          .find("strong")
          .first()
          .text() ||
        betCell.text();

      bet =
        parseBetText(
          betText,
          teams
        );
    }

    if (!bet) {
      unsupported += 1;

      console.warn(
        `[POST ${postId}] Unsupported bet` +

        ` | match=${matchId}` +

        ` | market=${
          $row.attr(
            "data-market"
          ) || "-"
        }` +

        ` | stat=${
          $row.attr(
            "data-stat"
          ) || "-"
        }` +

        ` | side=${
          $row.attr(
            "data-side"
          ) || "-"
        }` +

        ` | threshold=${
          $row.attr(
            "data-threshold"
          ) || "-"
        }`
      );

      continue;
    }

    parsedRows += 1;
    checked += 1;

    console.log(
      `[POST ${postId}] Checking ${matchId}` +

      ` | market=${
        $row.attr(
          "data-market"
        ) || "-"
      }` +

      ` | parsed=${JSON.stringify(
        bet
      )}`
    );

    const data =
      await fetchFlashscore(
        matchId
      );

    if (!data) {
      continue;
    }

    finishedRows += 1;

    const result =
      evalBet(
        bet,
        data
      );

    if (!result) {
      if (
        (
          bet.type ===
          "corners" &&
          !Number.isFinite(
            data.corners
          )
        ) ||

        (
          bet.type ===
          "cards" &&
          !Number.isFinite(
            data.cards
          )
        )
      ) {
        statsUnavailable += 1;

        console.warn(
          `[POST ${postId}] ${matchId}: match finished, but required ${bet.type} stats are unavailable`
        );
      } else {
        console.warn(
          `[POST ${postId}] ${matchId}: finished but bet could not be evaluated`
        );
      }

      continue;
    }

    $status.text(
      result === WIN
        ? "✅"
        : "❌"
    );

    $row.attr(
      "data-status",

      result === WIN
        ? "win"
        : "loss"
    );

    changed =
      true;

    evaluated += 1;

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

    ` unsupported=${unsupported}` +

    ` stats_unavailable=${statsUnavailable}`
  );

  if (!changed) {
    return {
      postId,
      status:
        "no_changes",

      rowsFound:
        rows.length,

      pendingRows,
      parsedRows,
      finishedRows,
      evaluated,
      noMatchId,
      unsupported,
      statsUnavailable,
    };
  }

  try {
    await wordpressPut(
      `${WP_BASE}/wp-json/wp/v2/posts/${postId}`,

      {
        content:
          $.html(),
      }
    );

    console.log(
      `[POST ${postId}] WordPress updated successfully.`
    );

    return {
      postId,
      status:
        "updated",

      rowsFound:
        rows.length,

      pendingRows,
      parsedRows,
      finishedRows,
      evaluated,
      noMatchId,
      unsupported,
      statsUnavailable,
    };
  } catch (error) {
    console.warn(
      `[POST ${postId}] WordPress update failed: ${error.message}`
    );

    return {
      postId,
      status:
        "update_failed",

      rowsFound:
        rows.length,

      pendingRows,
      parsedRows,
      finishedRows,
      evaluated,
      noMatchId,
      unsupported,
      statsUnavailable,
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

    `?per_page=${Math.min(
      RECHECK_LAST_N,
      100
    )}` +

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

    if (
      NON_BLOCKING
    ) {
      console.warn(
        "[VERIFY] Non-blocking mode enabled."
      );

      return {
        status:
          "wordpress_error",

        processed: 0,
      };
    }

    throw error;
  }

  if (
    !Array.isArray(posts)
  ) {
    throw new Error(
      "WordPress posts endpoint did not return an array."
    );
  }

  console.log(
    `[WP] Posts loaded: ${posts.length}`
  );

  const results = [];

  for (
    const post
    of posts
  ) {
    try {
      results.push(
        await processPost(
          post
        )
      );
    } catch (error) {
      console.error(
        `[POST ${post?.id}] Unexpected error: ${error.message}`
      );

      results.push({
        postId:
          post?.id,

        status:
          "error",

        rowsFound: 0,
        pendingRows: 0,
        parsedRows: 0,
        finishedRows: 0,
        evaluated: 0,
        noMatchId: 0,
        unsupported: 0,
        statsUnavailable: 0,
      });
    }
  }

  const sum =
    (
      key
    ) =>
      results.reduce(
        (
          total,
          item
        ) =>
          total +
          Number(
            item[key] || 0
          ),
        0
      );

  const updated =
    results.filter(
      (
        r
      ) =>
        r.status ===
        "updated"
    ).length;

  const errors =
    results.filter(
      (
        r
      ) =>
        [
          "read_failed",
          "update_failed",
          "error",
        ].includes(
          r.status
        )
    ).length;

  const rowsFound =
    sum(
      "rowsFound"
    );

  const pendingRows =
    sum(
      "pendingRows"
    );

  const parsedRows =
    sum(
      "parsedRows"
    );

  const finishedRows =
    sum(
      "finishedRows"
    );

  const evaluated =
    sum(
      "evaluated"
    );

  const noMatchId =
    sum(
      "noMatchId"
    );

  const unsupported =
    sum(
      "unsupported"
    );

  const statsUnavailable =
    sum(
      "statsUnavailable"
    );

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
    `Finished rows missing required stats: ${statsUnavailable}`
  );

  console.log(
    `Post errors: ${errors}`
  );

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

    console.log(
      "[VERIFY] Bets parsed correctly, but no checked match was detected as finished."
    );
  }

  else if (
    finishedRows > 0 &&
    evaluated === 0 &&
    statsUnavailable > 0
  ) {
    finalStatus =
      "warning_stats_unavailable";

    console.warn(
      "[VERIFY WARNING] Finished matches were found, but required market statistics were unavailable."
    );
  }

  else if (
    finishedRows > 0 &&
    evaluated === 0
  ) {
    finalStatus =
      "warning_finished_not_evaluated";

    console.warn(
      "[VERIFY WARNING] Finished matches were found but no market could be evaluated."
    );
  }

  return {
    status:
      finalStatus,

    processed:
      results.length,

    updated,
    rowsFound,
    pendingRows,
    parsedRows,
    finishedRows,
    evaluated,
    noMatchId,
    unsupported,
    statsUnavailable,
    errors,
  };
}

/* =========================================================
 * RUN
 * ========================================================= */

main()
  .then(
    (
      summary
    ) => {
      console.log(
        `[VERIFY] Final status: ${
          summary?.status ||
          "completed"
        }`
      );
    }
  )

  .catch(
    (
      error
    ) => {
      console.error("");

      console.error(
        "[VERIFY] Fatal error:"
      );

      console.error(
        error?.stack ||
        error?.message ||
        String(error)
      );

      if (
        NON_BLOCKING
      ) {
        console.warn(
          "[VERIFY] Non-blocking mode enabled. Exiting with code 0."
        );

        process.exit(0);
      }

      process.exit(1);
    }
  );
