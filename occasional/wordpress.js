import {
  cleanInline,
  htmlToText,
  requireEnv
} from "./helpers.js";

function authHeader(user, appPassword) {
  return (
    "Basic " +
    Buffer.from(
      `${user}:${appPassword}`
    ).toString("base64")
  );
}

function preview(value, max = 500) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function parseNestedJson(text) {
  if (!text) {
    return null;
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    return text;
  }

  for (let level = 0; level < 3; level += 1) {
    if (typeof data !== "string") {
      break;
    }

    const trimmed = data.trim();

    if (
      !trimmed.startsWith("[") &&
      !trimmed.startsWith("{")
    ) {
      break;
    }

    try {
      data = JSON.parse(trimmed);
    } catch {
      break;
    }
  }

  return data;
}

async function wpFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: "follow",
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (compatible; OccasionalVideoEngine/3.0)",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const data = parseNestedJson(text);

  if (!response.ok) {
    throw new Error(
      `WordPress API ${response.status} ${response.statusText}: ` +
      preview(
        typeof data === "string"
          ? data
          : JSON.stringify(data)
      )
    );
  }

  if (
    text &&
    typeof data === "string"
  ) {
    throw new Error(
      "WordPress REST API returned non-JSON content: " +
      preview(data)
    );
  }

  return data;
}

function normalizePost(post) {
  const featured =
    post?._embedded?.["wp:featuredmedia"]?.[0]?.source_url ||
    null;

  return {
    id: Number(post.id),
    date: post.date,
    modified: post.modified,
    slug: post.slug,
    status: post.status,
    link: post.link,

    title: cleanInline(
      post.title?.raw ||
      post.title?.rendered ||
      ""
    ),

    excerpt: htmlToText(
      post.excerpt?.raw ||
      post.excerpt?.rendered ||
      ""
    ),

    contentHtml:
      post.content?.raw ||
      post.content?.rendered ||
      "",

    contentText: htmlToText(
      post.content?.raw ||
      post.content?.rendered ||
      ""
    ),

    tags: Array.isArray(post.tags)
      ? post.tags.map(Number)
      : [],

    featuredImage: featured
  };
}

export async function fetchQueuedPosts({
  siteUrl,
  user,
  appPassword,
  queueTagId,
  doneTagId,
  limit = 1,
  explicitPostId = null
}) {
  const headers = {
    Authorization:
      authHeader(user, appPassword)
  };

  if (explicitPostId) {
    const post = await wpFetch(
      `${siteUrl}/wp-json/wp/v2/posts/${explicitPostId}` +
      "?context=edit&_embed=1",
      { headers }
    );

    const normalized = normalizePost(post);

    if (normalized.status !== "publish") {
      throw new Error(
        `Post ${explicitPostId} is not published.`
      );
    }

    if (
      normalized.tags.includes(
        Number(doneTagId)
      )
    ) {
      console.log(
        `[OCCASIONAL] Post ${explicitPostId} already has done tag ${doneTagId}.`
      );

      return [];
    }

    return [normalized];
  }

  const safeLimit = Math.max(
    1,
    Math.min(
      100,
      Number(limit) || 1
    )
  );

  const url =
    `${siteUrl}/wp-json/wp/v2/posts` +
    "?status=publish" +
    `&tags=${encodeURIComponent(queueTagId)}` +
    `&per_page=${safeLimit}` +
    "&orderby=date" +
    "&order=asc" +
    "&context=edit" +
    "&_embed=1";

  console.log(
    `[OCCASIONAL] Queue query: ${url}`
  );

  const posts = await wpFetch(
    url,
    { headers }
  );

  const normalized = (
    Array.isArray(posts)
      ? posts
      : []
  )
    .map(normalizePost)
    .filter(
      (post) =>
        !post.tags.includes(
          Number(doneTagId)
        )
    );

  console.log(
    `[OCCASIONAL] Eligible queued posts: ${normalized.length}`
  );

  return normalized;
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
  const marker =
    "<!-- occasional-video-embed -->";

  let content =
    String(
      post.contentHtml ||
      ""
    ).trim();

  if (
    !content.includes(marker) &&
    !content.includes(youtubeUrl)
  ) {
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

    const firstParagraphEnd =
      content.search(
        /<\/p>/i
      );

    content =
      firstParagraphEnd >= 0
        ? (
            content.slice(
              0,
              firstParagraphEnd + 4
            ) +
            "\n\n" +
            embed +
            "\n\n" +
            content.slice(
              firstParagraphEnd + 4
            )
          )
        : `${embed}\n\n${content}`;
  }

  const tags = [
    ...new Set([
      ...post.tags.filter(
        (id) =>
          Number(id) !==
          Number(queueTagId)
      ),

      Number(doneTagId)
    ])
  ].filter(
    Number.isFinite
  );

  console.log(
    `[OCCASIONAL] Updating WordPress post ${post.id}.`
  );

  console.log(
    `[OCCASIONAL] Removing queue tag ${queueTagId}; adding done tag ${doneTagId}.`
  );

  return wpFetch(
    `${siteUrl}/wp-json/wp/v2/posts/${post.id}`,
    {
      method: "POST",

      headers: {
        Authorization:
          authHeader(
            user,
            appPassword
          ),

        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify({
          content,
          tags
        })
    }
  );
}

export function getWordPressCredentials() {
  return {
    user:
      requireEnv(
        "WP_USER"
      ),

    appPassword:
      requireEnv(
        "WP_APP_PASS"
      )
  };
}
