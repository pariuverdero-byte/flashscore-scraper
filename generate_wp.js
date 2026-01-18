// generate_wp.js
// FINAL — aligned with verify_and_update_wp.js (bilet-pariu)

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
  <td style="text-align:center;font-weight:bold;">⏳</td>
</tr>`;
}

/**
 * Renders ticket table (class MUST be bilet-pariu)
 */
function renderTicket(ticket) {
  if (!ticket || !ticket.selections?.length) {
    return `<p>(Nu a fost generat)</p>`;
  }

  return `
<div class="pv-ticket-wrapper">
  <div class="pv-status-bilet pv-status-yellow">
    <span class="pv-status-icon">⏳</span>
    <span class="pv-status-label">Rezultat în așteptare</span>
  </div>

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
</div>`;
}

/**
 * Shared CSS (minimal, verifier-safe)
 */
const STYLE = `
<style>
.bilet-pariu {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 24px;
}
.bilet-pariu th,
.bilet-pariu td {
  border: 1px solid #ddd;
  padding: 8px;
}
.bilet-pariu th {
  background: #f4f4f4;
}

.pv-status-bilet {
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:8px 12px;
  border-radius:6px;
  font-weight:700;
  margin-bottom:12px;
}
.pv-status-yellow { background:#fde047; }
.pv-status-green  { background:#22c55e; color:#fff; }
.pv-status-red    { background:#ef4444; color:#fff; }
</style>
`;

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
