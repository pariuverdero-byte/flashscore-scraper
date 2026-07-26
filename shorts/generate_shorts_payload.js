import fs from "fs/promises";
import path from "path";

/*
 * =========================================================
 * INPUT / OUTPUT
 * =========================================================
 */

const INPUT_FILE =
  process.env.SHORTS_INPUT_FILE ||
  "tickets.json";

const OUTPUT_DIR =
  process.env.SHORTS_OUTPUT_DIR ||
  "output";

const TICKET_TYPE =
  process.env.SHORTS_TICKET_TYPE ||
  "bilet_cota2";

const LANG =
  (process.env.LANG || "en").toLowerCase();

/*
 * =========================================================
 * BRAND CONFIGURATION
 * =========================================================
 */

const DEFAULT_BRAND =
  LANG === "ro"
    ? {
        name: "PariuVerde",
        displayName: "PARIUVERDE",
        website: "pariuverde.ro",
        websiteDisplay: "WWW.PARIUVERDE.RO",
        url: "https://pariuverde.ro"
      }
    : {
        name: "GreenBetTips",
        displayName: "GREENBETTIPS",
        website: "greenbettips.com",
        websiteDisplay: "WWW.GREENBETTIPS.COM",
        url: "https://greenbettips.com"
      };

const BRAND_NAME =
  process.env.SHORTS_BRAND_NAME ||
  DEFAULT_BRAND.name;

const BRAND_DISPLAY =
  process.env.SHORTS_BRAND_DISPLAY ||
  DEFAULT_BRAND.displayName;

const SITE_URL = (
  process.env.SHORTS_SITE_URL ||
  DEFAULT_BRAND.url
).replace(/\/$/, "");

const WEBSITE =
  process.env.SHORTS_WEBSITE ||
  DEFAULT_BRAND.website;

const WEBSITE_DISPLAY =
  process.env.SHORTS_WEBSITE_DISPLAY ||
  DEFAULT_BRAND.websiteDisplay;

/*
 * =========================================================
 * LANGUAGE LABELS
 * =========================================================
 */

const LABELS = {
  en: {
    ticketLabels: {
      bilet_cota2: "Odds 2 Ticket",
      biletul_zilei: "Bet of the Day"
    },

    visualHeadlines: {
      bilet_cota2: "ODDS 2 TICKET",
      biletul_zilei: "BET OF THE DAY"
    },

    intro: {
      bilet_cota2:
        `Here is today's Odds 2 football ticket from ${BRAND_NAME}.`,
      biletul_zilei:
        `Here is today's Bet of the Day from ${BRAND_NAME}.`
    },

    pickNumber: "Pick",
    versus: "versus",
    selection: "The pick is",
    odds: "at odds of",
    combinedOdds: "The combined odds are",

    outro:
      `Visit ${BRAND_NAME} for the full ticket and follow for daily football predictions.`,

    visualCombinedOdds: "COMBINED ODDS",
    visualWebsite: WEBSITE_DISPLAY,
    visualOutroTop: "ENJOYED TODAY'S PICKS?",
    visualSubscribe: "SUBSCRIBE",
    visualOutroMessage:
      "FOR DAILY FOOTBALL PREDICTIONS",

    noTicket:
      "No suitable ticket is available for a Short today.",

    youtubeDescription:
      "Daily football predictions",

    hashtags: [
      "football",
      "footballpredictions",
      "bettingtips",
      "soccer",
      "shorts"
    ]
  },

  ro: {
    ticketLabels: {
      bilet_cota2: "Bilet Cota 2",
      biletul_zilei: "Biletul Zilei"
    },

    visualHeadlines: {
      bilet_cota2: "BILET COTA 2",
      biletul_zilei: "BILETUL ZILEI"
    },

    intro: {
      bilet_cota2:
        `Acesta este Biletul Cota 2 de astăzi de la ${BRAND_NAME}.`,
      biletul_zilei:
        `Acesta este Biletul Zilei de la ${BRAND_NAME}.`
    },

    pickNumber: "Selecția",
    versus: "contra",
    selection: "Pronosticul este",
    odds: "la cota",
    combinedOdds: "Cota totală este",

    outro:
      `Vezi biletul complet pe ${BRAND_NAME} și abonează-te pentru ponturi zilnice.`,

    visualCombinedOdds: "COTA TOTALĂ",
    visualWebsite: WEBSITE_DISPLAY,
    visualOutroTop: "ȚI-AU PLĂCUT PONTURILE?",
    visualSubscribe: "ABONEAZĂ-TE",
    visualOutroMessage:
      "PENTRU PONTURI ZILNICE",

    noTicket:
      "Astăzi nu există un bilet potrivit pentru videoclip.",

    youtubeDescription:
      "Ponturi și pronosticuri zilnice la fotbal",

    hashtags: [
      "pariuri",
      "ponturi",
      "fotbal",
      "pronosticuri",
      "biletulzilei",
      "shorts"
    ]
  }
};

const T =
  LABELS[LANG] ||
  LABELS.en;

/*
 * =========================================================
 * TEXT HELPERS
 * =========================================================
 */

function clean(value) {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRomanianText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/ă/g, "a")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/ș/g, "s")
    .replace(/ş/g, "s")
    .replace(/ț/g, "t")
    .replace(/ţ/g, "t");
}

function displayOdd(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number.toFixed(2)
    : clean(value);
}

function spokenOdd(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return clean(value);
  }

  const fixed =
    number.toFixed(2);

  if (LANG === "ro") {
    return fixed.replace(".", " virgulă ");
  }

  return fixed.replace(".", " point ");
}

/*
 * =========================================================
 * MARKET TRANSLATION
 * =========================================================
 */

function translateMarketToEnglish(value) {
  const original = clean(value);

  if (!original) {
    return "";
  }

  const normalized =
    normalizeRomanianText(original);

  const exactTranslations = {
    "victorie gazde": "Home Win",
    "victorie oaspeti": "Away Win",
    "egal": "Draw",

    "1x": "Home Win or Draw",
    "x2": "Away Win or Draw",
    "12": "Either Team to Win",

    "peste 0.5 goluri": "Over 0.5 Goals",
    "peste 1.5 goluri": "Over 1.5 Goals",
    "peste 2.5 goluri": "Over 2.5 Goals",
    "peste 3.5 goluri": "Over 3.5 Goals",
    "peste 4.5 goluri": "Over 4.5 Goals",
    "peste 5.5 goluri": "Over 5.5 Goals",

    "sub 0.5 goluri": "Under 0.5 Goals",
    "sub 1.5 goluri": "Under 1.5 Goals",
    "sub 2.5 goluri": "Under 2.5 Goals",
    "sub 3.5 goluri": "Under 3.5 Goals",
    "sub 4.5 goluri": "Under 4.5 Goals",
    "sub 5.5 goluri": "Under 5.5 Goals",

    "ambele echipe marcheaza":
      "Both Teams to Score",

    "ambele echipe marcheaza - da":
      "Both Teams to Score",

    "ambele echipe marcheaza da":
      "Both Teams to Score",

    "ambele echipe inscriu":
      "Both Teams to Score",

    "gg":
      "Both Teams to Score",

    "ambele echipe marcheaza - nu":
      "Both Teams Not to Score",

    "ambele echipe marcheaza nu":
      "Both Teams Not to Score",

    "ng":
      "Both Teams Not to Score",

    "gazde peste 0.5 goluri":
      "Home Team Over 0.5 Goals",

    "gazde peste 1.5 goluri":
      "Home Team Over 1.5 Goals",

    "gazde peste 2.5 goluri":
      "Home Team Over 2.5 Goals",

    "oaspeti peste 0.5 goluri":
      "Away Team Over 0.5 Goals",

    "oaspeti peste 1.5 goluri":
      "Away Team Over 1.5 Goals",

    "oaspeti peste 2.5 goluri":
      "Away Team Over 2.5 Goals",

    "gazde marcheaza":
      "Home Team to Score",

    "oaspeti marcheaza":
      "Away Team to Score",

    "gazde castiga oricare repriza":
      "Home Team to Win Either Half",

    "oaspeti castiga oricare repriza":
      "Away Team to Win Either Half",

    "peste 0.5 goluri prima repriza":
      "Over 0.5 First-Half Goals",

    "peste 1.5 goluri prima repriza":
      "Over 1.5 First-Half Goals",

    "sub 1.5 goluri prima repriza":
      "Under 1.5 First-Half Goals"
  };

  if (exactTranslations[normalized]) {
    return exactTranslations[normalized];
  }

  const dynamicPatterns = [
    {
      regex:
        /^peste (\d+(?:\.\d+)?) goluri$/,
      format:
        (number) => `Over ${number} Goals`
    },
    {
      regex:
        /^sub (\d+(?:\.\d+)?) goluri$/,
      format:
        (number) => `Under ${number} Goals`
    },
    {
      regex:
        /^peste (\d+(?:\.\d+)?) cornere$/,
      format:
        (number) => `Over ${number} Corners`
    },
    {
      regex:
        /^sub (\d+(?:\.\d+)?) cornere$/,
      format:
        (number) => `Under ${number} Corners`
    },
    {
      regex:
        /^peste (\d+(?:\.\d+)?) cartonase$/,
      format:
        (number) => `Over ${number} Cards`
    },
    {
      regex:
        /^sub (\d+(?:\.\d+)?) cartonase$/,
      format:
        (number) => `Under ${number} Cards`
    }
  ];

  for (const pattern of dynamicPatterns) {
    const match =
      normalized.match(pattern.regex);

    if (match) {
      return pattern.format(match[1]);
    }
  }

  console.warn(
    `[SHORTS] Untranslated market: ${original}`
  );

  return original;
}

function localizeMarket(value) {
  const original = clean(value);

  if (LANG === "en") {
    return translateMarketToEnglish(original);
  }

  return original;
}

/*
 * =========================================================
 * TEAM / SELECTION HELPERS
 * =========================================================
 */

function splitTeams(selection) {
  const home =
    clean(selection.home);

  const away =
    clean(selection.away);

  if (home || away) {
    return {
      home,
      away,
      teams: clean(
        selection.teams ||
          [home, away]
            .filter(Boolean)
            .join(" - ")
      )
    };
  }

  const teams =
    clean(selection.teams);

  const parts =
    teams.split(/\s+-\s+/);

  return {
    home:
      clean(parts[0]),

    away:
      clean(
        parts
          .slice(1)
          .join(" - ")
      ),

    teams
  };
}

function selectionToPayload(
  selection,
  index
) {
  const teamData =
    splitTeams(selection);

  const marketOriginal =
    clean(
      selection.market_raw ||
      selection.bet_text_ro ||
      selection.market ||
      selection.bet_text_en
    );

  const market =
    localizeMarket(marketOriginal);

  return {
    index:
      index + 1,

    matchId:
      clean(
        selection.match_id ||
        selection.matchId
      ),

    teams:
      teamData.teams,

    home:
      teamData.home,

    away:
      teamData.away,

    competition:
      clean(selection.competition),

    country:
      clean(selection.country),

    kickoff:
      clean(
        selection.start_time ||
        selection.kickoff
      ),

    marketOriginal,

    market,

    odds:
      displayOdd(
        selection.odd ??
        selection.odds
      ),

    source:
      clean(selection.source),

    url:
      clean(
        selection.flashscore_url ||
        selection.flashscoreUrl ||
        selection.url
      )
  };
}

/*
 * =========================================================
 * TICKET LABELS
 * =========================================================
 */

function ticketLabel(type) {
  return (
    T.ticketLabels[type] ||
    clean(type)
  );
}

function visualHeadline(type) {
  return (
    T.visualHeadlines[type] ||
    ticketLabel(type).toUpperCase()
  );
}

function ticketIntro(type) {
  return (
    T.intro[type] ||
    `Today's football ticket from ${BRAND_NAME}.`
  );
}

/*
 * =========================================================
 * VOICE SCRIPT
 * =========================================================
 */

function buildVoiceScript(
  matches,
  totalOdds
) {
  const sentences = [
    ticketIntro(TICKET_TYPE)
  ];

  for (const match of matches) {
    const teamsText =
      match.home && match.away
        ? LANG === "ro"
          ? `${match.home} contra ${match.away}.`
          : `${match.home} versus ${match.away}.`
        : `${match.teams}.`;

    sentences.push(
      `${T.pickNumber} ${match.index}. ` +
      `${teamsText} ` +
      `${T.selection} ${match.market}, ` +
      `${T.odds} ${spokenOdd(match.odds)}.`
    );
  }

  sentences.push(
    `${T.combinedOdds} ${spokenOdd(totalOdds)}.`
  );

  sentences.push(
    T.outro
  );

  return sentences.join(" ");
}

/*
 * =========================================================
 * YOUTUBE METADATA
 * =========================================================
 */

function createMatchTitle(match) {
  if (match.home && match.away) {
    return `${match.home} vs ${match.away}`;
  }

  return match.teams;
}

function buildYouTubeTitle(
  label,
  matches,
  totalOdds
) {
  const matchText =
    matches
      .slice(0, 2)
      .map(createMatchTitle)
      .join(" + ");

  let title;

  if (LANG === "ro") {
    title =
      `${label}: ${matchText} | Cota ${totalOdds} #shorts`;
  } else {
    title =
      `${label}: ${matchText} | ${totalOdds} #shorts`;
  }

  if (title.length <= 100) {
    return title;
  }

  return LANG === "ro"
    ? `${label} | Cota ${totalOdds} #shorts`
    : `${label} | Total Odds ${totalOdds} #shorts`;
}

function buildYouTubeDescription(
  label,
  date,
  totalOdds
) {
  const hashtags =
    [
      ...T.hashtags,
      BRAND_NAME.toLowerCase()
    ]
      .map((tag) =>
        `#${tag.replace(
          /[^a-zA-Z0-9ăâîșțĂÂÎȘȚ_]/g,
          ""
        )}`
      )
      .join(" ");

  if (LANG === "ro") {
    return (
      `${label} pentru ${date}. ` +
      `Cota totală: ${totalOdds}.\n\n` +
      `Vezi biletul complet: ${SITE_URL}\n\n` +
      `${hashtags}`
    );
  }

  return (
    `${label} for ${date}. ` +
    `Combined odds: ${totalOdds}.\n\n` +
    `Full ticket: ${SITE_URL}\n\n` +
    `${hashtags}`
  );
}

/*
 * =========================================================
 * SKIPPED PAYLOAD
 * =========================================================
 */

async function writeSkippedPayload(
  reason,
  date
) {
  const skipped = {
    status: "skipped",
    version: 3,
    reason,
    date: date || null,
    language: LANG,
    ticketType: TICKET_TYPE,

    brand: {
      name: BRAND_NAME,
      displayName: BRAND_DISPLAY,
      website: WEBSITE,
      websiteDisplay: WEBSITE_DISPLAY,
      url: SITE_URL
    }
  };

  await fs.mkdir(
    OUTPUT_DIR,
    {
      recursive: true
    }
  );

  await fs.writeFile(
    path.join(
      OUTPUT_DIR,
      "shorts_payload.json"
    ),
    JSON.stringify(
      skipped,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    `[SHORTS] Skipped: ${reason}`
  );
}

/*
 * =========================================================
 * MAIN
 * =========================================================
 */

async function main() {
  const raw =
    await fs.readFile(
      INPUT_FILE,
      "utf8"
    );

  const tickets =
    JSON.parse(raw);

  await fs.mkdir(
    OUTPUT_DIR,
    {
      recursive: true
    }
  );

  if (tickets.status === "no_picks") {
    await writeSkippedPayload(
      tickets.reason ||
      T.noTicket,
      tickets.date
    );

    return;
  }

  const ticket =
    tickets[TICKET_TYPE];

  if (
    !ticket ||
    !Array.isArray(ticket.selections) ||
    ticket.selections.length === 0
  ) {
    await writeSkippedPayload(
      `${ticketLabel(TICKET_TYPE)} nu a fost generat`,
      tickets.date
    );

    return;
  }

  const matches =
    ticket.selections.map(
      selectionToPayload
    );

  const totalOdds =
    displayOdd(
      ticket.product ??
      ticket.totalOdds ??
      ticket.total_odds
    );

  const label =
    ticketLabel(TICKET_TYPE);

  const date =
    clean(tickets.date);

  const voiceScript =
    buildVoiceScript(
      matches,
      totalOdds
    );

  const youtubeTags = [
    ...new Set([
      ...T.hashtags,
      BRAND_NAME.toLowerCase(),
      LANG === "ro"
        ? "pariuri sportive"
        : "sports betting"
    ])
  ];

  const payload = {
    status: "ready",
    version: 3,
    generatedAt:
      new Date().toISOString(),

    language:
      LANG,

    date,

    ticketType:
      TICKET_TYPE,

    ticketLabel:
      label,

    brand: {
      name:
        BRAND_NAME,

      displayName:
        BRAND_DISPLAY,

      website:
        WEBSITE,

      websiteDisplay:
        WEBSITE_DISPLAY,

      url:
        SITE_URL
    },

    youtube: {
      title:
        buildYouTubeTitle(
          label,
          matches,
          totalOdds
        ),

      description:
        buildYouTubeDescription(
          label,
          date,
          totalOdds
        ),

      categoryId:
        "17",

      privacyStatus:
        process.env.YOUTUBE_PRIVACY_STATUS ||
        "private",

      tags:
        youtubeTags
    },

    wordpress: {
      postId:
        null,

      url:
        SITE_URL
    },

    visuals: {
      brand:
        BRAND_DISPLAY,

      headline:
        visualHeadline(TICKET_TYPE),

      totalOdds,

      combinedOddsLabel:
        T.visualCombinedOdds,

      callToAction:
        T.visualWebsite,

      website:
        WEBSITE_DISPLAY,

      outroTop:
        T.visualOutroTop,

      subscribe:
        T.visualSubscribe,

      outroMessage:
        T.visualOutroMessage,

      presenterAsset:
        process.env.SHORTS_PRESENTER_FILE ||
        (
          LANG === "ro"
            ? "assets/presenters/ro_presenter_01.mp4"
            : "assets/presenters/presenter-01.mp4"
        ),

      outputVideo:
        path.join(
          OUTPUT_DIR,
          "short.mp4"
        )
    },

    voice: {
      script:
        voiceScript,

      targetDurationSeconds:
        30,

      outputFile:
        path.join(
          OUTPUT_DIR,
          "voice.mp3"
        )
    },

    subtitles: {
      outputFile:
        path.join(
          OUTPUT_DIR,
          "subs.srt"
        )
    },

    selections:
      matches
  };

  await Promise.all([
    fs.writeFile(
      path.join(
        OUTPUT_DIR,
        "shorts_payload.json"
      ),
      JSON.stringify(
        payload,
        null,
        2
      ),
      "utf8"
    ),

    fs.writeFile(
      path.join(
        OUTPUT_DIR,
        "voice_script.txt"
      ),
      `${voiceScript}\n`,
      "utf8"
    )
  ]);

  console.log(
    `[SHORTS] Payload ready`
  );

  console.log(
    `[SHORTS] Brand: ${BRAND_NAME}`
  );

  console.log(
    `[SHORTS] Language: ${LANG}`
  );

  console.log(
    `[SHORTS] Ticket: ${TICKET_TYPE}`
  );

  console.log(
    `[SHORTS] Selections: ${matches.length}`
  );

  console.log(
    `[SHORTS] Total odds: ${totalOdds}`
  );

  console.log(
    `[SHORTS] Output: ${OUTPUT_DIR}`
  );
}

main().catch((error) => {
  console.error(
    "[SHORTS] Payload generation failed:"
  );

  console.error(error);

  process.exit(1);
});
