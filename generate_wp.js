// generate_wp.js
// FINAL — aligned with relaxed Biletul Zilei logic

import fs from "fs/promises";

const TICKETS_FILE = "tickets.json";

function renderTicketHTML(title, ticket) {
  let html = `<h2>${title}</h2>`;
  html += `<p><strong>Cotă totală:</strong> ${ticket.product}</p>`;
  html += `<ul>`;

  for (const s of ticket.selections) {
    html += `<li>
      <strong>${s.teams}</strong><br/>
      ${s.market_raw} @ ${s.odd}<br/>
      <a href="${s.url}" target="_blank" rel="nofollow noopener">Vezi meciul</a>
    </li>`;
  }

  html += `</ul>`;
  return html;
}

function titleForBiletulZilei(size) {
  if (size === 1) return "Pontul Zilei";
  if (size === 2) return "Combo Zilnic";
  if (size === 3) return "Biletul Zilei";
  return "Biletul Zilei";
}

(async () => {
  const raw = await fs.readFile(TICKETS_FILE, "utf8");
  const data = JSON.parse(raw);

  const outputs = [];

  // ---- COTA 2 ----
  if (data.bilet_cota2) {
    const html = renderTicketHTML(
      "Cota 2 – Pronosticuri fotbal azi",
      data.bilet_cota2
    );

    await fs.writeFile("cota2.html", html, "utf8");
    outputs.push("cota2.html");
  }

  // ---- BILETUL ZILEI / VARIANTA ----
  if (data.biletul_zilei) {
    const size = data.biletul_zilei.selections.length;
    const title = titleForBiletulZilei(size);

    const html = renderTicketHTML(
      title,
      data.biletul_zilei
    );

    await fs.writeFile("biletul-zilei.html", html, "utf8");
    outputs.push("biletul-zilei.html");
  }

  if (!outputs.length) {
    console.log("[WP] Nothing to publish today.");
    return;
  }

  console.log("[WP] Generated:", outputs.join(", "));
})();
