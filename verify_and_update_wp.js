// verify_and_update_wp.js — FULL FINAL (RO + EN, MATCH + HALVES, FIXED PENDING + TEAM SPLIT)
// Node 18 / 20 compatible

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE = process.env.WP_BASE;
const WP_USER = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;

const RECHECK_ONCE = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");
const FS_BASE = "https://www.flashscore.mobi/match/";

const WIN = "win";
const LOSS = "loss";

/* ================= AUTH ================= */
const auth =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const get = (url) => fetch(url, { headers: { Authorization: auth } });
const put = (url, body) =>
  fetch(url, {
    method: "PUT",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

/* ================= HELPERS ================= */
function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMatchId($row) {
  const href =
    $row.find("a[href*='flashscore.mobi/match/']").attr("href") ||
    $row.find("a[href*='flashscore']").attr("href");
  const m = href?.match(/match\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function parseScore(txt) {
  const m = (txt || "").match(/(\d+)\s*[:\-]\s*(\d+)/);
  return m ? { h: +m[1], a: +m[2] } : null;
}

function parseHT(body) {
  const m =
    body.match(/HT\s*(\d+)\s*[-:]\s*(\d+)/i) ||
    body.match(/half[- ]?time\s*(\d+)\s*[-:]\s*(\d+)/i);
  return m ? { h: +m[1], a: +m[2] } : null;
}

function extractTeams($row) {
  const raw = normalize($row.find("td").eq(0).text());
  const parts = raw.split(/\s*[-–—]\s*/).filter(Boolean);
  if (parts.length >= 2) return { home: parts[0], away: parts[1] };
  return null;
}

function isPendingStatusCell($cell) {
  const html = ($cell.html() || "").toLowerCase();
  const txt = ($cell.text() || "").trim();
  if (txt.includes("✅") || txt.includes("❌")) return false;
  if (html.includes("✅") || html.includes("❌")) return false;
  // hourglass icons (emoji or image/font icons) or empty = pending
  return true;
}

/* ================= PARSE BET ================= */
function parseBetFromText(text, teams) {
  const t = normalize(text);

  // 1X2
  if (t.includes("home win") || t.includes("victorie gazde") || t === "1 (gazde)" || t === "1 gazde" || t === "1")
    return { type: "1x2", side: "1" };

  if (t.includes("away win") || t.includes("victorie oaspe") || t === "2 (oaspeti)" || t === "2 oaspeti" || t === "2")
    return { type: "1x2", side: "2" };

  if (t === "x" || t.includes("draw") || t.includes("egal"))
    return { type: "1x2", side: "x" };

  // Double chance
  if (t.includes("double chance 1x") || t.includes("sansa dubla 1x") || t.includes("șansă dublă 1x") || t === "1x")
    return { type: "double", sides: ["1", "x"] };

  if (t.includes("double chance x2") || t.includes("sansa dubla x2") || t.includes("șansă dublă x2") || t === "x2")
    return { type: "double", sides: ["x", "2"] };

  // BTTS
  if (
    t.includes("both teams to score") ||
    t.includes("ambele echipe marcheaza") ||
    t.includes("ambele echipe marchează") ||
    (t.includes("ambele") && t.includes("marche"))
  ) return { type: "btts" };

  // Team goals: "FCSB minim 1 gol", "Chelsea to score at least 2 goals"
  if (teams) {
    const th = normalize(teams.home);
    const ta = normalize(teams.away);

    const hasHome = th && t.includes(th);
    const hasAway = ta && t.includes(ta);

    if (hasHome || hasAway) {
      const side = hasHome ? "home" : "away";

      let m = t.match(/(minim|min|minimum|at least|over|peste)\s*(\d+(\.\d+)?)/);
      if (m) return { type: "team_goals", side, mode: "over", val: +m[2] };

      m = t.match(/(sub|under)\s*(\d+(\.\d+)?)/);
      if (m) return { type: "team_goals", side, mode: "under", val: +m[2] };

      // "echipa inscrie 1-3 goluri" / "team to score 1-3 goals"
      m = t.match(/(\d+)\s*-\s*(\d+)\s*gol/);
      if (m) return { type: "team_interval", side, min: +m[1], max: +m[2] };
    }
  }

  // Interval match / halves
  let m = t.match(/interval\s*(\d+)\s*-\s*(\d+).*total.*meci/);
  if (m) return { type: "interval_match", min: +m[1], max: +m[2] };

  m = t.match(/interval\s*(\d+)\s*-\s*(\d+).*prima repriz/);
  if (m) return { type: "interval_ht", min: +m[1], max: +m[2] };

  m = t.match(/interval\s*(\d+)\s*-\s*(\d+).*(repriza a doua|repriza secund)/);
  if (m) return { type: "interval_sh", min: +m[1], max: +m[2] };

  // Total goals over/under
  m = t.match(/(over|peste|minim)\s*(\d+(\.\d+)?)/);
  if (m) return { type: "goals", side: "over", val: +m[2] };

  m = t.match(/(under|sub)\s*(\d+(\.\d+)?)/);
  if (m) return { type: "goals", side: "under", val: +m[2] };

  return null;
}

/* ================= EVAL ================= */
function evalOutcome(bet, data) {
  const ft = data.ft;
  const ht = data.ht;
  const totalFT = ft.h + ft.a;

  switch (bet.type) {
    case "1x2": {
      const r = ft.h > ft.a ? "1" : ft.h < ft.a ? "2" : "x";
      return r === bet.side ? WIN : LOSS;
    }

    case "double": {
      const r = ft.h > ft.a ? "1" : ft.h < ft.a ? "2" : "x";
      return bet.sides.includes(r) ? WIN : LOSS;
    }

    case "btts":
      return ft.h > 0 && ft.a > 0 ? WIN : LOSS;

    case "team_goals": {
      const g = bet.side === "home" ? ft.h : ft.a;
      return bet.mode === "over"
        ? (g >= bet.val ? WIN : LOSS)
        : (g < bet.val ? WIN : LOSS);
    }

    case "team_interval": {
      const g = bet.side === "home" ? ft.h : ft.a;
      return g >= bet.min && g <= bet.max ? WIN : LOSS;
    }

    case "goals":
      return bet.side === "over"
        ? (totalFT >= Math.ceil(bet.val) ? WIN : LOSS)  // over 1.5 => >=2
        : (totalFT < bet.val ? WIN : LOSS);

    case "interval_match":
      return totalFT >= bet.min && totalFT <= bet.max ? WIN : LOSS;

    case "interval_ht":
      if (!ht) return null;
      return (ht.h + ht.a) >= bet.min && (ht.h + ht.a) <= bet.max ? WIN : LOSS;

    case "interval_sh":
      if (!ht) return null;
      const sh = totalFT - (ht.h + ht.a);
      return sh >= bet.min && sh <= bet.max ? WIN : LOSS;

    default:
      return null;
  }
}

/* ================= FLASHSCORE ================= */
async function fetchFlashscore(matchId) {
  const res = await fetch(`${FS_BASE}${matchId}/?s=1&d=-1`);
  if (!res.ok) return null;

  const html = await res.text();
  const $ = cheerio.load(html);
  const bodyText = $("body").text();

  if (!/Finished|FT|After Penalties|AET/i.test(bodyText)) return null;

  // FT: safest is first score pattern found in body
  const ft = parseScore(bodyText);
  if (!ft) return null;

  const ht = parseHT(bodyText);
  return { ft, ht };
}

/* ================= RUN ================= */
(async () => {
  const r = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=50`);
  if (!r.ok) return;

  const posts = await r.json();

  for (const p of posts) {
    const res = await get(`${WP_BASE}/wp-json/wp/v2/posts/${p.id}?context=edit`);
    if (!res.ok) continue;

    const post = await res.json();
    const $ = cheerio.load(post.content.raw || post.content.rendered);
    let changed = false;

    const rows = $("table.bilet-pariu tbody tr").toArray();

    for (const row of rows) {
      const $r = $(row);
      const $statusCell = $r.find("td").eq(5);

      if (!RECHECK_ONCE && !isPendingStatusCell($statusCell)) continue;

      const matchId = getMatchId($r);
      if (!matchId) continue;

      const teams = extractTeams($r);
      const betText = $r.find("td").eq(3).text();
      const bet = parseBetFromText(betText, teams);
      if (!bet) continue;

      const data = await fetchFlashscore(matchId);
      if (!data) continue;

      const verdict = evalOutcome(bet, data);
      if (!verdict) continue;

      $statusCell.html(verdict === WIN ? "✅" : "❌");
      changed = true;
    }

    if (changed) {
      await put(`${WP_BASE}/wp-json/wp/v2/posts/${p.id}`, { content: $.html() });
    }
  }
})();
