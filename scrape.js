import { chromium } from "playwright";
import fs from "fs";

const START_URL   = process.env.FLASH_URL || "https://www.flashscore.com/football/";
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 12);
const HEADLESS    = process.env.HEADLESS !== "false";
const GUARD_TIME  = process.env.GUARD_TIME === "1"; // rulează efectiv doar la 07:30 RO

function isRunTimeNow(targetHH=7, targetMM=30, tz="Europe/Bucharest") {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const hh = Number(parts.find(p => p.type === 'hour').value);
  const mm = Number(parts.find(p => p.type === 'minute').value);
  return hh === targetHH && mm === targetMM;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clean = (s) => String(s||"").replace(/\s+/g, " ").trim();

async function listMatches(page) {
  await page.goto(START_URL, { waitUntil: "networkidle", timeout: 60000 });

  // Accept cookies dacă apare (ajustează textul dacă e în română)
  try {
    const accept = page.locator('button:has-text("Accept"), button:has-text("Agree"), button:has-text("Sunt de acord")');
    if (await accept.first().isVisible()) await accept.first().click({ timeout: 5000 });
  } catch {}

  // TODO: selectorul linkurilor către pagina de meci; începe generic:
  const anchors = await page.locator('a[href*="/match/"]').all();

  const rows = [];
  for (const a of anchors) {
    try {
      const urlRel = await a.getAttribute("href");
      if (!urlRel) continue;
      const url = new URL(urlRel, "https://www.flashscore.com").toString();
      const id = (url.match(/\/match\/([^/]+)\//i) || [])[1] || url;

      // încearcă să citești echipele din context
      const parent = a.locator("xpath=ancestor-or-self::*[self::a or self::div][1]");
      const home = await parent.locator('.event__participant--home, [data-testid="match-home"]').first().textContent().catch(()=>null);
      const away = await parent.locator('.event__participant--away, [data-testid="match-away"]').first().textContent().catch(()=>null);
      const teams = (home && away) ? `${clean(home)} - ${clean(away)}` : null;

      rows.push({ id, url, teams });
      if (rows.length >= MAX_MATCHES) break;
    } catch {}
  }

  // elimină duplicate după id
  const seen = new Set();
  return rows.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
}

async function fetch1X2Odds(browser, matches) {
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (PariuVerdeBot/1.0)",
    viewport: { width: 1366, height: 900 }
  });
  const page = await ctx.newPage();
  const out = [];

  for (const m of matches) {
    try {
      await page.goto(m.url, { waitUntil: "networkidle", timeout: 60000 });

      // Deschide tab “Odds” (în unele limbi “Cote”) — extinde selectorul
      const oddsTab = page.locator(
        'a:has-text("Odds"), a:has-text("Cote"), button:has-text("Odds"), button:has-text("Cote"), [aria-label*="Odds"], [aria-label*="Cote"]'
      );
      if (await oddsTab.first().isVisible()) {
        await oddsTab.first().click({ timeout: 15000 });
        await sleep(800);
      }

      // TODO: selector mai specific pentru tabelul/box-ul 1X2 (inspectează pagina și ajustează)
      const table = page.locator('table, [role="table"]').first();
      const txt = clean(await table.textContent().catch(()=>"" ));

      // Heuristică: primele 3 numere cu format cote → 1, X, 2
      const nums = (txt.match(/\b\d+(?:[.,]\d+)?\b/g) || [])
        .map(x => Number(String(x).replace(',', '.')))
        .filter(x => x > 1.01 && x < 100);

      const o1 = nums[0], ox = nums[1], o2 = nums[2];

      if (o1) out.push({ id: m.id, teams: m.teams || m.id, market: "1", odd: o1 });
      if (ox) out.push({ id: m.id, teams: m.teams || m.id, market: "X", odd: ox });
      if (o2) out.push({ id: m.id, teams: m.teams || m.id, market: "2", odd: o2 });

      await sleep(350);
    } catch (e) {
      console.error("[ODDS FAIL]", m.url, e.message);
    }
  }
  await ctx.close();
  return out;
}

(async () => {
  if (GUARD_TIME && !isRunTimeNow(7, 30, "Europe/Bucharest"))) {
    console.log("Not 07:30 Europe/Bucharest — exiting.");
    fs.writeFileSync("odds.json", JSON.stringify({ events: [] }, null, 2));
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage();

  console.log("[*] Start:", START_URL);
  const matches = await listMatches(page);
  console.log("[*] Matches:", matches.length);

  let odds = [];
  if (matches.length) odds = await fetch1X2Odds(browser, matches);

  await browser.close();

  // scrie artifact
  fs.writeFileSync("odds.json", JSON.stringify({ events: odds }, null, 2));
  console.log("[*] Saved odds.json with", odds.length, "rows");
})().catch(err => { console.error(err); process.exit(1); });
