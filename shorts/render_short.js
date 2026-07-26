import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const PAYLOAD_FILE =
  process.env.SHORTS_PAYLOAD_FILE ||
  "output/shorts_payload.json";

const PRESENTER_FILE =
  process.env.SHORTS_PRESENTER_FILE ||
  "assets/presenters/presenter-01.mp4";

const AUDIO_FILE =
  process.env.SHORTS_AUDIO_FILE ||
  "output/voice.mp3";

const OUTPUT_FILE =
  process.env.SHORTS_VIDEO_FILE ||
  "output/short.mp4";

const TEMP_DIR =
  process.env.SHORTS_RENDER_TEXT_DIR ||
  "output/render_text";

const FONT_REGULAR =
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

const FONT_BOLD =
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const INTRO_DURATION = 3;
const OUTRO_DURATION = 3;
const MAX_TOTAL_DURATION = 60;

/*
 * Random visual variation settings.
 *
 * A different combination is selected on every render:
 * - presenter start point;
 * - presenter horizontal position;
 * - presenter zoom;
 * - horizontal flip;
 * - background.
 */
const BACKGROUND_OPTIONS = [
  "0x07140D",
  "0x07170F",
  "0x0B1512",
  "0x0B171A",
  "0x111712",
  "0x0C1218"
];

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

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Required file does not exist: ${filePath}`
    );
  }

  if (fs.statSync(filePath).size === 0) {
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

function shorten(value, maxLength) {
  const text = cleanText(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text
    .slice(0, maxLength - 3)
    .trim()}...`;
}

function escapeFilterPath(filePath) {
  return path
    .resolve(filePath)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function writeTextFile(filename, value) {
  const filePath =
    path.join(TEMP_DIR, filename);

  fs.writeFileSync(
    filePath,
    `${cleanText(value)}\n`,
    "utf8"
  );

  return filePath;
}

function getMediaDuration(filePath) {
  const output = execFileSync(
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

  const duration = Number(output);

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

function formatDate(
  dateValue,
  language = "en"
) {
  const value = cleanText(dateValue);

  if (!value) {
    return language === "ro"
      ? "ASTĂZI"
      : "TODAY";
  }

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );

  if (!match) {
    return value.toUpperCase();
  }

  const [, year, month, day] = match;

  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day)
  );

  return new Intl.DateTimeFormat(
    language === "ro"
      ? "ro-RO"
      : "en-US",
    {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }
  )
    .format(date)
    .toUpperCase();
}

function createSelectionText(
  selection,
  language
) {
  const separator =
    language === "ro"
      ? " - "
      : " vs ";

  const teams =
    selection.home && selection.away
      ? `${selection.home}${separator}${selection.away}`
      : selection.teams;

  return shorten(
    `${teams} | ${selection.market} | ${selection.odds}`,
    78
  );
}

function randomItem(items) {
  return items[
    Math.floor(
      Math.random() * items.length
    )
  ];
}

function randomBoolean(probability = 0.5) {
  return Math.random() < probability;
}

function randomNumber(
  minimum,
  maximum,
  decimals = 2
) {
  const value =
    minimum +
    Math.random() *
      (maximum - minimum);

  return Number(
    value.toFixed(decimals)
  );
}

function getTicketLayout(
  ticketType,
  selectionCount
) {
  /*
   * Ticket of the Day generally has 3–4 selections,
   * so it receives a taller card and smaller text.
   *
   * Odds 2 generally has 2–3 selections and receives
   * a more compact card.
   */

  if (
    ticketType === "biletul_zilei" ||
    selectionCount === 4
  ) {
    return {
      cardX: 35,
      cardY: 35,
      cardWidth: 1010,
      cardHeight: 435,

      headlineY: 63,
      headlineFontSize: 39,

      oddsY: 120,
      oddsFontSize: 33,

      selectionFontSize: 22,
      selectionY: [
        190,
        245,
        300,
        355
      ],

      selectionMaxLength: 82
    };
  }

  return {
    cardX: 45,
    cardY: 40,
    cardWidth: 990,
    cardHeight: 365,

    headlineY: 70,
    headlineFontSize: 42,

    oddsY: 130,
    oddsFontSize: 36,

    selectionFontSize: 25,
    selectionY: [
      205,
      260,
      315,
      370
    ],

    selectionMaxLength: 72
  };
}

function main() {
  requireFile(PAYLOAD_FILE);
  requireFile(PRESENTER_FILE);
  requireFile(AUDIO_FILE);
  requireFile(FONT_REGULAR);
  requireFile(FONT_BOLD);

  const payload = JSON.parse(
    fs.readFileSync(
      PAYLOAD_FILE,
      "utf8"
    )
  );

  if (payload.status === "skipped") {
    console.log(
      `[SHORTS] Video rendering skipped: ${
        payload.reason ||
        "No suitable ticket"
      }`
    );

    return;
  }

  if (payload.status !== "ready") {
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
    cleanText(payload.ticketType);

  /*
   * Ticket of the Day can contain four events.
   * All four are now displayed.
   */
  const selections =
    Array.isArray(payload.selections)
      ? payload.selections.slice(0, 4)
      : [];

  if (selections.length === 0) {
    throw new Error(
      "No selections were found in the Shorts payload."
    );
  }

  fs.mkdirSync(
    path.dirname(OUTPUT_FILE),
    {
      recursive: true
    }
  );

  fs.mkdirSync(
    TEMP_DIR,
    {
      recursive: true
    }
  );

  const audioDuration =
    getMediaDuration(AUDIO_FILE);

  const presenterDuration =
    getMediaDuration(PRESENTER_FILE);

  const finalDuration =
    INTRO_DURATION +
    audioDuration +
    OUTRO_DURATION;

  if (finalDuration > MAX_TOTAL_DURATION) {
    throw new Error(
      `Final video would be ${finalDuration.toFixed(
        2
      )} seconds. Maximum allowed is ${MAX_TOTAL_DURATION} seconds.`
    );
  }

  /*
   * Random presenter variation.
   *
   * Start offset remains inside the original presenter clip.
   * The clip is looped afterward by FFmpeg.
   */
  const maximumStartOffset =
    Math.max(
      0,
      Math.min(
        presenterDuration - 0.35,
        2.6
      )
    );

  const presenterStartOffset =
    randomNumber(
      0,
      maximumStartOffset,
      2
    );

  const presenterZoom =
    randomItem(ZOOM_OPTIONS);

  const presenterXOffset =
    randomItem(
      HORIZONTAL_POSITION_OPTIONS
    );

  /*
   * Approximately 45% of videos are mirrored.
   */
  const presenterFlipped =
    randomBoolean(0.45);

  const mainBackground =
    randomItem(BACKGROUND_OPTIONS);

  let introBackground =
    randomItem(BACKGROUND_OPTIONS);

  let outroBackground =
    randomItem(BACKGROUND_OPTIONS);

  /*
   * Avoid having all three scenes use exactly
   * the same background when alternatives exist.
   */
  if (
    introBackground === mainBackground
  ) {
    introBackground =
      randomItem(BACKGROUND_OPTIONS);
  }

  if (
    outroBackground === mainBackground
  ) {
    outroBackground =
      randomItem(BACKGROUND_OPTIONS);
  }

  const layout =
    getTicketLayout(
      ticketType,
      selections.length
    );

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
    `[SHORTS] Presenter mirrored: ${presenterFlipped}`
  );

  console.log(
    `[SHORTS] Main background: ${mainBackground}`
  );

  console.log(
    `[SHORTS] Ticket layout: ${ticketType || "default"}`
  );

  console.log(
    `[SHORTS] Displayed selections: ${selections.length}`
  );

  const ticketTitle =
    payload.ticketLabel ||
    payload.visuals?.headline ||
    (
      language === "ro"
        ? "BILET COTA 2"
        : "ODDS 2 TICKET"
    );

  const totalOdds =
    payload.visuals?.totalOdds ||
    payload.totalOdds ||
    "-";

  const brandDisplay =
    payload.brand?.displayName ||
    payload.visuals?.brand ||
    (
      language === "ro"
        ? "PARIUVERDE"
        : "GREENBETTIPS"
    );

  const websiteDisplay =
    payload.brand?.websiteDisplay ||
    payload.visuals?.website ||
    payload.visuals?.callToAction ||
    (
      language === "ro"
        ? "WWW.PARIUVERDE.RO"
        : "WWW.GREENBETTIPS.COM"
    );

  const combinedOddsLabel =
    payload.visuals?.combinedOddsLabel ||
    (
      language === "ro"
        ? "COTA TOTALĂ"
        : "COMBINED ODDS"
    );

  const outroTop =
    payload.visuals?.outroTop ||
    (
      language === "ro"
        ? "ȚI-AU PLĂCUT PONTURILE?"
        : "ENJOYED TODAY'S PICKS?"
    );

  const subscribeText =
    payload.visuals?.subscribe ||
    (
      language === "ro"
        ? "ABONEAZĂ-TE"
        : "SUBSCRIBE"
    );

  const outroMessage =
    payload.visuals?.outroMessage ||
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

  const introTitle =
    language === "ro"
      ? ticketTitle
      : `TODAY'S ${ticketTitle}`;

  const mainOddsText =
    `${combinedOddsLabel}: ${totalOdds}`;

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
      payload.visuals?.headline ||
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
      writeTextFile(
        `selection_${index + 1}.txt`,
        selections[index]
          ? shorten(
              createSelectionText(
                selections[index],
                language
              ),
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

  const boldFont =
    escapeFilterPath(FONT_BOLD);

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

  const introFadeOutStart =
    INTRO_DURATION - 0.35;

  const outroFadeOutStart =
    OUTRO_DURATION - 0.35;

  const presenterWidth =
    Math.round(
      1080 * presenterZoom
    );

  const presenterHeight =
    Math.round(
      1920 * presenterZoom
    );

  const horizontalFlipFilter =
    presenterFlipped
      ? ",hflip"
      : "";

  const selectionDrawFilters =
    selectionPaths
      .map(
        (
          selectionPath,
          index
        ) =>
          `drawtext=fontfile='${boldFont}':` +
          `textfile='${selectionPath}':` +
          `fontcolor=white:` +
          `fontsize=${layout.selectionFontSize}:` +
          `x=(w-text_w)/2:` +
          `y=${layout.selectionY[index]}`
      )
      .join(",");

  const filter = [
    /*
     * INTRO
     */
    `color=c=${introBackground}:s=1080x1920:r=30:d=${INTRO_DURATION}[intro_bg]`,

    "[intro_bg]" +
      "drawbox=x=0:y=0:w=1080:h=18:" +
      "color=0x38E878:t=fill," +

      "drawbox=x=90:y=235:w=900:h=2:" +
      "color=0x38E878@0.65:t=fill," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${introBrandPath}':` +
      "fontcolor=0x38E878:fontsize=50:" +
      "x=(w-text_w)/2:y=125," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${introTitlePath}':` +
      "fontcolor=white:fontsize=66:" +
      "x=(w-text_w)/2:y=365," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${introDatePath}':` +
      "fontcolor=0xD8E2DC:fontsize=38:" +
      "x=(w-text_w)/2:y=510," +

      "drawbox=x=180:y=735:w=720:h=440:" +
      "color=black@0.40:t=fill," +

      "drawbox=x=180:y=735:w=720:h=440:" +
      "color=0x38E878@0.80:t=4," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${introOddsLabelPath}':` +
      "fontcolor=white:fontsize=42:" +
      "x=(w-text_w)/2:y=820," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${introOddsPath}':` +
      "fontcolor=0x38E878:fontsize=145:" +
      "x=(w-text_w)/2:y=920," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${introFooterPath}':` +
      "fontcolor=white@0.80:fontsize=32:" +
      "x=(w-text_w)/2:y=1550," +

      "fade=t=in:st=0:d=0.35," +
      `fade=t=out:st=${introFadeOutStart}:d=0.35,` +
      "format=yuv420p," +
      "setsar=1," +
      "setpts=PTS-STARTPTS[intro_v]",

    /*
     * INTRO SILENT AUDIO
     */
    "anullsrc=r=48000:cl=stereo," +
      `atrim=duration=${INTRO_DURATION},` +
      "asetpts=PTS-STARTPTS[intro_a]",

    /*
     * PRESENTER
     *
     * The presenter is randomly:
     * - offset in time;
     * - zoomed;
     * - shifted left or right;
     * - mirrored.
     */
    "[0:v]" +
      "scale=1080:1920:" +
      "force_original_aspect_ratio=decrease," +
      "pad=1080:1920:" +
      "(ow-iw)/2:(oh-ih)/2:" +
      "color=0x00FF00," +
      "fps=30," +
      "chromakey=0x00FF00:0.18:0.08," +
      "format=rgba," +
      `scale=${presenterWidth}:${presenterHeight}` +
      horizontalFlipFilter +
      "[person]",

    /*
     * RANDOM MAIN BACKGROUND
     */
    `color=c=${mainBackground}:s=1080x1920:r=30:d=${audioDuration.toFixed(
      3
    )}[main_bg]`,

    /*
     * RANDOMLY POSITIONED PRESENTER
     */
    "[main_bg][person]" +
      `overlay=(W-w)/2+${presenterXOffset}:` +
      "(H-h)/2:" +
      "shortest=1[main_base]",

    /*
     * TICKET-SPECIFIC CARD LAYOUT
     */
    "[main_base]" +
      `drawbox=x=${layout.cardX}:` +
      `y=${layout.cardY}:` +
      `w=${layout.cardWidth}:` +
      `h=${layout.cardHeight}:` +
      "color=black@0.68:t=fill," +

      `drawbox=x=${layout.cardX}:` +
      `y=${layout.cardY}:` +
      `w=${layout.cardWidth}:` +
      `h=${layout.cardHeight}:` +
      "color=0x38E878@0.65:t=3," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${mainHeadlinePath}':` +
      `fontcolor=white:` +
      `fontsize=${layout.headlineFontSize}:` +
      `x=(w-text_w)/2:` +
      `y=${layout.headlineY},` +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${mainTotalOddsPath}':` +
      `fontcolor=0x38E878:` +
      `fontsize=${layout.oddsFontSize}:` +
      `x=(w-text_w)/2:` +
      `y=${layout.oddsY},` +

      selectionDrawFilters +
      "," +

      "drawbox=x=45:y=1765:w=990:h=85:" +
      "color=black@0.72:t=fill," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${mainCtaPath}':` +
      "fontcolor=0x38E878:fontsize=30:" +
      "x=(w-text_w)/2:y=1790," +

      `trim=duration=${audioDuration.toFixed(
        3
      )},` +
      "setpts=PTS-STARTPTS," +
      "format=yuv420p," +
      "setsar=1[main_v]",

    /*
     * MAIN AUDIO
     */
    "[1:a]" +
      "aresample=48000," +
      "aformat=sample_fmts=fltp:" +
      "sample_rates=48000:" +
      "channel_layouts=stereo," +
      `atrim=duration=${audioDuration.toFixed(
        3
      )},` +
      "asetpts=PTS-STARTPTS[main_a]",

    /*
     * OUTRO
     */
    `color=c=${outroBackground}:s=1080x1920:r=30:d=${OUTRO_DURATION}[outro_bg]`,

    "[outro_bg]" +
      "drawbox=x=0:y=1902:w=1080:h=18:" +
      "color=0x38E878:t=fill," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${outroTopPath}':` +
      "fontcolor=white:fontsize=42:" +
      "x=(w-text_w)/2:y=410," +

      "drawbox=x=165:y=565:w=750:h=180:" +
      "color=0x38E878@0.16:t=fill," +

      "drawbox=x=165:y=565:w=750:h=180:" +
      "color=0x38E878@0.75:t=4," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${outroSubscribePath}':` +
      "fontcolor=0x38E878:fontsize=100:" +
      "x=(w-text_w)/2:y=600," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${outroMessagePath}':` +
      "fontcolor=white:fontsize=32:" +
      "x=(w-text_w)/2:y=865," +

      "drawbox=x=130:y=1110:w=820:h=180:" +
      "color=black@0.42:t=fill," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${outroWebsitePath}':` +
      "fontcolor=0x38E878:fontsize=48:" +
      "x=(w-text_w)/2:y=1165," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${outroBrandPath}':` +
      "fontcolor=white@0.75:fontsize=34:" +
      "x=(w-text_w)/2:y=1560," +

      "fade=t=in:st=0:d=0.35," +
      `fade=t=out:st=${outroFadeOutStart}:d=0.35,` +
      "format=yuv420p," +
      "setsar=1," +
      "setpts=PTS-STARTPTS[outro_v]",

    /*
     * OUTRO SILENT AUDIO
     */
    "anullsrc=r=48000:cl=stereo," +
      `atrim=duration=${OUTRO_DURATION},` +
      "asetpts=PTS-STARTPTS[outro_a]",

    /*
     * CONCATENATE INTRO + MAIN + OUTRO
     */
    "[intro_v][intro_a]" +
      "[main_v][main_a]" +
      "[outro_v][outro_a]" +
      "concat=n=3:v=1:a=1[final_v][final_a]"
  ].join(";");

  const ffmpegArguments = [
    "-y",

    /*
     * Begin the presenter clip from a random
     * position before looping it.
     */
    "-ss",
    presenterStartOffset.toFixed(2),

    "-stream_loop",
    "-1",

    "-i",
    PRESENTER_FILE,

    "-i",
    AUDIO_FILE,

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

  console.log(
    "[SHORTS] Rendering randomized presenter variation..."
  );

  execFileSync(
    "ffmpeg",
    ffmpegArguments,
    {
      stdio: "inherit"
    }
  );

  requireFile(OUTPUT_FILE);

  console.log(
    `[SHORTS] Video generated successfully: ${OUTPUT_FILE}`
  );

  console.log(
    `[SHORTS] Final expected duration: ${finalDuration.toFixed(
      2
    )} seconds`
  );
}

try {
  main();
} catch (error) {
  console.error(
    "[SHORTS] Video rendering failed:"
  );

  console.error(error);

  process.exit(1);
}
