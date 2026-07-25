import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const OUTPUT_ROOT =
  process.env.SHORTS_OUTPUT_ROOT || "output";

const PRESENTER_FILE =
  process.env.SHORTS_PRESENTER_FILE ||
  "assets/presenters/presenter-01.mp4";

const TTS_VOICE =
  process.env.SHORTS_TTS_VOICE ||
  "en-US-GuyNeural";

const TTS_RATE =
  process.env.SHORTS_TTS_RATE ||
  "+5%";

const YOUTUBE_PRIVACY_STATUS =
  process.env.YOUTUBE_PRIVACY_STATUS ||
  "public";

const TICKET_TYPES = [
  {
    type: "bilet_cota2",
    label: "Odds 2 Ticket"
  },
  {
    type: "biletul_zilei",
    label: "Ticket of the Day"
  }
];

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file does not exist: ${filePath}`);
  }

  if (fs.statSync(filePath).size === 0) {
    throw new Error(`Required file is empty: ${filePath}`);
  }
}

function readJson(filePath) {
  requireFile(filePath);

  return JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );
}

function runCommand(command, args, options = {}) {
  console.log(
    `[BUILD] Running: ${command} ${args.join(" ")}`
  );

  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      ...(options.env || {})
    }
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Command failed with exit code ${result.status}: ${command}`
    );
  }
}

function getVideoDetails(videoFile) {
  const result = spawnSync(
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

  return JSON.parse(result.stdout);
}

function validateVideo(videoFile) {
  requireFile(videoFile);

  const details = getVideoDetails(videoFile);

  const stream = details.streams?.[0];
  const format = details.format || {};

  const width = Number(stream?.width);
  const height = Number(stream?.height);
  const duration = Number(format.duration);

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
    size: Number(format.size || 0)
  };
}

function generateVoice({
  scriptFile,
  voiceFile,
  subtitlesFile
}) {
  requireFile(scriptFile);

  runCommand("edge-tts", [
    "--voice",
    TTS_VOICE,
    `--rate=${TTS_RATE}`,
    "--volume=+0%",
    "--file",
    scriptFile,
    "--write-media",
    voiceFile,
    "--write-subtitles",
    subtitlesFile
  ]);

  requireFile(voiceFile);
  requireFile(subtitlesFile);

  console.log(
    `[BUILD] Voice generated: ${voiceFile}`
  );
}

function renderVideo({
  payloadFile,
  voiceFile,
  subtitlesFile,
  videoFile,
  renderTextDir
}) {
  runCommand(
    "node",
    ["shorts/render_short.js"],
    {
      env: {
        SHORTS_PAYLOAD_FILE: payloadFile,
        SHORTS_PRESENTER_FILE: PRESENTER_FILE,
        SHORTS_AUDIO_FILE: voiceFile,
        SHORTS_SUBTITLES_FILE: subtitlesFile,
        SHORTS_VIDEO_FILE: videoFile,
        SHORTS_RENDER_TEXT_DIR: renderTextDir
      }
    }
  );

  requireFile(videoFile);
}

function generateManifest({
  payloadFile,
  videoFile,
  manifestFile
}) {
  runCommand(
    "node",
    ["publish/generate_manifest.js"],
    {
      env: {
        SHORTS_PAYLOAD_FILE: payloadFile,
        SHORTS_VIDEO_FILE: videoFile,
        DISTRIBUTION_MANIFEST_FILE: manifestFile,
        YOUTUBE_PRIVACY_STATUS
      }
    }
  );

  requireFile(manifestFile);

  console.log(
    `[BUILD] Manifest generated: ${manifestFile}`
  );
}

function buildTicket(ticket) {
  const ticketDir = path.join(
    OUTPUT_ROOT,
    ticket.type
  );

  const payloadFile = path.join(
    ticketDir,
    "shorts_payload.json"
  );

  const scriptFile = path.join(
    ticketDir,
    "voice_script.txt"
  );

  const voiceFile = path.join(
    ticketDir,
    "voice.mp3"
  );

  const subtitlesFile = path.join(
    ticketDir,
    "subs.srt"
  );

  const videoFile = path.join(
    ticketDir,
    "short.mp4"
  );

  const manifestFile = path.join(
    ticketDir,
    "distribution_manifest.json"
  );

  const renderTextDir = path.join(
    ticketDir,
    "render_text"
  );

  fs.mkdirSync(ticketDir, {
    recursive: true
  });

  console.log("");
  console.log(
    `========== ${ticket.label} ==========`
  );

  if (!fs.existsSync(payloadFile)) {
    return {
      ticketType: ticket.type,
      label: ticket.label,
      status: "missing",
      reason: `Payload not found: ${payloadFile}`
    };
  }

  const payload = readJson(payloadFile);

  if (payload.status === "skipped") {
    console.log(
      `[BUILD] ${ticket.label} skipped: ${
        payload.reason || "No suitable ticket"
      }`
    );

    return {
      ticketType: ticket.type,
      label: ticket.label,
      status: "skipped",
      reason:
        payload.reason ||
        "No suitable ticket was generated"
    };
  }

  if (payload.status !== "ready") {
    throw new Error(
      `${ticket.label} has unexpected payload status: ${payload.status}`
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
    validateVideo(videoFile);

  generateManifest({
    payloadFile,
    videoFile,
    manifestFile
  });

  const manifest = readJson(manifestFile);

  return {
    ticketType: ticket.type,
    label: ticket.label,
    status: "ready",
    payloadFile,
    voiceFile,
    subtitlesFile,
    videoFile,
    manifestFile,
    youtube: {
      enabled:
        manifest.platforms?.youtube?.enabled ===
        true,
      privacyStatus:
        manifest.platforms?.youtube
          ?.privacyStatus || null,
      title:
        manifest.platforms?.youtube?.title ||
        null
    },
    video: videoDetails
  };
}

function main() {
  requireFile(PRESENTER_FILE);

  const startedAt = new Date().toISOString();
  const results = [];

  console.log(
    `[BUILD] Starting Shorts engine at ${startedAt}`
  );

  console.log(
    `[BUILD] Presenter: ${PRESENTER_FILE}`
  );

  console.log(
    `[BUILD] YouTube privacy: ${YOUTUBE_PRIVACY_STATUS}`
  );

  for (const ticket of TICKET_TYPES) {
    try {
      const result = buildTicket(ticket);
      results.push(result);
    } catch (error) {
      console.error(
        `[BUILD] ${ticket.label} failed:`
      );
      console.error(error);

      results.push({
        ticketType: ticket.type,
        label: ticket.label,
        status: "failed",
        error:
          error?.message ||
          String(error)
      });
    }
  }

  const summary = {
    status: results.some(
      (item) => item.status === "failed"
    )
      ? "partial_failure"
      : "success",

    startedAt,
    completedAt: new Date().toISOString(),

    configuration: {
      outputRoot: OUTPUT_ROOT,
      presenterFile: PRESENTER_FILE,
      ttsVoice: TTS_VOICE,
      ttsRate: TTS_RATE,
      youtubePrivacyStatus:
        YOUTUBE_PRIVACY_STATUS
    },

    results
  };

  const summaryFile = path.join(
    OUTPUT_ROOT,
    "build_summary.json"
  );

  fs.mkdirSync(OUTPUT_ROOT, {
    recursive: true
  });

  fs.writeFileSync(
    summaryFile,
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  console.log("");
  console.log("========== BUILD SUMMARY ==========");

  for (const result of results) {
    console.log(
      `${result.ticketType}: ${result.status}`
    );

    if (result.reason) {
      console.log(`  Reason: ${result.reason}`);
    }

    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }

    if (result.videoFile) {
      console.log(
        `  Video: ${result.videoFile}`
      );
    }
  }

  console.log(
    `[BUILD] Summary saved: ${summaryFile}`
  );

  if (summary.status === "partial_failure") {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(
    "[BUILD] Shorts engine failed:"
  );
  console.error(error);
  process.exit(1);
}
