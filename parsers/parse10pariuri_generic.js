import * as cheerio from "cheerio";
import fetch from "node-fetch";

export async function parse10pariuriGeneric(url, meta = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  /* -------------------------
   * TITLE
   * ------------------------- */
  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text().trim();

  /* -------------------------
   * DATE (JSON-LD)
   * ------------------------- */
  let publishedAt = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).text());
      if (json["@type"] === "Article" && json.datePublished) {
        publishedAt = json.datePublished;
      }
    } catch {}
  });

  /* -------------------------
   * CONTENT TEXT
   * ------------------------- */
  const contentText = $(".elementor-widget-text-editor")
    .map((_, el) => $(el).text())
    .get()
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  /* -------------------------
   * ODD
   * ------------------------- */
  const oddMatch = contentText.match(/cota\s+(de\s+)?([0-9]+(\.[0-9]+)?)/i);
  const odd = oddMatch ? parseFloat(oddMatch[2]) : null;

  /* -------------------------
   * SPORT
   * ------------------------- */
  let sport = meta.sport || "unknown";

  if (
    /tenis|atp|wta|set\s+[0-9]/i.test(title) ||
    /atp|wta|game|set/i.test(contentText)
  ) {
    sport = "tennis";
  } else if (/goluri|echipe|meci|repriza/i.test(contentText)) {
    sport = "football";
  }

  /* -------------------------
   * MARKET
   * ------------------------- */
  let market = null;

  if (
    /peste\s+1\.5\s+goluri\s+(in\s+)?prima\s+repriza/i.test(contentText)
  ) {
    market = "Over 1.5 goals 1st half";
  } else if (/peste\s+2\.5\s+goluri/i.test(contentText)) {
    market = "Over 2.5 goals";
  } else if (/sub\s+2\.5\s+goluri/i.test(contentText)) {
    market = "Under 2.5 goals";
  } else if (/ambele\s+echipe\s+marcheaza/i.test(contentText)) {
    market = "BTTS";
  } else if (
    sport === "tennis" &&
    /castiga|victorie|winner/i.test(contentText)
  ) {
    market = "Match Winner";
  } else if (sport === "football" && /castiga|victorie/i.test(contentText)) {
    market = "1X2";
  }

  return {
    source: "10pariuri.ro",
    sourceKey: meta.key || null,
    url,
    title,
    publishedAt,
    sport,
    market,
    odd,
    confidence: odd ? "medium" : "low",
    rawText: contentText.slice(0, 600),
  };
}
