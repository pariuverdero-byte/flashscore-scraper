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

/*
 * Maximum accepted final video duration.
 *
 * Default: 180 seconds.
 * Optional workflow override:
 *
 * SHORTS_MAX_TOTAL_DURATION=180
 */
const MAX_TOTAL_DURATION =
  Math.max(
    1,
    Number(
      process.env.SHORTS_MAX_TOTAL_DURATION ||
      180
    ) || 180
  );

const LANGUAGE =
  String(
    process.env.LANG ||
    "en"
  )
    .trim()
    .toLowerCase();

const DEFAULT_CONFIG =
  LANGUAGE === "ro"
    ? {
        brandName:
          "PariuVerde",

        brandDisplay:
          "PARIUVERDE",

        website:
          "pariuverde.ro",

        websiteDisplay:
          "WWW.PARIUVERDE.RO",

        siteUrl:
          "https://pariuverde.ro",

        presenterFiles: [
          "assets/intros/ro/intro_01.mp4",
          "assets/intros/ro/intro_02.mp4",
          "assets/intros/ro/intro_03.mp4",
          "assets/intros/ro/intro_04.mp4",
          "assets/intros/ro/intro_05.mp4",
          "assets/intros/ro/intro_06.mp4",
          "assets/intros/ro/intro_07.mp4"
        ],

        ttsVoice:
          "ro-RO-EmilNeural",

        ttsRate:
          "-5%"
      }
    : {
        brandName:
          "GreenBetTips",

        brandDisplay:
          "GREENBETTIPS",

        website:
          "greenbettips.com",

        websiteDisplay:
          "WWW.GREENBETTIPS.COM",

        siteUrl:
          "https://greenbettips.com",

        presenterFiles: [
          "assets/intros/en/intro_01.mp4",
          "assets/intros/en/intro_02.mp4",
          "assets/intros/en/intro_03.mp4",
          "assets/intros/en/intro_04.mp4",
          "assets/intros/en/intro_05.mp4",
          "assets/intros/en/intro_06.mp4",
          "assets/intros/en/intro_07.mp4",
          "assets/intros/en/intro_08.mp4"
        ],

        ttsVoice:
          "en-US-AndrewNeural",

        ttsRate:
          "-3%"
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

/*
 * =========================================================
 * PRESENTER AND VISUAL VARIATION
 * =========================================================
 */

const PRESENTER_FILES =
  String(
    process.env.SHORTS_PRESENTER_FILES ||
    ""
  )
    .split(",")
    .map(
      (item) =>
        item.trim()
    )
    .filter(
      Boolean
    );

const AVAILABLE_PRESENTERS =
  PRESENTER_FILES.length > 0
    ? PRESENTER_FILES
    : DEFAULT_CONFIG.presenterFiles;

function hashString(
  value
) {
  let hash =
    2166136261;

  const input =
    String(
      value
    );

  for (
    let index = 0;
    index < input.length;
    index += 1
  ) {
    hash ^=
      input.charCodeAt(
        index
      );

    hash =
      Math.imul(
        hash,
        16777619
      );
  }

  return hash >>> 0;
}

function seededNumber(
  seed,
  salt = ""
) {
  return (
    hashString(
      `${seed}|${salt}`
    ) /
    4294967295
  );
}

function seededInteger(
  seed,
  salt,
  minimum,
  maximum
) {
  const min =
    Math.ceil(
      minimum
    );

  const max =
    Math.floor(
      maximum
    );

  return (
    min +
    Math.floor(
      seededNumber(
        seed,
        salt
      ) *
      (
        max -
        min +
        1
      )
    )
  );
}

function seededFloat(
  seed,
  salt,
  minimum,
  maximum,
  decimals = 3
) {
  const value =
    minimum +
    seededNumber(
      seed,
      salt
    ) *
    (
      maximum -
      minimum
    );

  return Number(
    value.toFixed(
      decimals
    )
  );
}

function buildDailySeed(
  ticketType
) {
  const date =
    String(
      process.env.SHORTS_VARIATION_DATE ||
      new Date()
        .toISOString()
        .slice(
          0,
          10
        )
    );

  return [
    LANGUAGE,
    BRAND_NAME,
    date,
    ticketType
  ].join("|");
}

function buildVisualVariation(
  ticketType
) {
  const seed =
    buildDailySeed(
      ticketType
    );

  const presenterOverride =
    String(
      process.env.SHORTS_PRESENTER_FILE ||
      ""
    ).trim();

  const presenterIndex =
    seededInteger(
      seed,
      "presenter",
      0,
      AVAILABLE_PRESENTERS.length - 1
    );

  const presenterFile =
    presenterOverride ||
    AVAILABLE_PRESENTERS[
      presenterIndex
    ];

  const scale =
    seededFloat(
      seed,
      "scale",
      Number(
        process.env.SHORTS_PRESENTER_SCALE_MIN ||
        "0.92"
      ),
      Number(
        process.env.SHORTS_PRESENTER_SCALE_MAX ||
        "0.99"
      ),
      3
    );

  const offsetX =
    seededInteger(
      seed,
      "offset-x",
      Number(
        process.env.SHORTS_PRESENTER_OFFSET_X_MIN ||
        "-24"
      ),
      Number(
        process.env.SHORTS_PRESENTER_OFFSET_X_MAX ||
        "24"
      )
    );

  const offsetY =
    seededInteger(
      seed,
      "offset-y",
      Number(
        process.env.SHORTS_PRESENTER_OFFSET_Y_MIN ||
        "28"
      ),
      Number(
        process.env.SHORTS_PRESENTER_OFFSET_Y_MAX ||
        "58"
      )
    );

  const mirrorChance =
    Number(
      process.env.SHORTS_PRESENTER_MIRROR_CHANCE ||
      "0.20"
    );

  const mirror =
    seededNumber(
      seed,
      "mirror"
    ) <
    mirrorChance;

  const backgroundVariant =
    seededInteger(
      seed,
      "background",
      1,
      Number(
        process.env.SHORTS_BACKGROUND_VARIANT_COUNT ||
        "12"
      )
    );

  const backgroundChangeMinSeconds =
    seededInteger(
      seed,
      "background-min",
      Number(
        process.env.SHORTS_BACKGROUND_CHANGE_MIN_SECONDS ||
        "4"
      ),
      Number(
        process.env.SHORTS_BACKGROUND_CHANGE_MIN_SECONDS_MAX ||
        "5"
      )
    );

  const backgroundChangeMaxSeconds =
    seededInteger(
      seed,
      "background-max",
      Math.max(
        backgroundChangeMinSeconds + 1,
        Number(
          process.env.SHORTS_BACKGROUND_CHANGE_MAX_SECONDS_MIN ||
          "6"
        )
      ),
      Number(
        process.env.SHORTS_BACKGROUND_CHANGE_MAX_SECONDS ||
        "7"
      )
    );

  return {
    seed,
    presenterFile,
    presenterIndex:
      presenterOverride
        ? null
        : presenterIndex,

    scale,
    offsetX,
    offsetY,
    mirror,
    backgroundVariant,
    backgroundChangeMinSeconds,
    backgroundChangeMaxSeconds
  };
}

const TTS_VOICE =
  String(
    process.env.SHORTS_TTS_VOICE ||
    DEFAULT_CONFIG.ttsVoice
  ).trim();

const TTS_RATE =
  normalizeTtsRate(
    process.env.SHORTS_TTS_RATE ||
    DEFAULT_CONFIG.ttsRate
  );

const TTS_PITCH =
  normalizeTtsPitch(
    process.env.SHORTS_TTS_PITCH ||
    "+0Hz"
  );

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
 * TTS HELPERS
 * =========================================================
 */

function normalizeTtsRate(
  value
) {
  const rate =
    String(
      value ?? ""
    ).trim();

  if (!rate) {
    return "+0%";
  }

  /*
   * Accepted examples:
   *
   * -5%
   * +2%
   * 0%
   * 5
   * -3
   */

  if (
    /^[+-]?\d+%$/.test(rate)
  ) {
    if (
      rate.startsWith("+") ||
      rate.startsWith("-")
    ) {
      return rate;
    }

    return `+${rate}`;
  }

  if (
    /^[+-]?\d+$/.test(rate)
  ) {
    const numericRate =
      Number(rate);

    if (
      numericRate >= 0
    ) {
      return `+${numericRate}%`;
    }

    return `${numericRate}%`;
  }

  console.warn(
    `[BUILD] Invalid TTS rate "${rate}". Using +0%.`
  );

  return "+0%";
}


function normalizeTtsPitch(value) {
  const pitch = String(value ?? "").trim();

  if (!pitch) {
    return "+0Hz";
  }

  if (/^[+-]?\d+Hz$/i.test(pitch)) {
    return (
      pitch.startsWith("+") ||
      pitch.startsWith("-")
    )
      ? pitch
      : `+${pitch}`;
  }

  if (/^[+-]?\d+$/.test(pitch)) {
    const numericPitch = Number(pitch);
    return `${numericPitch >= 0 ? "+" : ""}${numericPitch}Hz`;
  }

  console.warn(
    `[BUILD] Invalid TTS pitch "${pitch}". Using +0Hz.`
  );

  return "+0Hz";
}

/*
 * =========================================================
 * TICKET CONFIGURATION
 * =========================================================
 */

const TICKET_TYPES =
  LANGUAGE === "ro"
    ? [
        {
          type:
            "bilet_cota2",

          label:
            "Bilet Cota 2"
        },

        {
          type:
            "biletul_zilei",

          label:
            "Biletul Zilei"
        }
      ]
    : [
        {
          type:
            "bilet_cota2",

          label:
            "Odds 2 Ticket"
        },

        {
          type:
            "biletul_zilei",

          label:
            "Ticket of the Day"
        }
      ];

/*
 * =========================================================
 * FILE HELPERS
 * =========================================================
 */

function requireFile(
  filePath
) {
  if (
    !fs.existsSync(
      filePath
    )
  ) {
    throw new Error(
      `Required file does not exist: ${filePath}`
    );
  }

  if (
    fs.statSync(
      filePath
    ).size === 0
  ) {
    throw new Error(
      `Required file is empty: ${filePath}`
    );
  }
}

function readJson(
  filePath
) {
  requireFile(
    filePath
  );

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

function formatCommandForLog(
  command,
  args
) {
  const formattedArgs =
    args.map(
      (arg) => {
        const value =
          String(arg);

        if (
          /\s/.test(value)
        ) {
          return JSON.stringify(
            value
          );
        }

        return value;
      }
    );

  return [
    command,
    ...formattedArgs
  ].join(" ");
}

function runCommand(
  command,
  args,
  options = {}
) {
  console.log(
    `[BUILD] Running: ${formatCommandForLog(
      command,
      args
    )}`
  );

  const result =
    spawnSync(
      command,
      args,
      {
        stdio:
          "inherit",

        shell:
          false,

        env: {
          ...process.env,
          ...(options.env || {})
        }
      }
    );

  if (
    result.error
  ) {
    throw result.error;
  }

  if (
    result.status !== 0
  ) {
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
        encoding:
          "utf8"
      }
    );

  if (
    result.error
  ) {
    throw result.error;
  }

  if (
    result.status !== 0
  ) {
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
  requireFile(
    videoFile
  );

  const details =
    getVideoDetails(
      videoFile
    );

  const stream =
    details.streams?.[0];

  const format =
    details.format ||
    {};

  const width =
    Number(
      stream?.width
    );

  const height =
    Number(
      stream?.height
    );

  const duration =
    Number(
      format.duration
    );

  if (
    width !== 1080
  ) {
    throw new Error(
      `${videoFile} has invalid width ${width}. Expected 1080.`
    );
  }

  if (
    height !== 1920
  ) {
    throw new Error(
      `${videoFile} has invalid height ${height}. Expected 1920.`
    );
  }

  if (
    !Number.isFinite(
      duration
    ) ||
    duration <= 0
  ) {
    throw new Error(
      `${videoFile} has an invalid duration.`
    );
  }

  if (
    duration >
    MAX_TOTAL_DURATION
  ) {
    throw new Error(
      `${videoFile} is ${duration.toFixed(
        2
      )} seconds. Maximum is ${MAX_TOTAL_DURATION} seconds.`
    );
  }

  console.log(
    `[BUILD] Video validated: 1080x1920, ${duration.toFixed(
      2
    )} seconds, maximum ${MAX_TOTAL_DURATION} seconds`
  );

  return {
    width,
    height,
    duration,

    size:
      Number(
        format.size ||
        0
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
  requireFile(
    scriptFile
  );

  fs.mkdirSync(
    path.dirname(
      voiceFile
    ),
    {
      recursive:
        true
    }
  );

  fs.mkdirSync(
    path.dirname(
      subtitlesFile
    ),
    {
      recursive:
        true
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

  console.log(
    `[BUILD] TTS pitch: ${TTS_PITCH}`
  );

  /*
   * Important:
   *
   * Negative values such as -5% must be passed
   * using --rate=-5%.
   *
   * Passing:
   *
   * --rate
   * -5%
   *
   * makes argparse interpret -5% as a new option.
   */

  runCommand(
    "edge-tts",
    [
      "--voice",
      TTS_VOICE,

      `--rate=${TTS_RATE}`,

      `--pitch=${TTS_PITCH}`,

      "--volume=+0%",

      "--file",
      scriptFile,

      "--write-media",
      voiceFile,

      "--write-subtitles",
      subtitlesFile
    ]
  );

  requireFile(
    voiceFile
  );

  requireFile(
    subtitlesFile
  );

  console.log(
    `[BUILD] Voice generated: ${voiceFile}`
  );

  console.log(
    `[BUILD] Subtitles generated: ${subtitlesFile}`
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
  renderTextDir,
  variation
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
          variation.presenterFile,

        SHORTS_VARIATION_SEED:
          variation.seed,

        SHORTS_PRESENTER_SCALE:
          String(
            variation.scale
          ),

        SHORTS_PRESENTER_OFFSET_X:
          String(
            variation.offsetX
          ),

        SHORTS_PRESENTER_OFFSET_Y:
          String(
            variation.offsetY
          ),

        SHORTS_PRESENTER_MIRROR:
          variation.mirror
            ? "true"
            : "false",

        SHORTS_BACKGROUND_VARIANT:
          String(
            variation.backgroundVariant
          ),

        SHORTS_AUDIO_FILE:
          voiceFile,

        SHORTS_SUBTITLES_FILE:
          subtitlesFile,

        SHORTS_VIDEO_FILE:
          videoFile,

        SHORTS_RENDER_TEXT_DIR:
          renderTextDir,

        SHORTS_BACKGROUND_CHANGE_MIN_SECONDS:
          String(
            variation.backgroundChangeMinSeconds
          ),

        SHORTS_BACKGROUND_CHANGE_MAX_SECONDS:
          String(
            variation.backgroundChangeMaxSeconds
          ),

        SHORTS_MAX_TOTAL_DURATION:
          String(
            MAX_TOTAL_DURATION
          )
      }
    }
  );

  requireFile(
    videoFile
  );

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

  requireFile(
    manifestFile
  );

  console.log(
    `[BUILD] Manifest generated: ${manifestFile}`
  );
}

/*
 * =========================================================
 * BUILD ONE TICKET
 * =========================================================
 */

function buildTicket(
  ticket
) {
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
      recursive:
        true
    }
  );

  fs.mkdirSync(
    renderTextDir,
    {
      recursive:
        true
    }
  );

  console.log("");

  console.log(
    `========== ${ticket.label} ==========`
  );

  if (
    !fs.existsSync(
      payloadFile
    )
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
    readJson(
      payloadFile
    );

  if (
    payload.status ===
    "skipped"
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
    payload.status !==
    "ready"
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
    )
      .trim()
      .toLowerCase();

  if (
    payloadLanguage !==
    LANGUAGE
  ) {
    console.warn(
      `[BUILD] Payload language ${payloadLanguage} differs from configured language ${LANGUAGE}.`
    );
  }

  requireFile(
    scriptFile
  );

  const variation =
    buildVisualVariation(
      ticket.type
    );

  requireFile(
    variation.presenterFile
  );

  console.log(
    `[BUILD] Variation seed: ${variation.seed}`
  );

  console.log(
    `[BUILD] Presenter: ${variation.presenterFile}`
  );

  console.log(
    `[BUILD] Presenter scale: ${variation.scale}`
  );

  console.log(
    `[BUILD] Presenter offset: X=${variation.offsetX}, Y=${variation.offsetY}`
  );

  console.log(
    `[BUILD] Presenter mirror: ${variation.mirror}`
  );

  console.log(
    `[BUILD] Background variant: ${variation.backgroundVariant}`
  );

  console.log(
    `[BUILD] Background timing: ${variation.backgroundChangeMinSeconds}-${variation.backgroundChangeMaxSeconds}s`
  );

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
    renderTextDir,
    variation
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
      manifest.brand ||
      {
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

    variation: {
      seed:
        variation.seed,

      presenterFile:
        variation.presenterFile,

      presenterIndex:
        variation.presenterIndex,

      scale:
        variation.scale,

      offsetX:
        variation.offsetX,

      offsetY:
        variation.offsetY,

      mirror:
        variation.mirror,

      backgroundVariant:
        variation.backgroundVariant,

      backgroundChangeMinSeconds:
        variation.backgroundChangeMinSeconds,

      backgroundChangeMaxSeconds:
        variation.backgroundChangeMaxSeconds
    },

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
  if (
    AVAILABLE_PRESENTERS.length === 0
  ) {
    throw new Error(
      "No presenter files are configured."
    );
  }

  for (
    const presenterFile of
    AVAILABLE_PRESENTERS
  ) {
    requireFile(
      presenterFile
    );
  }

  const startedAt =
    new Date()
      .toISOString();

  const results =
    [];

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
    `[BUILD] Available presenters: ${AVAILABLE_PRESENTERS.join(
      ", "
    )}`
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

  console.log(
    `[BUILD] Maximum video duration: ${MAX_TOTAL_DURATION} seconds`
  );

  for (
    const ticket of
    TICKET_TYPES
  ) {
    try {
      const result =
        buildTicket(
          ticket
        );

      results.push(
        result
      );
    } catch (
      error
    ) {
      console.error(
        `[BUILD] ${ticket.label} failed:`
      );

      console.error(
        error
      );

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
        item.status ===
        "failed"
    );

  const readyCount =
    results.filter(
      (item) =>
        item.status ===
        "ready"
    ).length;

  const skippedCount =
    results.filter(
      (item) =>
        item.status ===
        "skipped"
    ).length;

  const missingCount =
    results.filter(
      (item) =>
        item.status ===
        "missing"
    ).length;

  const failedCount =
    results.filter(
      (item) =>
        item.status ===
        "failed"
    ).length;

  const summary = {
    status:
      hasFailures
        ? "partial_failure"
        : "success",

    startedAt,

    completedAt:
      new Date()
        .toISOString(),

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

      presenterFiles:
        AVAILABLE_PRESENTERS,

      ttsVoice:
        TTS_VOICE,

      ttsRate:
        TTS_RATE,

      youtubePrivacyStatus:
        YOUTUBE_PRIVACY_STATUS,

      maximumVideoDuration:
        MAX_TOTAL_DURATION,

      visualVariation: {
        deterministic:
          true,

        date:
          process.env.SHORTS_VARIATION_DATE ||
          new Date()
            .toISOString()
            .slice(
              0,
              10
            ),

        presenterScaleRange: {
          minimum:
            process.env.SHORTS_PRESENTER_SCALE_MIN ||
            "0.92",

          maximum:
            process.env.SHORTS_PRESENTER_SCALE_MAX ||
            "0.99"
        },

        presenterOffsetXRange: {
          minimum:
            process.env.SHORTS_PRESENTER_OFFSET_X_MIN ||
            "-24",

          maximum:
            process.env.SHORTS_PRESENTER_OFFSET_X_MAX ||
            "24"
        },

        presenterOffsetYRange: {
          minimum:
            process.env.SHORTS_PRESENTER_OFFSET_Y_MIN ||
            "28",

          maximum:
            process.env.SHORTS_PRESENTER_OFFSET_Y_MAX ||
            "58"
        },

        presenterMirrorChance:
          process.env.SHORTS_PRESENTER_MIRROR_CHANCE ||
          "0.20",

        backgroundVariantCount:
          process.env.SHORTS_BACKGROUND_VARIANT_COUNT ||
          "12"
      },

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
      recursive:
        true
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
    const result of
    results
  ) {
    console.log(
      `${result.ticketType}: ${result.status}`
    );

    if (
      result.reason
    ) {
      console.log(
        `  Reason: ${result.reason}`
      );
    }

    if (
      result.error
    ) {
      console.log(
        `  Error: ${result.error}`
      );
    }

    if (
      result.videoFile
    ) {
      console.log(
        `  Video: ${result.videoFile}`
      );
    }

    if (
      result.youtube
        ?.title
    ) {
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

/*
 * =========================================================
 * START
 * =========================================================
 */

try {
  main();
} catch (
  error
) {
  console.error(
    "[BUILD] Content engine failed:"
  );

  console.error(
    error
  );

  process.exit(1);
}
