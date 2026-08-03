import fs from "fs";
import path from "path";
import { getSiteConfig } from "./config.js";
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
import { prepareArticle } from "./prepare_article.js";
import { renderArticleVideo } from "./render_article_video.js";
import { buildManifest } from "./build_manifest.js";

async function main() {
  const site = getSiteConfig(process.env.OCCASIONAL_SITE_KEY);
  const outputRoot = process.env.OCCASIONAL_OUTPUT_ROOT || "output/occasional";
  const dryRun = ["1", "true", "yes"].includes(String(process.env.OCCASIONAL_DRY_RUN || "false").toLowerCase());
  const queueSlug = process.env.OCCASIONAL_QUEUE_TAG || "generate-video";
  const doneSlug = process.env.OCCASIONAL_DONE_TAG || "video-published";
  const { user, appPassword } = getWordPressCredentials();

  console.log(`[OCCASIONAL] Site: ${site.key}`);
  console.log(`[OCCASIONAL] WordPress: ${site.siteUrl}`);
  console.log(`[OCCASIONAL] Dry run: ${dryRun}`);

  const queueTag = await ensureTag({
    siteUrl: site.siteUrl,
    user,
    appPassword,
    slug: queueSlug,
    name: "Generate Video"
  });

  const doneTag = await ensureTag({
    siteUrl: site.siteUrl,
    user,
    appPassword,
    slug: doneSlug,
    name: "Video Published"
  });

  const post = await fetchNextArticle({
    siteUrl: site.siteUrl,
    user,
    appPassword,
    queueTagId: queueTag.id,
    doneTagId: doneTag.id
  });

  if (!post) {
    console.log(`[OCCASIONAL] No queued article found for ${site.key}.`);
    ensureDir(outputRoot);
    writeJson(path.join(outputRoot, `${site.key}-status.json`), {
      status: "nothing_to_process",
      checkedAt: new Date().toISOString(),
      site: site.key
    });
    return;
  }

  console.log(`[OCCASIONAL] Processing post ${post.id}: ${post.title}`);
  const article = prepareArticle({ post, site, outputRoot });
  const presenterFile = process.env.SHORTS_PRESENTER_FILE ||
    selectDeterministic(site.presenterFiles, `${site.key}|${post.id}|${post.modified}`);
  requireFile(presenterFile);

  run("edge-tts", [
    "--voice", process.env.SHORTS_TTS_VOICE || site.ttsVoice,
    `--rate=${normalizeRate(process.env.SHORTS_TTS_RATE || site.ttsRate)}`,
    "--volume=+0%",
    "--file", article.files.scriptFile,
    "--write-media", article.files.voiceFile,
    "--write-subtitles", article.files.subtitlesFile
  ]);

  renderArticleVideo({
    presenterFile,
    voiceFile: article.files.voiceFile,
    subtitlesFile: article.files.subtitlesFile,
    titleFile: article.files.titleFile,
    websiteFile: article.files.websiteFile,
    videoFile: article.files.videoFile
  });

  buildManifest({ article });

  if (dryRun) {
    console.log("[OCCASIONAL] Dry run complete. YouTube upload and WordPress update skipped.");
    return;
  }

  run("node", ["publish/platforms/youtube.js"], {
    env: {
      DISTRIBUTION_MANIFEST_FILE: article.files.manifestFile,
      DISTRIBUTION_RESULTS_FILE: article.files.resultsFile
    }
  });

  const results = readJson(article.files.resultsFile);
  if (results.status !== "success" || !results.youtube?.url) {
    throw new Error("YouTube upload did not return a successful result.");
  }

  await updateArticleAfterUpload({
    siteUrl: site.siteUrl,
    user,
    appPassword,
    post,
    queueTagId: queueTag.id,
    doneTagId: doneTag.id,
    youtubeUrl: results.youtube.url
  });

  console.log(`[OCCASIONAL] WordPress article updated with ${results.youtube.url}`);
  console.log(`[OCCASIONAL] Completed successfully for post ${post.id}.`);
}

main().catch(error => {
  console.error("[OCCASIONAL] Failed:");
  console.error(error);
  process.exit(1);
});
