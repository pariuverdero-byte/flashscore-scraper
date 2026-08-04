import { clamp, round } from './utils.js';

export function calculatePressure(match, previous = null) {
  const h = match.stats?.home || {};
  const a = match.stats?.away || {};
  const totalShots = (h.shots || 0) + (a.shots || 0);
  const totalSot = (h.shotsOnTarget || 0) + (a.shotsOnTarget || 0);
  const totalCorners = (h.corners || 0) + (a.corners || 0);
  const totalXg = (h.xg || 0) + (a.xg || 0);
  const box = (h.shotsInBox || 0) + (a.shotsInBox || 0);
  const big = (h.bigChances || 0) + (a.bigChances || 0);

  let momentum = 0;
  if (previous && Number(match.minute) > Number(previous.minute)) {
    const ph = previous.stats?.home || {};
    const pa = previous.stats?.away || {};
    const dShots = totalShots - ((ph.shots || 0) + (pa.shots || 0));
    const dSot = totalSot - ((ph.shotsOnTarget || 0) + (pa.shotsOnTarget || 0));
    const dCorners = totalCorners - ((ph.corners || 0) + (pa.corners || 0));
    momentum = clamp(dShots * 2 + dSot * 5 + dCorners * 3, 0, 25);
  }

  const intensity = clamp(
    totalShots * 1.7 + totalSot * 4.5 + totalCorners * 2.2 + totalXg * 10 + box * 1.1 + big * 4 + momentum,
    0,
    100,
  );

  const homeRaw = (h.shots || 0) * 1.5 + (h.shotsOnTarget || 0) * 4 + (h.corners || 0) * 2 + (h.xg || 0) * 10 + (h.bigChances || 0) * 4;
  const awayRaw = (a.shots || 0) * 1.5 + (a.shotsOnTarget || 0) * 4 + (a.corners || 0) * 2 + (a.xg || 0) * 10 + (a.bigChances || 0) * 4;
  const sum = homeRaw + awayRaw || 1;

  return {
    intensity: round(intensity, 0),
    momentum: round(momentum, 0),
    homeShare: round((homeRaw / sum) * 100, 0),
    awayShare: round((awayRaw / sum) * 100, 0),
    totals: { shots: totalShots, shotsOnTarget: totalSot, corners: totalCorners, xg: round(totalXg, 2) },
  };
}
