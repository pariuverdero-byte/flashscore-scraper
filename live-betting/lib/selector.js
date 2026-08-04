import { LIVE_CONFIG } from '../config/live.config.js';

function competitionScore(match) {
  if (LIVE_CONFIG.competitionDenylist.some((pattern) => pattern.test(`${match.country} ${match.competition}`))) return -1000;
  const text = `${match.country} ${match.competition}`.toLowerCase();
  if (/premier league|la liga|serie a|bundesliga|ligue 1|champions league|europa league/.test(text)) return 15;
  if (/division|league|liga|cup|super/i.test(text)) return 9;
  return 4;
}

export function scoreMatch(match) {
  let score = 0;
  if (match.status === 'live') score += LIVE_CONFIG.selectionWeights.live;
  if (Number(match.minute) >= 12 && Number(match.minute) <= 75) score += LIVE_CONFIG.selectionWeights.minuteWindow;
  score += competitionScore(match);
  if (match.statsAvailable) score += LIVE_CONFIG.selectionWeights.statsAvailable;
  if (match.preMatchScore) score += Math.min(10, Number(match.preMatchScore));
  return score;
}

export function selectMatches(matches, limit = LIVE_CONFIG.maxMatches) {
  return matches
    .map((match) => ({ ...match, selectionScore: scoreMatch(match) }))
    .filter((match) => match.selectionScore >= 0)
    .sort((a, b) => b.selectionScore - a.selectionScore || String(a.id).localeCompare(String(b.id)))
    .slice(0, limit);
}
