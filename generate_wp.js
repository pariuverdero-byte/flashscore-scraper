// generate_wp.js
// FINAL — language-safe (RO / EN) + verification-ready

import fs from "fs/promises";

const TICKETS_FILE = "tickets.json";
const LANG = (process.env.LANG || "ro").toLowerCase();

/* ================= TRANSLATIONS ================= */

const I18N = {
  ro: {
    cota2_title: "Bilet Cota 2",
    zi_title: "Biletul Zilei",
    event: "Eveniment",
    sport: "Sport / Țară",
    time: "Ora (RO)",
    bet: "Pariu propus",
    odd: "Cotă",
    status: "Status",
    total: "Cotă totală",
  },
  en: {
    cota2_title: "Odds 2 Ticket",
    zi_title: "Bet of the Day",
    event: "Event",
    sport: "League / Country",
    time: "Kick-off",
    bet: "Proposed bet",
    odd: "Odds",
    status: "Status",
    total: "Total odds",
  }
};

const T = I18N[LANG] || I18N.ro;

/* ================= ROW ================= */

function renderRow(sel) {
  const betText =
    sel.meta?.bet_text ||
    sel.meta?.market_text ||
    sel.market_raw ||
    sel.market ||
    "—";

  return `
<tr
  data-id="${sel.id}"
  data-status="pending"
  data-market="${sel.market_type || "STAT"}"
  ${sel.stat ? `data-stat="${sel.stat}"` : ""}
  ${sel.side ? `data-side="${sel.side}"` : ""}
  ${sel.threshold ? `data-threshold="${sel.threshold}"` : ""}
>
  <td><a href="${sel.url}" target="_blank" rel="nofollow noopener">${sel.teams}</a></td>
  <td>${sel.country} / ${sel.competition}</td>
  <td>${sel.time || "-"}</td>
  <td><strong>${betText}</strong></td>
  <td><strong>${sel.odd}</strong></td>
  <td style="text-align:center;font-weight:bold;">⏳</td>
</tr>`;
}

/* ================= TABLE ================= */

function renderTicket(ticket) {
  if (!ticket || !ticket.selections?.length) return "";

  return `
<table class="bilet-pariu">
<thead>
<tr>
<th>${T.event}</th>
<th>${T.sport}</th>
<th>${T.time}</th>
<th>${T.bet}</th>
<th>${T.odd}</th>
<th>${T.status}</th>
</tr>
</thead>
<tbody>
${ticket.selections.map(renderRow).join("\n")}
</tbody>
<tfoot>
<tr>
<td colspan="4"><strong>${T.total}</strong></td>
<td><strong>${ticket.product}</strong></td>
<td></td>
</tr>
</tfoot>
</table>
`;
}

/* ================= STYLE ================= */

const STYLE = `
<style>
.bilet-pariu{width:100%;border-collapse:collapse;margin-bottom:24px}
.bilet-pariu th,.bilet-pariu td{border:1px solid #ddd;padding:8px}
.bilet-pariu th{background:#f4f4f4}
</style>
`;

/* ================= MAIN ================= */

(async () => {
  const data = JSON.parse(await fs.readFile(TICKETS_FILE, "utf8"));

  if (data.bilet_cota2) {
    await fs.writeFile(
      "cota2.html",
      STYLE + renderTicket(data.bilet_cota2),
      "utf8"
    );
  }

  if (data.biletul_zilei) {
    await fs.writeFile(
      "biletul-zilei.html",
      STYLE + renderTicket(data.biletul_zilei),
      "utf8"
    );
  }

  console.log(`[WP] HTML generated (${LANG.toUpperCase()})`);
})();
