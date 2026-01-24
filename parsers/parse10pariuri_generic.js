import * as cheerio from "cheerio";

export function parse10PariuriGeneric(html, url, meta = {}) {
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
   * ODD (prima cota gasita)
   * ------------------------- */
  const oddMatch = contentText.match(/cota\s+(de\s+)?([0-9]+(\.[0-9]+)?)/i);
  const odd = oddMatch ? parseFloat(oddMatch[2]) : null;

  /* -------------------------
   * SPORT (heuristic)
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
   * MARKET DETECTION (FIXED)
   * ------------------------- */
  let market = null;

  // ✅ Over 1.5 goals 1st half  (FIX pentru COTA2)
  if (
    /peste\s+1\.5\s+goluri\s+(in\s+)?prima\s+repriza/i.test(contentText)
  ) {
    market = "Over 1.5 goals 1st half";
  }

  // Over 2.5 goals
  else if (/peste\s+2\.5\s+goluri/i.test(contentText)) {
    market = "Over 2.5 goals";
  }

  // Under 2.5 goals
  else if (/sub\s+2\.5\s+goluri/i.test(contentText)) {
    market = "Under 2.5 goals";
  }

  // BTTS
  else if (/ambele\s+echipe\s+marcheaza/i.test(contentText)) {
    market = "BTTS";
  }

  // Tennis – match winner
  else if (
    sport === "tennis" &&
    /castiga|victorie|winner/i.test(contentText)
  ) {
    market = "Match Winner";
  }

  // Football – generic win / 1X2
  else if (sport === "football" && /castiga|victorie/i.test(contentText)) {
    market = "1X2";
  }

  /* -------------------------
   * FINAL OBJECT
   * ------------------------- */
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
// 🔁 Alias explicit pentru consum extern (tests, engine, etc.)
export { parse10pariuri };
export const parse10pariuriGeneric = parse10pariuri;
