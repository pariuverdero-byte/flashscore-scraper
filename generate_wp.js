// generate_wp.js
// FINAL — no duplicate titles, correct "Pariu propus", pending status ready

import fs from "fs/promises";

const TICKETS_FILE = "tickets.json";

/**
 * Renders a single table row (one selection)
 */
function renderRow(sel) {
  const betText =
    sel.meta?.bet_text ||
    sel.meta?.market_text ||
    sel.market_raw ||
    sel.market ||
    "Pariu special";

  return `
<tr data-match-id="${sel.id}" data-status="pending">
  <td>
    <a href="${sel.url}" target="_blank" rel="nofollow noopener">
      ${sel.teams}
    </a>
  </td>
  <td>${sel.country} / ${sel.competition}</td>
  <td>${sel.time || "-"}</td>
  <td><strong>${betText}</strong></td>
  <td><strong>${sel.odd}</strong></td>
  <td class="pv-status-cell">
    <span class="pv-status pv-pending">⏳</span>
    <span class="pv-status pv-win">✅</span>
    <span class="pv-status pv-loss">❌</span>
  </td>
</tr>`;
}

/**
 * Renders ticket table ONLY (NO TITLE!)
 */
function renderTicket(ticket) {
  if (!ticket || !ticket.selections?.length) {
    return `<p>(Nu a fost generat)</p>`;
  }

  return `
<table class="pv-ticket">
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
 * Shared CSS
 */
const STYLE = `
<style>
.pv-ticket {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 24px;
}
.pv-ticket th, .pv-ticket td {
  border: 1px solid #ddd;
  padding: 8px;
}
.pv-ticket th {
  background: #f4f4f4;
}
.pv-status {
  font-size: 18px;
}
[data-status="pending"] .pv-win,
[data-status="pending"] .pv-loss { display:none; }
[data-status="win"] .pv-pending,
[data-status="win"] .pv-loss { display:none; }
[data-status="loss"] .pv-pending,
[data-status="loss"] .pv-win { display:none; }
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
