import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const PAYLOAD_FILE =
  process.env.SHORTS_PAYLOAD_FILE || "output/shorts_payload.json";

const PRESENTER_FILE =
  process.env.SHORTS_PRESENTER_FILE ||
  "assets/presenters/presenter-01.mp4";

const AUDIO_FILE =
  process.env.SHORTS_AUDIO_FILE || "output/voice.mp3";

const SUBTITLES_FILE =
  process.env.SHORTS_SUBTITLES_FILE || "output/subs.srt";

const OUTPUT_FILE =
  process.env.SHORTS_VIDEO_FILE || "output/short.mp4";

const TEMP_DIR = "output/render_text";

const FONT_REGULAR =
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

const FONT_BOLD =
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

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

function writeTextFile(filename, value) {
  const filePath = path.join(TEMP_DIR, filename);

  fs.writeFileSync(filePath, `${cleanText(value)}\n`, "utf8");

  return filePath;
}

function createSelectionText(selection) {
  const teams =
    selection.home && selection.away
      ? `${selection.home} vs ${selection.away}`
      : selection.teams;

  return shorten(
    `${teams} | ${selection.market} | ${selection.odds}`,
    74
  );
}

function escapeFilterPath(filePath) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function main() {
  requireFile(PAYLOAD_FILE);
  requireFile(PRESENTER_FILE);
  requireFile(AUDIO_FILE);
  requireFile(SUBTITLES_FILE);
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

  fs.mkdirSync(path.dirname(OUTPUT_FILE), {
    recursive: true
  });

  fs.mkdirSync(TEMP_DIR, {
    recursive: true
  });

  const selections = Array.isArray(payload.selections)
    ? payload.selections.slice(0, 3)
    : [];

  if (selections.length === 0) {
    throw new Error("No selections were found in the payload.");
  }

  const headlineFile = writeTextFile(
    "headline.txt",
    payload.visuals?.headline || "TODAY'S FOOTBALL PICKS"
  );

  const totalOddsFile = writeTextFile(
    "total_odds.txt",
    `COMBINED ODDS: ${
      payload.visuals?.totalOdds ||
      payload.totalOdds ||
      "-"
    }`
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

  const ctaFile = writeTextFile(
    "cta.txt",
    payload.visuals?.callToAction ||
      "FULL TICKET AT GREENBETTIPS.COM"
  );

  const subtitlePath = escapeFilterPath(SUBTITLES_FILE);
  const boldFontPath = escapeFilterPath(FONT_BOLD);

  const filter = [
    "[0:v]" +
      "scale=1080:1920:force_original_aspect_ratio=decrease," +
      "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x00FF00," +
      "fps=30," +
      "chromakey=0x00FF00:0.18:0.08," +
      "format=rgba[person]",

    "[2:v][person]" +
      "overlay=(W-w)/2:(H-h)/2:shortest=1[base]",

    "[base]" +
      "drawbox=x=45:y=55:w=990:h=430:" +
      "color=black@0.68:t=fill," +

      `drawtext=fontfile='${boldFontPath}':` +
      `textfile='${escapeFilterPath(headlineFile)}':` +
      "fontcolor=white:fontsize=54:" +
      "x=(w-text_w)/2:y=90," +

      `drawtext=fontfile='${boldFontPath}':` +
      `textfile='${escapeFilterPath(totalOddsFile)}':` +
      "fontcolor=0x65FF8F:fontsize=46:" +
      "x=(w-text_w)/2:y=170," +

      `drawtext=fontfile='${boldFontPath}':` +
      `textfile='${escapeFilterPath(selection1File)}':` +
      "fontcolor=white:fontsize=31:" +
      "x=(w-text_w)/2:y=260," +

      `drawtext=fontfile='${boldFontPath}':` +
      `textfile='${escapeFilterPath(selection2File)}':` +
      "fontcolor=white:fontsize=31:" +
      "x=(w-text_w)/2:y=325," +

      `drawtext=fontfile='${boldFontPath}':` +
      `textfile='${escapeFilterPath(selection3File)}':` +
      "fontcolor=white:fontsize=31:" +
      "x=(w-text_w)/2:y=390," +

      "drawbox=x=45:y=1740:w=990:h=115:" +
      "color=black@0.72:t=fill," +

      `drawtext=fontfile='${boldFontPath}':` +
      `textfile='${escapeFilterPath(ctaFile)}':` +
      "fontcolor=0x65FF8F:fontsize=34:" +
      "x=(w-text_w)/2:y=1777," +

      `subtitles='${subtitlePath}':` +
      "force_style='" +
      "FontName=DejaVu Sans," +
      "FontSize=20," +
      "Bold=1," +
      "PrimaryColour=&H00FFFFFF," +
      "OutlineColour=&H00000000," +
      "BackColour=&H90000000," +
      "BorderStyle=3," +
      "Outline=2," +
      "Shadow=0," +
      "Alignment=2," +
      "MarginL=70," +
      "MarginR=70," +
      "MarginV=225" +
      "'[video]"
  ].join(";");

  const ffmpegArguments = [
    "-y",

    "-stream_loop",
    "-1",
    "-i",
    PRESENTER_FILE,

    "-i",
    AUDIO_FILE,

    "-f",
    "lavfi",
    "-i",
    "color=c=0x07140D:s=1080x1920:r=30",

    "-filter_complex",
    filter,

    "-map",
    "[video]",

    "-map",
    "1:a:0",

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

    "-shortest",

    OUTPUT_FILE
  ];

  console.log("[SHORTS] Rendering vertical video...");

  execFileSync("ffmpeg", ffmpegArguments, {
    stdio: "inherit"
  });

  requireFile(OUTPUT_FILE);

  console.log(
    `[SHORTS] Video generated successfully: ${OUTPUT_FILE}`
  );
}

try {
  main();
} catch (error) {
  console.error("[SHORTS] Video rendering failed:");
  console.error(error);
  process.exit(1);
}
