import { ensureSchema, getSql } from "@/lib/db";
import { getConfig, saveConfig } from "@/lib/store";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

async function applyProposal(id: number, status: "approved" | "auto_approved") {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT proposed_config FROM algorithm_proposals WHERE id = ${id} AND status = 'pending' LIMIT 1`;
  if (!rows.length) return false;
  const proposed = rows[0].proposed_config as { minLiveConfidence?: number };
  const config = await getConfig();
  if (typeof proposed.minLiveConfidence === "number") config.minLiveConfidence = clamp(proposed.minLiveConfidence, 65, 90);
  await saveConfig(config);
  await sql`UPDATE algorithm_proposals SET status = ${status}, decided_at = NOW() WHERE id = ${id} AND status = 'pending'`;
  return true;
}

export async function decideProposal(id: number, action: "approve" | "reject") {
  if (action === "approve") return applyProposal(id, "approved");
  await ensureSchema();
  const result = await getSql()`UPDATE algorithm_proposals SET status = 'rejected', decided_at = NOW() WHERE id = ${id} AND status = 'pending' RETURNING id`;
  return result.length > 0;
}

export async function applyDueProposals() {
  await ensureSchema();
  const config = await getConfig();
  if (!config.algorithmAutopilot) return { applied: 0, autopilot: false };
  const rows = await getSql()`SELECT id FROM algorithm_proposals WHERE status = 'pending' AND auto_apply_at <= NOW() ORDER BY created_at`;
  let applied = 0;
  for (const row of rows) if (await applyProposal(Number(row.id), "auto_approved")) applied += 1;
  return { applied, autopilot: true };
}

export async function runMonthlyReview(now = new Date()) {
  await ensureSchema();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  const sql = getSql();
  const buckets = await sql`
    SELECT market_text,
      CASE WHEN confidence < 75 THEN '0-74' WHEN confidence < 80 THEN '75-79' WHEN confidence < 85 THEN '80-84' ELSE '85-99' END AS confidence_bucket,
      COUNT(*)::int AS bets,
      COUNT(*) FILTER (WHERE profit > 0)::int AS wins,
      COALESCE(SUM(stake), 0)::float AS stake,
      COALESCE(SUM(profit), 0)::float AS profit
    FROM bet_transactions
    WHERE kind = 'live' AND status = 'settled' AND submitted_at >= ${start.toISOString()} AND submitted_at < ${end.toISOString()}
    GROUP BY market_text, confidence_bucket ORDER BY market_text, confidence_bucket`;
  const sampleSize = buckets.reduce((sum, row) => sum + Number(row.bets), 0);
  const recommendations = buckets.map((row) => ({
    market: row.market_text,
    confidenceBucket: row.confidence_bucket,
    bets: Number(row.bets),
    winRate: Number(row.bets) ? Number(row.wins) / Number(row.bets) : 0,
    roi: Number(row.stake) ? Number(row.profit) / Number(row.stake) : 0,
    action: Number(row.bets) < 20 ? "insufficient_sample" : Number(row.profit) > 0 ? "retain_or_expand_validation" : "review_thresholds",
  }));
  const reviewRows = await sql`INSERT INTO algorithm_reviews (period_start, period_end, sample_size, metrics, recommendations)
    VALUES (${start.toISOString().slice(0, 10)}, ${end.toISOString().slice(0, 10)}, ${sampleSize}, ${JSON.stringify(buckets)}::jsonb, ${JSON.stringify(recommendations)}::jsonb)
    ON CONFLICT (period_start, period_end) DO UPDATE SET sample_size = EXCLUDED.sample_size, metrics = EXCLUDED.metrics, recommendations = EXCLUDED.recommendations, created_at = NOW() RETURNING id`;
  const config = await getConfig();
  if (sampleSize >= 20 && reviewRows[0]?.id) {
    const reliable = recommendations.filter((item) => item.bets >= 20);
    const positive = reliable.filter((item) => item.roi > 0).sort((a, b) => Number(a.confidenceBucket.split("-")[0]) - Number(b.confidenceBucket.split("-")[0]));
    const proposedThreshold = clamp(positive.length ? Number(positive[0].confidenceBucket.split("-")[0]) : config.minLiveConfidence + 3, 65, 90);
    if (Math.abs(proposedThreshold - config.minLiveConfidence) >= 1) {
      const autoApplyAt = new Date(Date.now() + config.approvalWindowDays * 86400000).toISOString();
      await sql`INSERT INTO algorithm_proposals (review_id, proposed_config, rationale, auto_apply_at)
        SELECT ${Number(reviewRows[0].id)}, ${JSON.stringify({ minLiveConfidence: proposedThreshold })}::jsonb, ${positive.length ? "Lowest confidence bucket with positive ROI and sufficient sample" : "No positive-ROI confidence bucket with sufficient sample; tighten threshold"}, ${autoApplyAt}
        WHERE NOT EXISTS (SELECT 1 FROM algorithm_proposals WHERE review_id = ${Number(reviewRows[0].id)} AND status = 'pending')`;
    }
  }
  return { periodStart: start.toISOString(), periodEnd: end.toISOString(), sampleSize, recommendations };
}
