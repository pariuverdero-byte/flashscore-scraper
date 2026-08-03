import { writeJson } from "./helpers.js";

export function buildManifest({ article }) {
  const { site, post, files } = article;
  const title = String(post.title || "").replace(/\s+/g, " ").trim().slice(0, 92);

  const intro = site.language === "ro"
    ? `Vezi articolul complet aici:\n${post.link}\n\nUrmărește ${site.brandName} pentru analize și informații noi.`
    : `Read the full article here:\n${post.link}\n\nFollow ${site.brandName} for new analysis and updates.`;

  const responsible = site.language === "ro"
    ? "Joacă responsabil. Conținutul este informativ și nu garantează câștigul."
    : "Bet responsibly. This content is informational and does not guarantee profit.";

  const hashtagLine = site.hashtags.map(tag => `#${tag}`).join(" ");
  const description = `${intro}\n\n${responsible}\n\n${hashtagLine}`;

  const manifest = {
    status: "ready",
    version: 2,
    generatedAt: new Date().toISOString(),
    content: {
      id: `${site.key}-wordpress-${post.id}`,
      language: site.language,
      type: "wordpress_article",
      wordpressPostId: post.id,
      wordpressUrl: post.link
    },
    media: {
      video: files.videoFile,
      mimeType: "video/mp4",
      format: "vertical",
      aspectRatio: "9:16"
    },
    brand: {
      name: site.brandName,
      displayName: site.brandDisplay,
      website: site.siteUrl.replace(/^https?:\/\//, ""),
      websiteDisplay: site.websiteDisplay,
      url: site.siteUrl
    },
    metadata: { title, description, tags: site.hashtags },
    platforms: {
      youtube: {
        enabled: true,
        privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS || site.youtubePrivacyStatus,
        title: `${title} #shorts`.slice(0, 100),
        description,
        tags: site.hashtags,
        categoryId: site.youtubeCategoryId
      },
      tiktok: { enabled: false },
      instagram: { enabled: false },
      facebook: { enabled: false },
      telegram: { enabled: false }
    }
  };

  writeJson(files.manifestFile, manifest);
  return manifest;
}
