import fetch from "node-fetch";
import * as cheerio from "cheerio";

const WP_BASE = String(process.env.WP_BASE || "").replace(/\/$/, "");
const WP_USER = process.env.WP_USER || "";
const WP_APP_PASS = process.env.WP_APP_PASS || "";

const RECHECK_ONCE = /^(1|true|yes)$/i.test(
  process.env.RECHECK_ONCE || ""
);

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
  Number(process.env.FS_TIMEOUT_MS || 12000)
);

const WP_RETRIES = Math.max(
  0,
  Number(process.env.WP_RETRIES || 2)
);

const WP_RETRY_DELAY_MS = Math.max(
  500,
  Number(process.env.WP_RETRY_DELAY_MS || 3000)
);

const NON_BLOCKING = !/^(0|false|no)$/i.test(
  process.env.VERIFY_NON_BLOCKING || "true"
);

const WIN = "win";
const LOSS = "loss";

/*
 * IMPORTANT:
 * Flashscore can return different HTML depending on domain/region.
 * We try several mobile hosts automatically.
 */
const FS_HOSTS = [
  "https://www.flashscore.mobi",
  "https://m.flashscore.co.uk",
  "https://m.flashscore.com.ng",
  "https://m.flashscore.co.za",
  "https://m.flashscore.com.au",
  "https://m.flashscore.info",
];

const FS_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36",
};

/* =========================================================
 * CONFIG
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

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s.+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, max = 240) {
  const s = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  return s.length <= max
    ? s
    : `${s.slice(0, max - 3)}...`;
}

function abortAfter(ms) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    ms
  );

  return {
    controller,
    done: () => clearTimeout(timer),
  };
}

function num(value) {
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

/* =========================================================
 * WORDPRESS
 * ========================================================= */

const wpAuth =
  "Basic " +
  Buffer.from(
    `${WP_USER}:${WP_APP_PASS}`
  ).toString("base64");

async function wpRequest(
  url,
  {
    method = "GET",
    body,
  } = {}
) {
  let lastError;

  for (
    let attempt = 0;
    attempt <= WP_RETRIES;
    attempt++
  ) {
    const {
      controller,
      done,
    } = abortAfter(
      WP_TIMEOUT_MS
    );

    try {
      console.log(
        `[WP] ${method} ${url} ` +
        `(attempt ${attempt + 1}/${WP_RETRIES + 1})`
      );

      const res =
        await fetch(
          url,
          {
            method,

            signal:
              controller.signal,

            headers: {
              Authorization:
                wpAuth,

              Accept:
                "application/json",

              "User-Agent":
                "PariuVerde-WordPress-Verifier/4.0",

              "Cache-Control":
                "no-cache",

              ...(body !== undefined
                ? {
                    "Content-Type":
                      "application/json",
                  }
                : {}),
            },

            body:
              body !== undefined
                ? JSON.stringify(
                    body
                  )
                : undefined,
          }
        );

      const text =
        await res.text();

      if (!res.ok) {
        throw new Error(
          `WordPress HTTP ${res.status}: ${truncate(text)}`
        );
      }

      if (!text.trim()) {
        return null;
      }

      return JSON.parse(
        text
      );
    } catch (e) {
      lastError =
        e?.name ===
        "AbortError"
          ? new Error(
              `WordPress timeout after ${WP_TIMEOUT_MS} ms`
            )
          : e;

      console.warn(
        `[WP] Request failed: ${lastError.message}`
      );

      if (
        attempt <
        WP_RETRIES
      ) {
        await sleep(
          WP_RETRY_DELAY_MS *
            (attempt + 1)
        );
      }
    } finally {
      done();
    }
  }

  throw lastError;
}

/* =========================================================
 * WORDPRESS ROW HELPERS
 * ========================================================= */

function getMatchId(
  $row
) {
  const direct =
    String(
      $row.attr("data-id") ||
      $row.attr(
        "data-match-id"
      ) ||
      ""
    ).trim();

  if (
    /^[A-Za-z0-9]+$/.test(
      direct
    )
  ) {
    return direct;
  }

  const href =
    $row
      .find(
        "a[href*='flashscore']"
      )
      .first()
      .attr("href") ||
    "";

  return (
    href.match(
      /\/match\/([A-Za-z0-9]+)/i
    )?.[1] ||
    href.match(
      /\/meci\/([A-Za-z0-9]+)/i
    )?.[1] ||
    null
  );
}

function isPending(
  $cell
) {
  const text =
    String(
      $cell.text() ||
      ""
    );

  return (
    !text.includes("✅") &&
    !text.includes("❌")
  );
}

function extractTeams(
  $row
) {
  const raw =
    String(
      $row
        .find("td")
        .eq(0)
        .text() ||
      ""
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
 * BET PARSER
 * ========================================================= */

function parseStructuralBet(
  $row
) {
  const rawMarket =
    String(
      $row.attr(
        "data-market"
      ) ||
      ""
    ).trim();

  const market =
    rawMarket.toUpperCase();

  const stat =
    normalize(
      $row.attr(
        "data-stat"
      ) ||
      ""
    );

  const side =
    normalize(
      $row.attr(
        "data-side"
      ) ||
      ""
    );

  const threshold =
    num(
      $row.attr(
        "data-threshold"
      )
    );

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

  if (
    [
      "1X",
      "DC_1X",
    ].includes(market)
  ) {
    return {
      type: "double",
      sides: [
        "1",
        "x",
      ],
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
      sides: [
        "x",
        "2",
      ],
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
      sides: [
        "1",
        "2",
      ],
    };
  }

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

  let m =
    market.match(
      /^O(\d+(?:\.\d+)?)$/
    );

  if (m) {
    return {
      type: "goals",
      over: true,
      val: Number(
        m[1]
      ),
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
      val: Number(
        m[1]
      ),
    };
  }

  m =
    market.match(
      /^OVER[_\s-]?(\d+)[_.](\d+)$/
    );

  if (m) {
    return {
      type: "goals",
      over: true,

      val:
        Number(
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

      val:
        Number(
          `${m[1]}.${m[2]}`
        ),
    };
  }

  /*
   * Current generated market.
   */
  if (
    market ===
      "GOALS_OU" &&
    threshold !== null
  ) {
    const over =
      !side.includes(
        "under"
      ) &&
      !side.includes(
        "sub"
      ) &&
      side !== "u";

    return {
      type: "goals",
      over,
      val: threshold,
    };
  }

  /*
   * Structured stats.
   */
  if (
    market === "STAT" ||
    stat ||
    market.includes(
      "CORNER"
    ) ||
    market.includes(
      "CARD"
    )
  ) {
    const statText =
      `${stat} ${normalize(rawMarket)}`;

    if (
      (
        statText.includes(
          "corner"
        ) ||
        statText.includes(
          "cornere"
        )
      ) &&
      threshold !== null
    ) {
      return {
        type:
          "corners",

        over:
          !(
            side.includes(
              "under"
            ) ||
            side.includes(
              "sub"
            ) ||
            side === "u"
          ),

        val:
          threshold,
      };
    }

    if (
      (
        statText.includes(
          "card"
        ) ||
        statText.includes(
          "cartonas"
        )
      ) &&
      threshold !== null
    ) {
      return {
        type: "cards",

        over:
          !(
            side.includes(
              "under"
            ) ||
            side.includes(
              "sub"
            ) ||
            side === "u"
          ),

        val:
          threshold,
      };
    }
  }

  if (
    threshold !== null &&
    (
      stat.includes(
        "goal"
      ) ||
      stat.includes(
        "gol"
      )
    ) &&
    side
  ) {
    const teamSide =
      [
        "home",
        "gazde",
        "1",
      ].includes(side)
        ? "home"

        : [
            "away",
            "oaspeti",
            "2",
          ].includes(side)
          ? "away"
          : null;

    if (teamSide) {
      return {
        type:
          "team_goals",

        side:
          teamSide,

        over:
          !(
            market.includes(
              "UNDER"
            ) ||
            stat.includes(
              "under"
            ) ||
            stat.includes(
              "sub"
            )
          ),

        val:
          threshold,
      };
    }
  }

  return null;
}

/* =========================================================
 * TEXT FALLBACK PARSER
 * ========================================================= */

function parseBetText(
  text,
  teams = null
) {
  const v =
    normalize(text);

  if (!v) {
    return null;
  }

  if (
    v === "1" ||
    v.includes(
      "home win"
    ) ||
    v.includes(
      "victorie gazde"
    )
  ) {
    return {
      type: "1x2",
      side: "1",
    };
  }

  if (
    v === "2" ||
    v.includes(
      "away win"
    ) ||
    v.includes(
      "victorie oaspeti"
    )
  ) {
    return {
      type: "1x2",
      side: "2",
    };
  }

  if (
    v === "x" ||
    v.includes(
      "draw"
    ) ||
    v.includes(
      "egal"
    )
  ) {
    return {
      type: "1x2",
      side: "x",
    };
  }

  if (
    /(^|\s)1x(\s|$)/.test(
      v
    )
  ) {
    return {
      type:
        "double",

      sides:
        [
          "1",
          "x",
        ],
    };
  }

  if (
    /(^|\s)x2(\s|$)/.test(
      v
    )
  ) {
    return {
      type:
        "double",

      sides:
        [
          "x",
          "2",
        ],
    };
  }

  if (
    /(^|\s)12(\s|$)/.test(
      v
    )
  ) {
    return {
      type:
        "double",

      sides:
        [
          "1",
          "2",
        ],
    };
  }

  if (
    v.includes(
      "both teams"
    ) ||
    v.includes(
      "ambele"
    ) ||
    v.includes(
      "btts"
    ) ||
    v === "gg"
  ) {
    return {
      type:
        "btts",

      yes:
        !/\b(no|nu|ng)\b/.test(
          v
        ),
    };
  }

  let m =
    v.match(
      /\b(over|peste|minim|at least)\s*(\d+(?:[.,]\d+)?)/
    );

  if (m) {
    const val =
      Number(
        m[2].replace(
          ",",
          "."
        )
      );

    if (
      /corner|cornere/.test(
        v
      )
    ) {
      return {
        type:
          "corners",

        over:
          true,

        val,
      };
    }

    if (
      /card|cartonas/.test(
        v
      )
    ) {
      return {
        type:
          "cards",

        over:
          true,

        val,
      };
    }

    return {
      type:
        "goals",

      over:
        true,

      val,
    };
  }

  m =
    v.match(
      /\b(under|sub)\s*(\d+(?:[.,]\d+)?)/
    );

  if (m) {
    const val =
      Number(
        m[2].replace(
          ",",
          "."
        )
      );

    if (
      /corner|cornere/.test(
        v
      )
    ) {
      return {
        type:
          "corners",

        over:
          false,

        val,
      };
    }

    if (
      /card|cartonas/.test(
        v
      )
    ) {
      return {
        type:
          "cards",

        over:
          false,

        val,
      };
    }

    return {
      type:
        "goals",

      over:
        false,

      val,
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

    const teamSide =
      home &&
      v.includes(home)
        ? "home"

        : away &&
          v.includes(away)
          ? "away"
          : null;

    if (teamSide) {
      m =
        v.match(
          /\b(over|peste|under|sub)\s*(\d+(?:[.,]\d+)?)/
        );

      if (m) {
        return {
          type:
            "team_goals",

          side:
            teamSide,

          over:
            [
              "over",
              "peste",
            ].includes(
              m[1]
            ),

          val:
            Number(
              m[2].replace(
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
 * FLASHSCORE HTTP
 * ========================================================= */

async function fetchHtmlDetailed(
  url
) {
  const {
    controller,
    done,
  } = abortAfter(
    FS_TIMEOUT_MS
  );

  try {
    const res =
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

    const html =
      await res.text();

    if (!res.ok) {
      throw new Error(
        `HTTP ${res.status}`
      );
    }

    return {
      html,

      finalUrl:
        res.url,

      status:
        res.status,
    };
  } finally {
    done();
  }
}

function pageText(
  html
) {
  const $ =
    cheerio.load(
      html || ""
    );

  $(
    "script,style,noscript,svg"
  ).remove();

  return $("body")
    .text()
    .replace(
      /\u00a0/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function looksLikeMatchPage(
  html,
  matchId
) {
  const text =
    pageText(html);

  if (
    !text ||
    text.length < 40
  ) {
    return false;
  }

  const bad =
    /access denied|captcha|cloudflare|checking your browser|enable javascript|robot|forbidden/i.test(
      text
    );

  if (bad) {
    return false;
  }

  return (
    /finished|scheduled|live|half|odds|summary|standings|h2h|1st half|2nd half|football/i.test(
      text
    ) ||
    String(html).includes(
      matchId
    )
  );
}

/* =========================================================
 * SCORE PARSER
 * ========================================================= */

function extractFinishedScore(
  html
) {
  const text =
    pageText(html);

  if (!text) {
    return null;
  }

  const finished =
    /\bFinished\b|\bFull Time\b|\bFinal\b|\bFT\b|After Penalties|After Extra Time|\bAET\b/i.test(
      text
    );

  if (!finished) {
    return null;
  }

  /*
   * Actual Flashscore mobile format:
   *
   * 4-2 (3-0,1-2) Finished
   */
  let m =
    text.match(
      /(\d{1,2})\s*[-:]\s*(\d{1,2})(?:\s*\([^)]*\))?\s*(?:Finished|Full Time|Final|FT|AET)/i
    );

  if (m) {
    return {
      h:
        Number(
          m[1]
        ),

      a:
        Number(
          m[2]
        ),
    };
  }

  /*
   * Status before score.
   */
  m =
    text.match(
      /(?:Finished|Full Time|Final|FT|AET)[^0-9]{0,120}(\d{1,2})\s*[-:]\s*(\d{1,2})/i
    );

  if (m) {
    return {
      h:
        Number(
          m[1]
        ),

      a:
        Number(
          m[2]
        ),
    };
  }

  /*
   * Strong signature:
   *
   * SCORE (HT,2H)
   */
  m =
    text.match(
      /(?:^|\s)(\d{1,2})\s*[-:]\s*(\d{1,2})\s*\(\s*\d{1,2}\s*[-:]\s*\d{1,2}\s*[,;]\s*\d{1,2}\s*[-:]\s*\d{1,2}\s*\)/
    );

  if (m) {
    return {
      h:
        Number(
          m[1]
        ),

      a:
        Number(
          m[2]
        ),
    };
  }

  /*
   * Last fallback:
   * inspect only the area around "Finished".
   */
  const index =
    text.search(
      /Finished|Full Time|Final|\bFT\b|AET/i
    );

  if (
    index >= 0
  ) {
    const around =
      text.slice(
        Math.max(
          0,
          index - 180
        ),

        index + 180
      );

    const scores =
      [
        ...around.matchAll(
          /(?:^|\s)(\d{1,2})\s*[-:]\s*(\d{1,2})(?=\s|$|\()/g
        ),
      ];

    if (
      scores.length
    ) {
      const last =
        scores[
          scores.length - 1
        ];

      const h =
        Number(
          last[1]
        );

      const a =
        Number(
          last[2]
        );

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
  }

  return null;
}

/* =========================================================
 * STATISTICS PARSER
 * ========================================================= */

function parseNumeric(
  value
) {
  const m =
    String(
      value || ""
    )
      .replace(
        ",",
        "."
      )
      .match(
        /-?\d+(?:\.\d+)?/
      );

  return m
    ? Number(
        m[0]
      )
    : null;
}

function parseFinalStats(
  html
) {
  const $ =
    cheerio.load(
      html || ""
    );

  let hc = null;
  let ac = null;

  let hy = null;
  let ay = null;

  let hr = null;
  let ar = null;

  let hcards = null;
  let acards = null;

  /*
   * Table layout.
   */
  $("tr").each(
    (
      _,
      tr
    ) => {
      const cells =
        $(tr).find(
          "td"
        );

      if (
        cells.length < 3
      ) {
        return;
      }

      const left =
        parseNumeric(
          $(
            cells[0]
          ).text()
        );

      const label =
        normalize(
          $(
            cells[1]
          ).text()
        );

      const right =
        parseNumeric(
          $(
            cells[
              cells.length - 1
            ]
          ).text()
        );

      if (
        left === null ||
        right === null
      ) {
        return;
      }

      if (
        label.includes(
          "corner"
        )
      ) {
        hc =
          left;

        ac =
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
        hy =
          left;

        ay =
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
        hr =
          left;

        ar =
          right;
      }

      else if (
        label ===
          "cards" ||
        label.includes(
          "total cards"
        ) ||
        label ===
          "cartonase"
      ) {
        hcards =
          left;

        acards =
          right;
      }
    }
  );

  /*
   * Linear mobile layout:
   *
   * 5 Corner Kicks 3
   */
  const text =
    pageText(html);

  const patterns = [
    {
      re:
        /(\d+)\s+(?:Corner Kicks|Corners|Cornere)\s+(\d+)/i,

      key:
        "corners",
    },

    {
      re:
        /(\d+)\s+(?:Yellow Cards|Cartonase galbene)\s+(\d+)/i,

      key:
        "yellow",
    },

    {
      re:
        /(\d+)\s+(?:Red Cards|Cartonase rosii)\s+(\d+)/i,

      key:
        "red",
    },

    {
      re:
        /(\d+)\s+(?:Total Cards|Cards|Cartonase)\s+(\d+)/i,

      key:
        "cards",
    },
  ];

  for (
    const p
    of patterns
  ) {
    const m =
      text.match(
        p.re
      );

    if (!m) {
      continue;
    }

    const left =
      Number(
        m[1]
      );

    const right =
      Number(
        m[2]
      );

    if (
      p.key ===
        "corners" &&
      hc === null
    ) {
      hc =
        left;

      ac =
        right;
    }

    if (
      p.key ===
        "yellow" &&
      hy === null
    ) {
      hy =
        left;

      ay =
        right;
    }

    if (
      p.key ===
        "red" &&
      hr === null
    ) {
      hr =
        left;

      ar =
        right;
    }

    if (
      p.key ===
        "cards" &&
      hcards === null
    ) {
      hcards =
        left;

      acards =
        right;
    }
  }

  const corners =
    hc !== null &&
    ac !== null
      ? hc + ac
      : null;

  const yellow =
    hy !== null &&
    ay !== null
      ? hy + ay
      : null;

  const red =
    hr !== null &&
    ar !== null
      ? hr + ar
      : null;

  const cards =
    hcards !== null &&
    acards !== null
      ? hcards + acards

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
    yellow,
    red,
    cards,
  };
}

/* =========================================================
 * URL FALLBACKS
 * ========================================================= */

function scoreUrls(
  matchId
) {
  const urls = [];

  for (
    const host
    of FS_HOSTS
  ) {
    const base =
      `${host}/match/${matchId}/`;

    urls.push(
      base
    );

    urls.push(
      `${base}?s=1`
    );

    urls.push(
      `${base}?d=-1`
    );
  }

  return [
    ...new Set(
      urls
    ),
  ];
}

function statsUrls(
  matchId
) {
  const urls = [];

  for (
    const host
    of FS_HOSTS
  ) {
    const base =
      `${host}/match/${matchId}/`;

    urls.push(
      `${base}?s=2`
    );

    urls.push(
      `${base}?t=stats`
    );
  }

  return [
    ...new Set(
      urls
    ),
  ];
}

/* =========================================================
 * FLASHSCORE FETCHER
 * ========================================================= */

async function fetchFlashscore(
  matchId
) {
  let bestDiagnostic =
    null;

  for (
    const url
    of scoreUrls(
      matchId
    )
  ) {
    try {
      const {
        html,
        finalUrl,
        status,
      } =
        await fetchHtmlDetailed(
          url
        );

      const text =
        pageText(
          html
        );

      const valid =
        looksLikeMatchPage(
          html,
          matchId
        );

      const ft =
        valid
          ? extractFinishedScore(
              html
            )
          : null;

      console.log(
        `[FS] ${matchId}: GET ${url}` +
        ` -> ${status}` +
        ` | final=${finalUrl}` +
        ` | bytes=${html.length}` +
        ` | match_page=${valid}` +
        ` | finished=${Boolean(ft)}`
      );

      if (
        !bestDiagnostic ||
        text.length >
          bestDiagnostic
            .text.length
      ) {
        bestDiagnostic = {
          url,
          finalUrl,
          text,
        };
      }

      if (!ft) {
        continue;
      }

      let stats = {
        corners:
          null,

        cards:
          null,

        yellow:
          null,

        red:
          null,
      };

      for (
        const statsUrl
        of statsUrls(
          matchId
        )
      ) {
        try {
          const statRes =
            await fetchHtmlDetailed(
              statsUrl
            );

          const parsed =
            parseFinalStats(
              statRes.html
            );

          if (
            parsed.corners !==
              null ||
            parsed.cards !==
              null ||
            parsed.yellow !==
              null ||
            parsed.red !==
              null
          ) {
            stats =
              parsed;

            console.log(
              `[FS] ${matchId}: stats detected via ${statsUrl}`
            );

            break;
          }
        } catch (e) {
          console.warn(
            `[FS] ${matchId}: stats request failed ${statsUrl}: ${e.message}`
          );
        }
      }

      console.log(
        `[FS] ${matchId}: FINISHED ${ft.h}-${ft.a}` +

        (
          stats.corners !==
          null
            ? ` | corners=${stats.corners}`
            : ""
        ) +

        (
          stats.cards !==
          null
            ? ` | cards=${stats.cards}`
            : ""
        )
      );

      return {
        ft,
        ...stats,
      };
    } catch (e) {
      console.warn(
        `[FS] ${matchId}: request failed ${url}: ${
          e?.name ===
          "AbortError"
            ? "timeout"
            : e.message
        }`
      );
    }
  }

  if (
    bestDiagnostic
  ) {
    console.warn(
      `[FS] ${matchId}: no finished score detected.` +
      ` Best response: ${bestDiagnostic.finalUrl}` +
      ` | text="${truncate(bestDiagnostic.text, 320)}"`
    );
  } else {
    console.warn(
      `[FS] ${matchId}: no usable Flashscore response received from any fallback host.`
    );
  }

  return null;
}

/* =========================================================
 * BET EVALUATION
 * ========================================================= */

function evalThreshold(
  actual,
  bet
) {
  if (
    bet.over
  ) {
    return actual >
      bet.val
      ? WIN
      : LOSS;
  }

  return actual <
    bet.val
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

  const {
    h,
    a,
  } =
    data.ft;

  if (
    bet.type ===
    "1x2"
  ) {
    const result =
      h > a
        ? "1"

        : h < a
          ? "2"

          : "x";

    return result ===
      bet.side
      ? WIN
      : LOSS;
  }

  if (
    bet.type ===
    "double"
  ) {
    const result =
      h > a
        ? "1"

        : h < a
          ? "2"

          : "x";

    return bet.sides.includes(
      result
    )
      ? WIN
      : LOSS;
  }

  if (
    bet.type ===
    "btts"
  ) {
    const yes =
      h > 0 &&
      a > 0;

    return yes ===
      bet.yes
      ? WIN
      : LOSS;
  }

  if (
    bet.type ===
    "goals"
  ) {
    return evalThreshold(
      h + a,
      bet
    );
  }

  if (
    bet.type ===
    "team_goals"
  ) {
    return evalThreshold(
      bet.side ===
        "home"
        ? h
        : a,

      bet
    );
  }

  if (
    bet.type ===
    "corners"
  ) {
    return Number.isFinite(
      data.corners
    )
      ? evalThreshold(
          data.corners,
          bet
        )
      : null;
  }

  if (
    bet.type ===
    "cards"
  ) {
    return Number.isFinite(
      data.cards
    )
      ? evalThreshold(
          data.cards,
          bet
        )
      : null;
  }

  return null;
}

/* =========================================================
 * EMPTY RESULT
 * ========================================================= */

function emptyResult(
  postId,
  status
) {
  return {
    postId,
    status,

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

/* =========================================================
 * PROCESS POST
 * ========================================================= */

async function processPost(
  postSummary
) {
  const postId =
    postSummary.id;

  let post;

  try {
    post =
      await wpRequest(
        `${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`
      );
  } catch (e) {
    console.warn(
      `[POST ${postId}] Read failed: ${e.message}`
    );

    return emptyResult(
      postId,
      "read_failed"
    );
  }

  const content =
    post?.content?.raw ||
    post?.content?.rendered ||
    "";

  if (!content) {
    return emptyResult(
      postId,
      "empty"
    );
  }

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
      $(
        "tr[data-id]"
      ).toArray();
  }

  if (
    !rows.length
  ) {
    return emptyResult(
      postId,
      "no_ticket"
    );
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

  /*
   * Avoid requesting same match twice
   * inside same post.
   */
  const matchCache =
    new Map();

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
      $row.find(
        "td"
      );

    if (
      cells.length < 2
    ) {
      continue;
    }

    const $status =
      cells.last();

    if (
      !RECHECK_ONCE &&
      !isPending(
        $status
      )
    ) {
      continue;
    }

    pendingRows++;

    const matchId =
      getMatchId(
        $row
      );

    if (!matchId) {
      noMatchId++;

      console.warn(
        `[POST ${postId}] Row skipped: no Flashscore match ID`
      );

      continue;
    }

    let bet =
      parseStructuralBet(
        $row
      );

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
          .find(
            "strong"
          )
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
      unsupported++;

      console.warn(
        `[POST ${postId}] Unsupported bet` +
        ` | match=${matchId}` +
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

    let data;

    if (
      matchCache.has(
        matchId
      )
    ) {
      data =
        matchCache.get(
          matchId
        );
    } else {
      data =
        await fetchFlashscore(
          matchId
        );

      matchCache.set(
        matchId,
        data
      );
    }

    if (!data) {
      continue;
    }

    finishedRows++;

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
        statsUnavailable++;
      }

      console.warn(
        `[POST ${postId}] ${matchId}: finished but required data for ${bet.type} is unavailable`
      );

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
    ` unsupported=${unsupported}` +
    ` stats_unavailable=${statsUnavailable}`
  );

  const resultBase = {
    postId,

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

  if (!changed) {
    return {
      ...resultBase,
      status:
        "no_changes",
    };
  }

  try {
    await wpRequest(
      `${WP_BASE}/wp-json/wp/v2/posts/${postId}`,

      {
        method:
          "PUT",

        body: {
          content:
            $.html(),
        },
      }
    );

    console.log(
      `[POST ${postId}] WordPress updated successfully.`
    );

    return {
      ...resultBase,
      status:
        "updated",
    };
  } catch (e) {
    console.warn(
      `[POST ${postId}] WordPress update failed: ${e.message}`
    );

    return {
      ...resultBase,
      status:
        "update_failed",
    };
  }
}

/* =========================================================
 * MAIN
 * ========================================================= */

async function main() {
  validateConfiguration();

  console.log(
    "\n# WORDPRESS TICKET VERIFICATION\n"
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
      await wpRequest(
        postsUrl
      );
  } catch (e) {
    console.error(
      `[VERIFY] Cannot load WordPress posts: ${e.message}`
    );

    if (
      NON_BLOCKING
    ) {
      return {
        status:
          "wordpress_error",

        processed:
          0,
      };
    }

    throw e;
  }

  if (
    !Array.isArray(
      posts
    )
  ) {
    throw new Error(
      "WordPress posts endpoint did not return an array."
    );
  }

  console.log(
    `[WP] Posts loaded: ${posts.length}`
  );

  const results =
    [];

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
    } catch (e) {
      console.error(
        `[POST ${post?.id}] Unexpected error: ${
          e.stack ||
          e.message
        }`
      );

      results.push(
        emptyResult(
          post?.id,
          "error"
        )
      );
    }
  }

  const sum =
    (
      key
    ) =>
      results.reduce(
        (
          total,
          row
        ) =>
          total +
          Number(
            row[key] ||
            0
          ),
        0
      );

  const updated =
    results.filter(
      (
        row
      ) =>
        row.status ===
        "updated"
    ).length;

  const errors =
    results.filter(
      (
        row
      ) =>
        [
          "read_failed",
          "update_failed",
          "error",
        ].includes(
          row.status
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

  console.log(
    "\n# VERIFICATION SUMMARY\n"
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

  let status =
    errors
      ? "completed_with_errors"
      : "success";

  if (
    rowsFound > 0 &&
    pendingRows > 0 &&
    parsedRows === 0
  ) {
    status =
      "warning_no_parsed_bets";
  }

  else if (
    rowsFound > 0 &&
    parsedRows > 0 &&
    finishedRows === 0
  ) {
    status =
      "warning_flashscore_no_finished_matches_detected";
  }

  else if (
    finishedRows > 0 &&
    evaluated === 0 &&
    statsUnavailable > 0
  ) {
    status =
      "warning_stats_unavailable";
  }

  else if (
    finishedRows > 0 &&
    evaluated === 0
  ) {
    status =
      "warning_finished_not_evaluated";
  }

  return {
    status,

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
      console.error(
        "\n[VERIFY] Fatal error:"
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
