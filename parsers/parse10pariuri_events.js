import * as cheerio from "cheerio";

export async function parse10pariuriEvents(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const rawText = $(".elementor-widget-text-editor")
    .map((_, el) => $(el).text())
    .get()
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();

  const lines = rawText
    .split(/\n|\r|\. /)
    .map(l => l.trim())
    .filter(l => l.length > 5);

  const events = [];
  let current = null;

  for (const line of lines) {
    // MATCH
    const matchLine = line.match(
      /([A-Z][A-Za-z\s]+?)\s*(?:vs|–|-)\s*([A-Z][A-Za-z\s]+)/i
    );

    if (matchLine) {
      if (current && current.market && current.odd) {
        events.push(current);
      }

      current = {
        home: matchLine[1].trim(),
        away: matchLine[2].trim(),
        market: null,
        odd: null,
        source: "10pariuri",
        sourceUrl: url,
      };
      continue;
    }

    if (!current) continue;

    // MARKET
    if (
      /peste|sub|ambele|castiga|victorie|1x|x2|12|goluri|cornere/i.test(line)
    ) {
