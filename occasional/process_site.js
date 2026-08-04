import path from "path";

import {
  getSiteConfig
} from "./config.js";

import {
  ensureDir,
  hashString,
  normalizeRate,
  readJson,
  requireFile,
  run,
  selectDeterministic,
  writeJson
} from "./helpers.js";

import {
  fetchQueuedPosts,
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

function parseBoolean(value, fallback = false) {
  const normalized =
    String(value ?? "")
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

function positiveInteger(value, fallback) {
  const parsed =
    Number.parseInt(
      String(value ?? ""),
      10
    );

  return Number.isFinite(parsed) &&
    parsed > 0
    ? parsed
    : fallback;
}

function signedRate(
  baseRate,
  adjustment
) {
  const match =
    String(baseRate || "+0%")
      .trim()
      .match(
        /^([+-]?)(\d+)%$/
      );

  const base =
    match
      ? (
          (
            match[1] === "-"
              ? -1
              : 1
          ) *
          Number(
            match[2]
          )
        )
      : 0;

  const value =
    Math.max(
      -15,
      Math.min(
        20,
        base +
        adjustment
      )
    );

  return value >= 0
    ? `+${value}%`
    : `${value}%`;
}

function buildVariation(
  site,
  post
) {
  const seed =
    hashString(
      `${site.key}|${post.id}|${post.modified}`
    );

  const zoomOptions = [
    1.02,
    1.04,
    1.06
  ];

  const xOptions = [
    -18,
    0,
    18
  ];

  const yOptions = [
    -12,
    0,
    14
  ];

  const rateAdjustments = [
    -2,
    0,
    2
  ];

  return {
    zoom:
      zoomOptions[
        seed %
        zoomOptions.length
      ],

    offsetX:
      xOptions[
        (
          seed >>> 3
        ) %
        xOptions.length
      ],

    offsetY:
      yOptions[
        (
          seed >>> 6
        ) %
        yOptions.length
      ],

    mirror:
      (
        (
          seed >>> 9
        ) %
        5
      ) === 0,

    presetIndex:
      (
        seed >>> 12
      ) %
      6,

    ttsRate:
      signedRate(
        process.env.SHORTS_TTS_RATE ||
        site.ttsRate,
        rateAdjustments[
          (
            seed >>> 15
          ) %
          rateAdjustments.length
        ]
      )
  };
}

function sleep(milliseconds) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

async function uploadYouTubeWithRetry({
  manifestFile,
  resultsFile
}) {
  const maximumAttempts =
    positiveInteger(
      process.env.OCCASIONAL_YOUTUBE_RETRY_ATTEMPTS,
      3
    );

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= maximumAttempts;
    attempt += 1
  ) {
    try {
      console.log(
        `[OCCASIONAL] YouTube upload attempt ${attempt}/${maximumAttempts}`
      );

      run(
        "node",
        [
          "publish/platforms/youtube.js"
        ],
        {
          env: {
            DISTRIBUTION_MANIFEST_FILE:
              manifestFile,

            DISTRIBUTION_RESULTS_FILE:
              resultsFile
          }
        }
      );

      const results =
        readJson(
          resultsFile
        );

      if (
        results.status === "success" &&
        results.youtube?.url
      ) {
        return results;
      }

      throw new Error(
        results.youtube?.error ||
        "YouTube upload did not return a successful result."
      );
    } catch (error) {
      lastError = error;

      if (attempt >= maximumAttempts) {
        break;
      }

      const waitSeconds =
        20 *
        Math.pow(
          2,
          attempt - 1
        );

      console.warn(
        `[OCCASIONAL] Upload failed. Retrying in ${waitSeconds} seconds.`
      );

      await sleep(
        waitSeconds *
        1000
      );
    }
  }

  throw lastError ||
    new Error(
      "YouTube upload failed."
    );
}

async function processPost({
  site,
  post,
  outputRoot,
  dryRun,
  user,
  appPassword
}) {
  console.log("");
  console.log(
    `[OCCASIONAL] Processing post ${post.id}: ${post.title}`
  );

  const article =
    prepareArticle({
      post,
      site,
      outputRoot
    });

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

  const variation =
    buildVariation(
      site,
      post
    );

  console.log(
    `[OCCASIONAL] TTS rate: ${variation.ttsRate}`
  );

  run(
    "edge-tts",
    [
      "--voice",
      process.env.SHORTS_TTS_VOICE ||
      site.ttsVoice,

      `--rate=${normalizeRate(
        variation.ttsRate
      )}`,

      "--volume=+0%",

      "--file",
      article.files.scriptFile,

      "--write-media",
      article.files.voiceFile
    ]
  );

  renderArticleVideo({
    presenterFile,

    voiceFile:
      article.files.voiceFile,

    titleFile:
      article.files.titleFile,

    websiteFile:
      article.files.websiteFile,

    videoFile:
      article.files.videoFile,

    variation
  });

  buildManifest({
    article
  });

  if (dryRun) {
    console.log(
      `[OCCASIONAL] Dry run complete for post ${post.id}.`
    );

    return {
      postId:
        post.id,

      title:
        post.title,

      status:
        "dry_run_ready",

      videoFile:
        article.files.videoFile,

      wordpressUrl:
        post.link
    };
  }

  const uploadResults =
    await uploadYouTubeWithRetry({
      manifestFile:
        article.files.manifestFile,

      resultsFile:
        article.files.resultsFile
    });

  await updateArticleAfterUpload({
    siteUrl:
      site.siteUrl,

    user,
    appPassword,

    post,

    queueTagId:
      site.queueTagId,

    doneTagId:
      site.doneTagId,

    youtubeUrl:
      uploadResults.youtube.url
  });

  console.log(
    `[OCCASIONAL] Completed post ${post.id}: ${uploadResults.youtube.url}`
  );

  return {
    postId:
      post.id,

    title:
      post.title,

    status:
      "published",

    youtube:
      uploadResults.youtube,

    wordpressUrl:
      post.link,

    videoFile:
      article.files.videoFile
  };
}

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

  const maximumPosts =
    positiveInteger(
      process.env.OCCASIONAL_MAX_POSTS_PER_SITE,
      1
    );

  const explicitPostId =
    positiveInteger(
      process.env.OCCASIONAL_POST_ID,
      0
    ) || null;

  const {
    user,
    appPassword
  } =
    getWordPressCredentials();

  ensureDir(
    outputRoot
  );

  console.log(
    `[OCCASIONAL] Site: ${site.key}`
  );

  console.log(
    `[OCCASIONAL] WordPress: ${site.siteUrl}`
  );

  console.log(
    `[OCCASIONAL] Queue tag ID: ${site.queueTagId}`
  );

  console.log(
    `[OCCASIONAL] Done tag ID: ${site.doneTagId}`
  );

  console.log(
    `[OCCASIONAL] Maximum posts this run: ${maximumPosts}`
  );

  console.log(
    `[OCCASIONAL] Dry run: ${dryRun}`
  );

  const posts =
    await fetchQueuedPosts({
      siteUrl:
        site.siteUrl,

      user,
      appPassword,

      queueTagId:
        site.queueTagId,

      doneTagId:
        site.doneTagId,

      limit:
        maximumPosts,

      explicitPostId
    });

  if (posts.length === 0) {
    console.log(
      `[OCCASIONAL] Nothing to process for ${site.key}.`
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

        queueTagId:
          site.queueTagId,

        doneTagId:
          site.doneTagId
      }
    );

    return;
  }

  const results = [];

  for (const post of posts) {
    try {
      results.push(
        await processPost({
          site,
          post,
          outputRoot,
          dryRun,
          user,
          appPassword
        })
      );
    } catch (error) {
      console.error(
        `[OCCASIONAL] Post ${post.id} failed:`
      );

      console.error(
        error
      );

      results.push({
        postId:
          post.id,

        title:
          post.title,

        status:
          "failed",

        error:
          error?.message ||
          String(error)
      });
    }
  }

  const failed =
    results.filter(
      (item) =>
        item.status === "failed"
    );

  const summary = {
    status:
      failed.length > 0
        ? "partial_failure"
        : "success",

    completedAt:
      new Date().toISOString(),

    site:
      site.key,

    queueTagId:
      site.queueTagId,

    doneTagId:
      site.doneTagId,

    dryRun,

    processed:
      results.length,

    published:
      results.filter(
        (item) =>
          item.status === "published"
      ).length,

    failed:
      failed.length,

    results
  };

  writeJson(
    path.join(
      outputRoot,
      `${site.key}-status.json`
    ),
    summary
  );

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch(
  (error) => {
    console.error(
      "[OCCASIONAL] Engine failed:"
    );

    console.error(
      error
    );

    process.exit(1);
  }
);
