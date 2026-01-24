import cheerio from "cheerio";

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
  }

  let match = null;
  const matchRegex =
    contentText.match(/([A-Z][a-zA-Z\s]+)\s+(vs\.?|-\s?)\s+([A-Z][a-zA-Z\s]+)/);
  if (matchRegex) {
    match = `${matchRegex[1]} vs ${matchRegex[3]}`;
  }

  return {
    source: "10pariuri.ro",
    url,
    title,
    publishedAt,
    match,
    betType,
    odd,
    confidence: odd && betType ? "medium" : "low",
  };
}
