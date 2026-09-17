// One-time repair for the September posts published before the market fix.
import path from "node:path";
import { fileURLToPath } from "node:url";
const POSTS = new Map([
  [3483, "daily-ticket-2026-09-16-cota-2"],
  [3487, "daily-ticket-2026-09-17-cota-2"],
]);

export function repairMarketText(value) {
  return String(value || "").replace(/goal marcat (?:în|in) ambele reprize/gi, "Goal scored in both halves");
}

async function main() {
  const { WP_URL, WP_USER, WP_APP_PASS } = process.env;
  if (!WP_URL || !WP_USER || !WP_APP_PASS) throw new Error("WP_URL, WP_USER and WP_APP_PASS are required");
  const site = new URL(WP_URL);
  if (site.hostname !== "greenbettips.com" || site.protocol !== "https:") {
    throw new Error("This repair is restricted to https://greenbettips.com");
  }
  const auth = `Basic ${Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64")}`;
  for (const [id, slug] of POSTS) {
    const endpoint = new URL(`/wp-json/wp/v2/posts/${id}`, site);
    endpoint.searchParams.set("context", "edit");
    const response = await fetch(endpoint, { headers: { Authorization: auth } });
    if (!response.ok) throw new Error(`Could not read post ${id}: HTTP ${response.status}`);
    const post = await response.json();
    if (post.slug !== slug || post.status !== "publish") throw new Error(`Unexpected post at ID ${id}`);
    const title = repairMarketText(post.title?.raw);
    const content = repairMarketText(post.content?.raw);
    if (title === post.title?.raw && content === post.content?.raw) {
      console.log(`Post ${id} already correct`);
      continue;
    }
    if (!post.title?.raw || !post.content?.raw) throw new Error(`Raw post fields unavailable for ${id}`);
    const update = await fetch(new URL(`/wp-json/wp/v2/posts/${id}`, site), {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });
    if (!update.ok) throw new Error(`Could not update post ${id}: HTTP ${update.status}`);
    console.log(`Repaired ${id}: ${post.link}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
