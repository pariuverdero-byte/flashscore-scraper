import fs from "fs";

const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "").trim();
const TICKET_TYPE = String(process.env.TICKET_TYPE || "").trim();
const LANG = String(process.env.LANG || "ro").toLowerCase();

if (!BOT_TOKEN || !CHAT_ID || !["bilet_cota2", "biletul_zilei"].includes(TICKET_TYPE)) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / valid TICKET_TYPE");
}

const payloadFile = `output/${TICKET_TYPE}/shorts_payload.json`;
const videoFile = `output/${TICKET_TYPE}/short.mp4`;
const youtubeResultFile = `output/${TICKET_TYPE}/distribution_results.json`;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wordpressLink(ticketType) {
  if (!fs.existsSync("published_posts.json")) return "";
  const data = readJson("published_posts.json");
  const posts = Array.isArray(data) ? data : data.posts || [];
  const ticket = ticketType === "bilet_cota2" ? "cota-2" : "biletul-zilei";
  return posts.find(item => item.ticket === ticket && item.success)?.link || "";
}

function buildCaption(payload, youtubeUrl, articleUrl) {
  const isCota2 = TICKET_TYPE === "bilet_cota2";
  const title = LANG === "ro"
    ? (isCota2 ? "Bilet Cota 2" : "Biletul Zilei")
    : (isCota2 ? "Odds 2 Ticket" : "Bet of the Day");
  const oddsLabel = LANG === "ro" ? "Cotă totală" : "Total odds";
  const detailsLabel = LANG === "ro" ? "Analiza completă" : "Full analysis";
  const videoLabel = LANG === "ro" ? "Video YouTube" : "YouTube video";
  const lines = [
    `<b>${escapeHtml(title)}</b>`,
    `<b>${oddsLabel}: ${escapeHtml(payload.visuals?.totalOdds || payload.totalOdds || payload.total_odd || payload.totalOdd || "-")}</b>`,
    "",
  ];
  for (const selection of payload.selections || []) {
    const match = selection.match || selection.teams || "";
    const pick = selection.pick || selection.market || selection.marketOriginal || selection.bet || "";
    const oddValue = selection.odd || selection.odds;
    const odd = oddValue ? ` @ ${oddValue}` : "";
    lines.push(`⚽ <b>${escapeHtml(match)}</b>`);
    lines.push(`${escapeHtml(pick)}${escapeHtml(odd)}`);
  }
  if (articleUrl) lines.push("", `🔗 <a href="${escapeHtml(articleUrl)}">${detailsLabel}</a>`);
  if (youtubeUrl) lines.push(`▶️ <a href="${escapeHtml(youtubeUrl)}">${videoLabel}</a>`);
  lines.push("", LANG === "ro" ? "18+ Joacă responsabil." : "18+ Gamble responsibly.");
  return lines.join("\n").slice(0, 1024);
}

if (!fs.existsSync(payloadFile) || !fs.existsSync(videoFile) || !fs.existsSync(youtubeResultFile)) {
  console.log(`[TELEGRAM] ${TICKET_TYPE}: required published video files are missing; skipped`);
  process.exit(0);
}

const payload = readJson(payloadFile);
const youtubeResult = readJson(youtubeResultFile);
if (payload.status !== "ready" || youtubeResult.status !== "success") {
  console.log(`[TELEGRAM] ${TICKET_TYPE}: video was not published successfully; skipped`);
  process.exit(0);
}

const form = new FormData();
form.set("chat_id", CHAT_ID);
form.set("parse_mode", "HTML");
form.set("supports_streaming", "true");
form.set("caption", buildCaption(payload, youtubeResult.youtube?.url || "", wordpressLink(TICKET_TYPE)));
form.set("video", new Blob([fs.readFileSync(videoFile)], { type: "video/mp4" }), `${TICKET_TYPE}.mp4`);

const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`, {
  method: "POST",
  body: form,
});
const result = await response.json();
if (!response.ok || !result.ok) {
  throw new Error(`Telegram sendVideo failed: ${result.description || `HTTP ${response.status}`}`);
}

console.log(`[TELEGRAM] ${TICKET_TYPE}: published message ${result.result?.message_id} to configured channel`);
