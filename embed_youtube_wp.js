import fs from "fs/promises";
import fetch from "node-fetch";

const { WP_URL, WP_USER, WP_APP_PASS } = process.env;
const LANG = String(process.env.LANG || "ro").toLowerCase();

if (!WP_URL || !WP_USER || !WP_APP_PASS) {
  throw new Error("Missing WP_URL / WP_USER / WP_APP_PASS");
}

const apiBase = `${String(WP_URL).trim().replace(/\/+$/, "").replace(/\/wp-json(?:\/wp\/v2)?$/i, "")}/wp-json/wp/v2`;
const authorization = `Basic ${Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64")}`;

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function youtubeBlock(url, ticket) {
  const title = LANG === "ro"
    ? (ticket === "cota-2" ? "Analiza video – Bilet Cota 2" : "Analiza video – Biletul Zilei")
    : (ticket === "cota-2" ? "Video analysis – Odds 2 Ticket" : "Video analysis – Bet of the Day");
  return `<!-- pv-ticket-youtube:start -->
<section class="pv-ticket-video">
<h2>${title}</h2>
<!-- wp:embed {"url":"${url}","type":"video","providerNameSlug":"youtube","responsive":true,"className":"wp-embed-aspect-9-16 wp-has-aspect-ratio"} -->
<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube wp-embed-aspect-9-16 wp-has-aspect-ratio"><div class="wp-block-embed__wrapper">
${url}
</div></figure>
<!-- /wp:embed -->
</section>
<!-- pv-ticket-youtube:end -->`;
}

function addOrReplaceEmbed(content, block) {
  const marker = /<!-- pv-ticket-youtube:start -->[\s\S]*?<!-- pv-ticket-youtube:end -->/i;
  if (marker.test(content)) return content.replace(marker, block);
  const more = "<!--more-->";
  if (content.includes(more)) return content.replace(more, `${more}\n${block}`);
  return `${block}\n${content}`;
}

async function updatePost(postId, content) {
  const endpoint = `${apiBase}/posts/${postId}`;
  let response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json",
      "User-Agent": "PariuVerdeVideoEmbedder/1.0",
    },
    body: JSON.stringify({ content }),
  });
  let body = await response.text();
  if (!response.ok && response.status === 400 && /<html|openresty/i.test(body)) {
    const form = new URLSearchParams({ content });
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        Accept: "application/json",
        "User-Agent": "PariuVerdeVideoEmbedder/1.0",
      },
      body: form.toString(),
    });
    body = await response.text();
  }
  if (!response.ok) throw new Error(`WordPress update HTTP ${response.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body);
}

const published = await readJson("published_posts.json");
const posts = Array.isArray(published) ? published : published.posts || [];
const mapping = {
  bilet_cota2: "cota-2",
  biletul_zilei: "biletul-zilei",
};
let updated = 0;

for (const [ticketType, ticket] of Object.entries(mapping)) {
  const post = posts.find(item => item.ticket === ticket && item.success && item.id);
  if (!post) {
    console.log(`[WP-EMBED] ${ticketType}: no newly published WordPress post`);
    continue;
  }
  const distribution = await readJson(`output/${ticketType}/distribution_results.json`);
  const youtubeUrl = distribution?.youtube?.url;
  if (distribution?.status !== "success" || !/^https:\/\/www\.youtube\.com\/watch\?v=/i.test(youtubeUrl || "")) {
    console.log(`[WP-EMBED] ${ticketType}: no successful YouTube URL`);
    continue;
  }

  const currentResponse = await fetch(`${apiBase}/posts/${post.id}?context=edit`, {
    headers: { Authorization: authorization, Accept: "application/json" },
  });
  if (!currentResponse.ok) throw new Error(`Cannot read WordPress post ${post.id}: HTTP ${currentResponse.status}`);
  const current = await currentResponse.json();
  const sourceContent = current?.content?.raw || current?.content?.rendered || "";
  const result = await updatePost(post.id, addOrReplaceEmbed(sourceContent, youtubeBlock(youtubeUrl, ticket)));
  console.log(`[WP-EMBED] ${ticketType}: embedded ${youtubeUrl} in ${result.link || `post ${post.id}`}`);
  updated += 1;
}

console.log(`[WP-EMBED] completed: ${updated} article(s) updated`);
