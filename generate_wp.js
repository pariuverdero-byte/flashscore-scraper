import fs from "fs/promises";

const TICKETS_FILE = "tickets.json";
const LANG = process.env.LANG || "ro";

function translateBetText(sel) {
  const aiLabel = LANG === "en" ? sel.ai?.label_en : sel.ai?.label_ro;
  if (aiLabel) return aiLabel;
  const raw =
    sel.meta?.bet_text ||
    sel.meta?.market_text ||
    sel.market_raw ||
    sel.market ||
    "Pariu special";

  if (LANG !== "en") return raw;

  const t = raw.toLowerCase();
  let m;

  if (t.includes("ambele echipe marchează") && t.includes("nu")) {
    return "Both teams to score – NO";
  }
  if (t.includes("ambele echipe marchează")) {
    return "Both teams to score";
  }

  if ((m = t.match(/(.+?) minim (\d+) goluri/))) {
    return `${capitalize(m[1])} to score at least ${m[2]} goals`;
  }

  if ((m = t.match(/peste (\d+(\.\d+)?) goluri.*prima repriz/))) {
    return `Over ${m[1]} goals (1st half)`;
  }
  if ((m = t.match(/sub (\d+(\.\d+)?) goluri.*prima repriz/))) {
    return `Under ${m[1]} goals (1st half)`;
  }

  if ((m = t.match(/peste (\d+(\.\d+)?)/))) {
    return `Over ${m[1]} goals`;
  }
  if ((m = t.match(/sub (\d+(\.\d+)?)/))) {
    return `Under ${m[1]} goals`;
  }

  if ((m = t.match(/interval (\d+)\s*-\s*(\d+).*prima repriz/))) {
    return `Total goals 1st half: ${m[1]}–${m[2]}`;
  }

  if ((m = t.match(/interval (\d+)\s*-\s*(\d+).*meci/))) {
    return `Total goals: ${m[1]}–${m[2]}`;
  }

  if (t.includes("șansă dublă")) {
    if (t.includes("1x")) return "Double chance 1X";
    if (t.includes("x2")) return "Double chance X2";
    if (t.includes("12")) return "Double chance 12";
  }

  if (t.includes("victorie gazde")) return "Home win";
  if (t === "egal") return "Draw";
  if (t.includes("victorie oaspeți")) return "Away win";

  if (t.includes("pauză") && t.includes("final")) {
    return raw
      .replace(/pauză/gi, "Half-time")
      .replace(/final/gi, "Full-time");
  }

  return raw;
}

function capitalize(s = "") {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function formatTicketDate(isoDate) {
  if (!isoDate) return "-";

  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;

  if (LANG === "en") return `${d}/${m}/${y}`;
  return `${d}.${m}.${y}`;
}

function resolveEventUrl(sel) {
  if (sel.flashscore_url) return sel.flashscore_url;
  if (sel.url && !/claudiuhood|predictz/i.test(sel.url)) return sel.url;
  if (sel.id) return `https://www.flashscore.mobi/match/${sel.id}/`;
  if (sel.match_id) return `https://www.flashscore.mobi/match/${sel.match_id}/`;
  return sel.url || null;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderRow(sel) {
  const betText = translateBetText(sel);
  const link = resolveEventUrl(sel);
  const dataId = sel.id || sel.match_id || "";

  const eventCell = link
    ? `<a href="${escapeHtml(link)}" target="_blank" rel="nofollow noopener">${escapeHtml(sel.teams || "-")}</a>`
    : `<span>${escapeHtml(sel.teams || "-")}</span>`;

  return `
<tr
  data-id="${escapeHtml(dataId)}"
  data-status="pending"
  data-market="${escapeHtml(sel.market || sel.bet_type || "STAT")}"
  ${sel.stat ? `data-stat="${escapeHtml(sel.stat)}"` : ""}
  ${sel.side ? `data-side="${escapeHtml(sel.side)}"` : ""}
  ${sel.threshold ? `data-threshold="${escapeHtml(sel.threshold)}"` : ""}
>
  <td>${eventCell}</td>
  <td>${escapeHtml(sel.country || "-")} / ${escapeHtml(sel.competition || "-")}</td>
  <td>${escapeHtml(sel.time || "-")}</td>
  <td><strong>${escapeHtml(betText)}</strong></td>
  <td><strong>${escapeHtml(sel.odd ?? "-")}</strong></td>
  <td style="text-align:center;font-weight:bold;">⏳</td>
</tr>`;
}

function renderAnalysis(ticket) {
  const items = ticket.selections
    .map((sel, index) => {
      const reason = LANG === "en" ? sel.ai?.reason_en : sel.ai?.reason_ro;
      if (!reason) return "";
      const betText = translateBetText(sel);
      return `
<article class="ticket-analysis-item">
  <div class="ticket-analysis-number">${index + 1}</div>
  <div class="ticket-analysis-copy">
    <h3>${escapeHtml(sel.teams || "-")}</h3>
    <p class="ticket-analysis-pick"><strong>${escapeHtml(betText)}</strong> <span>@ ${escapeHtml(sel.odd ?? "-")}</span></p>
    <p>${escapeHtml(reason)}</p>
  </div>
</article>`;
    })
    .filter(Boolean)
    .join("\n");

  if (!items) return "";
  return `
<section class="ticket-analysis">
  <h2>${LANG === "en" ? "Selection analysis" : "Analiza selecțiilor"}</h2>
  ${items}
</section>`;
}

function renderTicketMeta(date) {
  return `
<div class="ticket-meta">
  <div class="ticket-date">
    <strong>${LANG === "en" ? "Ticket date" : "Data biletului"}:</strong>
    ${escapeHtml(formatTicketDate(date))}
  </div>
</div>`;
}

function renderTicket(ticket) {
  if (!ticket || !ticket.selections?.length) {
    return `<p>${LANG === "en" ? "(No ticket generated)" : "(Nu a fost generat niciun bilet)"}</p>`;
  }

  return `
<table class="bilet-pariu">
  <thead>
    <tr>
      <th>${LANG === "en" ? "Event" : "Eveniment"}</th>
      <th>${LANG === "en" ? "League" : "Sport / Țară"}</th>
      <th>${LANG === "en" ? "Time (CET)" : "Ora (CET)"}</th>
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
      <td><strong>${escapeHtml(ticket.product ?? "-")}</strong></td>
      <td></td>
    </tr>
  </tfoot>
</table>`;
}

const STYLE = `
<style>
.ticket-meta {
  margin-bottom: 12px;
}

.ticket-date {
  font-size: 14px;
  color: #555;
  margin-bottom: 10px;
}

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
.pick-reason { margin-top:5px; font-size:12px; line-height:1.35; color:#666; font-weight:400; }
.ticket-analysis { margin:28px 0 18px; }
.ticket-analysis > h2 { margin-bottom:16px; }
.ticket-analysis-item { display:flex; gap:14px; margin:0 0 14px; padding:18px; border:1px solid #dce9e3; border-radius:12px; background:#f8fbf9; }
.ticket-analysis-number { flex:0 0 34px; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:#079455; color:#fff; font-weight:700; }
.ticket-analysis-copy { min-width:0; }
.ticket-analysis-copy h3 { margin:2px 0 7px; font-size:18px; }
.ticket-analysis-copy p { margin:0 0 8px; line-height:1.55; }
.ticket-analysis-copy p:last-child { margin-bottom:0; }
.ticket-analysis-pick span { color:#52645c; white-space:nowrap; }
@media (max-width: 600px) {
  .ticket-analysis-item { padding:14px; gap:10px; }
  .ticket-analysis-number { flex-basis:30px; width:30px; height:30px; }
  .ticket-analysis-copy h3 { font-size:16px; }
}
</style>
`;

(async () => {
  const raw = await fs.readFile(TICKETS_FILE, "utf8");
  const data = JSON.parse(raw);

  if (data.bilet_cota2) {
    const html =
      STYLE +
      renderTicketMeta(data.date) +
      renderTicket(data.bilet_cota2) +
      renderAnalysis(data.bilet_cota2);

    await fs.writeFile("cota2.html", html, "utf8");
    console.log("[WP] cota2.html generated");
  }

  if (data.biletul_zilei) {
    const html =
      STYLE +
      renderTicketMeta(data.date) +
      renderTicket(data.biletul_zilei) +
      renderAnalysis(data.biletul_zilei);

    await fs.writeFile("biletul-zilei.html", html, "utf8");
    console.log("[WP] biletul-zilei.html generated");
  }

  if (!data.bilet_cota2 && !data.biletul_zilei) {
    console.log("[WP] Nothing to publish today.");
  }
})();
