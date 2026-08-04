import fs from 'fs/promises';

const feedPath = process.env.LIVE_FEED_FILE || 'live-betting/data/live_feed.json';
const targets = [
  { url: process.env.PV_LIVE_ENDPOINT, token: process.env.PV_LIVE_TOKEN },
  { url: process.env.GBT_LIVE_ENDPOINT, token: process.env.GBT_LIVE_TOKEN },
].filter((target) => target.url && target.token);

if (!targets.length) throw new Error('No live WordPress endpoint configured.');
const body = await fs.readFile(feedPath, 'utf8');
for (const target of targets) {
  const response = await fetch(target.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PV-Live-Token': target.token },
    body,
  });
  if (!response.ok) throw new Error(`${target.url}: HTTP ${response.status} ${await response.text()}`);
  console.log(`[publish] ${target.url}: OK`);
}
