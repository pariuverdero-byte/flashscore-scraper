// generate_wp.js
// FINAL — WP renderer with HUMAN bet text (meta.bet_text)

import fs from "fs/promises";

const TICKETS_FILE = "tickets.json";

function renderTable(ticket) {
  let html = `
<table class="pariuri">
  <thead>
    <tr>
      <th>Eveniment</th>
      <th>Sport / Țară</th>
      <th>Ora (RO)</th>
      <th>Pariu propus</th>
      <th>Cotă</th>
    </tr>
  </thead>
  <tbody>
`;

  for (const s of ticket.selections) {
    const betText =
      s.meta?.bet_text ||
      s.market_raw ||
      "Pariu special";

    html += `
    <tr>
      <td>
        <a href="${s.url}" target="_blank" rel="nofollow noopener">
          ${s.teams}
        </a>
      </td>
      <td>
        Fotbal — ${s.country} / ${s.competition}
      </td>
      <td>${s.time || "-"}</td>
      <td>${betText}</td>
      <td><strong>${s.odd}</strong></td>
    </tr>
`;
  }

  html += `
  </tbody>
  <tfoot>
    <tr>
      <td colspan="4"><strong>Cotă totală</strong></td>
      <td><strong>${ticket.product}</strong></td>
    </tr>
  </tfoot>
</table>
`;

  return html;
}

function titleForBiletulZilei(size) {
  if (size === 1) return "Pontul Zilei";
  if (size === 2) return "Combo Zilnic";
  return "Biletul Zilei";
}

(async () => {
  const raw = await fs.readFile(TICKETS_FILE, "utf8");
  const data = JSON.parse(raw);

  // ---- COTA 2 ----
  if (data.bilet_cota2) {
    const html =
      `<h2>Cota 2 – Pronosticuri fotbal azi</h2>` +
      renderTable(data.bilet_cota2);

    await fs.writeFile("cota2.html", html, "utf8");
    console.log("[WP] cota2.html generated");
  }

  // ---- BILETUL ZILEI ----
  if (data.biletul_zilei) {
    const size = data.biletul_zilei.selections.length;
    const title = titleForBiletulZilei(size);

    const html =
      `<h2>${title}</h2>` +
      renderTable(data.biletul_zilei);

    await fs.writeFile("biletul-zilei.html", html, "utf8");
    console.log("[WP] biletul-zilei.html generated");
  }

  if (!data.bilet_cota2 && !data.biletul_zilei) {
    console.log("[WP] Nothing to publish today.");
  }
})();
