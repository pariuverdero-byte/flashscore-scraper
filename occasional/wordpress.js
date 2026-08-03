import { cleanInline, htmlToText, requireEnv } from "./helpers.js";

function authHeader(user, appPassword) {
  return `Basic ${Buffer.from(`${user}:${appPassword}`).toString("base64")}`;
}

async function wpFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    throw new Error(`WordPress API ${response.status} ${response.statusText}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

export async function ensureTag({ siteUrl, user, appPassword, slug, name }) {
  const headers = { Authorization: authHeader(user, appPassword) };
  const existing = await wpFetch(
    `${siteUrl}/wp-json/wp/v2/tags?slug=${encodeURIComponent(slug)}&per_page=100`,
    { headers }
  );
  if (Array.isArray(existing) && existing[0]?.id) return existing[0];

  return wpFetch(`${siteUrl}/wp-json/wp/v2/tags`, {
    method: "POST",
    headers: {
      Authorization: authHeader(user, appPassword),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name, slug })
  });
}

export async function fetchNextArticle({ siteUrl, user, appPassword, queueTagId, doneTagId }) {
  const headers = { Authorization: authHeader(user, appPassword) };
  const posts = await wpFetch(
    `${siteUrl}/wp-json/wp/v2/posts?status=publish&tags=${queueTagId}&per_page=10&orderby=date&order=asc&context=edit&_embed=1`,
    { headers }
  );

  const post = (Array.isArray(posts) ? posts : []).find(
    item => !Array.isArray(item.tags) || !item.tags.includes(doneTagId)
  );

  if (!post) return null;

  const featured = post?._embedded?.["wp:featuredmedia"]?.[0]?.source_url || null;

  return {
    id: post.id,
    date: post.date,
    modified: post.modified,
    slug: post.slug,
    status: post.status,
    link: post.link,
    title: cleanInline(post.title?.raw || post.title?.rendered || ""),
    excerpt: htmlToText(post.excerpt?.raw || post.excerpt?.rendered || ""),
    contentHtml: post.content?.raw || post.content?.rendered || "",
    contentText: htmlToText(post.content?.raw || post.content?.rendered || ""),
    tags: Array.isArray(post.tags) ? post.tags : [],
    featuredImage: featured
  };
}

export async function updateArticleAfterUpload({
  siteUrl,
  user,
  appPassword,
  post,
  queueTagId,
  doneTagId,
  youtubeUrl
}) {
  const marker = "<!-- occasional-video-embed -->";
  let content = String(post.contentHtml || "").trim();

  if (!content.includes(marker) && !content.includes(youtubeUrl)) {
    const embed = [
      marker,
      `<!-- wp:embed {"url":"${youtubeUrl}","type":"video","providerNameSlug":"youtube","responsive":true} -->`,
      '<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube">',
      '<div class="wp-block-embed__wrapper">',
      youtubeUrl,
      "</div>",
      "</figure>",
      "<!-- /wp:embed -->"
    ].join("\n");

    const firstParagraphEnd = content.search(/<\/p>/i);
    content = firstParagraphEnd >= 0
      ? `${content.slice(0, firstParagraphEnd + 4)}\n\n${embed}\n\n${content.slice(firstParagraphEnd + 4)}`
      : `${embed}\n\n${content}`;
  }

  const tags = [...new Set([...(post.tags || []).filter(id => id !== queueTagId), doneTagId])];

  return wpFetch(`${siteUrl}/wp-json/wp/v2/posts/${post.id}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(user, appPassword),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content, tags })
  });
}

export function getWordPressCredentials() {
  return {
    user: requireEnv("WP_USER"),
    appPassword: requireEnv("WP_APP_PASS")
  };
}
