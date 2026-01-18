// verify_and_update_wp.js
// FINAL FIX — safe JSON parsing + CAPTCHA protection handling

import fetch from "node-fetch";
import * as cheerio from "cheerio";

/* ================= CONFIG ================= */
const WP_BASE     = process.env.WP_BASE;
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;

const RECHECK_ONCE = /^(1|true|yes)$/i.test(process.env.RECHECK_ONCE || "");

const FS_BASE = "https://www.flashscore.mobi/match/";
const PENDING = "pending";
const WIN  = "win";
const LOSS = "loss";

const authHeader =
  "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

/* ================= SAFE FETCH ================= */

async function safeGetJSON(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      "Accept": "application/json"
    }
  });

  const ct = res.headers.get("content-type") || "";

  if (!ct.includes("application/json")) {
    const txt = await res.text();
    console.error("⚠️ NON-JSON RESPONSE from WP (likely CAPTCHA / firewall)");
    console.error(txt.slice(0, 200));
    return null;
  }

  return await res.json();
}

async function safePutJSON(url, body) {
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(body)
  });

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    console.error("⚠️ PUT blocked (non-JSON response)");
    return false;
  }
  return true;
}

/* ================= FLASHCORE ================= */

async function fetchFlashscoreOutcome(matchId) {
  try {
    const res = await fetch(`${FS_BASE}${matchId}/?s=1&d=-1`);
    if (!res.ok) return { finished:false };

    const html = await res.text();
    const $ = cheerio.load(html);
    const text = $("body").text();

    if (!/Finished|Full Time|After Extra Time|Penalties/i.test(text))
      return { finished:false };

    const score =
      $("div.detail b").first().text() ||
      text.match(/(\d{1,2}\s*:\s*\d{1,2})/)?.[1];

    if (!score) return { finished:false };

    return { finished:true, scoreText:score };
  } catch {
    return { finished:false };
  }
}

function outcomeFromScore(scoreText, side) {
  const m = scoreText.match(/(\d+)\s*:\s*(\d+)/);
  if (!m) return null;

  const h = +m[1], a = +m[2];
  if (side === "1") return h > a ? WIN : LOSS;
  if (side === "2") return a > h ? WIN : LOSS;
  if (side === "X") return h === a ? WIN : LOSS;
  return null;
}

/* ================= VERIFY ================= */

async function verifyOnePost(postId) {
  const post = await safeGetJSON(`${WP_BASE}/wp-json/wp/v2/posts/${postId}?context=edit`);
  if (!post) return;

  const raw = post.content?.raw || post.content?.rendered || "";
  const $ = cheerio.load(raw);
  let changed = false;

  $("tr[data-id]").each(async (_, tr) => {
    const $tr = $(tr);
    const id = $tr.attr("data-id");
    const cur = $tr.attr("data-status") || PENDING;

    if (!RECHECK_ONCE && cur !== PENDING) return;

    const betTxt = $tr.find("td").eq(3).text();
    const side =
      betTxt.trim().startsWith("1") ? "1" :
      betTxt.trim().startsWith("2") ? "2" :
      betTxt.trim().toUpperCase().startsWith("X") ? "X" : null;

    if (!side) return;

    const o = await fetchFlashscoreOutcome(id);
    if (!o.finished) return;

    const verdict = outcomeFromScore(o.scoreText, side);
    if (verdict && verdict !== cur) {
      $tr.attr("data-status", verdict);
      $tr.find("td").last().text(verdict === WIN ? "✅" : "❌");
      changed = true;
      console.log(`[VERIFY] Post ${postId} :: ${id} -> ${verdict}`);
    }
  });

  if (changed) {
    await safePutJSON(`${WP_BASE}/wp-json/wp/v2/posts/${postId}`, {
      content: $.html()
    });
  }
}

/* ================= RUN ================= */

(async () => {
  if (!WP_BASE || !WP_USER || !WP_APP_PASS) {
    console.error("❌ Missing WP credentials");
    process.exit(1);
  }

  const list = await safeGetJSON(
    `${WP_BASE}/wp-json/wp/v2/posts?per_page=10&search=Bilet`
  );
  if (!Array.isArray(list)) {
    console.error("❌ Cannot load posts list");
    process.exit(0);
  }

  for (const p of list) {
    await verifyOnePost(p.id);
  }
})();
