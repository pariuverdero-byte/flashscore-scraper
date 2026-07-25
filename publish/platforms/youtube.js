import fs from "fs";
import path from "path";
import { google } from "googleapis";

const MANIFEST_FILE =
  process.env.DISTRIBUTION_MANIFEST_FILE ||
  "output/distribution_manifest.json";

const RESULTS_FILE =
  process.env.DISTRIBUTION_RESULTS_FILE ||
  "output/distribution_results.json";

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file does not exist: ${filePath}`);
  }

  if (fs.statSync(filePath).size === 0) {
    throw new Error(`Required file is empty: ${filePath}`);
  }
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function writeResults(data) {
  fs.mkdirSync(path.dirname(RESULTS_FILE), {
    recursive: true
  });

  fs.writeFileSync(
    RESULTS_FILE,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

async function main() {
  requireFile(MANIFEST_FILE);

  const manifest = JSON.parse(
    fs.readFileSync(MANIFEST_FILE, "utf8")
  );

  const youtubeConfig = manifest.platforms?.youtube;

  if (!youtubeConfig?.enabled) {
    console.log("[YOUTUBE] Publishing is disabled.");
    return;
  }

  const videoFile = manifest.media?.video;

  requireFile(videoFile);

  const oauth2Client = new google.auth.OAuth2(
    requireEnv("YOUTUBE_CLIENT_ID"),
    requireEnv("YOUTUBE_CLIENT_SECRET")
  );

  oauth2Client.setCredentials({
    refresh_token: requireEnv("YOUTUBE_REFRESH_TOKEN")
  });

  const youtube = google.youtube({
    version: "v3",
    auth: oauth2Client
  });

  console.log(
    `[YOUTUBE] Uploading ${videoFile} as ${
      youtubeConfig.privacyStatus || "private"
    }...`
  );

  const response = await youtube.videos.insert({
    part: ["snippet", "status"],

    requestBody: {
      snippet: {
        title: youtubeConfig.title,
        description: youtubeConfig.description,
        tags: youtubeConfig.tags,
        categoryId: youtubeConfig.categoryId || "17"
      },

      status: {
        privacyStatus:
          youtubeConfig.privacyStatus || "private",
        selfDeclaredMadeForKids: false
      }
    },

    media: {
      mimeType: manifest.media?.mimeType || "video/mp4",
      body: fs.createReadStream(videoFile)
    }
  });

  const videoId = response.data.id;

  if (!videoId) {
    throw new Error("YouTube did not return a video ID.");
  }

  const result = {
    status: "success",
    publishedAt: new Date().toISOString(),

    youtube: {
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: youtubeConfig.title,
      privacyStatus:
        youtubeConfig.privacyStatus || "private"
    }
  };

  writeResults(result);

  console.log(`[YOUTUBE] Upload successful.`);
  console.log(`[YOUTUBE] Video ID: ${videoId}`);
}

main().catch((error) => {
  const message =
    error?.response?.data?.error?.message ||
    error?.message ||
    String(error);

  writeResults({
    status: "failed",
    publishedAt: new Date().toISOString(),
    youtube: {
      error: message
    }
  });

  console.error("[YOUTUBE] Upload failed:");
  console.error(message);

  process.exit(1);
});
