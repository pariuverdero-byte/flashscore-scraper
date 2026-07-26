import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

/*
 * =========================================================
 * GENERAL CONFIGURATION
 * =========================================================
 */

const OUTPUT_ROOT =
  process.env.SHORTS_OUTPUT_ROOT ||
  "output";

const LANGUAGE =
  String(
    process.env.LANG ||
    "en"
  ).toLowerCase();

const DEFAULT_CONFIG =
  LANGUAGE === "ro"
    ? {
        brandName: "PariuVerde",
        brandDisplay: "PARIUVERDE",
        website: "pariuverde.ro",
        websiteDisplay: "WWW.PARIUVERDE.RO",
        siteUrl: "https://pariuverde.ro",
        presenterFile:
          "assets/presenters/ro_presenter_01.mp4",
        ttsVoice:
          "ro-RO-EmilNeural",
        ttsRate:
          "+2%"
      }
    : {
        brandName: "GreenBetTips",
        brandDisplay: "GREENBETTIPS",
        website: "greenbettips.com",
        websiteDisplay:
          "WWW.GREENBETTIPS.COM",
        siteUrl:
          "https://greenbettips.com",
        presenterFile:
          "assets/presenters/presenter-01.mp4",
        ttsVoice:
          "en-US-GuyNeural",
        ttsRate:
          "+5%"
      };

const BRAND_NAME =
  process.env.SHORTS_BRAND_NAME ||
  DEFAULT_CONFIG.brandName;

const BRAND_DISPLAY =
  process.env.SHORTS_BRAND_DISPLAY ||
  DEFAULT_CONFIG.brandDisplay;

const WEBSITE =
  process.env.SHORTS_WEBSITE ||
  DEFAULT_CONFIG.website;

const WEBSITE_DISPLAY =
  process.env.SHORTS_WEBSITE_DISPLAY ||
  DEFAULT_CONFIG.websiteDisplay;

const SITE_URL =
  (
    process.env.SHORTS_SITE_URL ||
    DEFAULT_CONFIG.siteUrl
  ).replace(/\/$/, "");

const PRESENTER_FILE =
  process.env.SHORTS_PRESENTER_FILE ||
  DEFAULT_CONFIG.presenterFile;

const TTS_VOICE =
  process.env.SHORTS_TTS_VOICE ||
  DEFAULT_CONFIG.ttsVoice;

const TTS_RATE =
  process.env.SHORTS_TTS_RATE ||
  DEFAULT_CONFIG.ttsRate;

const YOUTUBE_PRIVACY_STATUS =
  process.env.YOUTUBE_PRIVACY_STATUS ||
  "public";

const YOUTUBE_ENABLED =
  process.env.YOUTUBE_ENABLED ||
  "true";

const TIKTOK_ENABLED =
  process.env.TIKTOK_ENABLED ||
  "false";

const INSTAGRAM_ENABLED =
  process.env.INSTAGRAM_ENABLED ||
  "false";

const FACEBOOK_ENABLED =
  process.env.FACEBOOK_ENABLED ||
  "false";

const TELEGRAM_ENABLED =
  process.env.TELEGRAM_ENABLED ||
  "false";

/*
 * =========================================================
 * TICKET CONFIGURATION
 * =========================================================
 */

const TICKET_TYPES =
  LANGUAGE === "ro"
    ? [
        {
          type: "bilet_cota2",
          label: "Bilet Cota 2"
        },
        {
          type: "biletul_zilei",
          label: "Biletul Zilei"
        }
      ]
    : [
        {
          type: "bilet_cota2",
          label: "Odds 2 Ticket"
        },
        {
          type: "biletul_zilei",
          label: "Ticket of the Day"
        }
      ];

/*
 * =========================================================
 * FILE HELPERS
 * =========================================================
 */

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Required file does not exist: ${filePath}`
    );
  }

  if (
    fs.statSync(filePath).size === 0
  ) {
    throw new Error(
      `Required file is empty: ${filePath}`
    );
  }
}

function readJson(filePath) {
  requireFile(filePath);

  return JSON.parse(
    fs.readFileSync(
      filePath,
      "utf8"
    )
  );
}

/*
 * =========================================================
 * COMMAND RUNNER
 * =========================================================
 */

function runCommand(
  command,
  args,
  options = {}
) {
  console.log(
    `[BUILD] Running: ${command} ${args.join(
      " "
    )}`
  );

  const result =
    spawnSync(
      command,
      args,
      {
        stdio: "inherit",
        shell: false,
        env: {
          ...process.env,
          ...(options.env || {})
        }
      }
    );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Command failed with exit code ${result.status}: ${command}`
    );
  }
}

/*
 * =========================================================
 * VIDEO VALIDATION
 * =========================================================
 */

function getVideoDetails(
  videoFile
) {
  const result =
    spawnSync(
      "ffprobe",
      [
        "-v",
        "error",

        "-select_streams",
        "v:0",

        "-show_entries",
        "stream=width,height",

        "-show_entries",
        "format=duration,size",

        "-of",
        "json",

        videoFile
      ],
      {
        encoding: "utf8"
      }
    );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `ffprobe failed for ${videoFile}`
    );
  }

  return JSON.parse(
    result.stdout
  );
}

function validateVideo(
  videoFile
) {
  requireFile(videoFile);

  const details =
    getVideoDetails(
      videoFile
    );

  const stream =
    details.streams?.[0];

  const format =
    details.format || {};

  const width =
    Number(stream?.width);

  const height =
    Number(stream?.height);

  const duration =
    Number(format.duration);

  if (width !== 1080) {
    throw new Error(
      `${videoFile} has invalid width ${width}. Expected 1080.`
    );
  }

  if (height !== 1920) {
    throw new Error(
      `${videoFile} has invalid height ${height}. Expected 1920.`
    );
  }

  if (
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    throw new Error(
      `${videoFile} has an invalid duration.`
    );
  }

  if (duration > 60) {
    throw new Error(
      `${videoFile} is ${duration.toFixed(
        2
      )} seconds. Maximum is 60 seconds.`
    );
  }

  console.log(
    `[BUILD] Video validated: 1080x1920, ${duration.toFixed(
      2
    )} seconds`
  );

  return {
    width,
    height,
    duration,
    size:
      Number(
        format.size || 0
      )
  };
}

/*
 * =========================================================
 * VOICE GENERATION
 * =========================================================
 */

function generateVoice({
  scriptFile,
  voiceFile,
  subtitlesFile
}) {
  requireFile(scriptFile);

  fs.mkdirSync(
    path.dirname(voiceFile),
    {
      recursive: true
    }
  );

  console.log(
    `[BUILD] Generating ${LANGUAGE.toUpperCase()} voice`
  );

  console.log(
    `[BUILD] TTS voice: ${TTS_VOICE}`
  );

  console.log(
    `[BUILD] TTS rate: ${TTS_RATE}`
  );

  runCommand(
    "edge-tts",
    [
      "--voice",
      TTS_VOICE,

      "--rate",
      TTS_RATE,

      "--volume",
      "+0%",

      "--file",
      scriptFile,

      "--write-media",
      voiceFile,

      "--write-subtitles",
      subtitlesFile
    ]
  );

  requireFile(voiceFile);
  requireFile(subtitlesFile);

  console.log(
    `[BUILD] Voice generated: ${voiceFile}`
  );
}

/*
 * =========================================================
 * VIDEO RENDERING
 * =========================================================
 */

function renderVideo({
  payloadFile,
  voiceFile,
  subtitlesFile,
  videoFile,
  renderTextDir
}) {
  runCommand(
    "node",
    [
      "shorts/render_short.js"
    ],
    {
      env: {
        LANG:
          LANGUAGE,

        SHORTS_BRAND_NAME:
          BRAND_NAME,

        SHORTS_BRAND_DISPLAY:
          BRAND_DISPLAY,

        SHORTS_WEBSITE:
          WEBSITE,

        SHORTS_WEBSITE_DISPLAY:
          WEBSITE_DISPLAY,

        SHORTS_SITE_URL:
          SITE_URL,

        SHORTS_PAYLOAD_FILE:
          payloadFile,

        SHORTS_PRESENTER_FILE:
          PRESENTER_FILE,

        SHORTS_AUDIO_FILE:
          voiceFile,

        SHORTS_SUBTITLES_FILE:
          subtitlesFile,

        SHORTS_VIDEO_FILE:
          videoFile,

        SHORTS_RENDER_TEXT_DIR:
          renderTextDir
      }
    }
  );

  requireFile(videoFile);

  console.log(
    `[BUILD] Video rendered: ${videoFile}`
  );
}

/*
 * =========================================================
 * MANIFEST GENERATION
 * =========================================================
 */

function generateManifest({
  payloadFile,
  videoFile,
  manifestFile
}) {
  runCommand(
    "node",
    [
      "publish/generate_manifest.js"
    ],
    {
      env: {
        LANG:
          LANGUAGE,

        SHORTS_BRAND_NAME:
          BRAND_NAME,

        SHORTS_BRAND_DISPLAY:
          BRAND_DISPLAY,

        SHORTS_WEBSITE:
          WEBSITE,

        SHORTS_WEBSITE_DISPLAY:
          WEBSITE_DISPLAY,

        SHORTS_SITE_URL:
          SITE_URL,

        SHORTS_PAYLOAD_FILE:
          payloadFile,

        SHORTS_VIDEO_FILE:
          videoFile,

        DISTRIBUTION_MANIFEST_FILE:
          manifestFile,

        YOUTUBE_PRIVACY_STATUS,

        YOUTUBE_ENABLED,

        TIKTOK_ENABLED,

        INSTAGRAM_ENABLED,

        FACEBOOK_ENABLED,

        TELEGRAM_ENABLED
      }
    }
  );

  requireFile(manifestFile);

  console.log(
    `[BUILD] Manifest generated: ${manifestFile}`
  );
}

/*
 * =========================================================
 * BUILD ONE TICKET
 * =========================================================
 */

function buildTicket(ticket) {
  const ticketDir =
    path.join(
      OUTPUT_ROOT,
      ticket.type
    );

  const payloadFile =
    path.join(
      ticketDir,
      "shorts_payload.json"
    );

  const scriptFile =
    path.join(
      ticketDir,
      "voice_script.txt"
    );

  const voiceFile =
    path.join(
      ticketDir,
      "voice.mp3"
    );

  const subtitlesFile =
    path.join(
      ticketDir,
      "subs.srt"
    );

  const videoFile =
    path.join(
      ticketDir,
      "short.mp4"
    );

  const manifestFile =
    path.join(
      ticketDir,
      "distribution_manifest.json"
    );

  const renderTextDir =
    path.join(
      ticketDir,
      "render_text"
    );

  fs.mkdirSync(
    ticketDir,
    {
      recursive: true
    }
  );

  fs.mkdirSync(
    renderTextDir,
    {
      recursive: true
    }
  );

  console.log("");
  console.log(
    `========== ${ticket.label} ==========`
  );

  if (
    !fs.existsSync(payloadFile)
  ) {
    console.log(
      `[BUILD] Payload missing: ${payloadFile}`
    );

    return {
      ticketType:
        ticket.type,

      label:
        ticket.label,

      status:
        "missing",

      reason:
        `Payload not found: ${payloadFile}`
    };
  }

  const payload =
    readJson(payloadFile);

  if (
    payload.status === "skipped"
  ) {
    const reason =
      payload.reason ||
      (
        LANGUAGE === "ro"
          ? "Nu a fost generat un bilet potrivit."
          : "No suitable ticket was generated."
      );

    console.log(
      `[BUILD] ${ticket.label} skipped: ${reason}`
    );

    return {
      ticketType:
        ticket.type,

      label:
        ticket.label,

      status:
        "skipped",

      reason
    };
  }

  if (
    payload.status !== "ready"
  ) {
    throw new Error(
      `${ticket.label} has unexpected payload status: ${payload.status}`
    );
  }

  /*
   * Validate payload consistency.
   */
  const payloadLanguage =
    String(
      payload.language ||
      LANGUAGE
    ).toLowerCase();

  if (
    payloadLanguage !== LANGUAGE
  ) {
    console.warn(
      `[BUILD] Payload language ${payloadLanguage} differs from configured language ${LANGUAGE}.`
    );
  }

  requireFile(scriptFile);

  generateVoice({
    scriptFile,
    voiceFile,
    subtitlesFile
  });

  renderVideo({
    payloadFile,
    voiceFile,
    subtitlesFile,
    videoFile,
    renderTextDir
  });

  const videoDetails =
    validateVideo(
      videoFile
    );

  generateManifest({
    payloadFile,
    videoFile,
    manifestFile
  });

  const manifest =
    readJson(
      manifestFile
    );

  return {
    ticketType:
      ticket.type,

    label:
      payload.ticketLabel ||
      ticket.label,

    status:
      "ready",

    language:
      payloadLanguage,

    brand:
      manifest.brand || {
        name:
          BRAND_NAME,

        displayName:
          BRAND_DISPLAY,

        website:
          WEBSITE,

        websiteDisplay:
          WEBSITE_DISPLAY,

        url:
          SITE_URL
      },

    payloadFile,
    scriptFile,
    voiceFile,
    subtitlesFile,
    videoFile,
    manifestFile,

    youtube: {
      enabled:
        manifest.platforms
          ?.youtube
          ?.enabled === true,

      privacyStatus:
        manifest.platforms
          ?.youtube
          ?.privacyStatus ||
        null,

      title:
        manifest.platforms
          ?.youtube
          ?.title ||
        null
    },

    platforms: {
      youtube:
        manifest.platforms
          ?.youtube
          ?.enabled === true,

      tiktok:
        manifest.platforms
          ?.tiktok
          ?.enabled === true,

      instagram:
        manifest.platforms
          ?.instagram
          ?.enabled === true,

      facebook:
        manifest.platforms
          ?.facebook
          ?.enabled === true,

      telegram:
        manifest.platforms
          ?.telegram
          ?.enabled === true
    },

    video:
      videoDetails
  };
}

/*
 * =========================================================
 * MAIN ENGINE
 * =========================================================
 */

function main() {
  requireFile(
    PRESENTER_FILE
  );

  const startedAt =
    new Date().toISOString();

  const results = [];

  console.log(
    `[BUILD] Starting multi-ticket content engine at ${startedAt}`
  );

  console.log(
    `[BUILD] Language: ${LANGUAGE}`
  );

  console.log(
    `[BUILD] Brand: ${BRAND_NAME}`
  );

  console.log(
    `[BUILD] Brand display: ${BRAND_DISPLAY}`
  );

  console.log(
    `[BUILD] Website: ${SITE_URL}`
  );

  console.log(
    `[BUILD] Presenter: ${PRESENTER_FILE}`
  );

  console.log(
    `[BUILD] TTS voice: ${TTS_VOICE}`
  );

  console.log(
    `[BUILD] TTS rate: ${TTS_RATE}`
  );

  console.log(
    `[BUILD] YouTube privacy: ${YOUTUBE_PRIVACY_STATUS}`
  );

  for (
    const ticket of TICKET_TYPES
  ) {
    try {
      const result =
        buildTicket(ticket);

      results.push(result);
    } catch (error) {
      console.error(
        `[BUILD] ${ticket.label} failed:`
      );

      console.error(error);

      results.push({
        ticketType:
          ticket.type,

        label:
          ticket.label,

        status:
          "failed",

        error:
          error?.message ||
          String(error)
      });
    }
  }

  const hasFailures =
    results.some(
      (item) =>
        item.status === "failed"
    );

  const readyCount =
    results.filter(
      (item) =>
        item.status === "ready"
    ).length;

  const skippedCount =
    results.filter(
      (item) =>
        item.status === "skipped"
    ).length;

  const missingCount =
    results.filter(
      (item) =>
        item.status === "missing"
    ).length;

  const failedCount =
    results.filter(
      (item) =>
        item.status === "failed"
    ).length;

  const summary = {
    status:
      hasFailures
        ? "partial_failure"
        : "success",

    startedAt,

    completedAt:
      new Date().toISOString(),

    configuration: {
      language:
        LANGUAGE,

      brand: {
        name:
          BRAND_NAME,

        displayName:
          BRAND_DISPLAY,

        website:
          WEBSITE,

        websiteDisplay:
          WEBSITE_DISPLAY,

        url:
          SITE_URL
      },

      outputRoot:
        OUTPUT_ROOT,

      presenterFile:
        PRESENTER_FILE,

      ttsVoice:
        TTS_VOICE,

      ttsRate:
        TTS_RATE,

      youtubePrivacyStatus:
        YOUTUBE_PRIVACY_STATUS,

      platforms: {
        youtube:
          YOUTUBE_ENABLED,

        tiktok:
          TIKTOK_ENABLED,

        instagram:
          INSTAGRAM_ENABLED,

        facebook:
          FACEBOOK_ENABLED,

        telegram:
          TELEGRAM_ENABLED
      }
    },

    totals: {
      configured:
        TICKET_TYPES.length,

      ready:
        readyCount,

      skipped:
        skippedCount,

      missing:
        missingCount,

      failed:
        failedCount
    },

    results
  };

  const summaryFile =
    path.join(
      OUTPUT_ROOT,
      "build_summary.json"
    );

  fs.mkdirSync(
    OUTPUT_ROOT,
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    summaryFile,
    JSON.stringify(
      summary,
      null,
      2
    ),
    "utf8"
  );

  console.log("");
  console.log(
    "========== BUILD SUMMARY =========="
  );

  console.log(
    `Ready: ${readyCount}`
  );

  console.log(
    `Skipped: ${skippedCount}`
  );

  console.log(
    `Missing: ${missingCount}`
  );

  console.log(
    `Failed: ${failedCount}`
  );

  for (
    const result of results
  ) {
    console.log(
      `${result.ticketType}: ${result.status}`
    );

    if (result.reason) {
      console.log(
        `  Reason: ${result.reason}`
      );
    }

    if (result.error) {
      console.log(
        `  Error: ${result.error}`
      );
    }

    if (result.videoFile) {
      console.log(
        `  Video: ${result.videoFile}`
      );
    }

    if (result.youtube?.title) {
      console.log(
        `  YouTube: ${result.youtube.title}`
      );
    }
  }

  console.log(
    `[BUILD] Summary saved: ${summaryFile}`
  );

  if (
    summary.status ===
    "partial_failure"
  ) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(
    "[BUILD] Content engine failed:"
  );

  console.error(error);

  process.exit(1);
}
