import * as cheerio from "cheerio";

/**
 * Parsează o pagină 10pariuri și returnează EVENTURI (nu match unic)
 * @param {string} html
 * @param {string} url
 * @returns {Array}
 */
export function parse10pariuriEvents(html, url) {
  const $ = cheerio.load(html);

  // luăm DOAR textul util (nu meniuri)
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
    /* -------------------------
     * MATCH LINE
     * ------------------------- */
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

    /* -------------------------
     * MARKET
     * ------------------------- */
    if (
      /peste|sub|ambele|castiga|victorie|1x|x2|12|goluri|cornere/i.test(line)
    ) {
      current.market = line;
    }

    /* -------------------------
     * ODD
     * ------------------------- */
    const oddMatch = line.match(/cota\s+([0-9]+(\.[0-9]+)?)/i);
    if (oddMatch) {
      current.odd = parseFloat(oddMatch[1]);
    }
  }

  if (current && current.market && current.odd) {
    events.push(current);
  }

  // cleanup final
  return events.filter(e => e.home && e.away && e.market && e.odd);
}
