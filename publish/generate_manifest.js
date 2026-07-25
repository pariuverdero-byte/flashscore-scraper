import fs from "fs";
import path from "path";

const PAYLOAD_FILE =
  process.env.SHORTS_PAYLOAD_FILE ||
  "output/shorts_payload.json";

const VIDEO_FILE =
  process.env.SHORTS_VIDEO_FILE ||
  "output/short.mp4";

const OUTPUT_FILE =
  process.env.DISTRIBUTION_MANIFEST_FILE ||
  "output/distribution_manifest.json";

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file does not exist: ${filePath}`);
  }

  if (fs.statSync(filePath).size === 0) {
    throw new Error(`Required file is empty: ${filePath}`);
  }
}

function clean(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHashtag(value) {
  return clean(value)
    .replace(/^#/, "")
    .replace(/[^a-zA-Z0-9_]/g, "");
}

function main() {
  requireFile(PAYLOAD_FILE);
  requireFile(VIDEO_FILE);

  const payload = JSON.parse(
    fs.readFileSync(PAYLOAD_FILE, "utf8")
  );

  if (payload.status === "skipped") {
    console.log(
      `[PUBLISH] Manifest skipped: ${payload.reason}`
    );
    return;
  }

  if (payload.status !== "ready") {
    throw new Error(
      `Unexpected payload status: ${payload.status}`
    );
  }

  const baseHashtags = [
    "football",
    "footballpredictions",
    "bettingtips",
    "soccer",
    "greenbettips",
    "shorts"
  ];

  const payloadTags = Array.isArray(payload.youtube?.tags)
    ? payload.youtube.tags
    : [];

  const hashtags = [
    ...new Set(
      [...baseHashtags, ...payloadTags]
        .map(normalizeHashtag)
        .filter(Boolean)
    )
  ];

  const title =
    clean(payload.youtube?.title) ||
    `${payload.ticketLabel || "Football Picks"} #shorts`;

  const description =
    clean(payload.youtube?.description) ||
    `Daily football predictions from GreenBetTips. Full ticket: https://greenbettips.com`;

  const manifest = {
    status: "ready",
    version: 1,
    generatedAt: new Date().toISOString(),

    content: {
      id: `${payload.date || "today"}-${payload.ticketType || "ticket"}`,
      language: payload.language || "en",
      date: payload.date || null,
      ticketType: payload.ticketType || null,
      ticketLabel: payload.ticketLabel || null,
      totalOdds:
        payload.visuals?.totalOdds ||
        payload.totalOdds ||
        null
    },

    media: {
      video: VIDEO_FILE,
      mimeType: "video/mp4",
      format: "vertical",
      aspectRatio: "9:16"
    },

    brand: {
      name: "GreenBetTips",
      website: "https://greenbettips.com"
    },

    metadata: {
      title,
      description,
      hashtags
    },

    platforms: {
      youtube: {
        enabled: true,
        title,
        description:
          `${description}\n\n` +
          hashtags.map((tag) => `#${tag}`).join(" "),
        tags: hashtags,
        categoryId: "17",
        privacyStatus:
          process.env.YOUTUBE_PRIVACY_STATUS || "private"
      },

      tiktok: {
        enabled: false,
        caption:
          `${title}\n\n` +
          hashtags
            .filter((tag) => tag !== "shorts")
            .map((tag) => `#${tag}`)
            .join(" ")
      },

      instagram: {
        enabled: false,
        caption:
          `${title}\n\n${description}\n\n` +
          hashtags
            .filter((tag) => tag !== "shorts")
            .map((tag) => `#${tag}`)
            .join(" ")
      },

      facebook: {
        enabled: false,
        description:
          `${title}\n\n${description}`
      }
    }
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), {
    recursive: true
  });

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  console.log(
    `[PUBLISH] Distribution manifest created: ${OUTPUT_FILE}`
  );
}

try {
  main();
} catch (error) {
  console.error(
    "[PUBLISH] Manifest generation failed:"
  );
  console.error(error);
  process.exit(1);
}
