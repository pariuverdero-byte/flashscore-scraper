import path from "path";

import {
  getSiteConfig
} from "./config.js";

import {
  ensureDir,
  normalizeRate,
  readJson,
  requireFile,
  run,
  selectDeterministic,
  writeJson
} from "./helpers.js";

import {
  ensureTag,
  fetchNextArticle,
  getWordPressCredentials,
  updateArticleAfterUpload
} from "./wordpress.js";

import {
  prepareArticle
} from "./prepare_article.js";

import {
  renderArticleVideo
} from "./render_article_video.js";

import {
  buildManifest
} from "./build_manifest.js";

/*
 * =========================================================
 * HELPERS
 * =========================================================
 */

function parseBoolean(
  value,
  fallback = false
) {
  const normalized =
    String(
      value ?? ""
    )
      .trim()
      .toLowerCase();

  if (
    ["1", "true", "yes", "on"].includes(normalized)
  ) {
    return true;
  }

  if (
    ["0", "false", "no", "off"].includes(normalized)
  ) {
    return false;
  }

  return fallback;
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

/*
 * =========================================================
 * MAIN
 * =========================================================
 */

async function main() {
  const site =
    getSiteConfig(
      process.env.OCCASIONAL_SITE_KEY
    );

  const outputRoot =
    process.env.OCCASIONAL_OUTPUT_ROOT ||
    "output/occasional";

  const dryRun =
    parseBoolean(
      process.env.OCCASIONAL_DRY_RUN,
      false
    );

  const queueSlug =
    String(
      process.env.OCCASIONAL_QUEUE_TAG ||
      "generate-video"
    ).trim();

  const doneSlug =
    String(
      process.env.OCCASIONAL_DONE_TAG ||
      "video-published"
    ).trim();

  const explicitPostId =
    String(
      process.env.OCCASIONAL_POST_ID ||
      ""
    ).trim();

  const categoryFallbackSlug =
    String(
      process.env.OCCASIONAL_CATEGORY_FALLBACK ||
      "ocazional"
    ).trim();

  const allowCategoryFallback =
    parseBoolean(
      process.env.OCCASIONAL_ALLOW_CATEGORY_FALLBACK,
      false
    );

  const postLimit =
    parsePositiveInteger(
      process.env.OCCASIONAL_POST_SCAN_LIMIT,
      20
    );

  const maximumAgeDays =
    parsePositiveInteger(
      process.env.OCCASIONAL_MAX_POST_AGE_DAYS,
      30
    );

  const {
    user,
    appPassword
  } =
    getWordPressCredentials();

  console.log(
    `[OCCASIONAL] Site: ${site.key}`
  );

  console.log(
    `[OCCASIONAL] WordPress: ${site.siteUrl}`
  );

  console.log(
    `[OCCASIONAL] Dry run: ${dryRun}`
  );

  console.log(
    `[OCCASIONAL] Queue tag: ${queueSlug}`
  );

  console.log(
    `[OCCASIONAL] Done tag: ${doneSlug}`
  );

  console.log(
    `[OCCASIONAL] Maximum article age: ${maximumAgeDays} days`
  );

  console.log(
    `[OCCASIONAL] Explicit post ID: ${explicitPostId || "none"}`
  );

  console.log(
    `[OCCASIONAL] Category fallback enabled: ${allowCategoryFallback}`
  );

  if (allowCategoryFallback) {
    console.log(
      `[OCCASIONAL] Category fallback slug: ${categoryFallbackSlug}`
    );
  }

  /*
   * Ensure both operational tags exist.
   */
  const queueTag =
    await ensureTag({
      siteUrl:
        site.siteUrl,

      user,
      appPassword,

      slug:
        queueSlug,

      name:
        "Generate Video"
    });

  const doneTag =
    await ensureTag({
      siteUrl:
        site.siteUrl,

      user,
      appPassword,

      slug:
        doneSlug,

      name:
        "Video Published"
    });

  console.log(
    `[OCCASIONAL] Queue tag ID: ${queueTag.id}`
  );

  console.log(
    `[OCCASIONAL] Done tag ID: ${doneTag.id}`
  );

  /*
   * Native WordPress query.
   */
  const lookup =
    await fetchNextArticle({
      siteUrl:
        site.siteUrl,

      user,
      appPassword,

      queueTagId:
        queueTag.id,

      doneTagId:
        doneTag.id,

      queueTagSlug:
        queueSlug,

      doneTagSlug:
        doneSlug,

      explicitPostId:
        explicitPostId || null,

      categoryFallbackSlug,
      allowCategoryFallback,
      postLimit,
      maximumAgeDays
    });

  const post =
    lookup.post;

  if (!post) {
    console.log(
      `[OCCASIONAL] No eligible article found for ${site.key}.`
    );

    console.log(
      "[OCCASIONAL] WordPress native tag query returned no queued published posts."
    );

    console.log(
      `[OCCASIONAL] Confirm that the post REST response contains tag ID ${queueTag.id}.`
    );

    console.log(
      "[OCCASIONAL] In Gutenberg, type generate-video, press Enter, then click Update."
    );

    ensureDir(
      outputRoot
    );

    writeJson(
      path.join(
        outputRoot,
        `${site.key}-status.json`
      ),
      {
        status:
          "nothing_to_process",

        checkedAt:
          new Date().toISOString(),

        site:
          site.key,

        queueTag:
          queueSlug,

        queueTagId:
          queueTag.id,

        doneTag:
          doneSlug,

        doneTagId:
          doneTag.id,

        explicitPostId:
          explicitPostId || null,

        allowCategoryFallback,

        categoryFallbackSlug:
          allowCategoryFallback
            ? categoryFallbackSlug
            : null,

        lookupSource:
          lookup.source,

        diagnostics:
          lookup.diagnostics
      }
    );

    return;
  }

  console.log(
    `[OCCASIONAL] Processing post ${post.id}: ${post.title}`
  );

  console.log(
    `[OCCASIONAL] Article matched by: ${post.matchedBy}`
  );

  console.log(
    `[OCCASIONAL] Article tags: ${post.tagSlugs.join(", ") || "none"}`
  );

  console.log(
    `[OCCASIONAL] Article categories: ${post.categorySlugs.join(", ") || "none"}`
  );

  /*
   * Build article files.
   */
  const article =
    prepareArticle({
      post,
      site,
      outputRoot
    });

  /*
   * Deterministic presenter selection.
   */
  const presenterFile =
    process.env.SHORTS_PRESENTER_FILE ||
    selectDeterministic(
      site.presenterFiles,
      `${site.key}|${post.id}|${post.modified}`
    );

  requireFile(
    presenterFile
  );

  console.log(
    `[OCCASIONAL] Presenter: ${presenterFile}`
  );

  /*
   * Generate speech and subtitles.
   */
  run(
    "edge-tts",
    [
      "--voice",
      process.env.SHORTS_TTS_VOICE ||
      site.ttsVoice,

      `--rate=${normalizeRate(
        process.env.SHORTS_TTS_RATE ||
        site.ttsRate
      )}`,

      "--volume=+0%",

      "--file",
      article.files.scriptFile,

      "--write-media",
      article.files.voiceFile,

      "--write-subtitles",
      article.files.subtitlesFile
    ]
  );

  /*
   * Render vertical video.
   */
  renderArticleVideo({
    presenterFile,

    voiceFile:
      article.files.voiceFile,

    subtitlesFile:
      article.files.subtitlesFile,

    titleFile:
      article.files.titleFile,

    websiteFile:
      article.files.websiteFile,

    videoFile:
      article.files.videoFile
  });

  /*
   * Build social distribution manifest.
   */
  buildManifest({
    article
  });

  if (dryRun) {
    console.log(
      "[OCCASIONAL] Dry run complete. YouTube upload and WordPress update skipped."
    );

    return;
  }

  /*
   * Upload to YouTube.
   */
  run(
    "node",
    [
      "publish/platforms/youtube.js"
    ],
    {
      env: {
        DISTRIBUTION_MANIFEST_FILE:
          article.files.manifestFile,

        DISTRIBUTION_RESULTS_FILE:
          article.files.resultsFile
      }
    }
  );

  const results =
    readJson(
      article.files.resultsFile
    );

  if (
    results.status !== "success" ||
    !results.youtube?.url
  ) {
    throw new Error(
      "YouTube upload did not return a successful result."
    );
  }

  /*
   * Update WordPress only after successful YouTube upload.
   */
  await updateArticleAfterUpload({
    siteUrl:
      site.siteUrl,

    user,
    appPassword,

    post,

    queueTagId:
      queueTag.id,

    doneTagId:
      doneTag.id,

    youtubeUrl:
      results.youtube.url
  });

  console.log(
    `[OCCASIONAL] WordPress article updated with ${results.youtube.url}`
  );

  console.log(
    `[OCCASIONAL] Completed successfully for post ${post.id}.`
  );
}

/*
 * =========================================================
 * START
 * =========================================================
 */

main().catch(
  (error) => {
    console.error(
      "[OCCASIONAL] Failed:"
    );

    console.error(
      error
    );

    process.exit(1);
  }
);
