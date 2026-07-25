import fs from "fs/promises";
import path from "path";

const INPUT_FILE = process.env.SHORTS_INPUT_FILE || "tickets.json";
const OUTPUT_DIR = process.env.SHORTS_OUTPUT_DIR || "output";
const TICKET_TYPE = process.env.SHORTS_TICKET_TYPE || "bilet_cota2";
const SITE_URL = (
  process.env.SHORTS_SITE_URL || "https://greenbettips.com"
).replace(/\/$/, "");
const LANG = (process.env.LANG || "en").toLowerCase();

const LABELS = {
  en: {
    cota: "Odds 2 Ticket",
    day: "Bet of the Day",
    introCota: "Here is today's Odds 2 football ticket from GreenBetTips.",
    introDay: "Here is today's Bet of the Day from GreenBetTips.",
    pick: "The pick is",
    atOdds: "at odds of",
    total: "The combined odds are",
    outro:
      "Visit GreenBetTips for the full ticket and follow for daily football predictions.",
    noPicks: "No suitable ticket is available for a Short today."
  },
  ro: {
    cota: "Bilet Cota 2",
    day: "Biletul Zilei",
    introCota: "Iata biletul Cota 2 de astazi de la Pariu Verde.",
    introDay: "Iata Biletul Zilei de la Pariu Verde.",
    pick: "Selectia este",
    atOdds: "la cota",
    total: "Cota totala este",
    outro:
      "Vezi biletul complet pe Pariu Verde si urmareste-ne pentru predictii zilnice.",
    noPicks: "Astazi nu exista un bilet potrivit pentru un Short."
  }
};

const T = LABELS[LANG] || LABELS.en;

function clean(value) {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMarket(value) {
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

function translateMarketToEnglish(value) {
  const original = clean(value);

  if (!original || LANG !== "en") {
    return original;
  }

  const normalized = normalizeMarket(original);

  const exactTranslations = {
    "victorie gazde": "Home Win",
    "victorie oaspeti": "Away Win",
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

    "ambele echipe marcheaza": "Both Teams to Score",
    "ambele echipe marcheaza - da": "Both Teams to Score",
    "ambele echipe marcheaza da": "Both Teams to Score",
    "ambele echipe inscriu": "Both Teams to Score",
    "gg": "Both Teams to Score",

    "ambele echipe marcheaza - nu": "Both Teams Not to Score",
    "ambele echipe marcheaza nu": "Both Teams Not to Score",
    "ng": "Both Teams Not to Score",

    "gazde peste 0.5 goluri": "Home Team Over 0.5 Goals",
    "gazde peste 1.5 goluri": "Home Team Over 1.5 Goals",
    "gazde peste 2.5 goluri": "Home Team Over 2.5 Goals",

    "oaspeti peste 0.5 goluri": "Away Team Over 0.5 Goals",
    "oaspeti peste 1.5 goluri": "Away Team Over 1.5 Goals",
    "oaspeti peste 2.5 goluri": "Away Team Over 2.5 Goals",

    "peste 7.5 cornere": "Over 7.5 Corners",
    "peste 8.5 cornere": "Over 8.5 Corners",
    "peste 9.5 cornere": "Over 9.5 Corners",
    "peste 10.5 cornere": "Over 10.5 Corners",
    "peste 11.5 cornere": "Over 11.5 Corners",

    "sub 7.5 cornere": "Under 7.5 Corners",
    "sub 8.5 cornere": "Under 8.5 Corners",
    "sub 9.5 cornere": "Under 9.5 Corners",
    "sub 10.5 cornere": "Under 10.5 Corners",
    "sub 11.5 cornere": "Under 11.5 Corners",

    "peste 2.5 cartonase": "Over 2.5 Cards",
    "peste 3.5 cartonase": "Over 3.5 Cards",
    "peste 4.5 cartonase": "Over 4.5 Cards",
    "peste 5.5 cartonase": "Over 5.5 Cards",

    "sub 2.5 cartonase": "Under 2.5 Cards",
    "sub 3.5 cartonase": "Under 3.5 Cards",
    "sub 4.5 cartonase": "Under 4.5 Cards",
    "sub 5.5 cartonase": "Under 5.5 Cards",

    "gazde marcheaza": "Home Team to Score",
    "oaspeti marcheaza": "Away Team to Score",

    "gazde castiga oricare repriza": "Home Team to Win Either Half",
    "oaspeti castiga oricare repriza": "Away Team to Win Either Half",

    "peste 0.5 goluri prima repriza": "Over 0.5 First-Half Goals",
    "peste 1.5 goluri prima repriza": "Over 1.5 First-Half Goals",
    "sub 1.5 goluri prima repriza": "Under 1.5 First-Half Goals"
  };

  if (exactTranslations[normalized]) {
    return exactTranslations[normalized];
  }

  const overGoals = normalized.match(/^peste (\d+(?:\.\d+)?) goluri$/);
  if (overGoals) {
    return `Over ${overGoals[1]} Goals`;
  }

  const underGoals = normalized.match(/^sub (\d+(?:\.\d+)?) goluri$/);
  if (underGoals) {
    return `Under ${underGoals[1]} Goals`;
  }

  const overCorners = normalized.match(/^peste (\d+(?:\.\d+)?) cornere$/);
  if (overCorners) {
    return `Over ${overCorners[1]} Corners`;
  }

  const underCorners = normalized.match(/^sub (\d+(?:\.\d+)?) cornere$/);
  if (underCorners) {
    return `Under ${underCorners[1]} Corners`;
  }

  const overCards = normalized.match(/^peste (\d+(?:\.\d+)?) cartonase$/);
  if (overCards) {
    return `Over ${overCards[1]} Cards`;
  }

  const underCards = normalized.match(/^sub (\d+(?:\.\d+)?) cartonase$/);
  if (underCards) {
    return `Under ${underCards[1]} Cards`;
  }

  console.warn(`[SHORTS] Untranslated market: ${original}`);
  return original;
}

function spokenOdd(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return clean(value);
  }

  return number
    .toFixed(2)
    .replace(".", LANG === "ro" ? " virgula " : " point ");
}

function displayOdd(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : clean(value);
}

function ticketLabel(type) {
  return type === "biletul_zilei" ? T.day : T.cota;
}

function ticketIntro(type) {
  return type === "biletul_zilei" ? T.introDay : T.introCota;
}

function splitTeams(selection) {
  const home = clean(selection.home);
  const away = clean(selection.away);

  if (home || away) {
    return {
      home,
      away,
      teams: clean(
        selection.teams || [home, away].filter(Boolean).join(" - ")
      )
    };
  }

  const teams = clean(selection.teams);
  const parts = teams.split(/\s+-\s+/);

  return {
    home: clean(parts[0]),
    away: clean(parts.slice(1).join(" - ")),
    teams
  };
}

function selectionToPayload(selection, index) {
  const teamData = splitTeams(selection);

  const marketOriginal = clean(
    selection.bet_text_en ||
      selection.market_raw ||
      selection.bet_text_ro ||
      selection.market
  );

  const market =
    LANG === "en"
      ? translateMarketToEnglish(marketOriginal)
      : marketOriginal;

  const odds = displayOdd(selection.odd ?? selection.odds);

  return {
    index: index + 1,
    matchId: clean(selection.match_id || selection.matchId),
    teams: teamData.teams,
    home: teamData.home,
    away: teamData.away,
    competition: clean(selection.competition),
    country: clean(selection.country),
    kickoff: clean(selection.start_time || selection.kickoff),
    marketOriginal,
    market,
    odds,
    source: clean(selection.source),
    url: clean(
      selection.flashscore_url ||
        selection.flashscoreUrl ||
        selection.url
    )
  };
}

function buildVoiceScript(matches, totalOdds) {
  const sentences = [ticketIntro(TICKET_TYPE)];

  for (const match of matches) {
    const versusText =
      match.home && match.away
        ? `${match.home} versus ${match.away}.`
        : `${match.teams}.`;

    sentences.push(
      `Pick ${match.index}. ${versusText} ${T.pick} ${match.market}, ${T.atOdds} ${spokenOdd(match.odds)}.`
    );
  }

  sentences.push(`${T.total} ${spokenOdd(totalOdds)}.`);
  sentences.push(T.outro);

  return sentences.join(" ");
}

function buildYouTubeTitle(label, matches, totalOdds) {
  const matchText = matches
    .slice(0, 2)
    .map((match) =>
      match.home && match.away
        ? `${match.home} vs ${match.away}`
        : match.teams
    )
    .join(" + ");

  const coreTitle = matchText
    ? `${label}: ${matchText}`
    : label;

  const title = `${coreTitle} | ${totalOdds} #shorts`;

  return title.length <= 100
    ? title
    : `${label} | Total Odds ${totalOdds} #shorts`;
}

async function writeSkippedPayload(reason, date) {
  const skipped = {
    status: "skipped",
    reason,
    date: date || null,
    ticketType: TICKET_TYPE
  };

  await fs.writeFile(
    path.join(OUTPUT_DIR, "shorts_payload.json"),
    JSON.stringify(skipped, null, 2),
    "utf8"
  );

  console.log(`[SHORTS] Skipped: ${reason}`);
}

async function main() {
  const raw = await fs.readFile(INPUT_FILE, "utf8");
  const tickets = JSON.parse(raw);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  if (tickets.status === "no_picks") {
    await writeSkippedPayload(
      tickets.reason || T.noPicks,
      tickets.date
    );
    return;
  }

  const ticket = tickets[TICKET_TYPE];

  if (!ticket?.selections?.length) {
    await writeSkippedPayload(
      `${TICKET_TYPE} was not generated`,
      tickets.date
    );
    return;
  }

  const matches = ticket.selections.map(selectionToPayload);
  const totalOdds = displayOdd(ticket.product || ticket.totalOdds);
  const label = ticketLabel(TICKET_TYPE);
  const date = clean(tickets.date);
  const voiceScript = buildVoiceScript(matches, totalOdds);

  const payload = {
    status: "ready",
    version: 2,
    generatedAt: new Date().toISOString(),
    language: LANG,
    date,
    ticketType: TICKET_TYPE,
    ticketLabel: label,

    brand: {
      name: "GreenBetTips",
      website: "greenbettips.com",
      url: SITE_URL
    },

    youtube: {
      title: buildYouTubeTitle(label, matches, totalOdds),
      description:
        `${label} for ${date}. Combined odds: ${totalOdds}. ` +
        `Full ticket: ${SITE_URL}\n\n` +
        "#football #bettingtips #shorts",
      categoryId: "17",
      privacyStatus: "private",
      tags: [
        "football",
        "football predictions",
        "betting tips",
        "greenbettips",
        "shorts"
      ]
    },

    wordpress: {
      postId: null,
      url: SITE_URL
    },

    visuals: {
      headline:
        TICKET_TYPE === "biletul_zilei"
          ? "BET OF THE DAY"
          : "ODDS 2 TICKET",
      totalOdds,
      callToAction: "FULL TICKET AT GREENBETTIPS.COM",
      presenterAsset: "assets/presenters/presenter-01.mp4",
      outputVideo: "output/short.mp4"
    },

    voice: {
      script: voiceScript,
      targetDurationSeconds: 30,
      outputFile: "output/voice.mp3"
    },

    subtitles: {
      outputFile: "output/subs.srt"
    },

    selections: matches
  };

  await Promise.all([
    fs.writeFile(
      path.join(OUTPUT_DIR, "shorts_payload.json"),
      JSON.stringify(payload, null, 2),
      "utf8"
    ),
    fs.writeFile(
      path.join(OUTPUT_DIR, "voice_script.txt"),
      `${voiceScript}\n`,
      "utf8"
    )
  ]);

  console.log(
    `[SHORTS] Payload ready: ${matches.length} selections, total odds ${totalOdds}`
  );
}

main().catch((error) => {
  console.error("[SHORTS] Payload generation failed:", error);
  process.exit(1);
});
