import fs from "node:fs/promises";

const feedFile = process.env.LIVE_FEED_FILE || "live-betting/data/live_feed.json";
const stateFile = process.env.LIVE_TELEGRAM_STATE_FILE || "live-betting/data/telegram_sent.json";
const targets = [
  { lang: "ro", token: process.env.TELEGRAM_PV_BOT_TOKEN, chatId: process.env.TELEGRAM_PV_CHAT_ID, site: "https://pariuverde.ro", telegram: "https://t.me/pariuverde" },
  { lang: "en", token: process.env.TELEGRAM_GBT_BOT_TOKEN, chatId: process.env.TELEGRAM_GBT_CHAT_ID, site: "https://greenbettips.com", telegram: "https://t.me/greenbettips_com" },
].filter(target => target.token && target.chatId);

const social = {
  ro: [
    ["TikTok", "https://www.tiktok.com/@nicu_pariuverde"],
    ["YouTube", "https://www.youtube.com/@pontverde"],
    ["Instagram", "https://www.instagram.com/nick_verde_2025/"],
  ],
  en: [
    ["TikTok", "https://www.tiktok.com/@greenbtps"],
    ["YouTube", "https://www.youtube.com/@GreenBetTips"],
    ["Instagram", "https://www.instagram.com/nick_verde_2025/"],
  ],
};

const feed = JSON.parse(await fs.readFile(feedFile, "utf8"));
let state = { sent: { ro: [], en: [] }, lastPromotion: { ro: 0, en: 0 }, promotionIndex: { ro: 0, en: 0 } };
try { state = { ...state, ...JSON.parse(await fs.readFile(stateFile, "utf8")) }; } catch {}
state.sent ||= { ro: [], en: [] }; state.lastPromotion ||= { ro: 0, en: 0 }; state.promotionIndex ||= { ro: 0, en: 0 };

function esc(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function send(target, text, options = {}) {
  const response = await fetch(`https://api.telegram.org/bot${target.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: target.chatId, text, parse_mode: "HTML", disable_web_page_preview: options.preview === false }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(`${target.lang}: ${result.description || `HTTP ${response.status}`}`);
  return result.result.message_id;
}

for (const target of targets) {
  state.sent[target.lang] ||= [];
  const sent = new Set(state.sent[target.lang]);
  for (const match of feed.matches || []) {
    for (const signal of match.signals || []) {
      if (!signal.id || sent.has(signal.id)) continue;
      const title = signal.title?.[target.lang] || "";
      const reason = signal.reason?.[target.lang] || "";
      const score = `${match.score?.home ?? 0}-${match.score?.away ?? 0}`;
      const minOdd = Number(signal.recommendedMinimumOdd || 0).toFixed(2);
      const line = signal.line ? ` ${signal.line}` : "";
      const labels = target.lang === "ro"
        ? { badge: "🔴 SEMNAL LIVE", minute: "Minutul", confidence: "Încredere", odd: "Cotă minimă recomandată", note: "Semnal informativ. Joacă responsabil." }
        : { badge: "🔴 LIVE BETTING SIGNAL", minute: "Minute", confidence: "Confidence", odd: "Recommended minimum odds", note: "Informational signal. Gamble responsibly." };
      const text = [
        `<b>${labels.badge}</b>`, "",
        `<b>${esc(match.home)} – ${esc(match.away)}</b> · ${esc(score)} · ${labels.minute} ${esc(match.minute)}'`,
        esc(match.competition || ""), "",
        `🎯 <b>${esc(title)}${esc(line)}</b>`,
        esc(reason), "",
        `📊 ${labels.confidence}: <b>${esc(signal.confidence)}/100</b>`,
        `💹 ${labels.odd}: <b>${esc(minOdd)}</b>`, "",
        `<i>${labels.note}</i>`,
      ].filter(Boolean).join("\n");
      await send(target, text);
      sent.add(signal.id);
      console.log(`[LIVE-TELEGRAM] ${target.lang}: sent ${signal.id}`);
    }
  }
  state.sent[target.lang] = [...sent].slice(-500);

  const now = Date.now();
  if (now - Number(state.lastPromotion[target.lang] || 0) >= 72 * 60 * 60 * 1000) {
    const links = social[target.lang];
    const index = Number(state.promotionIndex[target.lang] || 0) % links.length;
    const [network, url] = links[index];
    const text = target.lang === "ro"
      ? `📣 <b>Ne găsești și pe ${network}</b>\n\nUrmărește PariuVerde pentru analize, Cota 2 și Biletul Zilei:\n<a href="${url}">${url}</a>`
      : `📣 <b>Follow us on ${network}</b>\n\nFollow GreenBetTips for match analysis, the Daily Double and Bet of the Day:\n<a href="${url}">${url}</a>`;
    await send(target, text);
    state.lastPromotion[target.lang] = now;
    state.promotionIndex[target.lang] = index + 1;
    console.log(`[LIVE-TELEGRAM] ${target.lang}: promoted ${network}`);
  }
}

await fs.mkdir("live-betting/data", { recursive: true });
await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
