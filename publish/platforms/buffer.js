import fs from "node:fs";
import path from "node:path";

const API_KEY = String(process.env.BUFFER_API_KEY || "").trim();
const WP_URL = String(process.env.WP_URL || "").trim().replace(/\/+$/, "");
const WP_USER = String(process.env.WP_USER || "").trim();
const WP_APP_PASS = String(process.env.WP_APP_PASS || "").trim();
const TIME_ZONE = String(process.env.BUFFER_TIME_ZONE || "Europe/Bucharest").trim();
const TARGET_SERVICES = String(process.env.BUFFER_TARGET_SERVICES || "tiktok,instagram,facebook")
  .split(",")
  .map(value => value.trim().toLowerCase())
  .filter(Boolean);

if (!API_KEY || !WP_URL || !WP_USER || !WP_APP_PASS) {
  throw new Error("Missing BUFFER_API_KEY / WP_URL / WP_USER / WP_APP_PASS");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function localDateParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}

function preferredTicketType() {
  const { year, month, day } = localDateParts();
  const start = Date.UTC(Number(year), 0, 1);
  const current = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const dayOfYear = Math.floor((current - start) / 86400000) + 1;
  return dayOfYear % 2 === 1 ? "bilet_cota2" : "biletul_zilei";
}

function chooseReadyTicket() {
  const preferred = preferredTicketType();
  const candidates = [preferred, preferred === "bilet_cota2" ? "biletul_zilei" : "bilet_cota2"];
  for (const ticketType of candidates) {
    const payloadFile = `output/${ticketType}/shorts_payload.json`;
    const manifestFile = `output/${ticketType}/distribution_manifest.json`;
    const videoFile = `output/${ticketType}/short.mp4`;
    if (!fs.existsSync(payloadFile) || !fs.existsSync(manifestFile) || !fs.existsSync(videoFile)) continue;
    const payload = readJson(payloadFile);
    if (payload.status === "ready" && fs.statSync(videoFile).size > 0) {
      return { ticketType, payload, manifest: readJson(manifestFile), videoFile, usedFallback: ticketType !== preferred };
    }
  }
  return null;
}

async function graphql(query) {
  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const result = await response.json();
  if (!response.ok || result.errors?.length) {
    throw new Error(`Buffer API error: ${result.errors?.map(error => error.message).join("; ") || response.status}`);
  }
  return result.data;
}

async function getTargetChannels() {
  const accountData = await graphql(`query { account { organizations { id name } } }`);
  const organizations = accountData.account?.organizations || [];
  if (organizations.length !== 1) {
    throw new Error(`Expected exactly one Buffer organization, found ${organizations.length}`);
  }
  const organization = organizations[0];
  const channelData = await graphql(`query { channels(input: { organizationId: ${JSON.stringify(organization.id)} }) { id name displayName service isQueuePaused } }`);
  const channels = (channelData.channels || []).filter(channel => TARGET_SERVICES.includes(String(channel.service).toLowerCase()));
  const missing = TARGET_SERVICES.filter(service => !channels.some(channel => String(channel.service).toLowerCase() === service));
  if (missing.length) throw new Error(`Missing Buffer channels: ${missing.join(", ")}`);
  if (channels.some(channel => channel.isQueuePaused)) {
    throw new Error(`Buffer queue is paused for: ${channels.filter(channel => channel.isQueuePaused).map(channel => channel.name).join(", ")}`);
  }
  return { organization, channels };
}

const wpAuth = `Basic ${Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64")}`;
const wpApi = `${WP_URL.replace(/\/wp-json(?:\/wp\/v2)?$/i, "")}/wp-json/wp/v2`;

async function findMedia(slug) {
  const response = await fetch(`${wpApi}/media?slug=${encodeURIComponent(slug)}&per_page=1`, {
    headers: { Authorization: wpAuth },
  });
  if (!response.ok) throw new Error(`WordPress media lookup failed: HTTP ${response.status}`);
  return (await response.json())[0] || null;
}

async function uploadVideo(videoFile, slug, title) {
  const existing = await findMedia(slug);
  if (existing) return { media: existing, alreadyPublished: /BUFFER_PUBLISHED/i.test(existing.description?.rendered || "") };

  const bytes = fs.readFileSync(videoFile);
  const response = await fetch(`${wpApi}/media`, {
    method: "POST",
    headers: {
      Authorization: wpAuth,
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${slug}.mp4"`,
      "X-WP-Nonce": "",
    },
    body: bytes,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`WordPress video upload failed: ${body.message || `HTTP ${response.status}`}`);

  const update = await fetch(`${wpApi}/media/${body.id}`, {
    method: "POST",
    headers: { Authorization: wpAuth, "Content-Type": "application/json" },
    body: JSON.stringify({ title, slug }),
  });
  if (!update.ok) throw new Error(`WordPress media metadata update failed: HTTP ${update.status}`);
  return { media: await update.json(), alreadyPublished: false };
}

function captionFor(manifest, service) {
  const platform = manifest.platforms?.[service];
  const fallback = [manifest.metadata?.title, ...(manifest.metadata?.hashtags || []).map(tag => `#${String(tag).replace(/^#/, "")}`)]
    .filter(Boolean)
    .join("\n\n");
  const platformText = platform?.caption || platform?.description;
  return String(platformText || fallback).trim().slice(0, service === "tiktok" ? 2200 : 2000);
}

async function createVideoPost(channel, text, videoUrl) {
  const query = `mutation {
    createPost(input: {
      text: ${JSON.stringify(text)}
      channelId: ${JSON.stringify(channel.id)}
      schedulingType: automatic
      mode: shareNow
      assets: [{ video: { url: ${JSON.stringify(videoUrl)}, metadata: { thumbnailOffset: 2000 } } }]
    }) {
      ... on PostActionSuccess { post { id text status } }
      ... on MutationError { message }
    }
  }`;
  const data = await graphql(query);
  if (!data.createPost?.post?.id) throw new Error(`${channel.service}: ${data.createPost?.message || "Buffer did not create the post"}`);
  return { service: channel.service, channel: channel.displayName || channel.name, postId: data.createPost.post.id, status: data.createPost.post.status };
}

async function markPublished(mediaId, results) {
  const response = await fetch(`${wpApi}/media/${mediaId}`, {
    method: "POST",
    headers: { Authorization: wpAuth, "Content-Type": "application/json" },
    body: JSON.stringify({ description: `BUFFER_PUBLISHED ${new Date().toISOString()} ${JSON.stringify(results)}` }),
  });
  if (!response.ok) throw new Error(`Could not mark WordPress media as distributed: HTTP ${response.status}`);
}

const selected = chooseReadyTicket();
if (!selected) {
  console.log("[BUFFER] No ready PariuVerde ticket video; skipped.");
  process.exit(0);
}

const date = localDateParts();
const localDate = `${date.year}-${date.month}-${date.day}`;
const slug = `pv-buffer-${localDate}-${selected.ticketType.replace(/_/g, "-")}`;
const title = selected.ticketType === "bilet_cota2" ? `Bilet Cota 2 ${localDate}` : `Biletul Zilei ${localDate}`;
const { media, alreadyPublished } = await uploadVideo(selected.videoFile, slug, title);
if (alreadyPublished) {
  console.log(`[BUFFER] ${slug} was already published; skipped to prevent duplicates.`);
  process.exit(0);
}
if (!media.source_url) throw new Error("WordPress did not return a public media URL");

const { organization, channels } = await getTargetChannels();
const results = [];
for (const channel of channels) {
  results.push(await createVideoPost(channel, captionFor(selected.manifest, String(channel.service).toLowerCase()), media.source_url));
}
await markPublished(media.id, results);

const summary = {
  status: "success",
  generatedAt: new Date().toISOString(),
  organization: organization.name,
  selectedTicket: selected.ticketType,
  usedFallback: selected.usedFallback,
  mediaUrl: media.source_url,
  results,
};
fs.mkdirSync("output", { recursive: true });
fs.writeFileSync("output/buffer_publishing_summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
