import fs from "fs/promises";
import cheerio from "cheerio";
import fetch from "node-fetch";

const SOURCE = "claudiuhood";

function extractFlashscoreId(url) {
  const m = url.match(/flashscore\.mobi\/match\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

export async function scrapeClaudiuPool() {
  const html = await fs.readFile("claudiu_pool.html", "utf8");
  const $ = cheerio.load(html);

  const selections = [];

  $("table tr").each((_, tr) => {
    const link = $(tr).find("a[href*='flashscore']").attr("href");
    if (!link) return;

    const matchId = extractFlashscoreId(link);
    if (!matchId) return; // HARD RULE

    const teams = $(tr).find(".teams").text().trim();
    const betText = $(tr).find(".bet").text().trim();
    const odd = parseFloat($(tr).find(".odd").text());

    if (!odd || !teams) return;

    selections.push({
      match_id: matchId,
      flashscore_url: `https://www.flashscore.mobi/match/${matchId}/`,
      teams,
      bet_type: detectBetType(betText),
      bet_text_ro: betText,
      bet_text_en: "", // completăm ulterior
      params: detectParams(betText),
      odd,
      source: SOURCE
    });
  });

  return selections;
}

/* ===== BET TYPE DETECT ===== */
function detectBetType(txt) {
  const t = txt.toLowerCase();
  if (t.includes("ambele")) return "btts";
  if (t.includes("goluri") && t.includes("minim")) return "team_goals_min";
  if (t.includes("over") || t.includes("under")) return "goals_ou";
  return "1x2";
}

function detectParams(txt) {
  const t = txt.toLowerCase();

  if (t.includes("ambele")) return { side: "yes" };

  const m = t.match(/(\d+(\.\d+)?)/);
  if (t.includes("minim") && m) {
    return { min: Number(m[1]) };
  }

  if ((t.includes("over") || t.includes("under")) && m) {
    return {
      side: t.includes("over") ? "over" : "under",
      line: Number(m[1])
    };
  }

  return {};
}
