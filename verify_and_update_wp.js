// verify_and_update_wp.js — FINAL, FULL COVERAGE (RO + EN, MATCH + HALVES)
// Node 18 / 20

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
  return s
    .toLowerCase()
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getMatchId($row) {
  const href = $row.find("a[href*='flashscore']").attr("href");
  const m = href?.match(/match\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function parseScore(txt) {
  const m = txt.match(/(\d+)\s*[:\-]\s*(\d+)/);
  return m ? { h: +m[1], a: +m[2] } : null;
}

function parseHT(body) {
  const m =
    body.match(/HT\s*(\d+)\s*[-:]\s*(\d+)/i) ||
    body.match(/half[- ]?time\s*(\d+)\s*[-:]\s*(\d+)/i);
  return m ? { h: +m[1], a: +m[2] } : null;
}

function extractTeams($row) {
  const txt = normalize($row.find("td").eq(0).text());
  const p = txt.split(" - ");
  return p.length === 2 ? { home: p[0], away: p[1] } : null;
}

/* ================= PARSE BET ================= */
function parseBet(text, teams) {
  const t = normalize(text);

  // 1X2
  if (["1", "1 gazde", "victorie gazde", "home win"].some(x => t === x || t.includes(x)))
    return { type: "1x2", side: "1" };

  if (["2", "2 oaspeti", "victorie oaspeti", "away win"].some(x => t === x || t.includes(x)))
    return { type: "1x2", side: "2" };

  if (t === "x" || t.includes("draw")) return { type: "1x2", side: "x" };

  // Double chance
  if (t.includes("1x")) return { type: "double", sides: ["1", "x"] };
  if (t.includes("x2")) return { type: "double", sides: ["x", "2"] };

  // BTTS
  if (t.includes("ambele") || t.includes("both teams"))
    return { type: "btts" };

  // Team goals (min / over / under / interval)
  if (teams) {
    for (const side of ["home", "away"]) {
      const team = teams[side];
      if (!team || !t.includes(team)) continue;

      let m = t.match(/(minim|min|at least|over)\s*(\d+(\.\d+)?)/);
      if (m) return { type: "team_goals", side, mode: "over", v: +m[2] };

      m = t.match(/(sub|under)\s*(\d+(\.\d+)?)/);
      if (m) return { type: "team_goals", side, mode: "under", v: +m[2] };

      m = t.match(/(\d+)\s*-\s*(\d+)\s*goluri/);
      if (m) return { type: "team_interval", side, min: +m[1], max: +m[2] };
    }
  }

  // Interval match / halves
  let m = t.match(/interval\s*(\d+)\s*-\s*(\d+).*meci/);
  if (m) return { type: "interval_match", min: +m[1], max: +m[2] };

  m = t.match(/interval\s*(\d+)\s*-\s*(\d+).*prima repriza/);
  if (m) return { type: "interval_ht", min: +m[1], max: +m[2] };

  m = t.match(/interval\s*(\d+)\s*-\s*(\d+).*repriza a doua/);
  if (m) return { type: "interval_sh", min: +m[1], max: +m[2] };

  // Total goals
  m = t.match(/(over|minim)\s*(\d+(\.\d+)?)/);
  if (m) return { type: "goals_min", v: +m[2] };

  return null;
}

/* ================= EVAL ================= */
function evalBet(b, data) {
  const ft = data.ft;
  const ht = data.ht;
  const totalFT = ft.h + ft.a;

  switch (b.type) {
    case "1x2": {
      const r = ft.h > ft.a ? "1" : ft.h < ft.a ? "2" : "x";
      return r === b.side ? WIN : LOSS;
    }

    case "double": {
      const r = ft.h > ft.a ? "1" : ft.h < ft.a ? "2" : "x";
      return b.sides.includes(r) ? WIN : LOSS;
    }

    case "btts":
      return ft.h > 0 && ft.a > 0 ? WIN : LOSS;

    case "team_goals": {
      const g = b.side === "home" ? ft.h : ft.a;
      return b.mode === "over"
        ? g >= b.v ? WIN : LOSS
        : g < b.v ? WIN : LOSS;
    }

    case "team_interval": {
      const g = b.side === "home" ? ft.h : ft.a;
      return g >= b.min && g <= b.max ? WIN : LOSS;
    }

    case "goals_min":
      return totalFT >= b.v ? WIN : LOSS;

    case "interval_match":
      return totalFT >= b.min && totalFT <= b.max ? WIN : LOSS;

    case "interval_ht":
      if (!ht) return null;
      return ht.h + ht.a >= b.min && ht.h + ht.a <= b.max ? WIN : LOSS;

    case "interval_sh":
      if (!ht) return null;
      const sh = totalFT - (ht.h + ht.a);
      return sh >= b.min && sh <= b.max ? WIN : LOSS;

    default:
      return null;
  }
}

/* ================= FLASHSCORE ================= */
async function fetchFS(id) {
  const r = await fetch(`${FS_BASE}${id}/?s=1&d=-1`);
  if (!r.ok) return null;
  const html = await r.text();
  const $ = cheerio.load(html);
  const body = $("body").text();
  if (!/Finished|FT|AET/i.test(body)) return null;

  const ft = parseScore(body);
  const ht = parseHT(body);
  return ft ? { ft, ht } : null;
}

/* ================= RUN ================= */
(async () => {
  const r = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=50`);
  const posts = await r.json();

  for (const p of posts) {
    const res = await get(`${WP_BASE}/wp-json/wp/v2/posts/${p.id}?context=edit`);
    const post = await res.json();
    const $ = cheerio.load(post.content.raw || post.content.rendered);
    let changed = false;

    $("table.bilet-pariu tbody tr").each(async (_, row) => {
      const $r = $(row);
      if (!RECHECK_ONCE && $r.find("td").eq(5).text().trim() !== "⏳") return;

      const id = getMatchId($r);
      const teams = extractTeams($r);
      const bet = parseBet($r.find("td").eq(3).text(), teams);
      if (!id || !bet) return;

      const data = await fetchFS(id);
      if (!data) return;

      const v = evalBet(bet, data);
      if (!v) return;

      $r.find("td").eq(5).html(v === WIN ? "✅" : "❌");
      changed = true;
    });

    if (changed)
      await put(`${WP_BASE}/wp-json/wp/v2/posts/${p.id}`, { content: $.html() });
  }
})();
