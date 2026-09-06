import fs from "fs/promises";
import * as cheerio from "cheerio";
import { matchEventToFlashscore } from "./engine/matcher_core.js";
import { fetchPrematchData } from "./live-betting/lib/prematch.js";

const POOL_FILE = "master_pool.json";
const MATCHES_FILE = "matches.json";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
// Enrich the candidate pool before the model chooses a ticket. The old limit
// could leave the ultimately selected bundle outside the enriched set.
const AI_PREMATCH_MAX = Math.max(0, Number(process.env.AI_PREMATCH_MAX || 48));
const AI_PREMATCH_CONCURRENCY = Math.max(1, Number(process.env.AI_PREMATCH_CONCURRENCY || 4));

const COTA2 = {
  min: Number(process.env.PV_COTA2_MIN || 1.90),
  max: Number(process.env.PV_COTA2_MAX || 2.50),
  target: Number(process.env.PV_TARGET_COTA2 || 2.05),
};
const ZI = {
  min: Number(process.env.PV_ZI_MIN || 3.50),
  max: Number(process.env.PV_ZI_MAX || 7.00),
  target: Number(process.env.PV_TARGET_ZI || 5.00),
  minSize: 2,
  maxSize: 4,
};

const safe = (v) => String(v ?? "").trim();
const norm = (v) => safe(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const product = (xs) => xs.reduce((a, s) => a * Number(s.odd), 1);

function getMatchesArray(raw) {
  if (Array.isArray(raw)) return raw;
  for (const k of ["matches", "fixtures", "data"]) if (Array.isArray(raw?.[k])) return raw[k];
  return [];
}

function marketClass(s) {
  const t = norm([s.market_raw, s.meta?.bet_text, s.meta?.market_text].join(" "));
  const dc = /(^| )(1x|x2|12)( |$)|sansa dubla|double chance/.test(t);
  const goals = /over|under|peste|sub|gol|goal/.test(t);
  if (dc && goals) return "double_chance_goals";
  if (/corner|cornere/.test(t)) return "corners";
  if (/cartonas|card/.test(t)) return "cards";
  if (dc) return "double_chance";
  if (/both teams|ambele|btts|gg/.test(t)) return "btts";
  if (goals) return "goals";
  if (/victorie|home win|away win|(^| )egal( |$)|(^| )draw( |$)/.test(t)) return "result";
  return "special";
}

const WEIGHT = {
  double_chance_goals: 10,
  corners: 9,
  cards: 8,
  double_chance: 8,
  btts: 6,
  goals: 5,
  result: 3,
  special: 1,
};

function isVerifierSupported(s) {
  const t = norm(s.market_raw || s.meta?.bet_text || "");
  if (!t) return false;
  if (/corner|cornere/.test(t)) return /(over|under|peste|sub|minim|at least)\s*\d/.test(t);
  if (/cartonas|card/.test(t)) return /(over|under|peste|sub|minim|at least)\s*\d/.test(t);
  if (/sansa dubla|double chance|(^| )(1x|x2|12)( |$)/.test(t)) return true;
  if (/both teams|ambele|btts|(^| )gg( |$)/.test(t)) return true;
  if (/over|under|peste|sub|minim|at least/.test(t) && /\d/.test(t)) return true;
  if (/victorie|home win|away win|(^| )egal( |$)|(^| )draw( |$)/.test(t)) return true;
  return false;
}

function canonicalize(sel, matches) {
  if (!sel || !safe(sel.teams) || !safe(sel.market_raw)) return null;
  const odd = Number(sel.odd);
  if (!Number.isFinite(odd) || odd <= 1) return null;

  const wantedId = safe(sel.match_id || sel.id || sel.flashscore_id);
  let m = wantedId ? matches.find(x => [x.id, x.match_id, x.flashscore_id].map(safe).includes(wantedId)) : null;
  if (!m) m = matchEventToFlashscore(sel.teams, matches)?.match || null;
  if (!m) return null;

  const id = safe(m.id || m.match_id || m.flashscore_id);
  if (!id) return null;
  const teams = safe(m.teams) || safe(sel.teams);
  const url = safe(m.url || m.flashscore_url) || `https://www.flashscore.mobi/match/${id}/`;
  return {
    ...sel,
    id,
    match_id: id,
    flashscore_url: url,
    url,
    teams,
    time: safe(m.time) || safe(sel.time),
    country: safe(m.country) || safe(sel.country),
    competition: safe(m.competition || m.league) || safe(sel.competition),
    odd: Number(odd.toFixed(3)),
  };
}

function scoreSelection(s) {
  const sourceBonus = /claudiu/i.test(s.source || "") ? 1.0 : /predictz|talkfootball/i.test(s.source || "") ? 0.4 : 0;
  return (WEIGHT[marketClass(s)] || 0) + sourceBonus - Math.abs(Number(s.odd) - 1.55) * 0.15;
}

function preparePool(items) {
  const seen = new Set();
  const deduped = [];
  for (const s of items) {
    if (!isVerifierSupported(s)) continue;
    const key = `${s.match_id}|${norm(s.market_raw)}|${Number(s.odd).toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }
  deduped.sort((a, b) => scoreSelection(b) - scoreSelection(a));
  const byMatch = new Map();
  for (const s of deduped) {
    const arr = byMatch.get(s.match_id) || [];
    if (arr.length >= 3) continue;
    if (!arr.some(x => marketClass(x) === marketClass(s)) || arr.length < 2) arr.push(s);
    byMatch.set(s.match_id, arr);
  }
  return [...byMatch.values()].flat().sort((a, b) => scoreSelection(b) - scoreSelection(a)).slice(0, 48);
}

function ticketScore(xs, p, target) {
  const classes = xs.map(marketClass);
  return xs.reduce((a, s) => a + scoreSelection(s), 0) + new Set(classes).size * 1.4 - Math.abs(p - target) * 3;
}

function enumerate(pool, minSize, maxSize, minOdd, maxOdd, target, limit) {
  const out = [];
  function walk(start, size, acc, used) {
    if (acc.length === size) {
      const p = product(acc);
      if (p >= minOdd && p <= maxOdd) out.push({ selections: acc.slice(), product: p, score: ticketScore(acc, p, target) });
      return;
    }
    for (let i = start; i < pool.length; i++) {
      const s = pool[i];
      if (used.has(s.match_id)) continue;
      const partial = product([...acc, s]);
      if (partial > maxOdd * 1.05) continue;
      used.add(s.match_id); acc.push(s);
      walk(i + 1, size, acc, used);
      acc.pop(); used.delete(s.match_id);
    }
  }
  for (let size = minSize; size <= maxSize; size++) walk(0, size, [], new Set());
  out.sort((a, b) => b.score - a.score);
  const seen = new Set(), uniq = [];
  for (const t of out) {
    const fp = t.selections.map(s => `${s.match_id}:${norm(s.market_raw)}`).sort().join("|");
    if (seen.has(fp)) continue;
    seen.add(fp); uniq.push(t);
    if (uniq.length >= limit) break;
  }
  return uniq;
}

function selectionFingerprint(s) {
  return `${safe(s.match_id)}|${norm(s.market_raw)}|${Number(s.odd).toFixed(3)}`;
}

function ticketFingerprint(ticket) {
  return ticket.selections.map(selectionFingerprint).sort().join("||");
}

function mergeTickets(primary, secondary, limit = 40) {
  const seen = new Set();
  const out = [];
  for (const ticket of [...primary, ...secondary]) {
    const fp = ticketFingerprint(ticket);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(ticket);
    if (out.length >= limit) break;
  }
  return out;
}

function attachBundleMeta(list, mode, c2Count, dayCount) {
  list.mode = mode;
  list.cota2Candidates = c2Count;
  list.dayCandidates = dayCount;
  return list;
}

function buildBundles(pool) {
  const c2Strict = enumerate(pool, 2, 2, COTA2.min, COTA2.max, COTA2.target, 25);
  const c2Singles = enumerate(pool, 1, 1, COTA2.min, COTA2.max, COTA2.target, 25);
  const c2Fallback = mergeTickets(c2Strict, c2Singles, 40);
  const day = enumerate(pool, ZI.minSize, ZI.maxSize, ZI.min, ZI.max, ZI.target, 40);

  console.log(`[GENERATOR] verifier-compatible pool: ${pool.length}`);
  console.log(`[GENERATOR] Cota2 strict 2-pick candidates: ${c2Strict.length}`);
  console.log(`[GENERATOR] Cota2 single-pick fallback candidates: ${c2Singles.length}`);
  console.log(`[GENERATOR] Biletul Zilei candidates: ${day.length}`);

  // Level 1: preserve the original preference — Cota 2 has two selections and
  // the two tickets use completely different matches.
  const strict = [];
  for (const a of c2Strict) {
    const aIds = new Set(a.selections.map(s => s.match_id));
    for (const b of day) {
      if (b.selections.some(s => aIds.has(s.match_id))) continue;
      strict.push({ id: `B${String(strict.length + 1).padStart(3, "0")}`, cota2: a, day: b, score: a.score + b.score, fallback_mode: "strict" });
      if (strict.length >= 120) break;
    }
    if (strict.length >= 120) break;
  }
  strict.sort((a, b) => b.score - a.score);
  console.log(`[GENERATOR] Strict bundles: ${strict.length}`);
  if (strict.length) return attachBundleMeta(strict.slice(0, 80), "strict", c2Fallback.length, day.length);

  // Level 2: Cota 2 may also be a valid single selection with total odds in the
  // configured range. The same match may appear in both tickets, but never the
  // exact same selection.
  const overlap = [];
  for (const a of c2Fallback) {
    const aSelections = new Set(a.selections.map(selectionFingerprint));
    for (const b of day) {
      if (b.selections.some(s => aSelections.has(selectionFingerprint(s)))) continue;
      overlap.push({ id: `F${String(overlap.length + 1).padStart(3, "0")}`, cota2: a, day: b, score: a.score + b.score - 0.5, fallback_mode: a.selections.length === 1 ? "single_cota2_shared_match_allowed" : "shared_match_different_selection" });
      if (overlap.length >= 120) break;
    }
    if (overlap.length >= 120) break;
  }
  overlap.sort((a, b) => b.score - a.score);
  console.log(`[GENERATOR] Flexible fallback bundles: ${overlap.length}`);
  if (overlap.length) return attachBundleMeta(overlap.slice(0, 80), "flexible", c2Fallback.length, day.length);

  // Level 3: generate each ticket type independently. This keeps publishing alive
  // when all feasible candidates overlap completely or only one ticket type exists.
  if (c2Fallback.length || day.length) {
    const independent = [{
      id: "I001",
      cota2: c2Fallback[0] || null,
      day: day[0] || null,
      score: (c2Fallback[0]?.score || 0) + (day[0]?.score || 0),
      fallback_mode: "independent"
    }];
    console.log(`[GENERATOR] Independent fallback active: cota2=${Boolean(c2Fallback[0])} day=${Boolean(day[0])}`);
    return attachBundleMeta(independent, "independent", c2Fallback.length, day.length);
  }

  return attachBundleMeta([], "none", c2Fallback.length, day.length);
}

function splitCanonicalTeams(teams = "") {
  const cleaned = safe(teams).replace(/\s+[–—−]\s+/g, " - ");
  const parts = cleaned.split(/\s+-\s+/).map(x => safe(x)).filter(Boolean);
  if (parts.length < 2) return { home: "", away: "" };
  const strip = (v) => safe(v).replace(/\s*\([^)]{2,5}\)\s*$/g, "").trim();
  return { home: strip(parts[0]), away: strip(parts.slice(1).join(" - ")) };
}

function formSummary(items = []) {
  const list = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!list.length) return null;

  const record = { W: 0, D: 0, L: 0 };
  const totals = [];
  let btts = 0;

  for (const item of list) {
    if (record[item?.result] !== undefined) record[item.result] += 1;
    const m = safe(item?.score).match(/(\d+)\s*[-:]\s*(\d+)/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    totals.push(a + b);
    if (a > 0 && b > 0) btts += 1;
  }

  const avg = totals.length
    ? totals.reduce((sum, value) => sum + value, 0) / totals.length
    : null;

  const countOver = (line) => totals.filter(v => v > line).length;
  const countUnder = (line) => totals.filter(v => v < line).length;

  return {
    matches: list.length,
    score_samples: totals.length,
    wins: record.W,
    draws: record.D,
    losses: record.L,
    avg_total_goals: avg === null ? null : Number(avg.toFixed(2)),
    over_1_5: countOver(1.5),
    over_2_5: countOver(2.5),
    over_3_5: countOver(3.5),
    under_1_5: countUnder(1.5),
    under_2_5: countUnder(2.5),
    under_3_5: countUnder(3.5),
    btts,
    totals,
    scores: list.map(x => safe(x.score)).filter(Boolean)
  };
}

function compactPrematch(data) {
  if (!data) return null;

  const out = {
    standings: {
      home_position: data?.standings?.home?.position ?? null,
      home_played: data?.standings?.home?.played ?? null,
      home_points: data?.standings?.home?.points ?? null,
      away_position: data?.standings?.away?.position ?? null,
      away_played: data?.standings?.away?.played ?? null,
      away_points: data?.standings?.away?.points ?? null,
    },
    recent_form: {
      home: formSummary(data?.form?.home),
      away: formSummary(data?.form?.away),
    },
    h2h: data?.h2h ? {
      meetings: data.h2h.meetings ?? 0,
      home_wins: data.h2h.homeWins ?? 0,
      draws: data.h2h.draws ?? 0,
      away_wins: data.h2h.awayWins ?? 0,
      scores: Array.isArray(data.h2h.items)
        ? data.h2h.items.slice(0, 5).map(x => safe(x.score)).filter(Boolean)
        : []
    } : null,
    market_odds: data?.odds || null,
  };

  const text = JSON.stringify(out);
  return /[1-9]/.test(text) ? out : null;
}

function parseGoalsMarket(market = "") {
  const text = safe(market).toLowerCase();
  const m = text.match(/(?:over|under|peste|sub)\s*(\d+(?:[.,]\d+)?)/i);
  return {
    line: m ? Number(m[1].replace(",", ".")) : null,
    direction: /\b(?:over|peste)\b/i.test(text)
      ? "over"
      : /\b(?:under|sub)\b/i.test(text)
        ? "under"
        : null
  };
}

function buildGoalsEvidence(prematch, market) {
  const { line, direction } = parseGoalsMarket(market);
  const home = prematch?.recent_form?.home;
  const away = prematch?.recent_form?.away;
  const hm = Number(home?.score_samples || 0);
  const am = Number(away?.score_samples || 0);

  if (!Number.isFinite(line) || !direction || hm < 3 || am < 3) {
    return { usable: false, type: "goals" };
  }

  const ha = Number(home?.avg_total_goals);
  const aa = Number(away?.avg_total_goals);
  if (!Number.isFinite(ha) || !Number.isFinite(aa)) {
    return { usable: false, type: "goals" };
  }

  const out = {
    usable: true,
    type: "goals",
    direction,
    line,
    home_matches: hm,
    away_matches: am,
    home_avg_total_goals: ha,
    away_avg_total_goals: aa
  };

  const key = `${direction}_${String(line).replace(".", "_")}`;
  if (
    hm >= 5 && am >= 5 &&
    Number.isFinite(Number(home?.[key])) &&
    Number.isFinite(Number(away?.[key]))
  ) {
    out.home_hits = Number(home[key]);
    out.away_hits = Number(away[key]);
    out.home_hit_rate = Math.round(out.home_hits / hm * 100);
    out.away_hit_rate = Math.round(out.away_hits / am * 100);
  }

  return out;
}

function buildResultEvidence(prematch) {
  const home = prematch?.recent_form?.home;
  const away = prematch?.recent_form?.away;
  const hm = Number(home?.matches || 0);
  const am = Number(away?.matches || 0);
  const st = prematch?.standings || {};
  const hp = Number(st.home_position);
  const ap = Number(st.away_position);
  const hplayed = Number(st.home_played || 0);
  const aplayed = Number(st.away_played || 0);

  const formUsable = hm >= 3 && am >= 3;
  const standingsUsable =
    Number.isFinite(hp) && Number.isFinite(ap) &&
    hplayed >= 3 && aplayed >= 3;

  if (!formUsable && !standingsUsable) {
    return { usable: false, type: "result" };
  }

  const out = { usable: true, type: "result" };
  if (formUsable) {
    out.home_form = {
      matches: hm,
      wins: Number(home?.wins || 0),
      draws: Number(home?.draws || 0),
      losses: Number(home?.losses || 0)
    };
    out.away_form = {
      matches: am,
      wins: Number(away?.wins || 0),
      draws: Number(away?.draws || 0),
      losses: Number(away?.losses || 0)
    };
  }
  if (standingsUsable) {
    out.standings = {
      home_position: hp,
      away_position: ap,
      home_played: hplayed,
      away_played: aplayed,
      home_points: Number(st.home_points),
      away_points: Number(st.away_points)
    };
  }
  return out;
}

function buildBttsEvidence(prematch) {
  const home = prematch?.recent_form?.home;
  const away = prematch?.recent_form?.away;
  const hm = Number(home?.score_samples || 0);
  const am = Number(away?.score_samples || 0);
  if (hm < 5 || am < 5) return { usable: false, type: "btts" };
  return {
    usable: true,
    type: "btts",
    home_matches: hm,
    away_matches: am,
    home_btts: Number(home?.btts || 0),
    away_btts: Number(away?.btts || 0),
    home_btts_rate: Math.round(Number(home?.btts || 0) / hm * 100),
    away_btts_rate: Math.round(Number(away?.btts || 0) / am * 100)
  };
}

function buildAnalysisEvidence(selection, prematch) {
  if (!prematch) return { usable: false, type: "none" };

  const cls = marketClass(selection);
  const market = safe(selection.market_raw);

  if (cls === "double_chance_goals") {
    const result = buildResultEvidence(prematch);
    const goals = buildGoalsEvidence(prematch, market);
    if (!result.usable || !goals.usable) {
      return { usable: false, type: "double_chance_goals" };
    }
    return { usable: true, type: "double_chance_goals", result, goals };
  }

  if (cls === "double_chance" || cls === "result") {
    return buildResultEvidence(prematch);
  }

  if (cls === "goals") {
    if (/team goals|team total|goluri echip|gol echip/i.test(market)) {
      return { usable: false, type: "team_goals" };
    }
    return buildGoalsEvidence(prematch, market);
  }

  if (cls === "btts") return buildBttsEvidence(prematch);

  if (cls === "corners" || cls === "cards") {
    return { usable: false, type: cls };
  }

  return { usable: false, type: cls || "unknown" };
}

function cleanReason(reason, evidence) {
  if (evidence?.usable !== true) return "";
  const text = safe(reason);
  if (!text || !/\d/.test(text)) return "";

  const banned = [
    /no data/i,
    /no prematch/i,
    /without form/i,
    /fără date/i,
    /fara date/i,
    /fără formă/i,
    /fara forma/i,
    /structura pieței/i,
    /structura pietei/i,
    /market structure/i,
    /low line/i,
    /linie redusă/i,
    /linie redusa/i,
    /moderate threshold/i,
    /pragul .*moderat/i,
    /balanced selection/i,
    /conservative pick/i
  ];

  return banned.some(rule => rule.test(text)) ? "" : text;
}

async function collectPrematchContext(selections) {
  if (AI_PREMATCH_MAX <= 0) return new Map();

  const unique = new Map();

  for (const s of selections) {
    if (unique.size >= AI_PREMATCH_MAX) break;
    if (!unique.has(s.match_id)) unique.set(s.match_id, s);
  }

  const jobs = [...unique.values()];
  const result = new Map();

  for (let start = 0; start < jobs.length; start += AI_PREMATCH_CONCURRENCY) {
    const batch = jobs.slice(start, start + AI_PREMATCH_CONCURRENCY);

    const rows = await Promise.all(batch.map(async (s) => {
      try {
        const { home, away } = splitCanonicalTeams(s.teams);
        if (!home || !away) return [s.match_id, null];

        const data = await fetchPrematchData({
          id: s.match_id,
          home,
          away
        });

        return [s.match_id, compactPrematch(data)];
      } catch (e) {
        console.warn(`[AI-STATS] ${s.teams}: ${e?.message || e}`);
        return [s.match_id, null];
      }
    }));

    for (const [id, context] of rows) {
      if (context) result.set(id, context);
    }
  }

  console.log(`[AI-STATS] enriched ${result.size}/${jobs.length} candidate matches`);
  return result;
}

function teamTokens(value) {
  return norm(value).split(" ").filter(token => token.length >= 3 && !["club", "football", "bucuresti"].includes(token));
}

function mentionsTeam(text, team) {
  const haystack = ` ${norm(text)} `;
  const tokens = teamTokens(team);
  if (!tokens.length) return false;
  const hits = tokens.filter(token => haystack.includes(` ${token} `)).length;
  return hits >= Math.min(2, tokens.length);
}

function dateVariants(date) {
  const match = safe(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];
  const [, year, month, day] = match;
  return [date, `${day}.${month}.${year}`, `${day}-${month}-${year}`, `${day}/${month}/${year}`];
}

async function fetchSourcePageEvidence(selection, eventDate) {
  const sourceUrl = safe(selection.source_url || selection.meta?.source_url);
  if (!/^https?:\/\//i.test(sourceUrl)) return null;

  const confidence = Number(selection.meta?.flashscore_match_confidence || 0);
  if (confidence < 0.88) return null;

  const { home, away } = splitCanonicalTeams(selection.teams);
  if (!home || !away) return null;

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PariuVerdeEvidenceBot/1.0)",
        "Accept-Language": "ro,en;q=0.8"
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);
    $("script,style,noscript,svg,nav,footer").remove();
    const title = cleanReasonText($("title").first().text()).slice(0, 180);
    const blocks = $("article p, main p, table tr, li, h1, h2, h3")
      .map((_, element) => cleanReasonText($(element).text()))
      .get()
      .filter(text => text.length >= 25 && text.length <= 900);
    const fullText = cleanReasonText($("body").text());

    const exactEvent = mentionsTeam(fullText, home) && mentionsTeam(fullText, away);
    const exactDate = dateVariants(eventDate).some(value => fullText.includes(value) || sourceUrl.includes(value));
    if (!exactEvent || !exactDate) return null;

    let excerpts = blocks.filter(text =>
      (mentionsTeam(text, home) || mentionsTeam(text, away)) && /\d/.test(text)
    ).slice(0, 5);

    if (!excerpts.length) {
      const normalizedHome = teamTokens(home)[0];
      const index = normalizedHome ? norm(fullText).indexOf(normalizedHome) : -1;
      if (index >= 0) excerpts = [fullText.slice(Math.max(0, index - 250), index + 900)];
    }

    excerpts = excerpts.map(value => value.slice(0, 700)).filter(value => /\d/.test(value));
    if (!excerpts.length) return null;

    return {
      usable: true,
      type: "verified_web_source",
      market_class: marketClass(selection),
      event_identity: {
        home,
        away,
        date: eventDate,
        flashscore_match_confidence: confidence
      },
      sources: [{
        url: sourceUrl,
        title,
        retrieved_at: new Date().toISOString(),
        excerpts
      }]
    };
  } catch (error) {
    console.warn(`[WEB-EVIDENCE] ${selection.teams}: ${error?.message || error}`);
    return null;
  }
}

function cleanReasonText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

async function addVerifiedWebFallback(pool, eventDate) {
  const missing = pool.filter(selection => selection.__analysisEvidence?.usable !== true);
  const concurrency = 4;
  let added = 0;
  for (let start = 0; start < missing.length; start += concurrency) {
    const batch = missing.slice(start, start + concurrency);
    const evidence = await Promise.all(batch.map(selection => fetchSourcePageEvidence(selection, eventDate)));
    evidence.forEach((item, index) => {
      if (!item) return;
      batch[index].__analysisEvidence = item;
      added += 1;
    });
  }
  console.log(`[WEB-EVIDENCE] verified exact-event pages=${added}/${missing.length}`);
}

function localEvidenceReason(selection, language = "ro") {
  const evidence = selection?.__analysisEvidence;
  if (evidence?.usable !== true) return "";

  const ro = language === "ro";
  const { home, away } = splitCanonicalTeams(selection.teams);
  const formText = (form, team) => ro
    ? `${team}: ${form.wins} victorii, ${form.draws} egaluri și ${form.losses} în ultimele ${form.matches} meciuri`
    : `${team}: ${form.wins} wins, ${form.draws} draws and ${form.losses} losses in the last ${form.matches} matches`;

  if (evidence.type === "goals") {
    const direction = evidence.direction === "over" ? (ro ? "peste" : "over") : (ro ? "sub" : "under");
    const hitText = Number.isFinite(evidence.home_hits) && Number.isFinite(evidence.away_hits)
      ? (ro
        ? ` Pragul a fost bifat în ${evidence.home_hits}/${evidence.home_matches}, respectiv ${evidence.away_hits}/${evidence.away_matches}.`
        : ` The line landed in ${evidence.home_hits}/${evidence.home_matches} and ${evidence.away_hits}/${evidence.away_matches}, respectively.`)
      : "";
    return ro
      ? `Meciurile recente ale lui ${home} au avut media de ${evidence.home_avg_total_goals} goluri, iar cele ale lui ${away} ${evidence.away_avg_total_goals}; cifrele susțin selecția ${direction} ${evidence.line}.${hitText}`
      : `${home}'s recent matches averaged ${evidence.home_avg_total_goals} total goals and ${away}'s ${evidence.away_avg_total_goals}; the numbers support ${direction} ${evidence.line}.${hitText}`;
  }

  if (evidence.type === "btts") {
    return ro
      ? `Ambele au avut goluri de fiecare parte în ${evidence.home_btts}/${evidence.home_matches} și ${evidence.away_btts}/${evidence.away_matches} dintre ultimele meciuri.`
      : `Both teams scored in ${evidence.home_btts}/${evidence.home_matches} and ${evidence.away_btts}/${evidence.away_matches} of their latest matches.`;
  }

  if (evidence.type === "result") {
    const parts = [];
    if (evidence.home_form && evidence.away_form) {
      parts.push(formText(evidence.home_form, home), formText(evidence.away_form, away));
    }
    if (evidence.standings) {
      parts.push(ro
        ? `în clasament sunt pe locurile ${evidence.standings.home_position} și ${evidence.standings.away_position}`
        : `their table positions are ${evidence.standings.home_position} and ${evidence.standings.away_position}`);
    }
    return parts.length ? `${parts.join("; ")}.` : "";
  }

  if (evidence.type === "double_chance_goals") {
    const resultReason = localEvidenceReason({ ...selection, __analysisEvidence: evidence.result }, language);
    const goalsReason = localEvidenceReason({ ...selection, __analysisEvidence: evidence.goals }, language);
    return [resultReason, goalsReason].filter(Boolean).join(" ");
  }

  return "";
}

function fallbackEnglish(raw) {
  let x = safe(raw);
  const reps = [
    [/șans[ăa] dubl[ăa]/gi, "Double chance"], [/ambele echipe marcheaz[ăa]/gi, "Both teams to score"],
    [/victorie gazde/gi, "Home win"], [/victorie oaspe[tț]i/gi, "Away win"], [/\begal\b/gi, "Draw"],
    [/peste/gi, "Over"], [/sub/gi, "Under"], [/goluri/gi, "goals"], [/gol/gi, "goal"],
    [/cornere/gi, "corners"], [/cartona[sș]e/gi, "cards"], [/prima repriz[ăa]/gi, "1st half"], [/\bsi\b|\bși\b/gi, "&"]
  ];
  for (const [a, b] of reps) x = x.replace(a, b);
  return x.replace(/\s+/g, " ").trim();
}

function responseText(body) {
  if (safe(body?.output_text)) return safe(body.output_text);
  for (const item of body?.output || []) for (const c of item?.content || []) if (c?.type === "output_text" && safe(c.text)) return safe(c.text);
  return "";
}

async function askAI(bundles, prematchContext = new Map()) {
  if (!OPENAI_API_KEY || !bundles.length) return null;
  const eligibleBundles = bundles.filter(b => b.cota2 || b.day);
  if (!eligibleBundles.length) return null;

  const selectionMap = new Map();
  for (const b of eligibleBundles) for (const t of [b.cota2, b.day].filter(Boolean)) for (const s of t.selections) selectionMap.set(s.__sid, s);
  const selections = [...selectionMap.entries()].map(([selection_id, s]) => ({
    selection_id,
    teams: s.teams,
    market: s.market_raw,
    odd: s.odd,
    source: s.source || "unknown",
    market_class: marketClass(s),
    evidence: s.__analysisEvidence || buildAnalysisEvidence(
      s,
      prematchContext.get(s.match_id) || null
    )
  }));
  const compactBundles = eligibleBundles.map(b => ({
    bundle_id: b.id,
    cota2_total: Number(b.cota2.product.toFixed(3)), cota2_selection_ids: b.cota2.selections.map(s => s.__sid),
    day_total: Number(b.day.product.toFixed(3)), day_selection_ids: b.day.selections.map(s => s.__sid)
  }));
  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      bundle_id: { type: "string", enum: eligibleBundles.map(b => b.id) },
      annotations: { type: "array", minItems: 1, maxItems: 6, items: {
        type: "object", additionalProperties: false,
        properties: {
          selection_id: { type: "string", enum: selections.map(s => s.selection_id) },
          label_ro: { type: "string" }, label_en: { type: "string" }, reason_ro: { type: "string" }, reason_en: { type: "string" }
        }, required: ["selection_id", "label_ro", "label_en", "reason_ro", "reason_en"]
      }}
    }, required: ["bundle_id", "annotations"]
  };
  const instructions = `You are a football betting analyst and conservative ticket curator. Choose exactly one supplied bundle.

HARD RULES:
- Never invent or modify an event, market, odd, selection_id or bundle_id.
- Use ONLY the evidence object supplied for that selection.
- Never invent form, goals, standings, H2H, cards, corners, injuries, lineups, news or motivation.

NO EVIDENCE = NO COMMENT:
- If evidence.usable is false, reason_ro MUST be "" and reason_en MUST be "".
- Do not explain why data is missing.
- Do not fill the space with generic betting commentary.

MARKET-SPECIFIC RULES:
- Goals Over/Under: primary evidence is average TOTAL goals per recent match for BOTH teams. When supplied, also use hit frequency versus the EXACT selected line. League position alone is not evidence for a goals market.
- BTTS: use BTTS frequency for BOTH teams; minimum sample is 5 recent matches for both.
- 1X2 / Double Chance: use recent W-D-L and/or standings. Recent form requires at least 3 matches for both teams; standings require at least 3 matches played.
- Double Chance + Goals: justify BOTH components. If evidence for either component is missing, output no reason.
- H2H is secondary and must never replace market-specific evidence.
- Corners: comment only when historical corner statistics are explicitly supplied.
- Cards: comment only when historical card statistics are explicitly supplied.
- Verified web source fallback: event_identity has already matched both teams and the event date. Use only numerical claims explicitly present in sources[].excerpts and relate them to market_class. Never infer a statistic that is absent from the excerpts.

QUALITY:
- Write for an informed adult audience in the tone of a concise professional match analyst.
- Every non-empty reason must contain at least two relevant concrete numbers whenever the evidence permits it.
- Compare BOTH teams; do not merely list one isolated statistic.
- First state the strongest statistical pattern, then explain why it supports the EXACT selected market.
- Distinguish supporting evidence from certainty: use "susține", "înclină" or "oferă argument", never claim that a bet is guaranteed.
- Prefer hit rates and sample sizes over vague adjectives. A percentage without its sample (for example 4/5) is incomplete.
- Avoid repeating the team names, market or odds when they add no analytical value.
- Use one or two information-dense sentences, normally 25-45 words so the complete ticket still fits a Short.
- Do not use exclamation marks, hype, sales language or beginner explanations of what the market means.

NEVER WRITE phrases equivalent to:
- "no data available"
- "without form or H2H"
- "based on market structure"
- "the line is low"
- "the threshold is moderate"
- "balanced selection"
- "conservative pick"
- "we expect an interesting match"
- "both teams will give everything"
- "anything can happen"
- "looks like a good choice"
- "this should be a safe bet"

GOOD OVER 1.5 EXAMPLE:
"Annagh's last five matches averaged 2.8 total goals and Rathfriland's 2.4, with Over 1.5 landing in 4/5 for each side. Two independent recent samples therefore support the selected line, without treating it as a certainty."

GOOD DOUBLE CHANCE EXAMPLE:
"Fenerbahce avoided defeat in 4 of their last 5 matches, while Sturm Graz lost 3 of 5. The contrast in recent W-D-L records gives a concrete basis for the double-chance protection."

LANGUAGE:
- label_ro/reason_ro: natural Romanian betting language.
- label_en/reason_en: natural English betting language with no Romanian terminology.`;
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort: "low" },
      input: [
        { role: "system", content: instructions },
        { role: "user", content: JSON.stringify({ rules: { cota2: COTA2, ticket_of_day: ZI }, selections, bundles: compactBundles }) }
      ],
      text: { format: { type: "json_schema", name: "ticket_curator", strict: true, schema } },
      max_output_tokens: 1800
    })
  });
  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const body = await r.json();
  const txt = responseText(body);
  if (!txt) throw new Error("OpenAI returned no structured output");
  return JSON.parse(txt);
}

function decorate(ticket, annotations) {
  if (!ticket) return null;
  const map = new Map((annotations || []).map(a => [safe(a.selection_id), a]));
  return {
    product: Number(ticket.product.toFixed(3)),
    selections: ticket.selections.map(s => {
      const a = map.get(s.__sid) || {};
      const out = { ...s };
      delete out.__sid;
      delete out.__analysisEvidence;
      out.ai = {
        label_ro: safe(a.label_ro) || safe(out.market_raw),
        label_en: safe(a.label_en) || fallbackEnglish(out.market_raw),
        reason_ro: cleanReason(a.reason_ro, s.__analysisEvidence) || localEvidenceReason(s, "ro"),
        reason_en: cleanReason(a.reason_en, s.__analysisEvidence) || localEvidenceReason(s, "en"),
      };
      out.analysis_evidence = s.__analysisEvidence;
      return out;
    })
  };
}

async function writeNoPicks(date, reason, poolSize = 0, extra = {}) {
  const out = { date, source: "master_pool", status: "no_picks", reason, pool_size: poolSize, bilet_cota2: null, biletul_zilei: null, ai_used: false, ...extra };
  await fs.writeFile("tickets.json", JSON.stringify(out, null, 2));
  await fs.writeFile("tickets.md", `# Tickets — ${date}\n\nStatus: no_picks\nReason: ${reason}\n`);
}

(async () => {
  try {
    const poolData = JSON.parse(await fs.readFile(POOL_FILE, "utf8"));
    const matches = getMatchesArray(JSON.parse(await fs.readFile(MATCHES_FILE, "utf8")));
    const date = poolData?.date || new Date().toISOString().slice(0, 10);
    const canonical = (poolData?.selections || []).map(s => canonicalize(s, matches)).filter(Boolean);
    const pool = preparePool(canonical);
    pool.forEach((s, i) => { s.__sid = `S${String(i + 1).padStart(3, "0")}`; });

    console.log(`[GENERATOR] canonical selections: ${canonical.length}`);
    let bundles = buildBundles(pool);
    if (!bundles.length) {
      await writeNoPicks(date, "No compatible Cota 2 or Biletul Zilei candidate after strict Flashscore matching", pool.length, {
        source_mode: poolData?.source_mode || "unknown",
        cota2_candidates: bundles.cota2Candidates || 0,
        biletul_zilei_candidates: bundles.dayCandidates || 0
      });
      console.log(`[GENERATOR] FINAL STATUS: no_picks`);
      return;
    }

    let chosen = bundles[0], annotations = [], aiUsed = false, aiError = null;
    let prematchContext = new Map();
    try {
      prematchContext = await collectPrematchContext(pool);

      for (const selection of pool) {
        selection.__analysisEvidence = buildAnalysisEvidence(
          selection,
          prematchContext.get(selection.match_id) || null
        );
      }

      await addVerifiedWebFallback(pool, date);

      // Rebuild the ticket candidates from selections that have market-specific
      // Flashscore evidence. OpenAI now curates and writes from this dossier; it
      // is no longer expected to know current football facts by itself.
      const evidencePool = pool.filter(selection => selection.__analysisEvidence?.usable === true);
      const evidenceBundles = buildBundles(evidencePool);
      console.log(`[AI-STATS] evidence-ready selections=${evidencePool.length}/${pool.length}; bundles=${evidenceBundles.length}`);
      if (evidenceBundles.length) {
        bundles = evidenceBundles;
        chosen = bundles[0];
      }

      const ai = evidenceBundles.length
        ? await askAI(bundles, prematchContext)
        : null;
      if (ai) {
        const found = bundles.find(b => b.id === ai.bundle_id);
        if (!found) throw new Error("AI selected unknown bundle");
        const allowed = new Set([...(found.cota2?.selections || []), ...(found.day?.selections || [])].map(s => s.__sid));
        annotations = (ai.annotations || []).filter(a => allowed.has(a.selection_id));
        chosen = found; aiUsed = true;
      }
    } catch (e) {
      aiError = e?.message || String(e);
      console.warn(`[AI] safe fallback: ${aiError}`);
    }

    const out = {
      date,
      source: "master_pool",
      source_mode: poolData?.source_mode || "unknown",
      status: "ok",
      reason: null,
      generation_mode: chosen.fallback_mode || bundles.mode || "strict",
      pool_size: pool.length,
      canonical_matches: canonical.length,
      cota2_candidates: bundles.cota2Candidates || 0,
      biletul_zilei_candidates: bundles.dayCandidates || 0,
      ai_used: aiUsed,
      ai_model: aiUsed ? OPENAI_MODEL : null,
      ai_error: aiError,
      analysis_source: aiUsed ? "openai_from_flashscore_evidence" : "local_from_flashscore_evidence",
      statistics_collected_at: new Date().toISOString(),
      bilet_cota2: decorate(chosen.cota2, annotations),
      biletul_zilei: decorate(chosen.day, annotations)
    };

    await fs.writeFile("tickets.json", JSON.stringify(out, null, 2));

    const md = [`# Tickets — ${date}`, `Mode: ${out.generation_mode}`, `AI: ${aiUsed ? OPENAI_MODEL : "local fallback"}`];
    if (out.bilet_cota2) {
      md.push("", `## Cota 2 — ${out.bilet_cota2.product}`);
      for (const s of out.bilet_cota2.selections) md.push(`- ${s.teams} — ${s.ai.label_ro} @ ${s.odd}`);
    }
    if (out.biletul_zilei) {
      md.push("", `## Biletul zilei — ${out.biletul_zilei.product}`);
      for (const s of out.biletul_zilei.selections) md.push(`- ${s.teams} — ${s.ai.label_ro} @ ${s.odd}`);
    }
    await fs.writeFile("tickets.md", md.join("\n"));

    console.log(`[GENERATOR] FINAL STATUS: ok mode=${out.generation_mode} cota2=${Boolean(out.bilet_cota2)} day=${Boolean(out.biletul_zilei)}`);
    console.log(`[AI] canonical=${canonical.length} pool=${pool.length} bundles=${bundles.length} ai_used=${aiUsed}`);
  } catch (e) {
    console.error("[AI] generator error:", e);
    await writeNoPicks(new Date().toISOString().slice(0, 10), `Generator exception: ${e?.message || e}`);
  }
})();
