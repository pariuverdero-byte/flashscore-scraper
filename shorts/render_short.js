import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

/*
 * =========================================================
 * INPUT / OUTPUT
 * =========================================================
 */

const PAYLOAD_FILE =
  process.env.SHORTS_PAYLOAD_FILE ||
  "output/shorts_payload.json";

const PRESENTER_FILE =
  process.env.SHORTS_PRESENTER_FILE ||
  (
    String(process.env.LANG || "en").toLowerCase() === "ro"
      ? "assets/intros/ro/intro_01.mp4"
      : "assets/intros/en/intro_01.mp4"
  );

const AUDIO_FILE =
  process.env.SHORTS_AUDIO_FILE ||
  "output/voice.mp3";

const HANDOFF_AUDIO_FILE =
  process.env.SHORTS_HANDOFF_AUDIO_FILE ||
  "assets/handoffs/ro/mihai_analyst_intro.mp3";

const TICKET_BACKGROUND_FILE =
  process.env.SHORTS_TICKET_BACKGROUND_FILE ||
  "assets/backgrounds/football_ticket_stadium_v1.png";

const OUTPUT_FILE =
  process.env.SHORTS_VIDEO_FILE ||
  "output/short.mp4";

const TEMP_DIR =
  process.env.SHORTS_RENDER_TEXT_DIR ||
  "output/render_text";

/*
 * =========================================================
 * FONTS
 * =========================================================
 */

const FONT_REGULAR =
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

const FONT_BOLD =
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

/*
 * =========================================================
 * VIDEO DURATIONS
 * =========================================================
 */

const INTRO_DURATION = 3;
const TRANSITION_DURATION = 0.65;
const OUTRO_DURATION = 3;

/*
 * YouTube Shorts can be up to 3 minutes.
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

/*
 * =========================================================
 * PERIODIC BACKGROUND SETTINGS
 * =========================================================
 *
 * Fundalul principal se schimbă aleatoriu
 * la fiecare 4–7 secunde.
 *
 * Valorile pot fi suprascrise din workflow:
 *
 * SHORTS_BACKGROUND_CHANGE_MIN_SECONDS: 4
 * SHORTS_BACKGROUND_CHANGE_MAX_SECONDS: 7
 */

const BACKGROUND_CHANGE_MIN_SECONDS =
  Number(
    process.env
      .SHORTS_BACKGROUND_CHANGE_MIN_SECONDS ||
    4
  );

const BACKGROUND_CHANGE_MAX_SECONDS =
  Number(
    process.env
      .SHORTS_BACKGROUND_CHANGE_MAX_SECONDS ||
    7
  );


/*
 * =========================================================
 * BUILD_ALL_SHORTS VARIATION INPUTS
 * =========================================================
 *
 * Aceste valori sunt trimise de ultima versiune
 * build_all_shorts.js. Render-ul nu mai alege aleatoriu
 * poziția, scala, oglindirea sau varianta de fundal.
 */

const VARIATION_SEED =
  String(
    process.env.SHORTS_VARIATION_SEED ||
    "default"
  );

const BACKGROUND_VARIANT =
  Math.max(
    1,
    Number(
      process.env.SHORTS_BACKGROUND_VARIANT ||
      1
    ) || 1
  );

function readFiniteEnvironmentNumber(
  name
) {
  const rawValue =
    process.env[name];

  if (
    rawValue === undefined ||
    rawValue === null ||
    String(rawValue).trim() === ""
  ) {
    return null;
  }

  const value =
    Number(rawValue);

  return Number.isFinite(value)
    ? value
    : null;
}

function readEnvironmentBoolean(
  name
) {
  const rawValue =
    process.env[name];

  if (
    rawValue === undefined ||
    rawValue === null ||
    String(rawValue).trim() === ""
  ) {
    return null;
  }

  const normalized =
    String(rawValue)
      .trim()
      .toLowerCase();

  if (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes"
  ) {
    return true;
  }

  if (
    normalized === "false" ||
    normalized === "0" ||
    normalized === "no"
  ) {
    return false;
  }

  return null;
}

/*
 * Culori de fundal.
 *
 * Sunt suficient de închise pentru ca:
 * - textul alb să rămână lizibil;
 * - verdele brandului să fie vizibil;
 * - prezentatorul să iasă în evidență.
 */

const BACKGROUND_OPTIONS = [
  "0x07140D",
  "0x0A1E17",
  "0x10241A",
  "0x071923",
  "0x0A2130",
  "0x101827",
  "0x17132B",
  "0x211536",
  "0x261A12",
  "0x2A1710",
  "0x25111A",
  "0x1E101D",
  "0x111B20",
  "0x122323",
  "0x1A2112",
  "0x20200E",
  "0x1A1520",
  "0x101018"
];

/*
 * =========================================================
 * PRESENTER VARIATIONS
 * =========================================================
 */

const ZOOM_OPTIONS = [
  1.025,
  1.04,
  1.055,
  1.07
];

const HORIZONTAL_POSITION_OPTIONS = [
  -42,
  -25,
  -10,
  0,
  12,
  28,
  44
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

function cleanText(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(
  value,
  maxLength
) {
  const text =
    cleanText(value);

  if (
    text.length <= maxLength
  ) {
    return text;
  }

  return `${text
    .slice(
      0,
      maxLength - 3
    )
    .trim()}...`;
}

function escapeFilterPath(
  filePath
) {
  return path
    .resolve(filePath)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function writeTextFile(
  filename,
  value
) {
  const filePath =
    path.join(
      TEMP_DIR,
      filename
    );

  fs.writeFileSync(
    filePath,
    `${cleanText(value)}\n`,
    "utf8"
  );

  return filePath;
}


function writeMultilineTextFile(
  filename,
  value
) {
  const filePath = path.join(TEMP_DIR, filename);
  const text = String(value ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map(line => cleanText(line))
    .join("\n")
    .trim();
  fs.writeFileSync(filePath, `${text}\n`, "utf8");
  return filePath;
}

/*
 * =========================================================
 * MEDIA HELPERS
 * =========================================================
 */

function getMediaDuration(
  filePath
) {
  const output =
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",

        "-show_entries",
        "format=duration",

        "-of",
        "default=noprint_wrappers=1:nokey=1",

        filePath
      ],
      {
        encoding: "utf8"
      }
    ).trim();

  const duration =
    Number(output);

  if (
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    throw new Error(
      `Could not determine media duration: ${output}`
    );
  }

  return duration;
}

/*
 * =========================================================
 * DATE FORMATTING
 * =========================================================
 */

function formatDate(
  dateValue,
  language = "en"
) {
  const value =
    cleanText(dateValue);

  if (!value) {
    return language === "ro"
      ? "ASTĂZI"
      : "TODAY";
  }

  const match =
    value.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (!match) {
    return value.toUpperCase();
  }

  const [
    ,
    year,
    month,
    day
  ] = match;

  const date =
    new Date(
      Number(year),
      Number(month) - 1,
      Number(day)
    );

  return new Intl.DateTimeFormat(
    language === "ro"
      ? "ro-RO"
      : "en-US",
    {
      weekday:
        "long",

      month:
        "long",

      day:
        "numeric",

      year:
        "numeric"
    }
  )
    .format(date)
    .toUpperCase();
}

/*
 * =========================================================
 * SELECTION TEXT
 * =========================================================
 */

function compactTeamName(value) {
  return cleanText(value)
    .replace(/\s*\([^)]{2,5}\)\s*$/g, "")
    .replace(/\b(?:FC|CF|SC|FK|SK)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fitLine(value, maxLength) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

function createSelectionText(
  selection,
  language,
  maxLineLength = 48
) {
  const separator = language === "ro" ? " - " : " vs ";
  const home = compactTeamName(selection.home);
  const away = compactTeamName(selection.away);
  const teams = home && away
    ? `${home}${separator}${away}`
    : compactTeamName(selection.teams);

  const market = cleanText(selection.market);
  const odds = cleanText(selection.odds);
  const line1 = fitLine(teams, maxLineLength);
  const pickPrefix = language === "ro" ? "Pont" : "Pick";
  const line2 = fitLine(`${pickPrefix}: ${market} | ${odds}`, maxLineLength + 8);
  return `${line1}\n${line2}`;
}

/*
 * =========================================================
 * DETERMINISTIC VARIATION HELPERS
 * =========================================================
 *
 * Aceeași combinație seed + etichetă produce aceeași valoare.
 * Astfel, rerularea workflow-ului în aceeași zi generează
 * aceleași variații vizuale.
 */

function hashString(
  value
) {
  let hash =
    2166136261;

  const input =
    String(value);

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
  label
) {
  let state =
    hashString(
      `${VARIATION_SEED}|${BACKGROUND_VARIANT}|${label}`
    );

  state +=
    0x6D2B79F5;

  let value =
    state;

  value =
    Math.imul(
      value ^
      (
        value >>> 15
      ),
      value | 1
    );

  value ^=
    value +
    Math.imul(
      value ^
      (
        value >>> 7
      ),
      value | 61
    );

  return (
    (
      value ^
      (
        value >>> 14
      )
    ) >>> 0
  ) /
  4294967296;
}

function seededItem(
  items,
  label
) {
  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return null;
  }

  const index =
    Math.floor(
      seededNumber(
        label
      ) *
      items.length
    );

  return items[
    Math.min(
      items.length - 1,
      index
    )
  ];
}

function seededBoolean(
  label,
  probability = 0.5
) {
  return (
    seededNumber(
      label
    ) <
    probability
  );
}

function seededRange(
  label,
  minimum,
  maximum,
  decimals = 2
) {
  const value =
    minimum +
    seededNumber(
      label
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

/*
 * =========================================================
 * PERIODIC BACKGROUND GENERATOR
 * =========================================================
 *
 * Creează un fundal de bază și aplică succesiv
 * culori diferite pe intervale de timp.
 */

function buildPeriodicBackground(
  duration
) {
  const safeMin =
    Number.isFinite(
      BACKGROUND_CHANGE_MIN_SECONDS
    )
      ? Math.max(
          1,
          BACKGROUND_CHANGE_MIN_SECONDS
        )
      : 4;

  const safeMax =
    Number.isFinite(
      BACKGROUND_CHANGE_MAX_SECONDS
    )
      ? Math.max(
          safeMin,
          BACKGROUND_CHANGE_MAX_SECONDS
        )
      : 7;

  const segments = [];

  let currentTime = 0;
  let previousColor = null;

  while (
    currentTime <
    duration - 0.01
  ) {
    const remaining =
      duration -
      currentTime;

    const requestedDuration =
      seededRange(
        `background-duration-${segments.length}`,
        safeMin,
        safeMax,
        2
      );

    const segmentDuration =
      Math.min(
        requestedDuration,
        remaining
      );

    let color =
      seededItem(
        BACKGROUND_OPTIONS,
        `background-color-${segments.length}`
      );

    /*
     * Evităm repetarea imediată
     * a aceleiași culori.
     */
    if (
      color === previousColor &&
      BACKGROUND_OPTIONS.length > 1
    ) {
      const alternatives =
        BACKGROUND_OPTIONS.filter(
          (item) =>
            item !==
            previousColor
        );

      color =
        seededItem(
          alternatives,
          `background-alternative-${segments.length}`
        );
    }

    segments.push({
      start:
        currentTime,

      end:
        currentTime +
        segmentDuration,

      duration:
        segmentDuration,

      color
    });

    previousColor =
      color;

    currentTime +=
      segmentDuration;
  }

  if (
    segments.length === 0
  ) {
    segments.push({
      start:
        0,

      end:
        duration,

      duration,

      color:
        seededItem(
          BACKGROUND_OPTIONS,
          "background-fallback"
        )
    });
  }

  /*
   * Fundalul de bază.
   */
  const baseColor =
    segments[0].color;

  const filters = [
    `color=c=${baseColor}:` +
    "s=1080x1920:" +
    "r=30:" +
    `d=${duration.toFixed(
      3
    )}` +
    "[periodic_bg_0]"
  ];

  /*
   * Fiecare segment colorează tot cadrul
   * doar în intervalul său.
   */
  segments.forEach(
    (
      segment,
      index
    ) => {
      const inputLabel =
        index === 0
          ? "periodic_bg_0"
          : `periodic_bg_${index}`;

      const outputLabel =
        index ===
        segments.length - 1
          ? "main_bg"
          : `periodic_bg_${index + 1}`;

      const start =
        segment.start.toFixed(
          3
        );

      const end =
        segment.end.toFixed(
          3
        );

      filters.push(
        `[${inputLabel}]` +

        "drawbox=" +
        "x=0:" +
        "y=0:" +
        "w=iw:" +
        "h=ih:" +
        `color=${segment.color}:` +
        "t=fill:" +

        `enable='between(t\\,${start}\\,${end})'` +

        `[${outputLabel}]`
      );
    }
  );

  return {
    segments,
    filters
  };
}

/*
 * =========================================================
 * TICKET LAYOUT
 * =========================================================
 */

function getTicketLayout(
  ticketType,
  selectionCount
) {
  /*
   * Biletul zilei poate avea
   * până la patru selecții.
   */

  if (
    ticketType ===
      "biletul_zilei" ||
    selectionCount === 4
  ) {
    return {
      cardX:
        55,

      cardY:
        115,

      cardWidth:
        970,

      cardHeight:
        1220,

      headlineY:
        170,

      headlineFontSize:
        54,

      oddsY:
        255,

      oddsFontSize:
        46,

      selectionFontSize:
        34,

      selectionY: [
        400,
        630,
        860,
        1090
      ],

      selectionMaxLength:
        42
    };
  }

  /*
   * Bilet Cota 2 are, în mod normal,
   * două sau trei selecții.
   */

  return {
    cardX:
      65,

    cardY:
      170,

    cardWidth:
      950,

    cardHeight:
      1110,

    headlineY:
      235,

    headlineFontSize:
      58,

    oddsY:
      330,

    oddsFontSize:
      48,

    selectionFontSize:
      38,

    selectionY: [
      505,
      800,
      1095,
      1390
    ],

    selectionMaxLength:
      38
  };
}

/*
 * =========================================================
 * MAIN
 * =========================================================
 */

function main() {
  requireFile(
    PAYLOAD_FILE
  );

  requireFile(
    PRESENTER_FILE
  );

  requireFile(
    AUDIO_FILE
  );

  requireFile(
    TICKET_BACKGROUND_FILE
  );

  requireFile(
    FONT_REGULAR
  );

  requireFile(
    FONT_BOLD
  );

  /*
   * Read payload.
   */
  const payload =
    JSON.parse(
      fs.readFileSync(
        PAYLOAD_FILE,
        "utf8"
      )
    );

  if (
    payload.status ===
    "skipped"
  ) {
    console.log(
      `[SHORTS] Video rendering skipped: ${
        payload.reason ||
        "No suitable ticket"
      }`
    );

    return;
  }

  if (
    payload.status !==
    "ready"
  ) {
    throw new Error(
      `Unexpected Shorts payload status: ${payload.status}`
    );
  }

  const language =
    cleanText(
      payload.language ||
      process.env.LANG ||
      "en"
    ).toLowerCase();

  const ticketType =
    cleanText(
      payload.ticketType
    );

  /*
   * Afișăm maximum patru selecții.
   */
  const selections =
    Array.isArray(
      payload.selections
    )
      ? payload.selections.slice(
          0,
          4
        )
      : [];

  if (
    selections.length === 0
  ) {
    throw new Error(
      "No selections were found in the Shorts payload."
    );
  }

  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE
    ),
    {
      recursive:
        true
    }
  );

  fs.mkdirSync(
    TEMP_DIR,
    {
      recursive:
        true
    }
  );

  /*
   * Media durations.
   */
  const audioDuration =
    getMediaDuration(
      AUDIO_FILE
    );

  const presenterDuration =
    getMediaDuration(
      PRESENTER_FILE
    );

  const hasHandoff =
    language === "ro" &&
    fs.existsSync(HANDOFF_AUDIO_FILE);

  const handoffDuration =
    hasHandoff
      ? getMediaDuration(HANDOFF_AUDIO_FILE)
      : 0;

  const ticketBackgroundInput =
    hasHandoff ? 3 : 2;

  const finalDuration =
    INTRO_DURATION +
    presenterDuration +
    handoffDuration +
    TRANSITION_DURATION +
    audioDuration +
    OUTRO_DURATION;

  console.log(
    `[SHORTS] Maximum allowed duration: ${MAX_TOTAL_DURATION} seconds`
  );

  if (
    finalDuration >
    MAX_TOTAL_DURATION
  ) {
    throw new Error(
      `Final video would be ${finalDuration.toFixed(
        2
      )} seconds. Maximum allowed is ${MAX_TOTAL_DURATION} seconds.`
    );
  }

  /*
   * =========================================================
   * PRESENTER VARIATION
   * =========================================================
   */

  const payloadPresenterVariation =
    payload.visuals
      ?.presenterVariation ||
    {};

  const maximumStartOffset =
    Math.max(
      0,
      Math.min(
        presenterDuration -
          0.35,
        2.6
      )
    );

  const configuredStartOffset =
    Number(
      payloadPresenterVariation
        .startOffsetSeconds
    );

  const presenterStartOffset =
    Number.isFinite(
      configuredStartOffset
    )
      ? Math.max(
          0,
          Math.min(
            configuredStartOffset,
            maximumStartOffset
          )
        )
      : seededRange(
          "presenter-start-offset",
          0,
          maximumStartOffset,
          2
        );

  const environmentZoom =
    readFiniteEnvironmentNumber(
      "SHORTS_PRESENTER_SCALE"
    );

  const configuredZoom =
    environmentZoom ??
    Number(
      payloadPresenterVariation
        .scale
    );

  const presenterZoom =
    Number.isFinite(
      configuredZoom
    )
      ? configuredZoom
      : seededItem(
          ZOOM_OPTIONS,
          "presenter-scale-fallback"
        );

  const environmentXOffset =
    readFiniteEnvironmentNumber(
      "SHORTS_PRESENTER_OFFSET_X"
    );

  const configuredXOffset =
    environmentXOffset ??
    Number(
      payloadPresenterVariation
        .xOffset
    );

  const presenterXOffset =
    Number.isFinite(
      configuredXOffset
    )
      ? configuredXOffset
      : seededItem(
          HORIZONTAL_POSITION_OPTIONS,
          "presenter-x-fallback"
        );

  const environmentYOffset =
    readFiniteEnvironmentNumber(
      "SHORTS_PRESENTER_OFFSET_Y"
    );

  const configuredYOffset =
    environmentYOffset ??
    Number(
      payloadPresenterVariation
        .yOffset
    );

  const presenterYOffset =
    Number.isFinite(
      configuredYOffset
    )
      ? configuredYOffset
      : seededRange(
          "presenter-y-fallback",
          28,
          58,
          0
        );

  const environmentMirror =
    readEnvironmentBoolean(
      "SHORTS_PRESENTER_MIRROR"
    );

  const presenterFlipped =
    environmentMirror !== null
      ? environmentMirror
      : typeof payloadPresenterVariation
          .mirror === "boolean"
        ? payloadPresenterVariation
            .mirror
        : seededBoolean(
            "presenter-mirror-fallback",
            0.20
          );

  /*
   * =========================================================
   * BACKGROUND VARIATION
   * =========================================================
   */

  const periodicBackground =
    buildPeriodicBackground(
      audioDuration
    );

  const introBackground =
    seededItem(
      BACKGROUND_OPTIONS,
      "intro-background"
    );

  const outroBackground =
    seededItem(
      BACKGROUND_OPTIONS.filter(
        (item) =>
          item !==
          introBackground
      ),
      "outro-background"
    ) ||
    seededItem(
      BACKGROUND_OPTIONS,
      "outro-background-fallback"
    );

  /*
   * Layout.
   */
  const layout =
    getTicketLayout(
      ticketType,
      selections.length
    );

  /*
   * Logs.
   */
  console.log(
    `[SHORTS] Audio duration: ${audioDuration.toFixed(
      2
    )} seconds`
  );

  console.log(
    `[SHORTS] Presenter duration: ${presenterDuration.toFixed(
      2
    )} seconds`
  );


  console.log(
    `[SHORTS] Variation seed: ${VARIATION_SEED}`
  );

  console.log(
    `[SHORTS] Background variant: ${BACKGROUND_VARIANT}`
  );

  console.log(
    `[SHORTS] Presenter file: ${PRESENTER_FILE}`
  );

  console.log(
    `[SHORTS] Presenter start offset: ${presenterStartOffset.toFixed(
      2
    )} seconds`
  );

  console.log(
    `[SHORTS] Presenter zoom: ${presenterZoom}`
  );

  console.log(
    `[SHORTS] Presenter horizontal offset: ${presenterXOffset}px`
  );

  console.log(
    `[SHORTS] Presenter vertical offset: ${presenterYOffset}px`
  );

  console.log(
    `[SHORTS] Presenter mirrored: ${presenterFlipped}`
  );

  console.log(
    `[SHORTS] Periodic background segments: ${periodicBackground.segments.length}`
  );

  periodicBackground
    .segments
    .forEach(
      (
        segment,
        index
      ) => {
        console.log(
          `[SHORTS] Background ${index + 1}: ` +
          `${segment.color}, ` +
          `${segment.duration.toFixed(
            2
          )} seconds`
        );
      }
    );

  console.log(
    `[SHORTS] Intro background: ${introBackground}`
  );

  console.log(
    `[SHORTS] Outro background: ${outroBackground}`
  );

  console.log(
    `[SHORTS] Ticket layout: ${ticketType || "default"}`
  );

  console.log(
    `[SHORTS] Displayed selections: ${selections.length}`
  );

  /*
   * =========================================================
   * PAYLOAD TEXTS
   * =========================================================
   */

  const ticketTitle =
    payload.ticketLabel ||
    payload.visuals
      ?.headline ||
    (
      language === "ro"
        ? "BILET COTA 2"
        : "ODDS 2 TICKET"
    );

  const totalOdds =
    payload.visuals
      ?.totalOdds ||
    payload.totalOdds ||
    "-";

  const brandDisplay =
    payload.brand
      ?.displayName ||
    payload.visuals
      ?.brand ||
    (
      language === "ro"
        ? "PARIUVERDE"
        : "GREENBETTIPS"
    );

  const websiteDisplay =
    payload.brand
      ?.websiteDisplay ||
    payload.visuals
      ?.website ||
    payload.visuals
      ?.callToAction ||
    (
      language === "ro"
        ? "WWW.PARIUVERDE.RO"
        : "WWW.GREENBETTIPS.COM"
    );

  const combinedOddsLabel =
    payload.visuals
      ?.combinedOddsLabel ||
    (
      language === "ro"
        ? "COTA TOTALĂ"
        : "COMBINED ODDS"
    );

  const outroTop =
    payload.visuals
      ?.outroTop ||
    (
      language === "ro"
        ? "ȚI-AU PLĂCUT PONTURILE?"
        : "ENJOYED TODAY'S PICKS?"
    );

  const subscribeText =
    payload.visuals
      ?.subscribe ||
    (
      language === "ro"
        ? "ABONEAZĂ-TE"
        : "SUBSCRIBE"
    );

  const outroMessage =
    payload.visuals
      ?.outroMessage ||
    (
      language === "ro"
        ? "PENTRU PONTURI ZILNICE"
        : "FOR DAILY FOOTBALL PREDICTIONS"
    );

  const introFooter =
    language === "ro"
      ? "PONTURI ZILNICE LA FOTBAL"
      : "DAILY FOOTBALL PREDICTIONS";

  const formattedDate =
    formatDate(
      payload.date,
      language
    );

  // Preserve the product name in the generic: Bilet Cota 2 / Biletul Zilei
  // (and the corresponding English label supplied by the payload).
  const introTitle =
    ticketTitle;

  const mainOddsText =
    `${combinedOddsLabel}: ${totalOdds}`;

  /*
   * =========================================================
   * WRITE TEXT FILES
   * =========================================================
   */

  const introBrandFile =
    writeTextFile(
      "intro_brand.txt",
      brandDisplay
    );

  const introTitleFile =
    writeTextFile(
      "intro_title.txt",
      introTitle
    );

  const introDateFile =
    writeTextFile(
      "intro_date.txt",
      formattedDate
    );

  const introOddsLabelFile =
    writeTextFile(
      "intro_odds_label.txt",
      combinedOddsLabel
    );

  const introOddsFile =
    writeTextFile(
      "intro_odds.txt",
      totalOdds
    );

  const introFooterFile =
    writeTextFile(
      "intro_footer.txt",
      introFooter
    );

  const mainHeadlineFile =
    writeTextFile(
      "main_headline.txt",
      payload.visuals
        ?.headline ||
      ticketTitle
    );

  const mainTotalOddsFile =
    writeTextFile(
      "main_total_odds.txt",
      mainOddsText
    );

  const selectionFiles = [];

  for (
    let index = 0;
    index < 4;
    index += 1
  ) {
    selectionFiles.push(
      writeMultilineTextFile(
        `selection_${index + 1}.txt`,

        selections[index]
          ? createSelectionText(
              selections[index],
              language,
              layout.selectionMaxLength
            )
          : ""
      )
    );
  }

  const mainCtaFile =
    writeTextFile(
      "main_cta.txt",
      websiteDisplay
    );

  const outroTopFile =
    writeTextFile(
      "outro_top.txt",
      outroTop
    );

  const outroSubscribeFile =
    writeTextFile(
      "outro_subscribe.txt",
      subscribeText
    );

  const outroMessageFile =
    writeTextFile(
      "outro_message.txt",
      outroMessage
    );

  const outroWebsiteFile =
    writeTextFile(
      "outro_website.txt",
      websiteDisplay
    );

  const outroBrandFile =
    writeTextFile(
      "outro_brand.txt",
      brandDisplay
    );

  /*
   * =========================================================
   * ESCAPE PATHS FOR FFMPEG
   * =========================================================
   */

  const boldFont =
    escapeFilterPath(
      FONT_BOLD
    );

  const introBrandPath =
    escapeFilterPath(
      introBrandFile
    );

  const introTitlePath =
    escapeFilterPath(
      introTitleFile
    );

  const introDatePath =
    escapeFilterPath(
      introDateFile
    );

  const introOddsLabelPath =
    escapeFilterPath(
      introOddsLabelFile
    );

  const introOddsPath =
    escapeFilterPath(
      introOddsFile
    );

  const introFooterPath =
    escapeFilterPath(
      introFooterFile
    );

  const mainHeadlinePath =
    escapeFilterPath(
      mainHeadlineFile
    );

  const mainTotalOddsPath =
    escapeFilterPath(
      mainTotalOddsFile
    );

  const selectionPaths =
    selectionFiles.map(
      escapeFilterPath
    );

  const mainCtaPath =
    escapeFilterPath(
      mainCtaFile
    );

  const outroTopPath =
    escapeFilterPath(
      outroTopFile
    );

  const outroSubscribePath =
    escapeFilterPath(
      outroSubscribeFile
    );

  const outroMessagePath =
    escapeFilterPath(
      outroMessageFile
    );

  const outroWebsitePath =
    escapeFilterPath(
      outroWebsiteFile
    );

  const outroBrandPath =
    escapeFilterPath(
      outroBrandFile
    );

  /*
   * =========================================================
   * VISUAL VALUES
   * =========================================================
   */

  const introFadeOutStart =
    INTRO_DURATION -
    0.35;

  const outroFadeOutStart =
    OUTRO_DURATION -
    0.35;

  /*
   * =========================================================
   * SELECTION DRAW FILTERS
   * =========================================================
   */

  const selectionDrawFilters =
    selectionPaths
      .map(
        (
          selectionPath,
          index
        ) =>
          `drawtext=fontfile='${boldFont}':` +
          `textfile='${selectionPath}':` +
          "fontcolor=white:" +
          `fontsize=${layout.selectionFontSize}:` +
          "line_spacing=5:" +
          `x=${layout.cardX + 38}:` +
          `y=${layout.selectionY[index]}`
      )
      .join(",");

  /*
   * =========================================================
   * FFMPEG FILTER GRAPH
   * =========================================================
   */

  const filter = [
    /*
     * =====================================================
     * INTRO
     * =====================================================
     */

    `color=c=${introBackground}:` +
      "s=1080x1920:" +
      "r=30:" +
      `d=${INTRO_DURATION}` +
      "[intro_bg]",

    "[intro_bg]" +

      "drawbox=" +
      "x=0:" +
      "y=0:" +
      "w=1080:" +
      "h=18:" +
      "color=0x38E878:" +
      "t=fill," +

      "drawbox=" +
      "x=90:" +
      "y=235:" +
      "w=900:" +
      "h=2:" +
      "color=0x38E878@0.65:" +
      "t=fill," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${introBrandPath}':` +
      "fontcolor=0x38E878:" +
      "fontsize=50:" +
      "x=(w-text_w)/2:" +
      "y=125," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${introTitlePath}':` +
      "fontcolor=white:" +
      "fontsize=66:" +
      "x=(w-text_w)/2:" +
      "y=365," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${introDatePath}':` +
      "fontcolor=0xD8E2DC:" +
      "fontsize=38:" +
      "x=(w-text_w)/2:" +
      "y=510," +

      "drawbox=" +
      "x=180:" +
      "y=735:" +
      "w=720:" +
      "h=440:" +
      "color=black@0.40:" +
      "t=fill," +

      "drawbox=" +
      "x=180:" +
      "y=735:" +
      "w=720:" +
      "h=440:" +
      "color=0x38E878@0.80:" +
      "t=4," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${introOddsLabelPath}':` +
      "fontcolor=white:" +
      "fontsize=42:" +
      "x=(w-text_w)/2:" +
      "y=820," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${introOddsPath}':` +
      "fontcolor=0x38E878:" +
      "fontsize=145:" +
      "x=(w-text_w)/2:" +
      "y=920," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${introFooterPath}':` +
      "fontcolor=white@0.80:" +
      "fontsize=32:" +
      "x=(w-text_w)/2:" +
      "y=1550," +

      "fade=" +
      "t=in:" +
      "st=0:" +
      "d=0.35," +

      "fade=" +
      "t=out:" +
      `st=${introFadeOutStart}:` +
      "d=0.35," +

      "format=yuv420p," +
      "setsar=1," +
      "setpts=PTS-STARTPTS" +

      "[intro_v]",

    /*
     * Intro silent audio.
     */

    "anullsrc=" +
      "r=48000:" +
      "cl=stereo," +

      `atrim=duration=${INTRO_DURATION},` +

      "asetpts=PTS-STARTPTS" +

      "[intro_a]",

    /* The recorded presenter is a self-contained introduction segment. */
    "[0:v]" +
      "scale=1080:1920:force_original_aspect_ratio=increase," +
      "crop=1080:1920," +
      "fps=30," +
      `trim=duration=${presenterDuration.toFixed(3)},` +
      "setpts=PTS-STARTPTS," +
      "format=yuv420p,setsar=1" +
      "[presenter_intro_v]",

    "[0:a]" +
      "aresample=48000," +
      "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo," +
      `atrim=duration=${presenterDuration.toFixed(3)},` +
      "loudnorm=I=-16:TP=-1.5:LRA=11," +
      `afade=t=out:st=${Math.max(0, presenterDuration - 0.18).toFixed(3)}:d=0.18,` +
      "asetpts=PTS-STARTPTS" +
      "[presenter_intro_a]",

    ...(hasHandoff
      ? [
          /* Branded holding card while the presenter introduces Mihai. */
          `color=c=0x063D24:s=1080x1920:r=30:d=${handoffDuration.toFixed(3)},` +
            "drawbox=x=0:y=0:w=1080:h=20:color=0x38E878:t=fill," +
            `drawtext=fontfile='${boldFont}':textfile='${introTitlePath}':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=760,` +
            `drawtext=fontfile='${boldFont}':textfile='${introBrandPath}':fontcolor=0x38E878:fontsize=38:x=(w-text_w)/2:y=875,` +
            "fade=t=in:st=0:d=0.18," +
            `fade=t=out:st=${Math.max(0, handoffDuration - 0.18).toFixed(3)}:d=0.18,` +
            "format=yuv420p,setsar=1,setpts=PTS-STARTPTS" +
            "[handoff_v]",

          "[2:a]" +
            "aresample=48000," +
            "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo," +
            `atrim=duration=${handoffDuration.toFixed(3)},` +
            "loudnorm=I=-16:TP=-1.5:LRA=11," +
            "afade=t=in:st=0:d=0.08," +
            `afade=t=out:st=${Math.max(0, handoffDuration - 0.12).toFixed(3)}:d=0.12,` +
            "asetpts=PTS-STARTPTS" +
            "[handoff_a]"
        ]
      : []),

    /* Short green broadcast slash between presenter and ticket. */
    "color=c=0x38E878:s=1080x1920:r=30:" +
      `d=${TRANSITION_DURATION}` +
      ",drawbox=x=720:y=0:w=360:h=1920:color=0x072B1A:t=fill" +
      ",format=yuv420p,setsar=1,setpts=PTS-STARTPTS" +
      "[transition_v]",

    /* A restrained audio sting makes the narrator change intentional. */
    "anoisesrc=color=pink:sample_rate=48000:" +
      `d=${TRANSITION_DURATION},` +
      "highpass=f=450," +
      "lowpass=f=4800," +
      "volume=0.10," +
      "afade=t=in:st=0:d=0.05," +
      `afade=t=out:st=0.25:d=${Math.max(0.1, TRANSITION_DURATION - 0.25).toFixed(2)},` +
      "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo," +
      "asetpts=PTS-STARTPTS" +
      "[transition_a]",

    /* Original football broadcast artwork enriches the ticket desk while the
     * dark central area keeps every selection readable. */
    `[${ticketBackgroundInput}:v]` +
      "scale=1080:1920:force_original_aspect_ratio=increase," +
      "crop=1080:1920," +
      "fps=30," +
      "eq=brightness=-0.10:saturation=0.78," +
      `trim=duration=${audioDuration.toFixed(3)},` +
      "setpts=PTS-STARTPTS" +
      "[main_base]",

    /*
     * =====================================================
     * TICKET CARD
     * =====================================================
     */

    "[main_base]" +

      `drawbox=x=${layout.cardX}:` +
      `y=${layout.cardY}:` +
      `w=${layout.cardWidth}:` +
      `h=${layout.cardHeight}:` +
      "color=black@0.68:" +
      "t=fill," +

      `drawbox=x=${layout.cardX}:` +
      `y=${layout.cardY}:` +
      `w=${layout.cardWidth}:` +
      `h=${layout.cardHeight}:` +
      "color=0x38E878@0.65:" +
      "t=3," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${mainHeadlinePath}':` +
      "fontcolor=white:" +
      `fontsize=${layout.headlineFontSize}:` +
      "x=(w-text_w)/2:" +
      `y=${layout.headlineY},` +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${mainTotalOddsPath}':` +
      "fontcolor=0x38E878:" +
      `fontsize=${layout.oddsFontSize}:` +
      "x=(w-text_w)/2:" +
      `y=${layout.oddsY},` +

      selectionDrawFilters +

      "," +

      "drawbox=" +
      "x=45:" +
      "y=1765:" +
      "w=990:" +
      "h=85:" +
      "color=black@0.72:" +
      "t=fill," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${mainCtaPath}':` +
      "fontcolor=0x38E878:" +
      "fontsize=30:" +
      "x=(w-text_w)/2:" +
      "y=1790," +

      `trim=duration=${audioDuration.toFixed(
        3
      )},` +

      "setpts=PTS-STARTPTS," +
      "format=yuv420p," +
      "setsar=1" +

      "[main_v]",

    /*
     * =====================================================
     * MAIN AUDIO
     * =====================================================
     */

    "[1:a]" +

      "aresample=48000," +

      "aformat=" +
      "sample_fmts=fltp:" +
      "sample_rates=48000:" +
      "channel_layouts=stereo," +

      "loudnorm=I=-16:TP=-1.5:LRA=11," +

      "afade=t=in:st=0:d=0.14," +

      `atrim=duration=${audioDuration.toFixed(
        3
      )},` +

      "asetpts=PTS-STARTPTS" +

      "[main_a]",

    /*
     * =====================================================
     * OUTRO
     * =====================================================
     */

    `color=c=${outroBackground}:` +
      "s=1080x1920:" +
      "r=30:" +
      `d=${OUTRO_DURATION}` +
      "[outro_bg]",

    "[outro_bg]" +

      "drawbox=" +
      "x=0:" +
      "y=1902:" +
      "w=1080:" +
      "h=18:" +
      "color=0x38E878:" +
      "t=fill," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${outroTopPath}':` +
      "fontcolor=white:" +
      "fontsize=42:" +
      "x=(w-text_w)/2:" +
      "y=410," +

      "drawbox=" +
      "x=120:" +
      "y=565:" +
      "w=840:" +
      "h=180:" +
      "color=0x38E878@0.16:" +
      "t=fill," +

      "drawbox=" +
      "x=120:" +
      "y=565:" +
      "w=840:" +
      "h=180:" +
      "color=0x38E878@0.75:" +
      "t=4," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${outroSubscribePath}':` +
      "fontcolor=0x38E878:" +
      "fontsize=78:" +
      "x=(w-text_w)/2:" +
      "y=600," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${outroMessagePath}':` +
      "fontcolor=white:" +
      "fontsize=32:" +
      "x=(w-text_w)/2:" +
      "y=865," +

      "drawbox=" +
      "x=130:" +
      "y=1110:" +
      "w=820:" +
      "h=180:" +
      "color=black@0.42:" +
      "t=fill," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${outroWebsitePath}':` +
      "fontcolor=0x38E878:" +
      "fontsize=48:" +
      "x=(w-text_w)/2:" +
      "y=1165," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${outroBrandPath}':` +
      "fontcolor=white@0.75:" +
      "fontsize=34:" +
      "x=(w-text_w)/2:" +
      "y=1560," +

      "fade=" +
      "t=in:" +
      "st=0:" +
      "d=0.35," +

      "fade=" +
      "t=out:" +
      `st=${outroFadeOutStart}:` +
      "d=0.35," +

      "format=yuv420p," +
      "setsar=1," +
      "setpts=PTS-STARTPTS" +

      "[outro_v]",

    /*
     * Outro silent audio.
     */

    "anullsrc=" +
      "r=48000:" +
      "cl=stereo," +

      `atrim=duration=${OUTRO_DURATION},` +

      "asetpts=PTS-STARTPTS" +

      "[outro_a]",

    /*
     * =====================================================
     * CONCAT INTRO + MAIN + OUTRO
     * =====================================================
     */

    "[intro_v][intro_a]" +
      "[presenter_intro_v][presenter_intro_a]" +
      (hasHandoff ? "[handoff_v][handoff_a]" : "") +
      "[transition_v][transition_a]" +
      "[main_v][main_a]" +
      "[outro_v][outro_a]" +

      "concat=" +
      `n=${hasHandoff ? 6 : 5}:` +
      "v=1:" +
      "a=1" +

      "[final_v][final_a]"
  ].join(";");

  /*
   * =========================================================
   * FFMPEG ARGUMENTS
   * =========================================================
   */

  const ffmpegArguments = [
    "-y",

    "-i",
    PRESENTER_FILE,

    "-i",
    AUDIO_FILE,

    ...(hasHandoff
      ? ["-i", HANDOFF_AUDIO_FILE]
      : []),

    "-loop",
    "1",
    "-i",
    TICKET_BACKGROUND_FILE,

    "-filter_complex",
    filter,

    "-map",
    "[final_v]",

    "-map",
    "[final_a]",

    "-c:v",
    "libx264",

    "-preset",
    "medium",

    "-crf",
    "21",

    "-profile:v",
    "high",

    "-level",
    "4.2",

    "-pix_fmt",
    "yuv420p",

    "-r",
    "30",

    "-c:a",
    "aac",

    "-b:a",
    "160k",

    "-ar",
    "48000",

    "-movflags",
    "+faststart",

    OUTPUT_FILE
  ];

  /*
   * =========================================================
   * RENDER
   * =========================================================
   */

  console.log(
    "[SHORTS] Rendering video with periodic randomized backgrounds..."
  );

  execFileSync(
    "ffmpeg",
    ffmpegArguments,
    {
      stdio:
        "inherit"
    }
  );

  requireFile(
    OUTPUT_FILE
  );

  console.log(
    `[SHORTS] Video generated successfully: ${OUTPUT_FILE}`
  );

  console.log(
    `[SHORTS] Final expected duration: ${finalDuration.toFixed(
      2
    )} seconds`
  );
}

/*
 * =========================================================
 * START
 * =========================================================
 */

try {
  main();
} catch (error) {
  console.error(
    "[SHORTS] Video rendering failed:"
  );

  console.error(error);

  process.exit(1);
}
