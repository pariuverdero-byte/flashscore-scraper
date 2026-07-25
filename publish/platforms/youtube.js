import fs from "fs";
import { google } from "googleapis";

const MANIFEST_FILE =
  process.env.DISTRIBUTION_MANIFEST_FILE ||
  "output/distribution_manifest.json";

const RESULTS_FILE =
  process.env.DISTRIBUTION_RESULTS_FILE ||
  "output/distribution_results.json";

function requireValue(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}`
    );
  }

  return value;
}

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file does not exist: ${filePath}`);
  }

  if (fs.statSync(filePath).size === 0) {
    throw new Error(`Required file is empty: ${filePath}`);
  }
}

function writeResults(results) {
  fs.writeFileSync(
    RESULTS_FILE,
    JSON.stringify(results, null, 2),
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

  const clientId =
    requireValue("YOUTUBE_CLIENT_ID");

  const clientSecret =
    requireValue("YOUTUBE_CLIENT_SECRET");

  const refreshToken =
    requireValue("YOUTUBE_REFRESH_TOKEN");

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken
  });

  const youtube = google.youtube({
    version: "v3",
    auth: oauth2Client
  });

  console.log(
    `[YOUTUBE] Uploading ${videoFile} as ${youtubeConfig.privacyStatus}...`
  );

  const response = await youtube.videos.insert({
    part: [
      "snippet",
      "status"
    ],

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
    throw new Error(
      "YouTube upload completed without returning a video ID."
    );
  }

  const videoUrl =
    `https://www.youtube.com/watch?v=${videoId}`;

  const results = {
    status: "success",
    generatedAt: new Date().toISOString(),

    youtube: {
      videoId,
      url: videoUrl,
      privacyStatus:
        youtubeConfig.privacyStatus || "private",
      title: youtubeConfig.title
    }
  };

  writeResults(results);

  console.log(
    `[YOUTUBE] Upload successful: ${videoUrl}`
  );
}

main().catch((error) => {
  const results = {
    status: "failed",
    generatedAt: new Date().toISOString(),

    youtube: {
      error:
        error?.response?.data?.error?.message ||
        error.message ||
        String(error)
    }
  };

  writeResults(results);

  console.error("[YOUTUBE] Upload failed:");
  console.error(error);

  process.exit(1);
});
