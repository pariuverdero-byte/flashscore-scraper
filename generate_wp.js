// generate_wp.js
// FINAL — RO / EN clean, aligned with verify + publish flows
// FIX: robust Flashscore link resolution (url → flashscore_url → id fallback)

import fs from "fs/promises";

const TICKETS_FILE = "tickets.json";
const LANG = process.env.LANG || "ro";

/* ======================================================
 * 🔁 TRANSLATE BET TEXT (RO → EN)
 * ====================================================== */
function translateBetText(sel) {
  const raw =
    sel.meta?.bet_text ||
    sel.meta?.market_text ||
    sel.market_raw ||
    sel.market ||
    "Pariu special";

  if (LANG !== "en") return raw;

  const t = raw.toLowerCase();
  let m;

  if (t.includes("ambele echipe marchează")) return "Both teams to score";
  if (t.includes("ambele") && t.includes("nu"))
    return "Both teams to score – NO";

  if ((m = t.match(/(.+?) minim (\d+) goluri/)))
    return `${capitalize(m[1])} to score at least ${m[2]} goals`;

  if ((m = t.match(/peste (\d+(\.\d+)?)/)))
    return `Over ${m[1]} goals`;
  if ((m = t.match(/sub (\d+(\.\d+)?)/)))
    return `Under ${m[1]} goals`;

  if ((m = t.match(/peste (\d+(\.\d+)?) goluri.*prima repriz/)))
    return `Over ${m[1]} goals (1st half)`;
  if ((m = t.match(/sub (\d+(\.\d+)?) goluri.*prima repriz/)))
    return `Under ${m[1]} goals (1st half)`;

  if ((m = t.match(/interval (\d+)\s*-\s*(\d+).*prima repriz/)))
    return `Total goals 1st half: ${m[1]}–${m[2]}`;

  if ((m = t.match(/interval (\d+)\s*-\s*(\d+).*meci/)))
    return `Total goals: ${m[1]}–${m[2]}`;

  if (t.includes("șansă dublă")) {
    if (t.includes("1x")) return "Double chance 1X";
    if (t.includes("x2")) return "Double chance X2";
    if (t.includes("12")) return "Double chance 12";
  }

  if (t.includes("victorie gazde")) return "Home win";
  if (t === "egal") return "Draw";
  if (t.includes("victorie oaspeți")) return "Away win";

  if (t.includes("pauză") && t.includes("final"))
    return raw
      .replace(/pauză/gi, "Half-time")
      .replace(/final/gi, "Full-time");

  return raw;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ======================================================
 * 🔗 RESOLVE FLASHCORE URL (CRITICAL FIX)
 * ====================================================== */
function resolveEventUrl(sel) {
  if (sel.url) return sel.url;
  if (sel.flashscore_url) return sel.flashscore_url;
  if (sel.id) return `https://www.flashscore.mobi/match/${sel.id}/`;
  return null;
}

/* ======================================================
 * 🧱 RENDER ONE ROW
 * ====================================================== */
function renderRow(sel) {
  const betText = translateBetText(sel);
  const link = resolveEventUrl(sel);

  const eventCell = link
    ? `<a href="${link}" target="_blank" rel="nofollow noopener">${sel.teams}</a>`
    : `<span>${sel.teams}</span>`;

  return `
<tr
  data-id="${sel.id || ""}"
  data-status="pending"
  data-market="${sel.market || "STAT"}"
  ${sel.stat ? `data-stat="${sel.stat}"` : ""}
  ${sel.side ? `data-side="${sel.side}"` : ""}
  ${sel.threshold ? `data-threshold="${sel.threshold}"` : ""}
>
  <td>${eventCell}</td>
  <td>${sel.country || "-"} / ${sel.competition || "-"}</td>
  <td>${sel.time || "-"}</td>
  <td><strong>${betText}</strong></td>
  <td><strong>${sel.odd}</strong></td>
  <td style="text-align:center;font-weight:bold;">⏳</td>
</tr>`;
}

/* ======================================================
 * 📊 RENDER TICKET TABLE
 * ====================================================== */
function renderTicket(ticket) {
  if (!ticket || !ticket.selections?.length) {
    return `<p>(No ticket generated)</p>`;
  }

  return `
<table class="bilet-pariu">
  <thead>
    <tr>
      <th>${LANG === "en" ? "Event" : "Eveniment"}</th>
      <th>${LANG === "en" ? "League" : "Sport / Țară"}</th>
      <th>${LANG === "en" ? "Time" : "Ora (RO)"}</th>
      <th>${LANG === "en" ? "Proposed bet" : "Pariu propus"}</th>
      <th>${LANG === "en" ? "Odds" : "Cotă"}</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    ${ticket.selections.map(renderRow).join("\n")}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="4"><strong>${LANG === "en" ? "Total odds" : "Cotă totală"}</strong></td>
      <td><strong>${ticket.product}</strong></td>
      <td></td>
    </tr>
  </tfoot>
</table>`;
}

/* ======================================================
 * 🎨 CSS (safe for WP)
 * ====================================================== */
const STYLE = `
<style>
.bilet-pariu {
  width:100%;
  border-collapse:collapse;
  margin-bottom:24px;
}
.bilet-pariu th,
.bilet-pariu td {
  border:1px solid #ddd;
  padding:8px;
}
.bilet-pariu th {
  background:#f4f4f4;
}
</style>
`;

/* ======================================================
 * 🚀 MAIN
 * ====================================================== */
(async () => {
  const raw = await fs.readFile(TICKETS_FILE, "utf8");
  const data = JSON.parse(raw);

  if (data.bilet_cota2) {
    const html = STYLE + renderTicket(data.bilet_cota2);
    await fs.writeFile("cota2.html", html, "utf8");
    console.log("[WP] cota2.html generated");
  }

  if (data.biletul_zilei) {
    const html = STYLE + renderTicket(data.biletul_zilei);
    await fs.writeFile("biletul-zilei.html", html, "utf8");
    console.log("[WP] biletul-zilei.html generated");
  }

  if (!data.bilet_cota2 && !data.biletul_zilei) {
    console.log("[WP] Nothing to publish today.");
  }
})();
