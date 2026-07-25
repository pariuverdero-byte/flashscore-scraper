import fs from "fs/promises";

const INPUT_FILE = process.env.SHORTS_TICKETS_FILE || "tickets.json";
const WP_RESULT_FILE = process.env.SHORTS_WP_RESULT_FILE || "published_posts.json";
const OUTPUT_FILE = process.env.SHORTS_PAYLOAD_FILE || "output/shorts_payload.json";
const SITE_URL = (process.env.WP_URL || "https://greenbettips.com").replace(/\/$/, "");
const LANG = (process.env.LANG || "en").toLowerCase();
const TICKET_TYPE = (process.env.SHORTS_TICKET_TYPE || "bilet_cota2").toLowerCase();

const readJson = async (path, fallback = null) => {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return fallback;
  }
};

const clean = (value = "") => String(value).replace(/\s+/g, " ").trim();
const number = (value, fallback = null) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

function splitTeams(value = "") {
  const raw = clean(value);
  const parts = raw.split(/\s+(?:-|–|—|vs\.?|v\.)\s+/i).map(clean).filter(Boolean);
  return {
    home: parts[0] || raw || "Home team",
    away: parts[1] || "Away team",
  };
}

function marketText(selection = {}) {
  return clean(
    selection.bet_text_en ||
      selection.meta?.bet_text_en ||
      selection.meta?.bet_text ||
      selection.market_text ||
      selection.market_raw ||
      selection.market ||
      selection.bet_type ||
      "Recommended selection"
  );
}

function normalizeSelection(selection, index) {
  const { home, away } = splitTeams(selection.teams);
  const odd = number(selection.odd, 0);
  return {
    index: index + 1,
    matchId: clean(selection.match_id || selection.id || ""),
    teams: clean(selection.teams || `${home} vs ${away}`),
    home,
    away,
    competition: clean(selection.competition || ""),
    country: clean(selection.country || ""),
    kickoff: clean(selection.time || selection.start_time || ""),
    market: marketText(selection),
    odds: odd ? odd.toFixed(2) : "-",
    source: clean(selection.source || ""),
    url: clean(selection.flashscore_url || selection.url || ""),
  };
}

function formatDate(date) {
  if (!date) return "today";
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat(LANG === "ro" ? "ro-RO" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function spokenOdds(value) {
  const n = number(value, 0);
  return n ? n.toFixed(2).replace(".", " point ") : "unavailable";
}

function buildEnglishScript(ticketLabel, selections, totalOdds) {
  const intro = `Here are today's ${ticketLabel.toLowerCase()} from Green Bet Tips.`;
  const picks = selections.map((s, i) => {
    const order = selections.length > 1 ? `Pick ${i + 1}. ` : "";
    return `${order}${s.home} versus ${s.away}. Our selection is ${s.market}, at odds ${spokenOdds(s.odds)}.`;
  });
  return [
    intro,
    ...picks,
    `The combined odds are ${spokenOdds(totalOdds)}.`,
    "Check the full ticket on greenbettips dot com and follow for daily football picks.",
  ].join(" ");
}

function buildRomanianScript(ticketLabel, selections, totalOdds) {
  const intro = `Acestea sunt selecțiile de astăzi pentru ${ticketLabel.toLowerCase()}, de la Pariu Verde.`;
  const picks = selections.map((s, i) => {
    const order = selections.length > 1 ? `Selecția ${i + 1}. ` : "";
    return `${order}${s.home} contra ${s.away}. Pariul recomandat este ${s.market}, la cota ${spokenOdds(s.odds)}.`;
  });
  return [
    intro,
    ...picks,
    `Cota totală este ${spokenOdds(totalOdds)}.`,
    "Vezi biletul complet pe pariuverde punct ro și urmărește-ne pentru ponturile zilnice.",
  ].join(" ");
}

function findWordPressPost(posts, ticketType) {
  if (!Array.isArray(posts)) return null;
  const slug = ticketType === "biletul_zilei" ? "biletul-zilei" : "cota-2";
  return posts.find((p) => p?.categorySlug === slug || p?.ticketType === ticketType) || null;
}

async function main() {
  const tickets = await readJson(INPUT_FILE);
  if (!tickets) throw new Error(`Could not read ${INPUT_FILE}`);

  await fs.mkdir("output", { recursive: true });

  if (tickets.status === "no_picks") {
    const skipped = {
      status: "skip",
      reason: tickets.reason || "No picks generated",
      date: tickets.date || null,
      generatedAt: new Date().toISOString(),
    };
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(skipped, null, 2));
    console.log(`[SHORTS] Skipped: ${skipped.reason}`);
    return;
  }

  const selectedTicket = tickets[TICKET_TYPE] || tickets.bilet_cota2 || tickets.biletul_zilei;
  if (!selectedTicket?.selections?.length) {
    throw new Error(`No usable ticket found for SHORTS_TICKET_TYPE=${TICKET_TYPE}`);
  }

  const actualType = tickets[TICKET_TYPE] ? TICKET_TYPE : tickets.bilet_cota2 ? "bilet_cota2" : "biletul_zilei";
  const ticketLabel = actualType === "biletul_zilei" ? "Bet of the Day" : "Odds 2 Ticket";
  const selections = selectedTicket.selections.map(normalizeSelection);
  const totalOdds = number(selectedTicket.product, 0).toFixed(2);
  const wpResults = await readJson(WP_RESULT_FILE, []);
  const wpPost = findWordPressPost(wpResults, actualType);
  const postUrl = wpPost?.url || wpPost?.link || SITE_URL;
  const dateLabel = formatDate(tickets.date);

  const voiceScript = LANG === "ro"
    ? buildRomanianScript(ticketLabel, selections, totalOdds)
    : buildEnglishScript(ticketLabel, selections, totalOdds);

  const payload = {
    status: "ready",
    version: 1,
    generatedAt: new Date().toISOString(),
    language: LANG,
    date: tickets.date,
    dateLabel,
    ticketType: actualType,
    ticketLabel,
    brand: {
      name: "GreenBetTips",
      website: "greenbettips.com",
      url: SITE_URL,
    },
    youtube: {
      title: `${ticketLabel}: ${selections.map((s) => `${s.home} vs ${s.away}`).join(" + ")} | ${totalOdds} #shorts`.slice(0, 100),
      description: `${ticketLabel} for ${dateLabel}. Combined odds: ${totalOdds}. Full ticket: ${postUrl}\n\n#football #bettingtips #shorts`,
      categoryId: "17",
      privacyStatus: "public",
      tags: ["football", "football predictions", "betting tips", "greenbettips", "shorts"],
    },
    wordpress: {
      postId: wpPost?.id || null,
      url: postUrl,
    },
    visuals: {
      headline: ticketLabel.toUpperCase(),
      totalOdds,
      callToAction: "FULL TICKET AT GREENBETTIPS.COM",
      presenterAsset: "assets/presenters/presenter-01.mp4",
      outputVideo: "output/short.mp4",
    },
    voice: {
      script: voiceScript,
      targetDurationSeconds: 30,
      outputFile: "output/voice.mp3",
    },
    subtitles: {
      outputFile: "output/subs.srt",
    },
    selections,
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile("output/voice_script.txt", `${voiceScript}\n`, "utf8");
  console.log(`[SHORTS] Payload generated: ${OUTPUT_FILE}`);
  console.log(`[SHORTS] Ticket: ${ticketLabel}; selections=${selections.length}; totalOdds=${totalOdds}`);
}

main().catch((error) => {
  console.error(`[SHORTS] ${error.message}`);
  process.exit(1);
});
