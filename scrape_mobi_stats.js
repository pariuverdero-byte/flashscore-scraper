import fs from "fs/promises";
import * as cheerio from "cheerio";

const BASE = "https://www.flashscore.mobi";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function num(v) {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function extractMinute($) {
  const t = $("span.mstat").first().text().trim(); // e.g. "23'"
  const m = /(\d{1,3})'/.exec(t);
  return m ? Number(m[1]) : null;
}

function emptyTeam() {
  return {
    xg: 0,
    shots: 0,
    shots_on_target: 0,
    big_chances: 0,
    shots_in_box: 0,
    box_touches: 0,
    corners: 0,
  };
}

function parseStats(html) {
  const $ = cheerio.load(html, { decodeEntities: false });

  const minute = extractMinute($);

  const home = emptyTeam();
  const away = emptyTeam();

  $("tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length !== 3) return;

    const left = $(tds[0]).text().trim();
    const label = $(tds[1]).text().trim().toLowerCase();
    const right = $(tds[2]).text().trim();

    if (!label) return;

    if (label.includes("expected goals")) {
      home.xg = num(left);
      away.xg = num(right);
    } else if (label === "total shots") {
      home.shots = num(left);
      away.shots = num(right);
    } else if (label === "shots on target") {
      home.shots_on_target = num(left);
      away.shots_on_target = num(right);
    } else if (label === "big chances") {
      home.big_chances = num(left);
      away.big_chances = num(right);
    } else if (label === "shots inside the box") {
      home.shots_in_box = num(left);
      away.shots_in_box = num(right);
    } else if (label === "touches in opposition box") {
      home.box_touches = num(left);
      away.box_touches = num(right);
    } else if (label === "corner kicks") {
      home.corners = num(left);
      away.corners = num(right);
    }
  });

  return { minute, home, away };
}

// CLI usage: node scrape_mobi_stats.js XSvcCx3
(async () => {
  const matchId = process.argv[2];
  if (!matchId) {
    console.error("Usage: node scrape_mobi_stats.js <match_id>");
    process.exit(1);
  }

  const url = `${BASE}/match/${matchId}/?s=2`;
  const html = await fetchText(url);
  await fs.writeFile(`stats_${matchId}.html`, html, "utf8");

  const stats = parseStats(html);
  console.log(JSON.stringify({ matchId, ...stats }, null, 2));
})();
