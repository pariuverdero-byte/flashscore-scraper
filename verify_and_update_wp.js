// verify_and_update_wp.js
// Node.js 18 / 20
// WordPress REST safe, captcha-aware, timeout-safe, non-blocking

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* =========================================================
 * CONFIGURATION
 * =========================================================
 */

const WP_BASE = String(
  process.env.WP_BASE || ""
).replace(/\/$/, "");

const WP_USER =
  process.env.WP_USER || "";

const WP_APP_PASS =
  process.env.WP_APP_PASS || "";

const FS_BASE =
  "https://www.flashscore.mobi/match/";

const RECHECK_ONCE =
  /^(1|true|yes)$/i.test(
    process.env.RECHECK_ONCE || ""
  );

const RECHECK_LAST_N =
  Math.max(
    1,
    Number(
      process.env.RECHECK_LAST_N || 30
    )
  );

const MAX_ROWS_PER_POST =
  Math.max(
    1,
    Number(
      process.env.MAX_ROWS_PER_POST || 10
    )
  );

const WP_TIMEOUT_MS =
  Math.max(
    3000,
    Number(
      process.env.WP_TIMEOUT_MS || 15000
    )
  );

const FS_TIMEOUT_MS =
  Math.max(
    3000,
    Number(
      process.env.FS_TIMEOUT_MS || 8000
    )
  );

const WP_RETRIES =
  Math.max(
    0,
    Number(
      process.env.WP_RETRIES || 2
    )
  );

const WP_RETRY_DELAY_MS =
  Math.max(
    500,
    Number(
      process.env.WP_RETRY_DELAY_MS || 3000
    )
  );

const NON_BLOCKING =
  !/^(0|false|no)$/i.test(
    process.env.VERIFY_NON_BLOCKING || "true"
  );

const WIN = "win";
const LOSS = "loss";

/* =========================================================
 * CONFIG VALIDATION
 * =========================================================
 */

function validateConfiguration() {
  const missing = [];

  if (!WP_BASE) {
    missing.push("WP_BASE");
  }

  if (!WP_USER) {
    missing.push("WP_USER");
  }

  if (!WP_APP_PASS) {
    missing.push("WP_APP_PASS");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

/* =========================================================
 * AUTH
 * =========================================================
 */

const auth =
  "Basic " +
  Buffer.from(
    `${WP_USER}:${WP_APP_PASS}`
  ).toString("base64");

const COMMON_HEADERS = {
  Authorization: auth,
  Accept: "application/json",
  "User-Agent":
    "PariuVerde-WordPress-Verifier/1.1",
  "Cache-Control": "no-cache",
  Pragma: "no-cache"
};

/* =========================================================
 * GENERIC HELPERS
 * =========================================================
 */

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, maxLength = 300) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function isProbablyHtml(text) {
  const value = String(text || "")
    .trimStart()
    .toLowerCase();

  return (
    value.startsWith("<!doctype html") ||
    value.startsWith("<html") ||
    value.startsWith("<head") ||
    value.startsWith("<body")
  );
}

function isCaptchaHtml(text) {
  const value = String(text || "")
    .toLowerCase();

  return (
    value.includes("/.well-known/sgcaptcha/") ||
    value.includes("sgcaptcha") ||
    value.includes("challenge-platform") ||
    value.includes("cf-chl-") ||
    value.includes("captcha")
  );
}

function createAbortController(timeoutMilliseconds) {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMilliseconds
  );

  return {
    controller,
    clear: () =>
      clearTimeout(timeout)
  };
}

/* =========================================================
 * CUSTOM ERROR
 * =========================================================
 */

class WordPressApiError extends Error {
  constructor(
    message,
    {
      status = null,
      url = null,
      captcha = false,
      responseText = null
    } = {}
  ) {
    super(message);

    this.name =
      "WordPressApiError";

    this.status = status;
    this.url = url;
    this.captcha = captcha;
    this.responseText =
      responseText;
  }
}

/* =========================================================
 * SAFE WORDPRESS REQUEST
 * =========================================================
 */

async function wordpressRequest(
  url,
  {
    method = "GET",
    body = undefined,
    retries = WP_RETRIES
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
      clear
    } = createAbortController(
      WP_TIMEOUT_MS
    );

    try {
      console.log(
        `[WP] ${method} ${url} ` +
        `(attempt ${attempt + 1}/${retries + 1})`
      );

      const response =
        await fetch(url, {
          method,
          signal:
            controller.signal,

          headers: {
            ...COMMON_HEADERS,

            ...(body !== undefined
              ? {
                  "Content-Type":
                    "application/json"
                }
              : {})
          },

          body:
            body !== undefined
              ? JSON.stringify(body)
              : undefined
        });

      const responseText =
        await response.text();

      if (!response.ok) {
        throw new WordPressApiError(
          `WordPress REST request failed with HTTP ${response.status}.`,
          {
            status:
              response.status,
            url,
            responseText
          }
        );
      }

      if (!responseText.trim()) {
        return null;
      }

      /*
       * First try parsing JSON.
       * WordPress JSON can legitimately contain HTML strings
       * inside content.rendered or content.raw.
       */
      try {
        return JSON.parse(
          responseText
        );
      } catch (jsonError) {
        const captcha =
          isCaptchaHtml(
            responseText
          );

        if (captcha) {
          throw new WordPressApiError(
            "WordPress REST API was intercepted by SG Captcha or another security layer.",
            {
              status:
                response.status,
              url,
              captcha: true,
              responseText
            }
          );
        }

        if (
          isProbablyHtml(
            responseText
          )
        ) {
          throw new WordPressApiError(
            "WordPress REST API returned an HTML page instead of JSON.",
            {
              status:
                response.status,
              url,
              responseText
            }
          );
        }

        throw new WordPressApiError(
          `WordPress returned invalid JSON: ${jsonError.message}`,
          {
            status:
              response.status,
            url,
            responseText
          }
        );
      }
    } catch (error) {
      if (
        error?.name ===
        "AbortError"
      ) {
        lastError =
          new WordPressApiError(
            `WordPress request timed out after ${WP_TIMEOUT_MS} ms.`,
            {
              url
            }
          );
      } else {
        lastError = error;
      }

      console.warn(
        `[WP] Request failed: ${
          lastError?.message ||
          String(lastError)
        }`
      );

      if (
        lastError?.responseText
      ) {
        console.warn(
          `[WP] Response preview: ${truncate(
            lastError.responseText
          )}`
        );
      }

      if (attempt < retries) {
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

async function wordpressGet(url) {
  return wordpressRequest(url, {
    method: "GET"
  });
}

async function wordpressPut(
  url,
  body
) {
  return wordpressRequest(url, {
    method: "PUT",
    body
  });
}

/* =========================================================
 * TABLE HELPERS
 * =========================================================
 */

function getMatchId($row) {
  const href =
    $row
      .find(
        "a[href*='flashscore']"
      )
      .attr("href");

  const match =
    href?.match(
      /match\/([A-Za-z0-9]+)/
    );

  return match
    ? match[1]
    : null;
}

function parseScore(text) {
  const match =
    String(text || "").match(
      /(\d+)\s*[:\-]\s*(\d+)/
    );

  if (!match) {
    return null;
  }

  return {
    h: Number(match[1]),
    a: Number(match[2])
  };
}

function extractTeams($row) {
  const raw =
    normalize(
      $row
        .find("td")
        .eq(0)
        .text()
    );

  const parts =
    raw.split(
      /\s*[-–—]\s*/
    );

  if (parts.length < 2) {
    return null;
  }

  return {
    home:
      parts[0],

    away:
      parts
        .slice(1)
        .join(" ")
  };
}

function isPending($cell) {
  const text =
    String(
      $cell.text() || ""
    ).trim();

  return (
    !text.includes("✅") &&
    !text.includes("❌")
  );
}

/* =========================================================
 * PARSE BET
 * =========================================================
 */

function parseBet(
  text,
  teams
) {
  const value =
    normalize(text);

  if (
    value.includes("home win") ||
    value.includes(
      "victorie gazde"
    )
  ) {
    return {
      type: "1x2",
      side: "1"
    };
  }

  if (
    value.includes("away win") ||
    value.includes(
      "victorie oaspe"
    )
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

  if (
    value.includes("1x")
  ) {
    return {
      type: "double",
      sides: ["1", "x"]
    };
  }

  if (
    value.includes("x2")
  ) {
    return {
      type: "double",
      sides: ["x", "2"]
    };
  }

  if (
    value.includes(
      "both teams"
    ) ||
    value.includes(
      "ambele"
    ) ||
    value === "gg"
  ) {
    return {
      type: "btts"
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

    const side =
      home &&
      value.includes(home)
        ? "home"
        : away &&
            value.includes(away)
          ? "away"
          : null;

    if (side) {
      let match =
        value.match(
          /(minim|min|at least|over|peste)\s*(\d+(?:\.\d+)?)/
        );

      if (match) {
        return {
          type: "team_goals",
          side,
          over: true,
          val: Number(
            match[2]
          )
        };
      }

      match =
        value.match(
          /(under|sub)\s*(\d+(?:\.\d+)?)/
        );

      if (match) {
        return {
          type: "team_goals",
          side,
          over: false,
          val: Number(
            match[2]
          )
        };
      }
    }
  }

  let match =
    value.match(
      /(over|peste|minim)\s*(\d+(?:\.\d+)?)/
    );

  if (match) {
    return {
      type: "goals",
      over: true,
      val: Number(
        match[2]
      )
    };
  }

  match =
    value.match(
      /(under|sub)\s*(\d+(?:\.\d+)?)/
    );

  if (match) {
    return {
      type: "goals",
      over: false,
      val: Number(
        match[2]
      )
    };
  }

  return null;
}

/* =========================================================
 * SAFE FLASHSCORE REQUEST
 * =========================================================
 */

async function fetchFlashscore(
  matchId
) {
  const {
    controller,
    clear
  } = createAbortController(
    FS_TIMEOUT_MS
  );

  try {
    const url =
      `${FS_BASE}${matchId}/?s=1&d=-1`;

    const response =
      await fetch(url, {
        signal:
          controller.signal,

        headers: {
          Accept:
            "text/html,application/xhtml+xml",

          "User-Agent":
            "Mozilla/5.0 (compatible; PariuVerdeVerifier/1.1)"
        }
      });

    if (!response.ok) {
      console.warn(
        `[FS] ${matchId}: HTTP ${response.status}`
      );

      return null;
    }

    const html =
      await response.text();

    const $ =
      cheerio.load(html);

    const body =
      $("body").text();

    if (
      !/Finished|FT|AET|After Penalties|Final/i.test(
        body
      )
    ) {
      return null;
    }

    const ft =
      parseScore(body);

    if (!ft) {
      return null;
    }

    return {
      ft
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
          String(error)
        }`
      );
    }

    return null;
  } finally {
    clear();
  }
}

/* =========================================================
 * EVALUATE BET
 * =========================================================
 */

function evalBet(
  bet,
  data
) {
  const ft =
    data.ft;

  const total =
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
    return (
      ft.h > 0 &&
      ft.a > 0
    )
      ? WIN
      : LOSS;
  }

  if (
    bet.type ===
    "team_goals"
  ) {
    const goals =
      bet.side === "home"
        ? ft.h
        : ft.a;

    return bet.over
      ? goals >= bet.val
        ? WIN
        : LOSS
      : goals < bet.val
        ? WIN
        : LOSS;
  }

  if (
    bet.type === "goals"
  ) {
    return bet.over
      ? total >= Math.ceil(
          bet.val
        )
        ? WIN
        : LOSS
      : total < bet.val
        ? WIN
        : LOSS;
  }

  return null;
}

/* =========================================================
 * PROCESS ONE POST
 * =========================================================
 */

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
      `[POST ${postId}] Could not read post: ${
        error?.message ||
        String(error)
      }`
    );

    return {
      postId,
      status: "read_failed",
      changed: false,
      checked: 0
    };
  }

  const content =
    post?.content?.raw ||
    post?.content?.rendered ||
    "";

  if (!content) {
    console.log(
      `[POST ${postId}] Empty content. Skipped.`
    );

    return {
      postId,
      status: "empty",
      changed: false,
      checked: 0
    };
  }

  const $ =
    cheerio.load(content);

  const rows =
    $("table.bilet-pariu tbody tr")
      .toArray();

  if (rows.length === 0) {
    return {
      postId,
      status: "no_ticket_table",
      changed: false,
      checked: 0
    };
  }

  let changed = false;
  let checked = 0;
  let evaluated = 0;

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

    if (cells.length < 6) {
      continue;
    }

    const $status =
      cells.eq(5);

    if (
      !RECHECK_ONCE &&
      !isPending($status)
    ) {
      continue;
    }

    const matchId =
      getMatchId($row);

    const teams =
      extractTeams($row);

    const bet =
      parseBet(
        cells.eq(3).text(),
        teams
      );

    if (
      !matchId ||
      !bet
    ) {
      continue;
    }

    checked += 1;

    const data =
      await fetchFlashscore(
        matchId
      );

    if (!data) {
      continue;
    }

    const result =
      evalBet(
        bet,
        data
      );

    if (!result) {
      continue;
    }

    $status.html(
      result === WIN
        ? "✅"
        : "❌"
    );

    changed = true;
    evaluated += 1;

    console.log(
      `[POST ${postId}] Match ${matchId}: ${result}`
    );
  }

  if (!changed) {
    return {
      postId,
      status:
        "no_changes",
      changed:
        false,
      checked,
      evaluated
    };
  }

  try {
    await wordpressPut(
      `${WP_BASE}/wp-json/wp/v2/posts/${postId}`,
      {
        content:
          $.html()
      }
    );

    console.log(
      `[POST ${postId}] Updated successfully.`
    );

    return {
      postId,
      status: "updated",
      changed: true,
      checked,
      evaluated
    };
  } catch (error) {
    console.warn(
      `[POST ${postId}] Update failed: ${
        error?.message ||
        String(error)
      }`
    );

    return {
      postId,
      status:
        "update_failed",
      changed:
        false,
      checked,
      evaluated
    };
  }
}

/* =========================================================
 * MAIN
 * =========================================================
 */

async function main() {
  validateConfiguration();

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

  let posts;

  try {
    const postsUrl =
      `${WP_BASE}/wp-json/wp/v2/posts` +
      `?per_page=${Math.min(
        RECHECK_LAST_N,
        100
      )}` +
      `&orderby=date&order=desc`;

    posts =
      await wordpressGet(
        postsUrl
      );
  } catch (error) {
    const captcha =
      error?.captcha === true;

    console.error("");
    console.error(
      "=========================================="
    );

    console.error(
      captcha
        ? "WORDPRESS REST API BLOCKED BY CAPTCHA"
        : "WORDPRESS REST API ERROR"
    );

    console.error(
      "=========================================="
    );

    console.error(
      error?.message ||
      String(error)
    );

    if (captcha) {
      console.error(
        "SiteGround/SG Security returned an anti-bot page for /wp-json/."
      );

      console.error(
        "The verifier cannot read or update WordPress posts until the REST API request is allowed."
      );
    }

    if (NON_BLOCKING) {
      console.warn(
        "[VERIFY] Non-blocking mode enabled. Workflow will continue without verifying tickets."
      );

      return {
        status:
          "wordpress_blocked",
        captcha,
        processed:
          0
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
    const result =
      await processPost(post);

    results.push(result);
  }

  const updated =
    results.filter(
      (item) =>
        item.status ===
        "updated"
    ).length;

  const failed =
    results.filter(
      (item) =>
        item.status ===
          "read_failed" ||
        item.status ===
          "update_failed"
    ).length;

  const evaluated =
    results.reduce(
      (sum, item) =>
        sum +
        Number(
          item.evaluated || 0
        ),
      0
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
    `Matches evaluated: ${evaluated}`
  );

  console.log(
    `Post errors: ${failed}`
  );

  return {
    status:
      failed > 0
        ? "completed_with_errors"
        : "success",

    processed:
      results.length,

    updated,

    evaluated,

    failed,

    results
  };
}

/* =========================================================
 * RUN
 * =========================================================
 */

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
        "[VERIFY] Non-blocking mode enabled. Exiting successfully."
      );

      process.exit(0);
    }

    process.exit(1);
  });
