// parsers/augment_pool_sources_and_fallback.js
// FINAL — Multi-source external pool augmentation.
//
// Sources:
// - biletu-zilei.com
// - 10pariuri.ro
// - ponturipariuri.pro
// - sportytrader.com
//
// Critical rule:
// A scraped selection is admitted to master_pool.json ONLY if the event
// is clearly matched to a Flashscore fixture and receives a real match_id.
//
// Flashscore odds fallback itself is NOT handled here anymore.
// It is handled exclusively by:
//   parsers/flashscore_odds_list_fallback.js
//
// Visitor-facing output remains unchanged.

import fs from "fs/promises";
import * as cheerio from "cheerio";

import {
  matchEventToFlashscore
} from "../engine/matcher_core.js";

const DAY_OFFSET =
  Number(
    process.env.DAY_OFFSET ||
    "0"
  );

const MASTER_FILE =
  "master_pool.json";

const MATCHES_FILE =
  "matches.json";

const EXTRA_ARTIFACT =
  "extra_sources_pool.json";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/125 Safari/537.36";

const REQUEST_TIMEOUT_MS =
  Math.max(
    3000,
    Number(
      process.env.EXTRA_SOURCE_TIMEOUT_MS ||
      "12000"
    )
  );

const MAX_PAGES_PER_SOURCE =
  Math.max(
    1,
    Number(
      process.env.EXTRA_SOURCE_MAX_PAGES ||
      "8"
    )
  );

function safe(value = "") {
  return String(
    value ?? ""
  )
    .replace(/\u00a0/g, " ")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function norm(value = "") {
  return safe(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

async function readJson(
  path,
  fallback
) {
  try {
    return JSON.parse(
      await fs.readFile(
        path,
        "utf8"
      )
    );
  } catch {
    return fallback;
  }
}

function getMatches(raw) {
  if (
    Array.isArray(raw)
  ) {
    return raw;
  }

  if (
    Array.isArray(
      raw?.matches
    )
  ) {
    return raw.matches;
  }

  if (
    Array.isArray(
      raw?.fixtures
    )
  ) {
    return raw.fixtures;
  }

  if (
    Array.isArray(
      raw?.data
    )
  ) {
    return raw.data;
  }

  return [];
}

function targetDate() {
  const date =
    new Date(
      Date.now() +
      DAY_OFFSET *
      86400000
    );

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Europe/Bucharest",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    )
      .formatToParts(
        date
      );

  const get =
    type =>
      parts.find(
        part =>
          part.type === type
      )?.value || "";

  return (
    `${get("year")}-` +
    `${get("month")}-` +
    `${get("day")}`
  );
}

async function fetchText(
  url
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        url,
        {
          redirect:
            "follow",

          signal:
            controller.signal,

          headers: {
            "User-Agent":
              UA,

            "Accept-Language":
              "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7",

            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

            "Cache-Control":
              "no-cache"
          }
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    return await response.text();
  } finally {
    clearTimeout(
      timer
    );
  }
}

function dateTokens(
  iso
) {
  const [
    year,
    month,
    day
  ] =
    iso.split("-");

  return [
    iso,

    `${day}-${month}-${year}`,
    `${day}.${month}.${year}`,
    `${day}/${month}/${year}`,

    `${Number(day)}-${Number(month)}-${year}`,

    `${day}-${month}`,

    `${day}.${month}`
  ]
    .map(
      norm
    )
    .filter(
      Boolean
    );
}

function absoluteUrl(
  href,
  base
) {
  try {
    return new URL(
      href,
      base
    ).toString();
  } catch {
    return null;
  }
}

function blockTexts(
  html
) {
  const $ =
    cheerio.load(
      html,
      {
        decodeEntities:
          false
      }
    );

  const selectors = [
    "article p",
    "article li",
    "article tr",
    "article td",

    "main p",
    "main li",
    "main tr",
    "main td",

    ".entry-content p",
    ".entry-content li",
    ".entry-content tr",
    ".entry-content td",

    ".post-content p",
    ".post-content li",
    ".post-content tr",
    ".post-content td",

    ".article-content p",
    ".article-content li",
    ".article-content tr",
    ".article-content td",

    "h2",
    "h3",
    "h4",
    "h5"
  ];

  const out = [];

  $(
    selectors.join(",")
  )
    .each(
      (_, element) => {
        const text =
          safe(
            $(element).text()
          );

        if (
          text.length >= 3 &&
          text.length <= 1000
        ) {
          out.push(
            text
          );
        }
      }
    );

  if (
    !out.length
  ) {
    $(
      "p,li,tr,td,h2,h3,h4"
    )
      .each(
        (_, element) => {
          const text =
            safe(
              $(element).text()
            );

          if (
            text.length >= 3 &&
            text.length <= 1000
          ) {
            out.push(
              text
            );
          }
        }
      );
  }

  return [
    ...new Set(
      out
    )
  ];
}

function cleanTeam(
  value
) {
  return safe(value)
    .replace(
      /^biletul\s+zilei(?:\s+fotbal)?(?:\s+cota\s+\d+(?:[.,]\d+)?)?\s*[-:|]*\s*\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}\s*[:|-]*\s*/i,
      ""
    )
    .replace(
      /^bilet(?:ul)?\s+cota\s+\d+(?:[.,]\d+)?\s*[-:|]*\s*/i,
      ""
    )
    .replace(
      /^\d{1,2}[:.]\d{2}\s+/,
      ""
    )
    .replace(
      /^\d+\.\s*/,
      ""
    )
    .replace(
      /\s*\([^)]{2,12}\)\s*$/,
      ""
    )
    .replace(
      /\s+(?:pont|pronostic|prediction|tip|pick)\s*:.*$/i,
      ""
    )
    .replace(
      /\s+-\s*$/,
      ""
    )
    .trim();
}

function validTeamName(
  value
) {
  const text =
    cleanTeam(value);

  if (
    text.length < 2 ||
    text.length > 80
  ) {
    return false;
  }

  if (
    /^(pont|pronostic|prediction|cota|odds?|tip|pick)$/i
      .test(
        text
      )
  ) {
    return false;
  }

  return true;
}

function splitEvent(
  text
) {
  const value =
    safe(text)
      .replace(
        /^biletul\s+zilei(?:\s+fotbal)?(?:\s+cota\s+\d+(?:[.,]\d+)?)?\s*[-:|]*\s*\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}\s*[:|-]*\s*/i,
        ""
      )
      .replace(
        /^bilet(?:ul)?\s+cota\s+\d+(?:[.,]\d+)?\s*[-:|]*\s*/i,
        ""
      )
      .replace(
        /\s+-\s*$/,
        ""
      )
      .trim();

  const patterns = [
    /^(.{2,80}?)\s+vs\.?\s+(.{2,80}?)(?=\s+(?:pont|pronostic|prediction|pick|tip|peste|sub|over|under|victorie|cota|odds?|@)\b|$)/i,
    /^(.{2,80}?)\s+v\s+(.{2,80}?)(?=\s+(?:pont|pronostic|prediction|pick|tip|peste|sub|over|under|victorie|cota|odds?|@)\b|$)/i,
    /^(.{2,80}?)\s+-\s+(.{2,80}?)(?=\s+(?:pont|pronostic|prediction|pick|tip|peste|sub|over|under|victorie|cota|odds?|@)\b|$)/i,
    /^(.{2,80}?)\s+–\s+(.{2,80}?)(?=\s+(?:pont|pronostic|prediction|pick|tip|peste|sub|over|under|victorie|cota|odds?|@)\b|$)/i,
    /^(.{2,80}?)\s+—\s+(.{2,80}?)(?=\s+(?:pont|pronostic|prediction|pick|tip|peste|sub|over|under|victorie|cota|odds?|@)\b|$)/i
  ];

  for (
    const pattern
    of patterns
  ) {
    const match =
      value.match(
        pattern
      );

    if (
      !match
    ) {
      continue;
    }

    const home =
      cleanTeam(
        match[1]
      );

    const away =
      cleanTeam(
        match[2]
      );

    if (
      validTeamName(home) &&
      validTeamName(away)
    ) {
      return {
        home,
        away
      };
    }
  }

  return null;
}

function oddFrom(
  text
) {
  const value =
    safe(text)
      .replace(
        /,/g,
        "."
      );

  const patterns = [
    /(?:cota|cot[aă]|odds?|odd)\s*[:=\-]?\s*(1\.\d{2,3}|2\.\d{2,3}|3\.\d{2,3}|4\.\d{2,3}|5\.\d{2,3})/i,

    /@\s*(1\.\d{2,3}|2\.\d{2,3}|3\.\d{2,3}|4\.\d{2,3}|5\.\d{2,3})/,

    /\b(1\.\d{2,3}|2\.\d{2,3}|3\.\d{2,3}|4\.\d{2,3}|5\.\d{2,3})\b/
  ];

  for (
    const pattern
    of patterns
  ) {
    const match =
      value.match(
        pattern
      );

    if (
      !match
    ) {
      continue;
    }

    const odd =
      Number(
        match[1]
      );

    if (
      Number.isFinite(
        odd
      ) &&
      odd > 1.01 &&
      odd <= 10
    ) {
      return odd;
    }
  }

  return null;
}

function marketFrom(
  text,
  event = null
) {
  const value =
    norm(text);

  let match;

  match =
    value.match(
      /(?:peste|over)\s*(\d+(?:[ .]\d+)?)\s*(?:gol|goluri|goals?)/
    );

  if (
    match
  ) {
    return (
      `Peste ` +
      `${match[1].replace(" ", ".")} goluri`
    );
  }

  match =
    value.match(
      /(?:sub|under)\s*(\d+(?:[ .]\d+)?)\s*(?:gol|goluri|goals?)/
    );

  if (
    match
  ) {
    return (
      `Sub ` +
      `${match[1].replace(" ", ".")} goluri`
    );
  }

  match =
    value.match(
      /(?:peste|over)\s*(\d+(?:[ .]\d+)?)\s*(?:cornere|corners?)/
    );

  if (
    match
  ) {
    return (
      `Peste ` +
      `${match[1].replace(" ", ".")} cornere`
    );
  }

  match =
    value.match(
      /(?:sub|under)\s*(\d+(?:[ .]\d+)?)\s*(?:cornere|corners?)/
    );

  if (
    match
  ) {
    return (
      `Sub ` +
      `${match[1].replace(" ", ".")} cornere`
    );
  }

  match =
    value.match(
      /(?:peste|over)\s*(\d+(?:[ .]\d+)?)\s*(?:cartonase|cards?)/
    );

  if (
    match
  ) {
    return (
      `Peste ` +
      `${match[1].replace(" ", ".")} cartonase`
    );
  }

  match =
    value.match(
      /(?:sub|under)\s*(\d+(?:[ .]\d+)?)\s*(?:cartonase|cards?)/
    );

  if (
    match
  ) {
    return (
      `Sub ` +
      `${match[1].replace(" ", ".")} cartonase`
    );
  }

  if (
    /ambele echipe.*marcheaza|both teams.*score|\bbtts\b|\bgg\b/
      .test(
        value
      )
  ) {
    return (
      "Ambele echipe marcheaza"
    );
  }

  if (
    /ambele echipe.*nu.*marcheaza|both teams.*not.*score|\bng\b/
      .test(
        value
      )
  ) {
    return (
      "Ambele echipe nu marcheaza"
    );
  }

  if (
    /sansa dubla\s*1x|double chance\s*1x|\b1x\b/
      .test(
        value
      )
  ) {
    return (
      "Sansa dubla 1X"
    );
  }

  if (
    /sansa dubla\s*x2|double chance\s*x2|\bx2\b/
      .test(
        value
      )
  ) {
    return (
      "Sansa dubla X2"
    );
  }

  if (
    /sansa dubla\s*12|double chance\s*12/
      .test(
        value
      )
  ) {
    return (
      "Sansa dubla 12"
    );
  }

  if (
    /victorie gazde|gazdele castiga|home win|home team to win/
      .test(
        value
      )
  ) {
    return (
      "Victorie gazde"
    );
  }

  if (
    /victorie oaspeti|oaspetii castiga|away win|away team to win/
      .test(
        value
      )
  ) {
    return (
      "Victorie oaspeti"
    );
  }

  if (
    /\begal\b|\bdraw\b|\bx\b/
      .test(
        value
      )
  ) {
    return "Egal";
  }

  if (
    /\b1\b/.test(
      value
    ) &&
    /pronostic|prediction|pick|tip|selection/
      .test(
        value
      )
  ) {
    return (
      "Victorie gazde"
    );
  }

  if (
    /\b2\b/.test(
      value
    ) &&
    /pronostic|prediction|pick|tip|selection/
      .test(
        value
      )
  ) {
    return (
      "Victorie oaspeti"
    );
  }

  if (
    event &&
    (
      /\bcastiga\b/.test(
        value
      ) ||
      /\bto win\b/.test(
        value
      ) ||
      /\bwins?\b/.test(
        value
      )
    )
  ) {
    if (
      value.includes(
        norm(
          event.home
        )
      )
    ) {
      return (
        `Victorie ${event.home}`
      );
    }

    if (
      value.includes(
        norm(
          event.away
        )
      )
    ) {
      return (
        `Victorie ${event.away}`
      );
    }
  }

  return null;
}

function makeRawSelection({
  event,
  market,
  odd,
  source,
  sourceUrl,
  extraMeta = {}
}) {
  if (
    !event ||
    !market
  ) {
    return null;
  }

  return {
    teams:
      `${event.home} - ${event.away}`,

    market_raw:
      market,

    odd:
      odd !== null &&
      odd !== undefined &&
      odd !== "" &&
      Number.isFinite(
        Number(odd)
      )
        ? Number(
            Number(odd)
              .toFixed(3)
          )
        : null,

    source,

    source_url:
      sourceUrl,

    meta: {
      bet_text:
        market,

      source,

      source_url:
        sourceUrl,

      ...extraMeta
    }
  };
}

function extractGenericSelections(
  html,
  source,
  sourceUrl
) {
  const blocks =
    blockTexts(
      html
    );

  const out = [];

  for (
    let i = 0;
    i < blocks.length;
    i++
  ) {
    const contexts = [
      blocks[i],

      [
        blocks[i],
        blocks[i + 1]
      ]
        .filter(Boolean)
        .join(" | "),

      [
        blocks[i],
        blocks[i + 1],
        blocks[i + 2]
      ]
        .filter(Boolean)
        .join(" | "),

      [
        blocks[i],
        blocks[i + 1],
        blocks[i + 2],
        blocks[i + 3]
      ]
        .filter(Boolean)
        .join(" | ")
    ];

    let event =
      null;

    for (
      const context
      of contexts
    ) {
      event =
        splitEvent(
          context
        );

      if (
        event
      ) {
        break;
      }
    }

    if (
      !event
    ) {
      continue;
    }

    let market =
      null;

    let odd =
      null;

    for (
      const context
      of contexts
    ) {
      if (
        !market
      ) {
        market =
          marketFrom(
            context,
            event
          );
      }

      if (
        !odd
      ) {
        odd =
          oddFrom(
            context
          );
      }
    }

    if (
      !market
    ) {
      continue;
    }

    const selection =
      makeRawSelection({
        event,
        market,
        odd,
        source,
        sourceUrl,
        extraMeta: {
          parser:
            "generic"
        }
      });

    if (
      selection
    ) {
      out.push(
        selection
      );
    }
  }

  return out;
}

function extract10Pariuri(
  html,
  sourceUrl
) {
  const $ =
    cheerio.load(
      html,
      {
        decodeEntities:
          false
      }
    );

  const out = [];

  const blocks =
    blockTexts(
      html
    );

  for (
    let i = 0;
    i < blocks.length;
    i++
  ) {
    const line =
      blocks[i];

    const event =
      splitEvent(
        line
      );

    if (
      !event
    ) {
      continue;
    }

    const context =
      [
        line,
        blocks[i + 1],
        blocks[i + 2],
        blocks[i + 3],
        blocks[i + 4]
      ]
        .filter(Boolean)
        .join(" | ");

    let market =
      null;

    const pronosticMatch =
      context.match(
        /pronostic\s*:?\s*([^|]{1,120})/i
      );

    if (
      pronosticMatch
    ) {
      market =
        marketFrom(
          pronosticMatch[1],
          event
        );
    }

    if (
      !market
    ) {
      market =
        marketFrom(
          context,
          event
        );
    }

    if (
      !market
    ) {
      continue;
    }

    const odd =
      oddFrom(
        context
      );

    const selection =
      makeRawSelection({
        event,
        market,
        odd,
        source:
          "10pariuri",
        sourceUrl,
        extraMeta: {
          parser:
            "10pariuri"
        }
      });

    if (
      selection
    ) {
      out.push(
        selection
      );
    }
  }

  /*
   * Tables are sometimes structured better
   * than the paragraph flow.
   */
  $("tr")
    .each(
      (_, tr) => {
        const cells =
          $(tr)
            .find(
              "td,th"
            )
            .map(
              (_, cell) =>
                safe(
                  $(cell).text()
                )
            )
            .get()
            .filter(
              Boolean
            );

        if (
          cells.length < 2
        ) {
          return;
        }

        const context =
          cells.join(
            " | "
          );

        const event =
          splitEvent(
            context
          );

        if (
          !event
        ) {
          return;
        }

        const market =
          marketFrom(
            context,
            event
          );

        if (
          !market
        ) {
          return;
        }

        const odd =
          oddFrom(
            context
          );

        const selection =
          makeRawSelection({
            event,
            market,
            odd,
            source:
              "10pariuri",
            sourceUrl,
            extraMeta: {
              parser:
                "10pariuri-table"
            }
          });

        if (
          selection
        ) {
          out.push(
            selection
          );
        }
      }
    );

  return out;
}

function extractPonturiPariuri(
  html,
  sourceUrl
) {
  const $ =
    cheerio.load(
      html,
      {
        decodeEntities:
          false
      }
    );

  const out = [];

  /*
   * PonturiPariuri publishes the daily ticket
   * in a table with this stable structure:
   *
   * Time | Match | Pick | Odd
   *
   * Example:
   * 20.00 | Univ Craiova vs KuPS | 1 | 1.47
   * 20.00 | Dinamo Minsk vs Braga | 2 | 1.44
   */

  $("tr")
    .each(
      (_, tr) => {
        const cells =
          $(tr)
            .find(
              "td,th"
            )
            .map(
              (_, cell) =>
                safe(
                  $(cell).text()
                )
            )
            .get()
            .filter(
              value =>
                value !== ""
            );

        if (
          cells.length < 4
        ) {
          return;
        }

        const matchText =
          safe(
            cells[1]
          );

        const pickText =
          safe(
            cells[2]
          );

        const oddText =
          safe(
            cells[3]
          )
            .replace(
              ",",
              "."
            );

        const event =
          splitEvent(
            matchText
          );

        if (
          !event
        ) {
          return;
        }

        let market =
          null;

        if (
          pickText === "1"
        ) {
          market =
            "Victorie gazde";
        } else if (
          pickText === "2"
        ) {
          market =
            "Victorie oaspeti";
        } else if (
          /^x$/i.test(
            pickText
          )
        ) {
          market =
            "Egal";
        } else if (
          /^1x$/i.test(
            pickText
          )
        ) {
          market =
            "Sansa dubla 1X";
        } else if (
          /^x2$/i.test(
            pickText
          )
        ) {
          market =
            "Sansa dubla X2";
        } else {
          market =
            marketFrom(
              pickText,
              event
            );
        }

        if (
          !market
        ) {
          return;
        }

        const odd =
          Number(
            oddText
          );

        if (
          !Number.isFinite(
            odd
          ) ||
          odd <= 1.01 ||
          odd > 10
        ) {
          return;
        }

        const selection =
          makeRawSelection({
            event,

            market,

            odd,

            source:
              "ponturipariuri.pro",

            sourceUrl,

            extraMeta: {
              parser:
                "ponturipariuri-table",

              raw_pick:
                pickText,

              raw_odd:
                oddText
            }
          });

        if (
          selection
        ) {
          out.push(
            selection
          );
        }
      }
    );

  /*
   * If the table was not found,
   * fall back to generic extraction.
   */
  if (
    !out.length
  ) {
    return extractGenericSelections(
      html,
      "ponturipariuri.pro",
      sourceUrl
    );
  }

  return out;
}
function extractBiletuZilei(
  html,
  sourceUrl
) {
  const $ =
    cheerio.load(
      html,
      {
        decodeEntities:
          false
      }
    );

  const out = [];

  /*
   * First try tables.
   */
  $("tr")
    .each(
      (_, tr) => {
        const cells =
          $(tr)
            .find(
              "td,th"
            )
            .map(
              (_, cell) =>
                safe(
                  $(cell).text()
                )
            )
            .get()
            .filter(
              Boolean
            );

        if (
          cells.length < 2
        ) {
          return;
        }

        const context =
          cells.join(
            " | "
          );

        const event =
          splitEvent(
            context
          );

        if (
          !event
        ) {
          return;
        }

        const market =
          marketFrom(
            context,
            event
          );

        if (
          !market
        ) {
          return;
        }

        const odd =
          oddFrom(
            context
          );

        const selection =
          makeRawSelection({
            event,
            market,
            odd,
            source:
              "biletu-zilei",
            sourceUrl,
            extraMeta: {
              parser:
                "biletu-zilei-table"
            }
          });

        if (
          selection
        ) {
          out.push(
            selection
          );
        }
      }
    );

  out.push(
    ...extractGenericSelections(
      html,
      "biletu-zilei",
      sourceUrl
    )
  );

  return out;
}

function extractSportyTrader(
  html,
  sourceUrl
) {
  const $ =
    cheerio.load(
      html,
      {
        decodeEntities:
          false
      }
    );

  const out = [];

  const containers = [];

  $(
    [
      "article",
      ".prediction",
      ".tip",
      ".betting-tip",
      ".match",
      ".event",
      ".card",
      "li"
    ].join(",")
  )
    .each(
      (_, element) => {
        const text =
          safe(
            $(element).text()
          );

        if (
          text.length >= 8 &&
          text.length <= 2000
        ) {
          containers.push(
            text
          );
        }
      }
    );

  containers.push(
    ...blockTexts(
      html
    )
  );

  for (
    const text
    of [
      ...new Set(
        containers
      )
    ]
  ) {
    const event =
      splitEvent(
        text
      );

    if (
      !event
    ) {
      continue;
    }

    const market =
      marketFrom(
        text,
        event
      );

    if (
      !market
    ) {
      continue;
    }

    /*
     * SportyTrader may not expose odds
     * on every listing. That is acceptable:
     * the event signal can still enter the
     * external candidate stage, but only after
     * exact Flashscore matching.
     */
    const odd =
      oddFrom(
        text
      );

    const selection =
      makeRawSelection({
        event,
        market,
        odd,
        source:
          "sportytrader",
        sourceUrl,
        extraMeta: {
          parser:
            "sportytrader",
          external_odd_missing:
            !Number.isFinite(
              Number(odd)
            )
        }
      });

    if (
      selection
    ) {
      out.push(
        selection
      );
    }
  }

  return out;
}

function extractSelectionsBySource(
  html,
  source,
  sourceUrl
) {
  if (
    source ===
    "10pariuri"
  ) {
    return extract10Pariuri(
      html,
      sourceUrl
    );
  }

  if (
    source ===
    "ponturipariuri.pro"
  ) {
    return extractPonturiPariuri(
      html,
      sourceUrl
    );
  }

  if (
    source ===
    "biletu-zilei"
  ) {
    return extractBiletuZilei(
      html,
      sourceUrl
    );
  }

  if (
    source ===
    "sportytrader"
  ) {
    return extractSportyTrader(
      html,
      sourceUrl
    );
  }

  return extractGenericSelections(
    html,
    source,
    sourceUrl
  );
}

function articleLinks(
  html,
  baseUrl,
  iso,
  source
) {
  const $ =
    cheerio.load(
      html,
      {
        decodeEntities:
          false
      }
    );

  const tokens =
    dateTokens(
      iso
    );

  const urls = [];

  $("a[href]")
    .each(
      (_, anchor) => {
        const href =
          safe(
            $(anchor)
              .attr("href")
          );

        const text =
          safe(
            $(anchor).text()
          );

        const url =
          absoluteUrl(
            href,
            baseUrl
          );

        if (
          !url
        ) {
          return;
        }

        const hay =
          norm(
            `${text} ${url}`
          );

        let relevant =
          tokens.some(
            token =>
              token &&
              hay.includes(
                token
              )
          );

        if (
          !relevant &&
          source ===
          "10pariuri"
        ) {
          relevant =
            /biletul zilei|cota 2|cota 3|cota mare|ponturi/i
              .test(
                `${text} ${url}`
              );
        }

        if (
          !relevant &&
          source ===
          "biletu-zilei"
        ) {
          relevant =
            /biletul zilei|cota 2|cota 3|ponturi/i
              .test(
                `${text} ${url}`
              );
        }

        if (
          !relevant &&
          source ===
          "ponturipariuri.pro"
        ) {
          relevant =
            /biletul zilei|biletulzilei|cota 2|ponturi/i
              .test(
                `${text} ${url}`
              );
        }

        if (
          relevant
        ) {
          urls.push(
            url
          );
        }
      }
    );

  return [
    ...new Set(
      urls
    )
  ]
    .slice(
      0,
      MAX_PAGES_PER_SOURCE
    );
}

function dedupeRaw(
  items
) {
  const seen =
    new Set();

  const out = [];

  for (
    const item
    of items
  ) {
    const key =
      [
        norm(
          item?.source
        ),

        norm(
          item?.teams
        ),

        norm(
          item?.market_raw
        ),

        Number.isFinite(
          Number(
            item?.odd
          )
        )
          ? Number(
              item.odd
            )
              .toFixed(2)
          : "no-odd"
      ]
        .join("|");

    if (
      !key ||
      seen.has(
        key
      )
    ) {
      continue;
    }

    seen.add(
      key
    );

    out.push(
      item
    );
  }

  return out;
}

function canonicalize(
  selection,
  matches
) {
  const hit =
    matchEventToFlashscore(
      selection.teams,
      matches
    );

  if (
    !hit?.match
  ) {
    return null;
  }

  const match =
    hit.match;

  const id =
    safe(
      match.id ||
      match.match_id ||
      match.flashscore_id
    );

  if (
    !id
  ) {
    return null;
  }

  const url =
    safe(
      match.url ||
      match.flashscore_url
    ) ||
    `https://www.flashscore.mobi/match/${id}/`;

  const score =
    Number(
      hit.score || 0
    );

  /*
   * The matcher already applies its own
   * ambiguity thresholds.
   *
   * We add a final safety floor here.
   */
  if (
    Number.isFinite(
      score
    ) &&
    score > 0 &&
    score < 0.72
  ) {
    return null;
  }

  return {
    ...selection,

    id,
    match_id:
      id,

    flashscore_url:
      url,

    url,

    teams:
      safe(
        match.teams
      ) ||
      selection.teams,

    time:
      safe(
        match.time
      ),

    country:
      safe(
        match.country
      ),

    competition:
      safe(
        match.competition ||
        match.league
      ),

    meta: {
      ...selection.meta,

      flashscore_match_confidence:
        Number.isFinite(
          score
        )
          ? Number(
              score.toFixed(3)
            )
          : null
    }
  };
}

function dedupeCanonical(
  items
) {
  const seen =
    new Set();

  const out = [];

  for (
    const item
    of items
  ) {
    const key =
      [
        safe(
          item?.match_id
        ),

        norm(
          item?.market_raw
        ),

        norm(
          item?.source
        )
      ]
        .join("|");

    if (
      !item?.match_id ||
      !item?.market_raw ||
      seen.has(
        key
      )
    ) {
      continue;
    }

    seen.add(
      key
    );

    out.push(
      item
    );
  }

  return out;
}

function sourceConfigs(
  iso
) {
  const [
    year,
    month,
    day
  ] =
    iso.split("-");

  return [
    {
      source:
        "10pariuri",

      urls: [
        `https://10pariuri.ro/biletul-zilei-la-pariuri/cota-2-${day}${month}${year}/`,
        `https://10pariuri.ro/biletul-zilei-la-pariuri/cota-3-${day}${month}${year}/`,
        "https://10pariuri.ro/biletul-zilei-la-pariuri/cota-2/",
        "https://10pariuri.ro/biletul-zilei-la-pariuri/cota-3-azi/",
        "https://10pariuri.ro/biletul-zilei-la-pariuri/bilet-cota-mare/"
      ],

      discover:
        true
    },

    {
      source:
        "biletu-zilei",

      urls: [
        "https://biletu-zilei.com/biletul-zilei/cota-2/",
        "https://biletu-zilei.com/biletul-zilei/cota-3/"
      ],

      discover:
        true
    },

    {
      source:
        "sportytrader",

      urls: [
        "https://www.sportytrader.com/en/betting-tips/football/today/"
      ],

      discover:
        false
    },

    {
      source:
        "ponturipariuri.pro",

      urls: [
        "https://ponturipariuri.pro/",

        `https://ponturipariuri.pro/biletulzilei/biletul-zilei-cota-2-${day}-${month}-${year}/`
      ],

      discover:
        true
    }
  ];
}

async function scrapeOneSource(
  config,
  iso,
  raw,
  errors,
  diagnostics
) {
  const visited =
    new Set();

  let extracted =
    0;

  for (
    const indexUrl
    of config.urls
  ) {
    if (
      visited.has(
        indexUrl
      )
    ) {
      continue;
    }

    visited.add(
      indexUrl
    );

    let indexHtml;

    try {
      indexHtml =
        await fetchText(
          indexUrl
        );
    } catch (error) {
      errors.push(
        `${config.source} ${indexUrl}: ${error.message}`
      );

      continue;
    }

    const indexSelections =
      extractSelectionsBySource(
        indexHtml,
        config.source,
        indexUrl
      );

    raw.push(
      ...indexSelections
    );

    extracted +=
      indexSelections.length;

    if (
      !config.discover
    ) {
      continue;
    }

    const links =
      articleLinks(
        indexHtml,
        indexUrl,
        iso,
        config.source
      );

    for (
      const pageUrl
      of links
    ) {
      if (
        visited.has(
          pageUrl
        )
      ) {
        continue;
      }

      visited.add(
        pageUrl
      );

      try {
        const html =
          await fetchText(
            pageUrl
          );

        const selections =
          extractSelectionsBySource(
            html,
            config.source,
            pageUrl
          );

        raw.push(
          ...selections
        );

        extracted +=
          selections.length;
      } catch (error) {
        errors.push(
          `${config.source} ${pageUrl}: ${error.message}`
        );
      }
    }
  }

  diagnostics[
    config.source
  ] = {
    pages_attempted:
      visited.size,

    raw_extracted:
      extracted
  };
}

async function addExtraSources(
  master,
  matches,
  iso
) {
  const raw =
    [];

  const errors =
    [];

  const diagnostics =
    {};

  const configs =
    sourceConfigs(
      iso
    );

  for (
    const config
    of configs
  ) {
    try {
      await scrapeOneSource(
        config,
        iso,
        raw,
        errors,
        diagnostics
      );
    } catch (error) {
      errors.push(
        `${config.source}: ${error.message}`
      );
    }
  }

  const parsed =
    dedupeRaw(
      raw
    );

  const matched =
    [];

  const dropped =
    [];

  for (
    const selection
    of parsed
  ) {
    const canonical =
      canonicalize(
        selection,
        matches
      );

    if (
      canonical
    ) {
      matched.push(
        canonical
      );
    } else {
      dropped.push({
        source:
          selection.source,

        teams:
          selection.teams,

        market_raw:
          selection.market_raw,

        odd:
          selection.odd,

        reason:
          "no_clear_flashscore_match"
      });
    }
  }

  const uniqueMatched =
    dedupeCanonical(
      matched
    );

  const counts =
    {};

  for (
    const selection
    of uniqueMatched
  ) {
    const source =
      selection.source ||
      "unknown";

    counts[source] =
      (
        counts[source] ||
        0
      ) + 1;
  }

  await fs.writeFile(
    EXTRA_ARTIFACT,

    JSON.stringify(
      {
        date:
          iso,

        raw_count:
          parsed.length,

        matched_count:
          uniqueMatched.length,

        dropped_count:
          dropped.length,

        source_counts:
          counts,

        diagnostics,

        selections:
          uniqueMatched,

        dropped:
          dropped.slice(
            0,
            100
          ),

        errors
      },
      null,
      2
    ),

    "utf8"
  );

  const combined =
    dedupeCanonical([
      ...(
        master.selections ||
        []
      ),

      ...uniqueMatched
    ]);

  return {
    master: {
      ...master,

      source_mode:
        uniqueMatched.length
          ? `${
              master.source_mode ||
              "existing"
            }_plus_extra_sources`
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

          ...uniqueMatched.map(
            selection =>
              selection.source
          )
        ])
      ],

      upstream_counts: {
        ...(
          master.upstream_counts ||
          {}
        ),

        extra_sources_raw:
          parsed.length,

        extra_sources_matched_to_flashscore:
          uniqueMatched.length
      },

      selections:
        combined
    },

    matched:
      uniqueMatched.length
  };
}

/*
 * Legacy fallback stub intentionally kept
 * for backward compatibility.
 *
 * Real fallback:
 * parsers/flashscore_odds_list_fallback.js
 */
async function addFallback(
  master,
  matches
) {
  return {
    master,
    added: 0
  };
}

(async () => {
  const iso =
    targetDate();

  const matches =
    getMatches(
      await readJson(
        MATCHES_FILE,
        {
          matches: []
        }
      )
    );

  let master =
    await readJson(
      MASTER_FILE,
      {
        date:
          iso,

        source:
          "master_pool",

        source_mode:
          "empty",

        sources_used:
          [],

        selections:
          []
      }
    );

  const extra =
    await addExtraSources(
      master,
      matches,
      iso
    );

  master =
    extra.master;

  const fallback =
    await addFallback(
      master,
      matches
    );

  master =
    fallback.master;

  await fs.writeFile(
    MASTER_FILE,

    JSON.stringify(
      master,
      null,
      2
    ),

    "utf8"
  );

  console.log(
    `[POOL+] date=${iso} ` +
    `extra_matched=${extra.matched} ` +
    `fallback_added=${fallback.added} ` +
    `final_pool=${master.selections?.length || 0}`
  );
})()
  .catch(
    error => {
      console.warn(
        `[POOL+] non-blocking failure: ` +
        `${error?.stack || error?.message || error}`
      );
    }
  );
