// verify_and_update_wp.js — FINAL FIXED (NO BLOCKING, TIMEOUT SAFE)
// Node 18 / 20

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE = process.env.WP_BASE;
const WP_USER = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;

const FS_BASE = "https://www.flashscore.mobi/match/";
const RECHECK_ONCE = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");

const WIN = "win";
const LOSS = "loss";

const MAX_ROWS_PER_POST = 10;
const FS_TIMEOUT_MS = 8000;

/* ================= AUTH ================= */
const auth =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const get = (url) =>
  fetch(url, { headers: { Authorization: auth } });

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
  const href = $row.find("a[href*='flashscore']").attr("href");
  const m = href?.match(/match\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function parseScore(txt) {
  const m = (txt || "").match(/(\d+)\s*[:\-]\s*(\d+)/);
  return m ? { h: +m[1], a: +m[2] } : null;
}

function extractTeams($row) {
  const raw = normalize($row.find("td").eq(0).text());
  const p = raw.split(/\s*[-–—]\s*/);
  return p.length >= 2 ? { home: p[0], away: p[1] } : null;
}

function isPending($cell) {
  const t = ($cell.text() || "").trim();
  return !t.includes("✅") && !t.includes("❌");
}

/* ================= PARSE BET ================= */
function parseBet(text, teams) {
  const t = normalize(text);

  if (t.includes("home win") || t.includes("victorie gazde")) return { type: "1x2", side: "1" };
  if (t.includes("away win") || t.includes("victorie oaspe")) return { type: "1x2", side: "2" };
  if (t === "x" || t.includes("draw")) return { type: "1x2", side: "x" };

  if (t.includes("1x")) return { type: "double", sides: ["1", "x"] };
  if (t.includes("x2")) return { type: "double", sides: ["x", "2"] };

  if (t.includes("both teams") || t.includes("ambele")) return { type: "btts" };

  if (teams) {
    const h = normalize(teams.home);
    const a = normalize(teams.away);
    const side = t.includes(h) ? "home" : t.includes(a) ? "away" : null;

    if (side) {
      let m = t.match(/(minim|min|at least|over)\s*(\d+(\.\d+)?)/);
      if (m) return { type: "team_goals", side, over: true, val: +m[2] };

      m = t.match(/(under|sub)\s*(\d+(\.\d+)?)/);
      if (m) return { type: "team_goals", side, over: false, val: +m[2] };
    }
  }

  let m = t.match(/(over|peste|minim)\s*(\d+(\.\d+)?)/);
  if (m) return { type: "goals", over: true, val: +m[2] };

  m = t.match(/(under|sub)\s*(\d+(\.\d+)?)/);
  if (m) return { type: "goals", over: false, val: +m[2] };

  return null;
}

/* ================= SAFE FLASHSCORE ================= */
async function fetchFlashscore(matchId) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FS_TIMEOUT_MS);

  try {
    const res = await fetch(`${FS_BASE}${matchId}/?s=1&d=-1`, {
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    const body = $("body").text();

    if (!/Finished|FT|AET|After Penalties/i.test(body)) return null;

    const ft = parseScore(body);
    if (!ft) return null;

    return { ft };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* ================= EVAL ================= */
function evalBet(b, d) {
  const ft = d.ft;
  const total = ft.h + ft.a;

  if (b.type === "1x2") {
    const r = ft.h > ft.a ? "1" : ft.h < ft.a ? "2" : "x";
    return r === b.side ? WIN : LOSS;
  }

  if (b.type === "double") {
    const r = ft.h > ft.a ? "1" : ft.h < ft.a ? "2" : "x";
    return b.sides.includes(r) ? WIN : LOSS;
  }

  if (b.type === "btts") return ft.h > 0 && ft.a > 0 ? WIN : LOSS;

  if (b.type === "team_goals") {
    const g = b.side === "home" ? ft.h : ft.a;
    return b.over ? (g >= b.val ? WIN : LOSS) : (g < b.val ? WIN : LOSS);
  }

  if (b.type === "goals") {
    return b.over ? (total >= Math.ceil(b.val) ? WIN : LOSS) : (total < b.val ? WIN : LOSS);
  }

  return null;
}

/* ================= RUN ================= */
(async () => {
  const r = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=30`);
  if (!r.ok) return;

  const posts = await r.json();

  for (const p of posts) {
    const res = await get(`${WP_BASE}/wp-json/wp/v2/posts/${p.id}?context=edit`);
    if (!res.ok) continue;

    const post = await res.json();
    const $ = cheerio.load(post.content.raw || post.content.rendered);

    let changed = false;
    let checked = 0;

    for (const row of $("table.bilet-pariu tbody tr").toArray()) {
      if (checked >= MAX_ROWS_PER_POST) break;

      const $r = $(row);
      const $status = $r.find("td").eq(5);
      if (!RECHECK_ONCE && !isPending($status)) continue;

      const id = getMatchId($r);
      const teams = extractTeams($r);
      const bet = parseBet($r.find("td").eq(3).text(), teams);
      if (!id || !bet) continue;

      const data = await fetchFlashscore(id);
      if (!data) continue;

      const v = evalBet(bet, data);
      if (!v) continue;

      $status.html(v === WIN ? "✅" : "❌");
      changed = true;
      checked++;
    }

    if (changed) {
      await put(`${WP_BASE}/wp-json/wp/v2/posts/${p.id}`, {
        content: $.html(),
      });
    }
  }
})();
