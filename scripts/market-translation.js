// Keep market labels consistent across the site, post titles and Shorts.
const romanianWords = /\b(?:ambele|repriz[ae]|marcat[ei]?|peste|goluri|cornere|cartonase|sansa|dubla|victorie|gazde|oaspeti|pauza|meci|echipe|prima|egal|minim|interval)\b/i;

function plain(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function translate(raw) {
  const value = String(raw || "").trim();
  const normalized = plain(value);
  if (/\b(?:gol|goal)(?:uri|s)?\s+marcat[ei]?\s+(?:in\s+)?ambele\s+reprize\b/.test(normalized)) {
    return "Goal scored in both halves";
  }
  if (/\bambele\s+echipe\s+marcheaza\b/.test(normalized)) {
    return `Both teams to score${/\bnu\b/.test(normalized) ? " – No" : ""}`;
  }
  let match = normalized.match(/(.+?)\s+minim\s+(\d+)\s+goluri/);
  if (match) return `${match[1].replace(/^./, c => c.toUpperCase())} to score at least ${match[2]} goals`;
  match = normalized.match(/interval\s+(\d+)\s*-\s*(\d+)/);
  if (match) return `Total goals${normalized.includes("prima repriz") ? " 1st half" : ""}: ${match[1]}–${match[2]}`;
  const replacements = [
    [/șans[ăa] dubl[ăa]/gi, "Double chance"], [/victorie gazde/gi, "Home win"],
    [/victorie oaspe[tț]i/gi, "Away win"], [/\begal\b/gi, "Draw"],
    [/peste/gi, "Over"], [/\bsub\b/gi, "Under"], [/goluri/gi, "goals"],
    [/\bgol\b/gi, "goal"], [/cornere/gi, "corners"],
    [/cartona[sș]e/gi, "cards"], [/prima repriz[ăa]/gi, "1st half"],
    [/\bsi\b|\bși\b/gi, "&"], [/pauz[ăa]/gi, "Half-time"],
    [/\bfinal\b/gi, "Full-time"]
  ];
  let result = value;
  for (const [pattern, replacement] of replacements) result = result.replace(pattern, replacement);
  return result.replace(/\s+/g, " ").trim();
}

export function englishMarketLabel(label, raw) {
  const candidate = String(label || "").trim();
  if (candidate && !romanianWords.test(plain(candidate))) return candidate;
  if (candidate) {
    const repaired = translate(candidate);
    if (!romanianWords.test(plain(repaired))) return repaired;
  }
  const translated = translate(raw || candidate);
  if (romanianWords.test(plain(translated))) {
    throw new Error(`Untranslated English market label: ${raw || candidate}`);
  }
  return translated || "Special bet";
}
