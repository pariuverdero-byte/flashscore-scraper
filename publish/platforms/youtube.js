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

function requireEnv(name) {
  const value = process.env[name];

  if (!value || !String(value).trim()) {
    throw new Error(
      `Missing required environment variable: ${name}`
    );
  }

  return String(value).trim();
}

function writeResults(data) {
  fs.mkdirSync(
    path.dirname(RESULTS_FILE),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    RESULTS_FILE,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

async function main() {
  requireFile(MANIFEST_FILE);

  const manifest = JSON.parse(
    fs.readFileSync(
      MANIFEST_FILE,
      "utf8"
    )
  );

  if (manifest.status !== "ready") {
    throw new Error(
      `Unexpected manifest status: ${manifest.status}`
    );
  }

  const youtubeConfig =
    manifest.platforms?.youtube;

  if (!youtubeConfig?.enabled) {
    const result = {
      status: "skipped",
      generatedAt:
        new Date().toISOString(),
      youtube: {
        reason:
          "YouTube publishing is disabled in the manifest."
      }
    };

    writeResults(result);

    console.log(
      "[YOUTUBE] Publishing is disabled."
    );

    return;
  }

  const videoFile =
    manifest.media?.video;

  if (!videoFile) {
    throw new Error(
      "Manifest does not contain media.video."
    );
  }

  requireFile(videoFile);

  const clientId =
    requireEnv("YOUTUBE_CLIENT_ID");

  const clientSecret =
    requireEnv("YOUTUBE_CLIENT_SECRET");

  const refreshToken =
    requireEnv("YOUTUBE_REFRESH_TOKEN");

  const oauth2Client =
    new google.auth.OAuth2(
      clientId,
      clientSecret
    );

  oauth2Client.setCredentials({
    refresh_token: refreshToken
  });

  /*
   * Force token refresh now so OAuth errors
   * happen before the video upload starts.
   */
  await oauth2Client.getAccessToken();

  const youtube = google.youtube({
    version: "v3",
    auth: oauth2Client
  });

  /*
   * Identify the channel authorized by
   * the refresh token.
   */
  const channelResponse =
    await youtube.channels.list({
      part: ["snippet"],
      mine: true
    });

  const channels =
    channelResponse.data.items || [];

  if (channels.length === 0) {
    throw new Error(
      "The OAuth credentials do not return an authorized YouTube channel."
    );
  }

  const authorizedChannel =
    channels[0];

  const channelId =
    authorizedChannel.id || null;

  const channelTitle =
    authorizedChannel.snippet?.title ||
    "Unknown channel";

  console.log(
    `[YOUTUBE] Authorized channel: ${channelTitle}`
  );

  console.log(
    `[YOUTUBE] Authorized channel ID: ${channelId}`
  );

  const privacyStatus =
    youtubeConfig.privacyStatus ||
    "private";

  const title =
    String(
      youtubeConfig.title ||
      manifest.metadata?.title ||
      "Football Predictions"
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);

  const description =
    String(
      youtubeConfig.description ||
      manifest.metadata?.description ||
      ""
    ).trim();

  const tags =
    Array.isArray(youtubeConfig.tags)
      ? youtubeConfig.tags
          .map((tag) =>
            String(tag).trim()
          )
          .filter(Boolean)
          .slice(0, 30)
      : [];

  console.log(
    `[YOUTUBE] Uploading: ${videoFile}`
  );

  console.log(
    `[YOUTUBE] Title: ${title}`
  );

  console.log(
    `[YOUTUBE] Privacy: ${privacyStatus}`
  );

  console.log(
    `[YOUTUBE] Target channel: ${channelTitle}`
  );

  const response =
    await youtube.videos.insert({
      part: [
        "snippet",
        "status"
      ],

      requestBody: {
        snippet: {
          title,
          description,
          tags,
          categoryId:
            youtubeConfig.categoryId ||
            "17"
        },

        status: {
          privacyStatus,
          selfDeclaredMadeForKids: false
        }
      },

      media: {
        mimeType:
          manifest.media?.mimeType ||
          "video/mp4",

        body:
          fs.createReadStream(
            videoFile
          )
      }
    });

  const videoId =
    response.data.id;

  if (!videoId) {
    throw new Error(
      "YouTube did not return a video ID."
    );
  }

  const videoUrl =
    `https://www.youtube.com/watch?v=${videoId}`;

  const result = {
    status: "success",
    publishedAt:
      new Date().toISOString(),

    brand:
      manifest.brand || null,

    content:
      manifest.content || null,

    youtube: {
      channelId,
      channelTitle,
      videoId,
      url: videoUrl,
      title,
      privacyStatus
    }
  };

  writeResults(result);

  console.log(
    "[YOUTUBE] Upload successful."
  );

  console.log(
    `[YOUTUBE] Video ID: ${videoId}`
  );

  console.log(
    `[YOUTUBE] Video URL: ${videoUrl}`
  );
}

main().catch((error) => {
  const apiError =
    error?.response?.data?.error;

  const message =
    apiError?.message ||
    error?.message ||
    String(error);

  const details =
    apiError?.errors ||
    null;

  writeResults({
    status: "failed",
    publishedAt:
      new Date().toISOString(),

    youtube: {
      error: message,
      details
    }
  });

  console.error(
    "[YOUTUBE] Upload failed:"
  );

  console.error(message);

  if (details) {
    console.error(
      JSON.stringify(
        details,
        null,
        2
      )
    );
  }

  process.exit(1);
});
