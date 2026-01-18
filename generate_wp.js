// generate_wp.js
// FINAL — WP HTML with PENDING status for later auto-validation

import fs from "fs/promises";

const tickets = JSON.parse(await fs.readFile("tickets.json", "utf8"));

function row(sel) {
  return `
<tr data-match-id="${sel.id}" data-status="pending">
  <td>
    <a href="${sel.url}" target="_blank" rel="noopener">
      ${sel.teams}
    </a>
  </td>
  <td>${sel.country} / ${sel.competition}</td>
  <td>${sel.time || "-"}</td>
  <td>${sel.market}</td>
  <td>${sel.odd}</td>
  <td>
    <span class="pv-status pv-pending">⏳</span>
    <span class="pv-status pv-win">✅</span>
    <span class="pv-status pv-loss">❌</span>
  </td>
</tr>`;
}

function table(title, ticket) {
  if (!ticket || !ticket.selections?.length) {
    return `<h2>${title}</h2><p>(Nu a fost generat)</p>`;
  }

  return `
<h2>${title}</h2>

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
    ${ticket.selections.map(row).join("\n")}
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

const baseStyle = `
<style>
.pv-ticket { width:100%; border-collapse:collapse; }
.pv-ticket th, .pv-ticket td {
  border:1px solid #ddd;
  padding:8px;
}
.pv-ticket th { background:#f5f5f5; }
.pv-status { font-size:18px; }

[data-status="pending"] .pv-win,
[data-status="pending"] .pv-loss { display:none; }

[data-status="win"] .pv-pending,
[data-status="win"] .pv-loss { display:none; }

[data-status="loss"] .pv-pending,
[data-status="loss"] .pv-win { display:none; }
</style>
`;

const cota2Html = `
${baseStyle}
${table("Bilet Cota 2", tickets.bilet_cota2)}
`;

const ziHtml = `
${baseStyle}
${table("Biletul Zilei", tickets.biletul_zilei)}
`;

await fs.writeFile("cota2.html", cota2Html);
await fs.writeFile("biletul-zilei.html", ziHtml);

console.log("[OK] WordPress HTML generated with PENDING status");
