// generate_wp.js
// FINAL — aligned with verify_and_update_wp.js (score + stats ready)

import fs from "fs/promises";

const TICKETS_FILE = "tickets.json";

/**
 * Detect bet type + build verification metadata
 */
function buildVerificationMeta(sel) {
  // DEFAULT: 1X2
  let market = "1";
  let stat = "";
  let side = "";
  let threshold = "";

  const txt =
    sel.meta?.bet_text?.toLowerCase() ||
    sel.meta?.market_text?.toLowerCase() ||
    "";

  // OVER / UNDER goals
  if (txt.includes("over") || txt.includes("under")) {
    market = "stat";

    if (txt.includes("gol")) stat = "goals";
    else if (txt.includes("corner")) stat = "corners";
    else if (txt.includes("shot") || txt.includes("șut"))
      stat = "shots_on_target";

    side = txt.includes("over") ? "over" : "under";

    const m = txt.match(/(\d+(\.\d+)?)/);
    if (m) threshold = m[1];
  }

  return { market, stat, side, threshold };
}

/**
 * Render one table row
 */
function renderRow(sel) {
  const betText =
    sel.meta?.bet_text ||
    sel.meta?.market_text ||
    sel.market_raw ||
    sel.market ||
    "Pariu special";

  const meta = buildVerificationMeta(sel);

  return `
<tr
  data-id="${sel.id}"
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
  <td><strong>${sel.odd}</strong></td>
  <td style="text-align:center;font-weight:bold;">⏳</td>
</tr>`;
}

/**
 * Render ONLY the ticket table (no title!)
 */
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
</table>
`;
}

/**
 * Minimal CSS (safe for WP)
 */
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

(async () => {
  const raw = await fs.readFile(TICKETS_FILE, "utf8");
  const data = JSON.parse(raw);

  // ---- COTA 2 ----
  if (data.bilet_cota2) {
    const html = STYLE + renderTicket(data.bilet_cota2);
    await fs.writeFile("cota2.html", html, "utf8");
    console.log("[WP] cota2.html generated");
  }

  // ---- BILETUL ZILEI ----
  if (data.biletul_zilei) {
    const html = STYLE + renderTicket(data.biletul_zilei);
    await fs.writeFile("biletul-zilei.html", html, "utf8");
    console.log("[WP] biletul-zilei.html generated");
  }

  if (!data.bilet_cota2 && !data.biletul_zilei) {
    console.log("[WP] Nothing to publish today.");
  }
})();
