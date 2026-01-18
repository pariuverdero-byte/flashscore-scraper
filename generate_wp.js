// generate_wp.js
// FINAL — RO hour aligned + event date displayed (homepage-safe)

import fs from "fs/promises";

const TICKETS_FILE = "tickets.json";

/* ================= HELPERS ================= */

/**
 * Add +1 hour to match time (RO alignment)
 */
function addOneHour(timeStr) {
  if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr)) return timeStr || "-";
  const [h, m] = timeStr.split(":").map(Number);
  const nh = (h + 1) % 24;
  return `${String(nh).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Build verification meta (used by verify flow)
 */
function buildVerificationMeta(sel) {
  let market = "1";
  let stat = "";
  let side = "";
  let threshold = "";

  const txt =
    sel.meta?.bet_text?.toLowerCase() ||
    sel.meta?.market_text?.toLowerCase() ||
    "";

  // Goals over / under
  if (txt.includes("gol")) {
    market = "STAT";
    stat = "goals";
    side = txt.includes("sub") ? "under" : "over";

    const m = txt.match(/(\d+(\.\d+)?)/);
    if (m) threshold = m[1];
  }

  // BTTS
  if (txt.includes("ambele") && txt.includes("marche")) {
    market = "BTTS";
    stat = "btts";
    side = "yes";
  }

  return { market, stat, side, threshold };
}

/* ================= ROW ================= */
function renderRow(sel) {
  const betText =
    sel.meta?.bet_text ||
    sel.meta?.market_text ||
    sel.market_raw ||
    sel.market ||
    "Pariu special";

  const meta = buildVerificationMeta(sel);
  const timeRO = addOneHour(sel.time);

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
  <td>${timeRO}</td>
  <td><strong>${betText}</strong></td>
  <td><strong>${sel.odd}</strong></td>
  <td style="text-align:center;font-weight:bold;">⏳</td>
</tr>`;
}

/* ================= TABLE ================= */
function renderTicket(ticket, dateLabel) {
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

<div class="pv-ticket-date">
  📅 Evenimentele sunt programate pentru <strong>${dateLabel}</strong>
</div>
`;
}

/* ================= CSS ================= */
const STYLE = `
<style>
.bilet-pariu {
  width:100%;
  border-collapse:collapse;
  margin-bottom:16px;
}
.bilet-pariu th,
.bilet-pariu td {
  border:1px solid #ddd;
  padding:8px;
}
.bilet-pariu th {
  background:#f4f4f4;
}
.pv-ticket-date {
  font-size:14px;
  color:#555;
  margin-bottom:24px;
}
</style>
`;

/* ================= MAIN ================= */
(async () => {
  const raw = await fs.readFile(TICKETS_FILE, "utf8");
  const data = JSON.parse(raw);

  const dateRO = new Date(data.date).toLocaleDateString("ro-RO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  if (data.bilet_cota2) {
    const html = STYLE + renderTicket(data.bilet_cota2, dateRO);
    await fs.writeFile("cota2.html", html, "utf8");
    console.log("[WP] cota2.html generated");
  }

  if (data.biletul_zilei) {
    const html = STYLE + renderTicket(data.biletul_zilei, dateRO);
    await fs.writeFile("biletul-zilei.html", html, "utf8");
    console.log("[WP] biletul-zilei.html generated");
  }

  if (!data.bilet_cota2 && !data.biletul_zilei) {
    console.log("[WP] Nothing to publish today.");
  }
})();
