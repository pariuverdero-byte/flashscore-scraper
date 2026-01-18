// generate_wp.js
// FINAL FIX — always extract Flashscore match ID (no more undefined)

import fs from "fs/promises";

const TICKETS_FILE = "tickets.json";

/* ================= HELPERS ================= */

/**
 * Extract Flashscore match ID from URL
 */
function extractMatchId(url = "") {
  const m = url.match(/\/match\/([A-Za-z0-9]+)\//);
  return m ? m[1] : "";
}

/**
 * Detect bet type + build verification metadata
 */
function buildVerificationMeta(sel) {
  let market = "1";
  let stat = "";
  let side = "";
  let threshold = "";

  const txt =
    sel.meta?.bet_text?.toLowerCase() ||
    sel.meta?.market_text?.toLowerCase() ||
    sel.market_raw?.toLowerCase() ||
    "";

  // BTTS
  if (/ambele.*marcheaz|btts/i.test(txt)) {
    return { market: "STAT", stat: "btts", side: "yes", threshold: "" };
  }

  // OVER / UNDER
  if (/over|under|minim|maxim|peste|sub/i.test(txt)) {
    market = "stat";

    if (/gol/i.test(txt)) stat = "goals";
    else if (/corner/i.test(txt)) stat = "corners";
    else if (/șut|sut|shot/i.test(txt)) stat = "shots_on_target";

    side = /sub|under/i.test(txt) ? "under" : "over";

    const m = txt.match(/(\d+(\.\d+)?)/);
    if (m) threshold = m[1];
  }

  return { market, stat, side, threshold };
}

/* ================= RENDER ================= */

function renderRow(sel) {
  const matchId = sel.id || extractMatchId(sel.url);
  if (!matchId) return ""; // safety

  const betText =
    sel.meta?.bet_text ||
    sel.meta?.market_text ||
    sel.market_raw ||
    sel.market ||
    "Pariu special";

  const meta = buildVerificationMeta(sel);

  return `
<tr
  data-id="${matchId}"
  data-status="pending"
  data-market="${meta.market}"
  ${meta.stat ? `data-stat="${meta.stat}"` : ""}
  ${meta.side ? `data-side="${meta.side}"` : ""}
  ${meta.threshold ? `data-threshold="${meta.threshold}"` : ""}
>
  <td>
    <a href="${sel.url}" target="_blank" rel="nofollow noopener">
      ${sel.teams}
    </a>
  </td>
  <td>${sel.country} / ${sel.competition}</td>
  <td>${sel.time || "-"}</td>
  <td><strong>${betText}</strong></td>
  <td><strong>${Number(sel.odd).toFixed(2)}</strong></td>
  <td style="text-align:center;font-weight:bold;">⏳</td>
</tr>`;
}

function renderTicket(ticket) {
  if (!ticket || !ticket.selections?.length) {
    return `<p>(Nu a fost generat)</p>`;
  }

  return `
<table class="bilet-pariu">
  <thead>
    <tr>
      <th>Eveniment</th>
      <th>Sport / Țară</th>
      <th>Ora (RO)</th>
      <th>Pariu propus</th>
      <th>Cotă</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    ${ticket.selections.map(renderRow).join("\n")}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="4"><strong>Cotă totală</strong></td>
      <td><strong>${ticket.product}</strong></td>
      <td></td>
    </tr>
  </tfoot>
</table>`;
}

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

/* ================= MAIN ================= */

(async () => {
  const raw = await fs.readFile(TICKETS_FILE, "utf8");
  const data = JSON.parse(raw);

  if (data.bilet_cota2) {
    await fs.writeFile(
      "cota2.html",
      STYLE + renderTicket(data.bilet_cota2),
      "utf8"
    );
    console.log("[OK] cota2.html generated");
  }

  if (data.biletul_zilei) {
    await fs.writeFile(
      "biletul-zilei.html",
      STYLE + renderTicket(data.biletul_zilei),
      "utf8"
    );
    console.log("[OK] biletul-zilei.html generated");
  }
})();
