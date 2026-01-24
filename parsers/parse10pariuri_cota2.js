import * as cheerio from "cheerio";

export function parse10PariuriCota2(html, url) {
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text().trim();

  let publishedAt = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).text());
      if (json["@type"] === "Article" && json.datePublished) {
        publishedAt = json.datePublished;
      }
    } catch {}
  });

  const contentText = $(".elementor-widget-text-editor")
    .map((_, el) => $(el).text())
    .get()
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const oddMatch = contentText.match(/cota\s+(de\s+)?([0-9]+\.[0-9]+)/i);
  const odd = oddMatch ? parseFloat(oddMatch[2]) : null;

  let betType = null;
  if (/peste\s+1\.5\s+goluri\s+in\s+prima\s+repriza/i.test(contentText)) {
    betType = "Over 1.5 goals 1st half";
  } else if (/peste\s+2\.5\s+goluri/i.test(contentText)) {
    betType = "Over 2.5 goals";
  } else if (/sub\s+2\.5\s+goluri/i.test(contentText)) {
    betType = "Under 2.5 goals";
  } else if (/ambele\s+echipe\s+marcheaza/i.test(contentText)) {
    betType = "BTTS";
  }

  return {
    source: "10pariuri.ro",
    url,
    title,
    publishedAt,
    betType,
    odd,
    confidence: odd && betType ? "medium" : "low",
  };
}
