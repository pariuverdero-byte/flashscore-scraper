import fs from "fs/promises";
import { matchEventToFlashscore } from "./engine/matcher_core.js";

const POOL_FILE = "master_pool.json";
const MATCHES_FILE = "matches.json";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";

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

function buildBundles(pool) {
  const c2 = enumerate(pool, 2, 2, COTA2.min, COTA2.max, COTA2.target, 25);
  const day = enumerate(pool, ZI.minSize, ZI.maxSize, ZI.min, ZI.max, ZI.target, 40);
  const bundles = [];
  for (const a of c2) {
    const aIds = new Set(a.selections.map(s => s.match_id));
    for (const b of day) {
      if (b.selections.some(s => aIds.has(s.match_id))) continue;
      bundles.push({ id: `B${String(bundles.length + 1).padStart(3, "0")}`, cota2: a, day: b, score: a.score + b.score });
      if (bundles.length >= 120) break;
    }
    if (bundles.length >= 120) break;
  }
  bundles.sort((a, b) => b.score - a.score);
  return bundles.slice(0, 80);
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

async function askAI(bundles) {
  if (!OPENAI_API_KEY || !bundles.length) return null;
  const selectionMap = new Map();
  for (const b of bundles) for (const t of [b.cota2, b.day]) for (const s of t.selections) selectionMap.set(s.__sid, s);
  const selections = [...selectionMap.entries()].map(([selection_id, s]) => ({
    selection_id, teams: s.teams, market: s.market_raw, odd: s.odd, source: s.source || "unknown", market_class: marketClass(s)
  }));
  const compactBundles = bundles.map(b => ({
    bundle_id: b.id,
    cota2_total: Number(b.cota2.product.toFixed(3)), cota2_selection_ids: b.cota2.selections.map(s => s.__sid),
    day_total: Number(b.day.product.toFixed(3)), day_selection_ids: b.day.selections.map(s => s.__sid)
  }));
  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      bundle_id: { type: "string", enum: bundles.map(b => b.id) },
      annotations: { type: "array", minItems: 1, maxItems: 6, items: {
        type: "object", additionalProperties: false,
        properties: {
          selection_id: { type: "string", enum: selections.map(s => s.selection_id) },
          label_ro: { type: "string" }, label_en: { type: "string" }, reason_ro: { type: "string" }, reason_en: { type: "string" }
        }, required: ["selection_id", "label_ro", "label_en", "reason_ro", "reason_en"]
      }}
    }, required: ["bundle_id", "annotations"]
  };
  const instructions = `You are a conservative football-ticket curator. Choose exactly one supplied bundle. Never invent or modify event, market, odd, selection_id or bundle_id. Prefer sensible diversity when it already exists: double chance + goals, double chance, corners, cards, BTTS, totals, then plain 1X2. Keep Odds 2 conservative and the day ticket balanced. Produce natural Romanian and English labels; English must contain no Romanian words. Reasons must be max 16 words and may ONLY discuss the supplied market structure, odds and diversification. Do not invent form, standings, H2H, injuries, lineups, statistics, motivation, news or external facts.`;
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
  const map = new Map((annotations || []).map(a => [safe(a.selection_id), a]));
  return {
    product: Number(ticket.product.toFixed(3)),
    selections: ticket.selections.map(s => {
      const a = map.get(s.__sid) || {};
      const out = { ...s };
      delete out.__sid;
      out.ai = {
        label_ro: safe(a.label_ro) || safe(out.market_raw),
        label_en: safe(a.label_en) || fallbackEnglish(out.market_raw),
        reason_ro: safe(a.reason_ro),
        reason_en: safe(a.reason_en),
      };
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
    const bundles = buildBundles(pool);
    if (!bundles.length) {
      await writeNoPicks(date, "No compatible ticket bundle after strict Flashscore matching", pool.length, { source_mode: poolData?.source_mode || "unknown" });
      console.log(`[AI] no bundles; canonical=${canonical.length}, pool=${pool.length}`);
      return;
    }
    let chosen = bundles[0], annotations = [], aiUsed = false, aiError = null;
    try {
      const ai = await askAI(bundles);
      if (ai) {
        const found = bundles.find(b => b.id === ai.bundle_id);
        if (!found) throw new Error("AI selected unknown bundle");
        const allowed = new Set([...found.cota2.selections, ...found.day.selections].map(s => s.__sid));
        annotations = (ai.annotations || []).filter(a => allowed.has(a.selection_id));
        chosen = found; aiUsed = true;
      }
    } catch (e) {
      aiError = e?.message || String(e);
      console.warn(`[AI] safe fallback: ${aiError}`);
    }
    const out = {
      date, source: "master_pool", source_mode: poolData?.source_mode || "unknown", status: "ok", reason: null,
      pool_size: pool.length, canonical_matches: canonical.length, ai_used: aiUsed, ai_model: aiUsed ? OPENAI_MODEL : null, ai_error: aiError,
      bilet_cota2: decorate(chosen.cota2, annotations), biletul_zilei: decorate(chosen.day, annotations)
    };
    await fs.writeFile("tickets.json", JSON.stringify(out, null, 2));
    const md = [`# Tickets — ${date}`, `AI: ${aiUsed ? OPENAI_MODEL : "local fallback"}`, "", `## Cota 2 — ${out.bilet_cota2.product}`];
    for (const s of out.bilet_cota2.selections) md.push(`- ${s.teams} — ${s.ai.label_ro} @ ${s.odd}`);
    md.push("", `## Biletul zilei — ${out.biletul_zilei.product}`);
    for (const s of out.biletul_zilei.selections) md.push(`- ${s.teams} — ${s.ai.label_ro} @ ${s.odd}`);
    await fs.writeFile("tickets.md", md.join("\n"));
    console.log(`[AI] canonical=${canonical.length} pool=${pool.length} bundles=${bundles.length} ai_used=${aiUsed}`);
  } catch (e) {
    console.error("[AI] generator error:", e);
    await writeNoPicks(new Date().toISOString().slice(0, 10), `Generator exception: ${e?.message || e}`);
  }
})();
