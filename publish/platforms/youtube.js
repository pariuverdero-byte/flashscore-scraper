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
  const resultsDirectory =
    path.dirname(RESULTS_FILE);

  fs.mkdirSync(
    resultsDirectory,
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

function readJsonFile(filePath) {
  requireFile(filePath);

  try {
    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );
  } catch (error) {
    throw new Error(
      `Invalid JSON file ${filePath}: ${error.message}`
    );
  }
}

function normalizeTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function normalizeDescription(value) {
  return String(value || "")
    .trim()
    .slice(0, 5000);
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .map((tag) =>
      String(tag || "").trim()
    )
    .filter(Boolean)
    .slice(0, 30);
}

function normalizePrivacyStatus(value) {
  const allowedStatuses = [
    "public",
    "private",
    "unlisted"
  ];

  const normalized =
    String(value || "private")
      .trim()
      .toLowerCase();

  if (
    !allowedStatuses.includes(
      normalized
    )
  ) {
    throw new Error(
      `Invalid YouTube privacy status: ${normalized}`
    );
  }

  return normalized;
}

async function main() {
  const manifest =
    readJsonFile(
      MANIFEST_FILE
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

      brand:
        manifest.brand || null,

      content:
        manifest.content || null,

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
    requireEnv(
      "YOUTUBE_CLIENT_ID"
    );

  const clientSecret =
    requireEnv(
      "YOUTUBE_CLIENT_SECRET"
    );

  const refreshToken =
    requireEnv(
      "YOUTUBE_REFRESH_TOKEN"
    );

  const oauth2Client =
    new google.auth.OAuth2(
      clientId,
      clientSecret
    );

  oauth2Client.setCredentials({
    refresh_token:
      refreshToken
  });

  /*
   * Force access-token refresh before upload.
   *
   * This validates that the client ID,
   * client secret and refresh token are valid.
   *
   * We intentionally do not call channels.list(),
   * because the current refresh token may only have
   * the youtube.upload scope.
   */
  const accessTokenResponse =
    await oauth2Client.getAccessToken();

  const accessToken =
    typeof accessTokenResponse === "string"
      ? accessTokenResponse
      : accessTokenResponse?.token;

  if (!accessToken) {
    throw new Error(
      "Google OAuth did not return an access token."
    );
  }

  console.log(
    "[YOUTUBE] OAuth access token refreshed successfully."
  );

  const youtube =
    google.youtube({
      version: "v3",
      auth: oauth2Client
    });

  const privacyStatus =
    normalizePrivacyStatus(
      youtubeConfig.privacyStatus ||
      process.env
        .YOUTUBE_PRIVACY_STATUS ||
      "private"
    );

  const title =
    normalizeTitle(
      youtubeConfig.title ||
      manifest.metadata?.title ||
      "Football Predictions"
    );

  if (!title) {
    throw new Error(
      "YouTube video title is empty."
    );
  }

  const description =
    normalizeDescription(
      youtubeConfig.description ||
      manifest.metadata?.description ||
      ""
    );

  const tags =
    normalizeTags(
      youtubeConfig.tags ||
      manifest.metadata?.tags ||
      []
    );

  const categoryId =
    String(
      youtubeConfig.categoryId ||
      "17"
    ).trim();

  const mimeType =
    String(
      manifest.media?.mimeType ||
      "video/mp4"
    ).trim();

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
    `[YOUTUBE] Category ID: ${categoryId}`
  );

  console.log(
    `[YOUTUBE] Tags: ${tags.length}`
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
          categoryId
        },

        status: {
          privacyStatus,
          selfDeclaredMadeForKids:
            false
        }
      },

      media: {
        mimeType,

        body:
          fs.createReadStream(
            videoFile
          )
      }
    });

  const videoId =
    response.data?.id;

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
      videoId,
      url: videoUrl,
      title,
      privacyStatus,
      categoryId
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

  console.log(
    `[YOUTUBE] Privacy: ${privacyStatus}`
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
    error?.response?.data ||
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
