// verify_and_update_wp.js — FINAL MULTI-LANG (RO / EN)

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= ENV ================= */
const WP_BASE = process.env.WP_BASE.replace(/\/$/, "");
const WP_USER = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;
const LANG = process.env.LANG || "ro";
const HOMEPAGE_ID = process.env.HOMEPAGE_ID;

const RECHECK_ONCE = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");

/* ================= CONST ================= */
const FS_BASE = "https://www.flashscore.mobi/match/";
const PENDING = "pending";
const WIN = "win";
const LOSS = "loss";

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

/* ================= I18N ================= */
const I18N = {
  ro: {
    pending: "Rezultat în așteptare",
    win: "Bilet câștigat",
    loss: "Bilet pierdut",
  },
  en: {
    pending: "Pending result",
    win: "Winning ticket",
    loss: "Losing ticket",
  },
};

/* ================= SCORE ================= */
function parseScore(text) {
  const m = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return null;
  return { h: +m[1], a: +m[2] };
}

/* ================= OUTCOMES ================= */
const outcome1X2 = (s, side) =>
  (s.h > s.a && side === "1") ||
  (s.h < s.a && side === "2") ||
  (s.h === s.a && side === "x")
    ? WIN
    : LOSS;

const outcomeGoals = (s, side, t) =>
  side === "over"
    ? s.h + s.a > t ? WIN : LOSS
    : s.h + s.a < t ? WIN : LOSS;

const outcomeBTTS = (s) =>
  s.h > 0 && s.a > 0 ? WIN : LOSS;

/* ================= FLASHScore ================= */
async function fetchFlashscore(id) {
  const r = await fetch(`${FS_BASE}${id}/?s=1&d=-1`);
  if (!r.ok) return null;

  const html = await r.text();
  const $ = cheerio.load(html);

  if (!/Finished|Full Time|After Extra Time|Penalties/i.test($.text()))
    return null;

  const scoreText =
    $("div.detail b").first().text() ||
    $.text().match(/(\d+\s*:\s*\d+)/)?.[1];

  return scoreText ? parseScore(scoreText) : null;
}

/* ================= UI ================= */
function paintRow($, row, status) {
  $(row).attr("data-status", status);
  $(row).find("td").last().html(
    status === WIN ? "✅" : status === LOSS ? "❌" : "⏳"
  );
}

function computeTicketStatus($, table) {
  let pending = false, loss = false;

  $(table).find("tbody tr").each((_, tr) => {
    const s = $(tr).attr("data-status");
    if (s === PENDING) pending = true;
    if (s === LOSS) loss = true;
  });

  if (pending) return PENDING;
  if (loss) return LOSS;
  return WIN;
}

function updateBadge($, status) {
  $(".pv-status-bilet").remove();

  $("table.bilet-pariu").first().before(`
    <div class="pv-status-bilet pv-${status}">
      ${status === WIN ? "✅" : status === LOSS ? "❌" : "⏳"}
      ${I18N[LANG][status]}
    </div>
  `);
}

/* ================= VERIFY POST ================= */
async function verifyPost(id) {
  const r = await get(`${WP_BASE}/wp-json/wp/v2/posts/${id}?context=edit`);
  if (!r.ok) return;

  const post = await r.json();
  const $ = cheerio.load(post.content.raw || post.content.rendered);

  let changed = false;

  $("table.bilet-pariu tbody tr").each(async (_, row) => {
    const $r = $(row);
    const cur = $r.attr("data-status") || PENDING;
    if (!RECHECK_ONCE && cur !== PENDING) return;

    const score = await fetchFlashscore($r.attr("data-id"));
    if (!score) return;

    const market = ($r.attr("data-market") || "").toLowerCase();
    const stat = ($r.attr("data-stat") || "").toLowerCase();
    const side = ($r.attr("data-side") || "").toLowerCase();
    const thr = parseFloat($r.attr("data-threshold"));

    let verdict = null;
    if (market === "1") verdict = outcome1X2(score, side);
    else if (stat === "goals") verdict = outcomeGoals(score, side, thr);
    else if (stat === "btts") verdict = outcomeBTTS(score);

    if (verdict && verdict !== cur) {
      paintRow($, row, verdict);
      changed = true;
    }
  });

  if (changed) {
    const status = computeTicketStatus($, $("table.bilet-pariu"));
    updateBadge($, status);

    await put(`${WP_BASE}/wp-json/wp/v2/posts/${id}`, {
      content: $.html(),
    });
  }
}

/* ================= RUN ================= */
(async () => {
  const r = await get(`${WP_BASE}/wp-json/wp/v2/posts?per_page=25`);
  if (!r.ok) return;

  const posts = await r.json();
  for (const p of posts) await verifyPost(p.id);

  if (HOMEPAGE_ID) {
    const page = await get(`${WP_BASE}/wp-json/wp/v2/pages/${HOMEPAGE_ID}?context=edit`);
    if (page.ok) {
      const j = await page.json();
      await put(`${WP_BASE}/wp-json/wp/v2/pages/${HOMEPAGE_ID}`, {
        content: (j.content.raw || "") + `\n<!-- pv-refresh:${Date.now()} -->`,
      });
    }
  }

  console.log("✅ VERIFY FLOW FINISHED");
})();
