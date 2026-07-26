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

  if (fs.statSync(filePath).size === 0) {
    throw new Error(
      `Required file is empty: ${filePath}`
    );
  }
}

function readJson(filePath) {
  requireFile(filePath);

  return JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );
}

/*
 * =========================================================
 * TEXT HELPERS
 * =========================================================
 */

function cleanInline(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMultiline(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function slugify(value) {
  return cleanInline(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeHashtag(value) {
  return cleanInline(value)
    .replace(/^#+/, "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}_]/gu, "");
}

function uniqueHashtags(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const normalized =
      normalizeHashtag(value);

    if (!normalized) {
      continue;
    }

    const key =
      normalized.toLocaleLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
  }

  return output;
}

function formatHashtags(hashtags) {
  return hashtags
    .map((tag) => `#${tag}`)
    .join(" ");
}

function appendHashtags(
  description,
  hashtags
) {
  const cleanedDescription =
    cleanMultiline(description);

  const hashtagLine =
    formatHashtags(hashtags);

  if (!hashtagLine) {
    return cleanedDescription;
  }

  const existingTags =
    new Set(
      (
        cleanedDescription.match(
          /#[\p{L}\p{N}_]+/gu
        ) || []
      ).map((tag) =>
        tag
          .replace(/^#/, "")
          .toLocaleLowerCase()
      )
    );

  const missingHashtags =
    hashtags.filter(
      (tag) =>
        !existingTags.has(
          tag.toLocaleLowerCase()
        )
    );

  if (missingHashtags.length === 0) {
    return cleanedDescription;
  }

  const missingLine =
    formatHashtags(missingHashtags);

  return cleanedDescription
    ? `${cleanedDescription}\n\n${missingLine}`
    : missingLine;
}

function envBoolean(
  name,
  defaultValue = false
) {
  const value =
    process.env[name];

  if (value === undefined) {
    return defaultValue;
  }

  return [
    "1",
    "true",
    "yes",
    "on"
  ].includes(
    String(value).toLowerCase()
  );
}

/*
 * =========================================================
 * DEFAULT CONFIGURATION
 * =========================================================
 */

function getDefaults(language) {
  if (language === "ro") {
    return {
      brand: {
        name: "PariuVerde",
        displayName: "PARIUVERDE",
        website: "pariuverde.ro",
        websiteDisplay:
          "WWW.PARIUVERDE.RO",
        url: "https://pariuverde.ro"
      },

      title:
        "Ponturi fotbal #shorts",

      description:
        "Ponturi și pronosticuri zilnice la fotbal.",

      hashtags: [
        "pariuverde",
        "pariuri",
        "ponturi",
        "fotbal",
        "pronosticuri",
        "biletulzilei",
        "shorts"
      ]
    };
  }

  return {
    brand: {
      name: "GreenBetTips",
      displayName: "GREENBETTIPS",
      website: "greenbettips.com",
      websiteDisplay:
        "WWW.GREENBETTIPS.COM",
      url: "https://greenbettips.com"
    },

    title:
      "Football Predictions #shorts",

    description:
      "Daily football predictions and betting tips.",

    hashtags: [
      "greenbettips",
      "football",
      "footballpredictions",
      "bettingtips",
      "soccer",
      "shorts"
    ]
  };
}

/*
 * =========================================================
 * MAIN
 * =========================================================
 */

function main() {
  requireFile(PAYLOAD_FILE);
  requireFile(VIDEO_FILE);

  const payload =
    readJson(PAYLOAD_FILE);

  if (payload.status === "skipped") {
    console.log(
      `[PUBLISH] Manifest skipped: ${
        payload.reason ||
        "No suitable ticket"
      }`
    );

    return;
  }

  if (payload.status !== "ready") {
    throw new Error(
      `Unexpected payload status: ${payload.status}`
    );
  }

  const language =
    cleanInline(
      payload.language ||
      process.env.LANG ||
      "en"
    ).toLowerCase();

  const defaults =
    getDefaults(language);

  /*
   * Brand values come primarily from the payload.
   * Environment variables may override them.
   */
  const brandName =
    cleanInline(
      process.env.SHORTS_BRAND_NAME ||
      payload.brand?.name ||
      defaults.brand.name
    );

  const brandDisplayName =
    cleanInline(
      process.env.SHORTS_BRAND_DISPLAY ||
      payload.brand?.displayName ||
      payload.visuals?.brand ||
      defaults.brand.displayName
    );

  const brandUrl =
    cleanInline(
      process.env.SHORTS_SITE_URL ||
      payload.brand?.url ||
      defaults.brand.url
    ).replace(/\/$/, "");

  const brandWebsite =
    cleanInline(
      process.env.SHORTS_WEBSITE ||
      payload.brand?.website ||
      defaults.brand.website
    );

  const brandWebsiteDisplay =
    cleanInline(
      process.env
        .SHORTS_WEBSITE_DISPLAY ||
      payload.brand?.websiteDisplay ||
      payload.visuals?.website ||
      payload.visuals?.callToAction ||
      defaults.brand.websiteDisplay
    );

  /*
   * YouTube metadata is generated in
   * generate_shorts_payload.js and is reused here.
   */
  const title =
    cleanInline(
      payload.youtube?.title ||
      payload.ticketLabel ||
      defaults.title
    );

  const description =
    cleanMultiline(
      payload.youtube?.description ||
      (
        language === "ro"
          ? `${defaults.description}\n\nVezi biletul complet: ${brandUrl}`
          : `${defaults.description}\n\nFull ticket: ${brandUrl}`
      )
    );

  const payloadTags =
    Array.isArray(
      payload.youtube?.tags
    )
      ? payload.youtube.tags
      : [];

  const brandHashtag =
    normalizeHashtag(brandName);

  const hashtags =
    uniqueHashtags([
      ...defaults.hashtags,
      ...payloadTags,
      brandHashtag,
      "shorts"
    ]);

  const youtubeDescription =
    appendHashtags(
      description,
      hashtags
    );

  /*
   * Environment variable has priority because
   * workflows may intentionally override privacy.
   */
  const youtubePrivacyStatus =
    cleanInline(
      process.env
        .YOUTUBE_PRIVACY_STATUS ||
      payload.youtube?.privacyStatus ||
      "private"
    ).toLowerCase();

  const allowedPrivacyStatuses =
    new Set([
      "private",
      "unlisted",
      "public"
    ]);

  if (
    !allowedPrivacyStatuses.has(
      youtubePrivacyStatus
    )
  ) {
    throw new Error(
      `Invalid YouTube privacy status: ${youtubePrivacyStatus}`
    );
  }

  const youtubeCategoryId =
    cleanInline(
      payload.youtube?.categoryId ||
      "17"
    );

  const ticketType =
    cleanInline(
      payload.ticketType ||
      "ticket"
    );

  const date =
    cleanInline(
      payload.date ||
      "today"
    );

  const brandSlug =
    slugify(brandName) ||
    "brand";

  const ticketSlug =
    slugify(ticketType) ||
    "ticket";

  const contentId =
    `${brandSlug}-${date}-${ticketSlug}`;

  const tiktokHashtags =
    hashtags.filter(
      (tag) =>
        tag.toLowerCase() !==
        "shorts"
    );

  const tiktokCaption =
    [
      title,
      formatHashtags(
        tiktokHashtags
      )
    ]
      .filter(Boolean)
      .join("\n\n");

  const instagramCaption =
    [
      title,
      description,
      formatHashtags(
        tiktokHashtags
      )
    ]
      .filter(Boolean)
      .join("\n\n");

  const facebookDescription =
    [
      title,
      description
    ]
      .filter(Boolean)
      .join("\n\n");

  const manifest = {
    status: "ready",
    version: 2,
    generatedAt:
      new Date().toISOString(),

    content: {
      id:
        contentId,

      language,

      date:
        payload.date || null,

      ticketType:
        payload.ticketType || null,

      ticketLabel:
        payload.ticketLabel || null,

      totalOdds:
        payload.visuals?.totalOdds ||
        payload.totalOdds ||
        null
    },

    media: {
      video:
        VIDEO_FILE,

      mimeType:
        "video/mp4",

      format:
        "vertical",

      aspectRatio:
        "9:16"
    },

    brand: {
      name:
        brandName,

      displayName:
        brandDisplayName,

      website:
        brandWebsite,

      websiteDisplay:
        brandWebsiteDisplay,

      url:
        brandUrl
    },

    metadata: {
      title,
      description,
      hashtags
    },

    platforms: {
      youtube: {
        enabled:
          envBoolean(
            "YOUTUBE_ENABLED",
            true
          ),

        title,

        description:
          youtubeDescription,

        tags:
          hashtags,

        categoryId:
          youtubeCategoryId,

        privacyStatus:
          youtubePrivacyStatus,

        madeForKids:
          false
      },

      tiktok: {
        enabled:
          envBoolean(
            "TIKTOK_ENABLED",
            false
          ),

        caption:
          tiktokCaption,

        privacyStatus:
          process.env
            .TIKTOK_PRIVACY_STATUS ||
          "PUBLIC_TO_EVERYONE",

        allowComments:
          true,

        allowDuet:
          true,

        allowStitch:
          true
      },

      instagram: {
        enabled:
          envBoolean(
            "INSTAGRAM_ENABLED",
            false
          ),

        caption:
          instagramCaption,

        mediaType:
          "REELS",

        shareToFeed:
          true
      },

      facebook: {
        enabled:
          envBoolean(
            "FACEBOOK_ENABLED",
            false
          ),

        title,

        description:
          facebookDescription
      },

      telegram: {
        enabled:
          envBoolean(
            "TELEGRAM_ENABLED",
            false
          ),

        caption:
          [
            title,
            description,
            formatHashtags(
              tiktokHashtags
            )
          ]
            .filter(Boolean)
            .join("\n\n")
      }
    }
  };

  fs.mkdirSync(
    path.dirname(OUTPUT_FILE),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      manifest,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    `[PUBLISH] Distribution manifest created: ${OUTPUT_FILE}`
  );

  console.log(
    `[PUBLISH] Brand: ${brandName}`
  );

  console.log(
    `[PUBLISH] Language: ${language}`
  );

  console.log(
    `[PUBLISH] Content ID: ${contentId}`
  );

  console.log(
    `[PUBLISH] YouTube title: ${title}`
  );

  console.log(
    `[PUBLISH] YouTube privacy: ${youtubePrivacyStatus}`
  );

  console.log(
    `[PUBLISH] Hashtags: ${formatHashtags(
      hashtags
    )}`
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
