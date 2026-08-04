import {
  cleanInline,
  htmlToText,
  requireEnv
} from "./helpers.js";

function authHeader(
  user,
  appPassword
) {
  return `Basic ${Buffer.from(
    `${user}:${appPassword}`
  ).toString("base64")}`;
}

function normalizeSlug(
  value
) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function responsePreview(
  value,
  maximum = 500
) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

async function wpFetch(
  url,
  options = {}
) {
  const response =
    await fetch(
      url,
      options
    );

  const text =
    await response.text();

  const contentType =
    String(
      response.headers.get(
        "content-type"
      ) || ""
    ).toLowerCase();

  let data = null;

  if (text) {
    try {
      data =
        JSON.parse(
          text
        );
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw new Error(
      `WordPress API ${response.status} ${response.statusText}: ` +
      responsePreview(
        typeof data === "string"
          ? data
          : JSON.stringify(data)
      )
    );
  }

  if (
    text &&
    !contentType.includes(
      "application/json"
    ) &&
    typeof data === "string"
  ) {
    throw new Error(
      "WordPress REST API returned non-JSON content: " +
      responsePreview(data)
    );
  }

  return data;
}

async function fetchTerms({
  siteUrl,
  headers,
  taxonomy
}) {
  const endpoint =
    taxonomy === "category"
      ? "categories"
      : "tags";

  const terms = [];
  let page = 1;

  while (page <= 10) {
    const url =
      `${siteUrl}/wp-json/wp/v2/${endpoint}` +
      `?per_page=100&page=${page}&hide_empty=false`;

    let batch;

    try {
      batch =
        await wpFetch(
          url,
          { headers }
        );
    } catch (error) {
      if (
        /rest_post_invalid_page_number|invalid page/i.test(
          String(error?.message || error)
        )
      ) {
        break;
      }

      throw error;
    }

    if (
      !Array.isArray(batch) ||
      batch.length === 0
    ) {
      break;
    }

    terms.push(
      ...batch
    );

    if (batch.length < 100) {
      break;
    }

    page += 1;
  }

  return terms;
}

function buildTermMaps(
  terms
) {
  const byId =
    new Map();

  const bySlug =
    new Map();

  for (const term of terms) {
    const id =
      Number(term?.id);

    const slug =
      normalizeSlug(
        term?.slug ||
        term?.name
      );

    if (
      Number.isFinite(id)
    ) {
      byId.set(
        id,
        term
      );
    }

    if (slug) {
      bySlug.set(
        slug,
        term
      );
    }
  }

  return {
    byId,
    bySlug
  };
}

function getEmbeddedTerms(
  post,
  taxonomy
) {
  const groups =
    post?._embedded?.[
      "wp:term"
    ];

  if (!Array.isArray(groups)) {
    return [];
  }

  return groups
    .flat()
    .filter(
      (term) =>
        term?.taxonomy === taxonomy
    );
}

function postTermSlugs({
  post,
  taxonomy,
  maps
}) {
  const embedded =
    getEmbeddedTerms(
      post,
      taxonomy
    );

  const slugs =
    new Set(
      embedded
        .map(
          (term) =>
            normalizeSlug(
              term?.slug ||
              term?.name
            )
        )
        .filter(Boolean)
    );

  const ids =
    taxonomy === "category"
      ? post?.categories
      : post?.tags;

  for (
    const id of
    Array.isArray(ids)
      ? ids
      : []
  ) {
    const term =
      maps.byId.get(
        Number(id)
      );

    const slug =
      normalizeSlug(
        term?.slug ||
        term?.name
      );

    if (slug) {
      slugs.add(slug);
    }
  }

  return [
    ...slugs
  ];
}

function parsePositiveInteger(
  value,
  fallback
) {
  const parsed =
    Number.parseInt(
      String(value || ""),
      10
    );

  return Number.isFinite(parsed) &&
    parsed > 0
    ? parsed
    : fallback;
}

function isWithinAgeLimit(
  post,
  maximumAgeDays
) {
  if (
    !Number.isFinite(maximumAgeDays) ||
    maximumAgeDays <= 0
  ) {
    return true;
  }

  const date =
    new Date(
      post?.date_gmt
        ? `${post.date_gmt}Z`
        : post?.date
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return false;
  }

  const maximumAgeMs =
    maximumAgeDays *
    24 *
    60 *
    60 *
    1000;

  return (
    Date.now() -
    date.getTime()
  ) <= maximumAgeMs;
}

export async function ensureTag({
  siteUrl,
  user,
  appPassword,
  slug,
  name
}) {
  const headers = {
    Authorization:
      authHeader(
        user,
        appPassword
      )
  };

  const normalizedSlug =
    normalizeSlug(slug);

  const existing =
    await wpFetch(
      `${siteUrl}/wp-json/wp/v2/tags` +
      `?slug=${encodeURIComponent(normalizedSlug)}` +
      "&per_page=100&hide_empty=false",
      { headers }
    );

  const exact =
    Array.isArray(existing)
      ? existing.find(
          (item) =>
            normalizeSlug(
              item?.slug
            ) === normalizedSlug
        )
      : null;

  if (exact?.id) {
    return exact;
  }

  return wpFetch(
    `${siteUrl}/wp-json/wp/v2/tags`,
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
          name,
          slug:
            normalizedSlug
        })
    }
  );
}

export async function fetchNextArticle({
  siteUrl,
  user,
  appPassword,
  queueTagSlug,
  doneTagSlug,
  categoryFallbackSlug = "",
  allowCategoryFallback = false,
  postLimit = 50,
  maximumAgeDays = 30
}) {
  const headers = {
    Authorization:
      authHeader(
        user,
        appPassword
      )
  };

  const safePostLimit =
    Math.min(
      100,
      parsePositiveInteger(
        postLimit,
        50
      )
    );

  const safeMaximumAgeDays =
    parsePositiveInteger(
      maximumAgeDays,
      30
    );

  const [
    tags,
    categories,
    posts
  ] =
    await Promise.all([
      fetchTerms({
        siteUrl,
        headers,
        taxonomy: "post_tag"
      }),
      fetchTerms({
        siteUrl,
        headers,
        taxonomy: "category"
      }),
      wpFetch(
        `${siteUrl}/wp-json/wp/v2/posts` +
        "?status=publish" +
        `&per_page=${safePostLimit}` +
        "&orderby=date&order=desc" +
        "&context=edit&_embed=1",
        { headers }
      )
    ]);

  const tagMaps =
    buildTermMaps(tags);

  const categoryMaps =
    buildTermMaps(categories);

  const queueSlug =
    normalizeSlug(
      queueTagSlug
    );

  const doneSlug =
    normalizeSlug(
      doneTagSlug
    );

  const fallbackSlug =
    normalizeSlug(
      categoryFallbackSlug
    );

  const diagnostics = [];
  const candidates = [];

  for (
    const post of
    Array.isArray(posts)
      ? posts
      : []
  ) {
    const tagSlugs =
      postTermSlugs({
        post,
        taxonomy: "post_tag",
        maps: tagMaps
      });

    const categorySlugs =
      postTermSlugs({
        post,
        taxonomy: "category",
        maps: categoryMaps
      });

    const hasQueueTag =
      tagSlugs.includes(
        queueSlug
      );

    const hasDoneTag =
      tagSlugs.includes(
        doneSlug
      );

    const matchesFallbackCategory =
      Boolean(
        allowCategoryFallback &&
        fallbackSlug &&
        categorySlugs.includes(
          fallbackSlug
        )
      );

    const withinAgeLimit =
      isWithinAgeLimit(
        post,
        safeMaximumAgeDays
      );

    const title =
      cleanInline(
        post.title?.raw ||
        post.title?.rendered ||
        ""
      );

    diagnostics.push({
      id: post.id,
      title,
      date:
        post.date || null,
      tags:
        tagSlugs,
      categories:
        categorySlugs,
      hasQueueTag,
      hasDoneTag,
      matchesFallbackCategory,
      withinAgeLimit
    });

    if (
      !withinAgeLimit ||
      hasDoneTag ||
      (
        !hasQueueTag &&
        !matchesFallbackCategory
      )
    ) {
      continue;
    }

    candidates.push({
      post,
      title,
      tagSlugs,
      categorySlugs,
      matchedBy:
        hasQueueTag
          ? "queue_tag"
          : "category_fallback"
    });
  }

  console.log(
    `[OCCASIONAL] Inspected ${diagnostics.length} recent published posts.`
  );

  for (
    const item of
    diagnostics.slice(0, 15)
  ) {
    console.log(
      `[OCCASIONAL] Post ${item.id}: ` +
      `${item.title || "(untitled)"} | ` +
      `tags=[${item.tags.join(", ") || "none"}] | ` +
      `categories=[${item.categories.join(", ") || "none"}] | ` +
      `queue=${item.hasQueueTag} | ` +
      `done=${item.hasDoneTag}`
    );
  }

  if (candidates.length === 0) {
    return {
      post: null,
      diagnostics,
      queueTagFound:
        tagMaps.bySlug.has(
          queueSlug
        ),
      doneTagFound:
        tagMaps.bySlug.has(
          doneSlug
        )
    };
  }

  /*
   * Process the oldest valid queued article first.
   * This preserves queue order and prevents newer posts
   * from starving older explicitly tagged posts.
   */
  candidates.sort(
    (left, right) =>
      new Date(
        left.post.date
      ).getTime() -
      new Date(
        right.post.date
      ).getTime()
  );

  const selected =
    candidates[0];

  const post =
    selected.post;

  const featured =
    post?._embedded?.[
      "wp:featuredmedia"
    ]?.[0]?.source_url ||
    null;

  return {
    post: {
      id: post.id,
      date: post.date,
      modified: post.modified,
      slug: post.slug,
      status: post.status,
      link: post.link,
      title:
        selected.title,
      excerpt:
        htmlToText(
          post.excerpt?.raw ||
          post.excerpt?.rendered ||
          ""
        ),
      contentHtml:
        post.content?.raw ||
        post.content?.rendered ||
        "",
      contentText:
        htmlToText(
          post.content?.raw ||
          post.content?.rendered ||
          ""
        ),
      tags:
        Array.isArray(post.tags)
          ? post.tags
          : [],
      tagSlugs:
        selected.tagSlugs,
      categorySlugs:
        selected.categorySlugs,
      matchedBy:
        selected.matchedBy,
      featuredImage:
        featured
    },
    diagnostics,
    queueTagFound:
      tagMaps.bySlug.has(
        queueSlug
      ),
    doneTagFound:
      tagMaps.bySlug.has(
        doneSlug
      )
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
        ? `${content.slice(0, firstParagraphEnd + 4)}\n\n${embed}\n\n${content.slice(firstParagraphEnd + 4)}`
        : `${embed}\n\n${content}`;
  }

  const tags = [
    ...new Set([
      ...(post.tags || [])
        .map(Number)
        .filter(
          (id) =>
            Number.isFinite(id) &&
            id !== Number(queueTagId)
        ),
      Number(doneTagId)
    ])
  ].filter(Number.isFinite);

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
