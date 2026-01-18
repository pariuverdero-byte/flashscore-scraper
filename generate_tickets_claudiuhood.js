// generate_tickets_claudiuhood.js
// ClaudiuHood PRIMARY (text+regex) → Flashscore mapping → fallback to generate_tickets.js

import fs from "fs/promises";
import * as cheerio from "cheerio";
import { execSync } from "child_process";

// ---------------- CONFIG ----------------
const MATCHES_JSON = "matches.json";
const COTA2_RULE = { size: 2, min: 1.9, max: 2.5 };
const ZI_RULE = { size: 4, min: 4.0, max: 6.0 };
const DAY_OFFSET = Number(process.env.DAY_OFFSET || 0);

const RO_MONTH = [
  "ianuarie","februarie","martie","aprilie","mai","iunie",
  "iulie","august","septembrie","octombrie","noiembrie","decembrie"
];

// ---------------- UTILS ----------------
const log = (msg) => console.log(`[claudiu] ${msg}`);

function normalize(s="") {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return {
    day: d.getDate(),
    dd: String(d.getDate()).padStart(2,"0"),
    mm: String(d.getMonth()+1).padStart(2,"0"),
    monthName: RO_MONTH[d.getMonth()],
    year: d.getFullYear()
  };
}

function buildUrls() {
  const { day, dd, mm, monthName, year } = buildDate(DAY_OFFSET);
  return {
    cota2: `https://www.claudiuhood.ro/cota-2-zilnica-${day}-${monthName}-${year}/`,
    zi: `https://www.claudiuhood.ro/biletul-zilei-${dd}-${mm}-${year}/`
  };
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "ro-RO,ro;q=0.9,en;q=0.8"
    }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function fallback(reason) {
  log(`FALLBACK → ${reason}`);
  execSync("node generate_tickets.js", { stdio: "inherit" });
  process.exit(0);
}

// ---------------- CLAUDIU TEXT EXTRACTION ----------------
function extractFromText(html) {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ");

  // Matches patterns like:
  // Team A – Team B ... 1X ... Cota 1.45
  const REGEX = /([A-Za-zÀ-ž0-9 .'-]+)\s*[-–]\s*([A-Za-zÀ-ž0-9 .'-]+).*?(1X|12|X2|1|X|2|Peste\s*\d+\.5|Sub\s*\d+\.5).*?Cota[: ]+([\d.]+)/gi;

  const out = [];
  let m;
  while ((m = REGEX.exec(text)) !== null) {
    out.push({
      teams: `${m[1].trim()} - ${m[2].trim()}`,
      market_raw: m[3].trim(),
      odd: Number(m[4])
    });
  }
  return out;
}

function normalizeMarket(m) {
  m = m.toLowerCase();
  if (m === "1" || m === "x" || m === "2") return m.toUpperCase();
  if (["1x","x2","12"].includes(m)) return m.toUpperCase();
  if (m.startsWith("peste")) return "O" + m.match(/(\d+\.5)/)[1];
  if (m.startsWith("sub")) return "U" + m.match(/(\d+\.5)/)[1];
  return null;
}

// ---------------- FLASHScore MAPPING ----------------
function mapToFlashscore(selections, matches) {
  const mapped = [];

  for (const s of selections) {
    const [a,b] = s.teams.split(" - ");
    const na = normalize(a);
    const nb = normalize(b);

    const match = matches.find(m => {
      const mt = normalize(m.teams || "");
      return mt.includes(na) && mt.includes(nb);
    });

    if (!match) continue;

    const market = normalizeMarket(s.market_raw);
    if (!market) continue;

    mapped.push({
      id: match.id,
      teams: match.teams,
      market,
      odd: s.odd,
      competition: match.competition,
      country: match.country,
      time: match.time,
      url: match.url
    });
  }

  return mapped;
}

function product(arr) {
  return arr.reduce((a,b)=>a*b,1);
}

// ---------------- MAIN ----------------
(async () => {
  const urls = buildUrls();
  log(`URLs → ${JSON.stringify(urls)}`);

  let matches = [];
  try {
    matches = JSON.parse(await fs.readFile(MATCHES_JSON,"utf8")).matches || [];
  } catch {
    fallback("matches.json missing");
  }

  if (!matches.length) fallback("no Flashscore matches");

  let htmlC2, htmlZi;
  try {
    htmlC2 = await fetchHtml(urls.cota2);
    htmlZi = await fetchHtml(urls.zi);
    await fs.writeFile("claudiu_cota2.html", htmlC2);
    await fs.writeFile("claudiu_zi.html", htmlZi);
  } catch {
    fallback("Claudiu pages not found");
  }

  const selC2 = extractFromText(htmlC2);
  const selZi = extractFromText(htmlZi);

  log(`Extracted Cota2 selections: ${selC2.length}`);
  log(`Extracted ZI selections: ${selZi.length}`);

  if (selC2.length < 2 || selZi.length < 4)
    fallback("not enough Claudiu selections");

  const mapC2 = mapToFlashscore(selC2.slice(0,2), matches);
  const mapZi = mapToFlashscore(selZi.slice(0,4), matches);

  if (mapC2.length !== 2) fallback("Cota2 mapping failed");
  if (mapZi.length !== 4) fallback("ZI mapping failed");

  const pC2 = product(mapC2.map(x=>x.odd));
  const pZi = product(mapZi.map(x=>x.odd));

  if (pC2 < COTA2_RULE.min || pC2 > COTA2_RULE.max)
    fallback("Cota2 odds outside range");

  if (pZi < ZI_RULE.min || pZi > ZI_RULE.max)
    fallback("ZI odds outside range");

  const out = {
    date: new Date().toISOString().slice(0,10),
    source: "claudiuhood",
    bilet_cota2: { selections: mapC2, product: pC2.toFixed(3) },
    biletul_zilei: { selections: mapZi, product: pZi.toFixed(3) }
  };

  await fs.writeFile("tickets.json", JSON.stringify(out,null,2));
  log("SUCCESS → tickets.json generated from ClaudiuHood");
})();
