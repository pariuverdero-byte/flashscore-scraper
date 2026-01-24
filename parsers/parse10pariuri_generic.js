import * as cheerio from "cheerio";

export function parse10PariuriGeneric(html, url, meta = {}) {
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text().trim();

  // JSON-LD date
  let publishedAt = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).text());
      if (json["@type"] === "Article" && json.datePublished) {
        publishedAt = json.datePublished;
      }
    } catch {}
  });

  // text editorial
  const contentText = $(".elementor-widget-text-editor")
    .map((_, el) => $(el).text())
    .get()
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  // cota (prima gasita)
  const oddMatch = contentText.match(/cota\s+(de\s+)?([0-9]+(\.[0-9]+)?)/i);
  const odd = oddMatch ? parseFloat(oddMatch[2]) : null;

  // sport heuristic
  let sport = meta.sport || "unknown";
  if (/tenis/i.test(title) || /ATP|WTA|set/i.test(contentText)) {
    sport = "tennis";
  }

  // market heuristic
  let market = null;
  if (/peste\s+1\.5\s+goluri\s+prima\s+repriza/i.test(contentText))
    market = "Over 1.5 goals 1st half";
  else if (/peste\s+2\.5\s+goluri/i.test(contentText))
    market = "Over 2.5 goals";
  else if (/sub\s+2\.5\s+goluri/i.test(contentText))
    market = "Under 2.5 goals";
  else if (/ambele\s+echipe\s+marcheaza/i.test(contentText))
    market = "BTTS";
  else if (/castiga|victorie/i.test(contentText))
    market = sport === "tennis" ? "Match Winner" : "1X2";

  return {
    source: "10pariuri.ro",
    sourceKey: meta.key,
    url,
    title,
    publishedAt,
    sport,
    market,
    odd,
    confidence: odd ? "medium" : "low",
    rawText: contentText.slice(0, 500), // debug safe
  };
}
