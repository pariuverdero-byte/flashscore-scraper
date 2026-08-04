import {
  cleanInline,
  htmlToText,
  requireEnv
} from "./helpers.js";

/*
 * =========================================================
 * BASIC HELPERS
 * =========================================================
 */

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

/*
 * =========================================================
 * SAFE WORDPRESS FETCH
 * =========================================================
 */

function buildRestRouteFallback(
  originalUrl
) {
  const parsed =
    new URL(
      originalUrl
    );

  const marker =
    "/wp-json/";

  const markerIndex =
    parsed.pathname.indexOf(
      marker
    );

  if (markerIndex < 0) {
    return null;
  }

  const route =
    "/" +
    parsed.pathname
      .slice(
        markerIndex +
        marker.length
      )
      .replace(
        /^\/+/,
        ""
      );

  const fallback =
    new URL(
      parsed.origin
    );

  fallback.pathname =
    "/";

  fallback.searchParams.set(
    "rest_route",
    route
  );

  for (
    const [
      key,
      value
    ] of
    parsed.searchParams.entries()
  ) {
    fallback.searchParams.append(
      key,
      value
    );
  }

  return fallback.toString();
}

function mergeWordPressHeaders(
  headers = {}
) {
  return {
    Accept:
      "application/json",

    "User-Agent":
      "Mozilla/5.0 (compatible; PariuVerde-GitHubActions/1.0)",

    "Cache-Control":
      "no-cache",

    Pragma:
      "no-cache",

    ...headers
  };
}

async function executeWordPressRequest(
  url,
  options = {}
) {
  const response =
    await fetch(
      url,
      {
        ...options,

        redirect:
          "follow",

        headers:
          mergeWordPressHeaders(
            options.headers
          )
      }
    );

  const text =
    await response.text();

  let data = null;
  let isJson = false;

  if (text) {
    try {
      data =
        JSON.parse(
          text
        );

      /*
       * Some WordPress/security/cache layers return
       * JSON that is encoded as a JSON string.
       *
       * Example:
       * "[{\"id\":709,\"slug\":\"generate-video\"}]"
       *
       * Parse nested JSON strings safely, up to three levels.
       */
      for (
        let level = 0;
        level < 3;
        level += 1
      ) {
        if (
          typeof data !== "string"
        ) {
          break;
        }

        const trimmed =
          data.trim();

        if (
          !trimmed ||
          !(
            trimmed.startsWith("[") ||
            trimmed.startsWith("{")
          )
        ) {
          break;
        }

        data =
          JSON.parse(
            trimmed
          );
      }

      isJson =
        typeof data !== "string";
    } catch {
      data = text;
      isJson = false;
    }
  } else {
    isJson = true;
  }

  return {
    response,
    text,
    data,
    isJson
  };
}

async function wpFetch(
  url,
  options = {}
) {
  const attempts = [
    {
      label:
        "standard REST URL",

      url
    }
  ];

  const fallbackUrl =
    buildRestRouteFallback(
      url
    );

  if (
    fallbackUrl &&
    fallbackUrl !== url
  ) {
    attempts.push({
      label:
        "rest_route fallback",

      url:
        fallbackUrl
    });
  }

  let lastError = null;

  for (
    let index = 0;
    index < attempts.length;
    index += 1
  ) {
    const attempt =
      attempts[index];

    console.log(
      `[OCCASIONAL] WordPress request via ${attempt.label}: ${attempt.url}`
    );

    const {
      response,
      data,
      isJson
    } =
      await executeWordPressRequest(
        attempt.url,
        options
      );

    if (
      response.ok &&
      isJson
    ) {
      const shape =
        Array.isArray(data)
          ? `array(${data.length})`
          : data &&
            typeof data === "object"
            ? "object"
            : typeof data;

      console.log(
        `[OCCASIONAL] WordPress JSON payload shape: ${shape}`
      );

      return data;
    }

    const preview =
      responsePreview(
        typeof data === "string"
          ? data
          : JSON.stringify(data)
      );

    if (!response.ok) {
      lastError =
        new Error(
          `WordPress API ${response.status} ${response.statusText}: ${preview}`
        );
    } else {
      lastError =
        new Error(
          `WordPress REST API returned non-JSON content: ${preview}`
        );
    }

    const hasAnotherAttempt =
      index <
      attempts.length - 1;

    if (hasAnotherAttempt) {
      console.warn(
        `[OCCASIONAL] ${attempt.label} failed. Trying REST route fallback.`
      );
    }
  }

  throw lastError ||
    new Error(
      "WordPress REST API request failed."
    );
}

/*
 * =========================================================
 * TAXONOMY HELPERS
 * =========================================================
 */

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

function postTermSlugs({
  post,
  taxonomy,
  maps
}) {
  const ids =
    taxonomy === "category"
      ? post?.categories
      : post?.tags;

  const slugs =
    [];

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
      slugs.push(slug);
    }
  }

  return [
    ...new Set(slugs)
  ];
}

/*
 * =========================================================
 * TAG MANAGEMENT
 * =========================================================
 */

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
      method:
        "POST",

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

/*
 * =========================================================
 * POST NORMALIZATION
 * =========================================================
 */

function normalizePost({
  post,
  tagMaps,
  categoryMaps,
  matchedBy
}) {
  const title =
    cleanInline(
      post.title?.raw ||
      post.title?.rendered ||
      ""
    );

  const tagSlugs =
    postTermSlugs({
      post,
      taxonomy:
        "post_tag",
      maps:
        tagMaps
    });

  const categorySlugs =
    postTermSlugs({
      post,
      taxonomy:
        "category",
      maps:
        categoryMaps
    });

  const featured =
    post?._embedded?.[
      "wp:featuredmedia"
    ]?.[0]?.source_url ||
    null;

  return {
    id:
      post.id,

    date:
      post.date,

    modified:
      post.modified,

    slug:
      post.slug,

    status:
      post.status,

    link:
      post.link,

    title,

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

    tagSlugs,
    categorySlugs,
    matchedBy,
    featuredImage:
      featured
  };
}

/*
 * =========================================================
 * DIRECT POST LOOKUP
 * =========================================================
 */

async function fetchExplicitPost({
  siteUrl,
  headers,
  postId,
  queueTagId,
  doneTagId,
  tagMaps,
  categoryMaps,
  maximumAgeDays
}) {
  const post =
    await wpFetch(
      `${siteUrl}/wp-json/wp/v2/posts/${postId}` +
      "?context=edit&_embed=1",
      { headers }
    );

  const tags =
    Array.isArray(post?.tags)
      ? post.tags.map(Number)
      : [];

  const hasQueueTag =
    tags.includes(
      Number(queueTagId)
    );

  const hasDoneTag =
    tags.includes(
      Number(doneTagId)
    );

  const withinAgeLimit =
    isWithinAgeLimit(
      post,
      maximumAgeDays
    );

  if (
    post?.status !== "publish"
  ) {
    throw new Error(
      `Explicit WordPress post ${postId} is not published.`
    );
  }

  if (hasDoneTag) {
    throw new Error(
      `Explicit WordPress post ${postId} already has the done tag.`
    );
  }

  if (!withinAgeLimit) {
    throw new Error(
      `Explicit WordPress post ${postId} is older than the configured age limit.`
    );
  }

  console.log(
    `[OCCASIONAL] Explicit post ${postId}: ` +
    `queue=${hasQueueTag}, done=${hasDoneTag}`
  );

  return normalizePost({
    post,
    tagMaps,
    categoryMaps,
    matchedBy:
      hasQueueTag
        ? "explicit_post_id_with_queue_tag"
        : "explicit_post_id"
  });
}

/*
 * =========================================================
 * NATIVE TAG QUERY
 * =========================================================
 */

async function fetchPostsByTag({
  siteUrl,
  headers,
  tagId,
  postLimit
}) {
  return wpFetch(
    `${siteUrl}/wp-json/wp/v2/posts` +
    "?status=publish" +
    `&tags=${encodeURIComponent(tagId)}` +
    `&per_page=${encodeURIComponent(postLimit)}` +
    "&orderby=date&order=asc" +
    "&context=edit&_embed=1",
    { headers }
  );
}

/*
 * =========================================================
 * OPTIONAL CATEGORY FALLBACK
 * =========================================================
 */

async function fetchPostsByCategory({
  siteUrl,
  headers,
  categoryId,
  postLimit
}) {
  return wpFetch(
    `${siteUrl}/wp-json/wp/v2/posts` +
    "?status=publish" +
    `&categories=${encodeURIComponent(categoryId)}` +
    `&per_page=${encodeURIComponent(postLimit)}` +
    "&orderby=date&order=asc" +
    "&context=edit&_embed=1",
    { headers }
  );
}

/*
 * =========================================================
 * FETCH NEXT ARTICLE
 * =========================================================
 */

export async function fetchNextArticle({
  siteUrl,
  user,
  appPassword,
  queueTagId,
  doneTagId,
  queueTagSlug,
  doneTagSlug,
  explicitPostId = null,
  categoryFallbackSlug = "",
  allowCategoryFallback = false,
  postLimit = 20,
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
        20
      )
    );

  const safeMaximumAgeDays =
    parsePositiveInteger(
      maximumAgeDays,
      30
    );

  const [
    tags,
    categories
  ] =
    await Promise.all([
      fetchTerms({
        siteUrl,
        headers,
        taxonomy:
          "post_tag"
      }),

      fetchTerms({
        siteUrl,
        headers,
        taxonomy:
          "category"
      })
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

  const queueTerm =
    tagMaps.byId.get(
      Number(queueTagId)
    ) ||
    tagMaps.bySlug.get(
      queueSlug
    );

  const doneTerm =
    tagMaps.byId.get(
      Number(doneTagId)
    ) ||
    tagMaps.bySlug.get(
      doneSlug
    );

  if (!queueTerm?.id) {
    throw new Error(
      `Queue tag "${queueSlug}" could not be resolved.`
    );
  }

  if (!doneTerm?.id) {
    throw new Error(
      `Done tag "${doneSlug}" could not be resolved.`
    );
  }

  if (
    explicitPostId !== null &&
    explicitPostId !== undefined &&
    String(explicitPostId).trim() !== ""
  ) {
    const parsedPostId =
      parsePositiveInteger(
        explicitPostId,
        0
      );

    if (!parsedPostId) {
      throw new Error(
        `Invalid OCCASIONAL_POST_ID: ${explicitPostId}`
      );
    }

    const explicitPost =
      await fetchExplicitPost({
        siteUrl,
        headers,
        postId:
          parsedPostId,
        queueTagId:
          queueTerm.id,
        doneTagId:
          doneTerm.id,
        tagMaps,
        categoryMaps,
        maximumAgeDays:
          safeMaximumAgeDays
      });

    return {
      post:
        explicitPost,

      source:
        "explicit_post_id",

      diagnostics: {
        queueTagId:
          queueTerm.id,
        doneTagId:
          doneTerm.id,
        explicitPostId:
          parsedPostId
      }
    };
  }

  /*
   * Primary and safest path:
   * ask WordPress itself for posts with the queue tag.
   */
  const queuedPosts =
    await fetchPostsByTag({
      siteUrl,
      headers,
      tagId:
        queueTerm.id,
      postLimit:
        safePostLimit
    });

  console.log(
    `[OCCASIONAL] Native WordPress tag query returned ` +
    `${Array.isArray(queuedPosts) ? queuedPosts.length : 0} post(s).`
  );

  const validQueuedPosts =
    (Array.isArray(queuedPosts)
      ? queuedPosts
      : []
    ).filter(
      (post) => {
        const tagIds =
          Array.isArray(post?.tags)
            ? post.tags.map(Number)
            : [];

        const hasDoneTag =
          tagIds.includes(
            Number(doneTerm.id)
          );

        const withinAgeLimit =
          isWithinAgeLimit(
            post,
            safeMaximumAgeDays
          );

        console.log(
          `[OCCASIONAL] Native candidate ${post.id}: ` +
          `${cleanInline(post.title?.raw || post.title?.rendered || "")} | ` +
          `done=${hasDoneTag} | withinAgeLimit=${withinAgeLimit}`
        );

        return (
          !hasDoneTag &&
          withinAgeLimit
        );
      }
    );

  if (validQueuedPosts.length > 0) {
    const selected =
      validQueuedPosts[0];

    return {
      post:
        normalizePost({
          post:
            selected,
          tagMaps,
          categoryMaps,
          matchedBy:
            "native_queue_tag_query"
        }),

      source:
        "native_queue_tag_query",

      diagnostics: {
        queueTagId:
          queueTerm.id,
        doneTagId:
          doneTerm.id,
        queuedPostCount:
          queuedPosts.length,
        validQueuedPostCount:
          validQueuedPosts.length
      }
    };
  }

  /*
   * Optional fallback.
   * Disabled by default because it can process an article
   * without an explicit queue tag.
   */
  if (
    allowCategoryFallback &&
    normalizeSlug(
      categoryFallbackSlug
    )
  ) {
    const fallbackSlug =
      normalizeSlug(
        categoryFallbackSlug
      );

    const categoryTerm =
      categoryMaps.bySlug.get(
        fallbackSlug
      );

    if (!categoryTerm?.id) {
      console.warn(
        `[OCCASIONAL] Fallback category "${fallbackSlug}" was not found.`
      );
    } else {
      const categoryPosts =
        await fetchPostsByCategory({
          siteUrl,
          headers,
          categoryId:
            categoryTerm.id,
          postLimit:
            safePostLimit
        });

      const validCategoryPosts =
        (Array.isArray(categoryPosts)
          ? categoryPosts
          : []
        ).filter(
          (post) => {
            const tagIds =
              Array.isArray(post?.tags)
                ? post.tags.map(Number)
                : [];

            const hasDoneTag =
              tagIds.includes(
                Number(doneTerm.id)
              );

            return (
              !hasDoneTag &&
              isWithinAgeLimit(
                post,
                safeMaximumAgeDays
              )
            );
          }
        );

      if (validCategoryPosts.length === 1) {
        const selected =
          validCategoryPosts[0];

        console.warn(
          `[OCCASIONAL] Using safe category fallback for post ${selected.id}.`
        );

        return {
          post:
            normalizePost({
              post:
                selected,
              tagMaps,
              categoryMaps,
              matchedBy:
                "single_post_category_fallback"
            }),

          source:
            "single_post_category_fallback",

          diagnostics: {
            queueTagId:
              queueTerm.id,
            doneTagId:
              doneTerm.id,
            fallbackCategoryId:
              categoryTerm.id,
            fallbackCandidateCount:
              1
          }
        };
      }

      console.warn(
        `[OCCASIONAL] Category fallback found ${validCategoryPosts.length} ` +
        "eligible posts. For safety, fallback runs only when exactly one post is eligible."
      );
    }
  }

  return {
    post:
      null,

    source:
      "none",

    diagnostics: {
      queueTagId:
        queueTerm.id,
      doneTagId:
        doneTerm.id,
      queuedPostCount:
        Array.isArray(queuedPosts)
          ? queuedPosts.length
          : 0,
      message:
        "WordPress returned no eligible published posts for the queue tag."
    }
  };
}

/*
 * =========================================================
 * UPDATE ARTICLE AFTER YOUTUBE UPLOAD
 * =========================================================
 */

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

  const existingTags =
    Array.isArray(post.tags)
      ? post.tags
          .map(Number)
          .filter(Number.isFinite)
      : [];

  const tags = [
    ...new Set([
      ...existingTags.filter(
        (id) =>
          id !== Number(queueTagId)
      ),
      Number(doneTagId)
    ])
  ].filter(Number.isFinite);

  return wpFetch(
    `${siteUrl}/wp-json/wp/v2/posts/${post.id}`,
    {
      method:
        "POST",

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

/*
 * =========================================================
 * CREDENTIALS
 * =========================================================
 */

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
