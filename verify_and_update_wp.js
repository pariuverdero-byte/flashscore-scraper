// verify_and_update_wp.js — FULL FINAL VERSION (RO + EN, MATCH + HALVES)
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
function parseBetFromText(text, teams) {
  if (!text) return null;
  const t = normalize(text);

  if (t.includes("home win") || t.includes("victorie gazde"))
    return { type: "1x2", side: "1" };

  if (t.includes("away win") || t.includes("victorie oaspeti"))
    return { type: "1x2", side: "2" };

  if (t === "x" || t.includes("draw"))
    return { type: "1x2", side: "x" };

  if (t.includes("1x")) return { type: "double", sides: ["1", "x"] };
  if (t.includes("x2")) return { type: "double", sides: ["x", "2"] };

  if (t.includes("ambele") || t.includes("both teams"))
    return { type: "btts" };

  if (teams) {
    for (const side of ["home", "away"]) {
      if (!t.includes(teams[side])) continue;

      let m = t.match(/(minim|min|minimum|at least|over)\s*(\d+(\.\d+)?)/);
      if (m)
        return { type: "team_goals", side, mode: "over", val: +m[2] };

      m = t.match(/(sub|under)\s*(\d+(\.\d+)?)/);
      if (m)
        return { type: "team_goals", side, mode: "under", val: +m[2] };

      m = t.match(/(\d+)\s*-\s*(\d+)\s*gol/);
      if (m)
        return {
          type: "team_interval",
          side,
          min: +m[1],
          max: +m[2],
        };
    }
  }

  let m = t.match(/interval\s*(\d+)\s*-\s*(\d+).*meci/);
  if (m) return { type: "interval_match", min: +m[1], max: +m[2] };

  m = t.match(/interval\s*(\d+)\s*-\s*(\d+).*prima repriza/);
  if (m) return { type: "interval_ht", min: +m[1], max: +m[2] };

  m = t.match(/interval\s*(\d+)\s*-\s*(\d+).*repriza a doua/);
  if (m) return { type: "interval_sh", min: +m[1], max: +m[2] };

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
        ? g >= bet.val ? WIN : LOSS
        : g < bet.val ? WIN : LOSS;
    }

    case "team_interval": {
      const g = bet.side === "home" ? ft.h : ft.a;
      return g >= bet.min && g <= bet.max ? WIN : LOSS;
    }

    case "goals":
      return bet.side === "over"
        ? totalFT >= Math.ceil(bet.val) ? WIN : LOSS
        : totalFT < bet.val ? WIN : LOSS;

    case "interval_match":
      return totalFT >= bet.min && totalFT <= bet.max ? WIN : LOSS;

    case "interval_ht":
      if (!ht) return null;
      return ht.h + ht.a >= bet.min && ht.h + ht.a <= bet.max ? WIN : LOSS;

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
  const body = $("body").text();

  if (!/Finished|FT|After Penalties|AET/i.test(body)) return null;

  const ft = parseScore(body);
  if (!ft) return null;

  const ht = parseHT(body);
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

    for (const row of $("table.bilet-pariu tbody tr").toArray()) {
      const $r = $(row);
      const status = $r.find("td").eq(5).text().trim();
      if (!RECHECK_ONCE && status !== "⏳") continue;

      const matchId = getMatchId($r);
      const teams = extractTeams($r);
      const bet = parseBetFromText($r.find("td").eq(3).text(), teams);
      if (!matchId || !bet) continue;

      const data = await fetchFlashscore(matchId);
      if (!data) continue;

      const verdict = evalOutcome(bet, data);
      if (!verdict) continue;

      $r.find("td").eq(5).html(verdict === WIN ? "✅" : "❌");
      changed = true;
    }

    if (changed) {
      await put(`${WP_BASE}/wp-json/wp/v2/posts/${p.id}`, {
        content: $.html(),
      });
    }
  }
})();
