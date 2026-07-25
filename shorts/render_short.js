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

const TEMP_DIR = "output/render_text";

const FONT_REGULAR =
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

const FONT_BOLD =
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const INTRO_DURATION = 3;
const OUTRO_DURATION = 3;
const MAX_TOTAL_DURATION = 60;

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file does not exist: ${filePath}`);
  }

  if (fs.statSync(filePath).size === 0) {
    throw new Error(`Required file is empty: ${filePath}`);
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

  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function escapeFilterPath(filePath) {
  return path
    .resolve(filePath)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function writeTextFile(filename, value) {
  const filePath = path.join(TEMP_DIR, filename);

  fs.writeFileSync(
    filePath,
    `${cleanText(value)}\n`,
    "utf8"
  );

  return filePath;
}

function getAudioDuration(filePath) {
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

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(
      `Could not determine audio duration: ${output}`
    );
  }

  return duration;
}

function formatDate(dateValue) {
  const value = cleanText(dateValue);

  if (!value) {
    return "TODAY";
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

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  })
    .format(date)
    .toUpperCase();
}

function createSelectionText(selection) {
  const teams =
    selection.home && selection.away
      ? `${selection.home} vs ${selection.away}`
      : selection.teams;

  return shorten(
    `${teams} | ${selection.market} | ${selection.odds}`,
    72
  );
}

function main() {
  requireFile(PAYLOAD_FILE);
  requireFile(PRESENTER_FILE);
  requireFile(AUDIO_FILE);
  requireFile(FONT_REGULAR);
  requireFile(FONT_BOLD);

  const payload = JSON.parse(
    fs.readFileSync(PAYLOAD_FILE, "utf8")
  );

  if (payload.status === "skipped") {
    console.log(
      `[SHORTS] Video rendering skipped: ${payload.reason}`
    );
    return;
  }

  if (payload.status !== "ready") {
    throw new Error(
      `Unexpected Shorts payload status: ${payload.status}`
    );
  }

  const selections = Array.isArray(payload.selections)
    ? payload.selections.slice(0, 3)
    : [];

  if (selections.length === 0) {
    throw new Error(
      "No selections were found in the Shorts payload."
    );
  }

  fs.mkdirSync(
    path.dirname(OUTPUT_FILE),
    { recursive: true }
  );

  fs.mkdirSync(
    TEMP_DIR,
    { recursive: true }
  );

  const audioDuration = getAudioDuration(AUDIO_FILE);

  const finalDuration =
    INTRO_DURATION +
    audioDuration +
    OUTRO_DURATION;

  console.log(
    `[SHORTS] Audio duration: ${audioDuration.toFixed(2)} seconds`
  );

  console.log(
    `[SHORTS] Estimated final duration: ${finalDuration.toFixed(2)} seconds`
  );

  if (finalDuration > MAX_TOTAL_DURATION) {
    throw new Error(
      `Final video would be ${finalDuration.toFixed(
        2
      )} seconds. Maximum allowed is ${MAX_TOTAL_DURATION} seconds.`
    );
  }

  const ticketTitle =
    payload.ticketLabel ||
    payload.visuals?.headline ||
    "ODDS 2 TICKET";

  const totalOdds =
    payload.visuals?.totalOdds ||
    payload.totalOdds ||
    "-";

  const formattedDate = formatDate(payload.date);

  const introBrandFile = writeTextFile(
    "intro_brand.txt",
    "GREENBETTIPS"
  );

  const introTitleFile = writeTextFile(
    "intro_title.txt",
    `TODAY'S ${ticketTitle}`
  );

  const introDateFile = writeTextFile(
    "intro_date.txt",
    formattedDate
  );

  const introOddsLabelFile = writeTextFile(
    "intro_odds_label.txt",
    "COMBINED ODDS"
  );

  const introOddsFile = writeTextFile(
    "intro_odds.txt",
    totalOdds
  );

  const mainHeadlineFile = writeTextFile(
    "main_headline.txt",
    payload.visuals?.headline ||
      ticketTitle ||
      "TODAY'S FOOTBALL PICKS"
  );

  const mainTotalOddsFile = writeTextFile(
    "main_total_odds.txt",
    `COMBINED ODDS: ${totalOdds}`
  );

  const selection1File = writeTextFile(
    "selection_1.txt",
    createSelectionText(selections[0])
  );

  const selection2File = writeTextFile(
    "selection_2.txt",
    selections[1]
      ? createSelectionText(selections[1])
      : ""
  );

  const selection3File = writeTextFile(
    "selection_3.txt",
    selections[2]
      ? createSelectionText(selections[2])
      : ""
  );

  const mainCtaFile = writeTextFile(
    "main_cta.txt",
    "WWW.GREENBETTIPS.COM"
  );

  const outroTopFile = writeTextFile(
    "outro_top.txt",
    "ENJOYED TODAY'S PICKS?"
  );

  const outroSubscribeFile = writeTextFile(
    "outro_subscribe.txt",
    "SUBSCRIBE"
  );

  const outroMessageFile = writeTextFile(
    "outro_message.txt",
    "FOR DAILY FOOTBALL PREDICTIONS"
  );

  const outroWebsiteFile = writeTextFile(
    "outro_website.txt",
    "WWW.GREENBETTIPS.COM"
  );

  const boldFont =
    escapeFilterPath(FONT_BOLD);

  const introBrandPath =
    escapeFilterPath(introBrandFile);

  const introTitlePath =
    escapeFilterPath(introTitleFile);

  const introDatePath =
    escapeFilterPath(introDateFile);

  const introOddsLabelPath =
    escapeFilterPath(introOddsLabelFile);

  const introOddsPath =
    escapeFilterPath(introOddsFile);

  const mainHeadlinePath =
    escapeFilterPath(mainHeadlineFile);

  const mainTotalOddsPath =
    escapeFilterPath(mainTotalOddsFile);

  const selection1Path =
    escapeFilterPath(selection1File);

  const selection2Path =
    escapeFilterPath(selection2File);

  const selection3Path =
    escapeFilterPath(selection3File);

  const mainCtaPath =
    escapeFilterPath(mainCtaFile);

  const outroTopPath =
    escapeFilterPath(outroTopFile);

  const outroSubscribePath =
    escapeFilterPath(outroSubscribeFile);

  const outroMessagePath =
    escapeFilterPath(outroMessageFile);

  const outroWebsitePath =
    escapeFilterPath(outroWebsiteFile);

  const introFadeOutStart =
    INTRO_DURATION - 0.35;

  const outroFadeOutStart =
    OUTRO_DURATION - 0.35;

  const filter = [
    /*
     * INTRO
     */
    `color=c=0x07140D:s=1080x1920:r=30:d=${INTRO_DURATION}[intro_bg]`,

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
      "text='DAILY FOOTBALL PREDICTIONS':" +
      "fontcolor=white@0.80:fontsize=32:" +
      "x=(w-text_w)/2:y=1550," +

      "fade=t=in:st=0:d=0.35," +
      `fade=t=out:st=${introFadeOutStart}:d=0.35,` +
      "format=yuv420p," +
      "setsar=1," +
      "setpts=PTS-STARTPTS[intro_v]",

    /*
     * INTRO SILENCE
     */
    "anullsrc=r=48000:cl=stereo," +
      `atrim=duration=${INTRO_DURATION},` +
      "asetpts=PTS-STARTPTS[intro_a]",

    /*
     * PRESENTER
     */
    "[0:v]" +
      "scale=1080:1920:" +
      "force_original_aspect_ratio=decrease," +
      "pad=1080:1920:" +
      "(ow-iw)/2:(oh-ih)/2:" +
      "color=0x00FF00," +
      "fps=30," +
      "chromakey=0x00FF00:0.18:0.08," +
      "format=rgba[person]",

    /*
     * MAIN BACKGROUND
     */
    `color=c=0x07140D:s=1080x1920:r=30:d=${audioDuration.toFixed(
      3
    )}[main_bg]`,

    /*
     * MAIN VIDEO
     */
    "[main_bg][person]" +
      "overlay=(W-w)/2:(H-h)/2:" +
      "shortest=1[main_base]",

    "[main_base]" +
      "drawbox=x=45:y=40:w=990:h=365:" +
      "color=black@0.68:t=fill," +

      "drawbox=x=45:y=40:w=990:h=365:" +
      "color=0x38E878@0.65:t=3," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${mainHeadlinePath}':` +
      "fontcolor=white:fontsize=42:" +
      "x=(w-text_w)/2:y=70," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${mainTotalOddsPath}':` +
      "fontcolor=0x38E878:fontsize=36:" +
      "x=(w-text_w)/2:y=130," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${selection1Path}':` +
      "fontcolor=white:fontsize=25:" +
      "x=(w-text_w)/2:y=205," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${selection2Path}':` +
      "fontcolor=white:fontsize=25:" +
      "x=(w-text_w)/2:y=260," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${selection3Path}':` +
      "fontcolor=white:fontsize=25:" +
      "x=(w-text_w)/2:y=315," +

      "drawbox=x=45:y=1765:w=990:h=85:" +
      "color=black@0.72:t=fill," +

      `drawtext=fontfile='${boldFont}':` +
      `textfile='${mainCtaPath}':` +
      "fontcolor=0x38E878:fontsize=30:" +
      "x=(w-text_w)/2:y=1790," +

      `trim=duration=${audioDuration.toFixed(3)},` +
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
      `atrim=duration=${audioDuration.toFixed(3)},` +
      "asetpts=PTS-STARTPTS[main_a]",

    /*
     * OUTRO
     */
    `color=c=0x07140D:s=1080x1920:r=30:d=${OUTRO_DURATION}[outro_bg]`,

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
      "text='GREENBETTIPS':" +
      "fontcolor=white@0.75:fontsize=34:" +
      "x=(w-text_w)/2:y=1560," +

      "fade=t=in:st=0:d=0.35," +
      `fade=t=out:st=${outroFadeOutStart}:d=0.35,` +
      "format=yuv420p," +
      "setsar=1," +
      "setpts=PTS-STARTPTS[outro_v]",

    /*
     * OUTRO SILENCE
     */
    "anullsrc=r=48000:cl=stereo," +
      `atrim=duration=${OUTRO_DURATION},` +
      "asetpts=PTS-STARTPTS[outro_a]",

    /*
     * CONCAT
     */
    "[intro_v][intro_a]" +
      "[main_v][main_a]" +
      "[outro_v][outro_a]" +
      "concat=n=3:v=1:a=1[final_v][final_a]"
  ].join(";");

  const ffmpegArguments = [
    "-y",

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
    "[SHORTS] Rendering intro, presenter and subscribe ending..."
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
