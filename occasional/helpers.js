import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

export function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function requireFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Required file does not exist: ${filePath}`);
  if (fs.statSync(filePath).size === 0) throw new Error(`Required file is empty: ${filePath}`);
}

export function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export function readJson(filePath) {
  requireFile(filePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function cleanInline(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#8211;|&#8212;/g, "-")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function htmlToText(value) {
  return cleanInline(
    String(value ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, ". ")
      .replace(/<\/p>/gi, ". ")
      .replace(/<\/li>/gi, ". ")
      .replace(/<[^>]+>/g, " ")
  );
}

export function slugify(value) {
  return cleanInline(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "article";
}

export function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function selectDeterministic(items, seed) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Cannot select from an empty list.");
  }
  return items[hashString(seed) % items.length];
}

export function run(command, args, options = {}) {
  console.log(`[OCCASIONAL] Running: ${command} ${args.map(String).join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    env: { ...process.env, ...(options.env || {}) }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${command}`);
  }
}

export function normalizeRate(value) {
  const rate = String(value || "+0%").trim();
  if (/^[+-]\d+%$/.test(rate)) return rate;
  if (/^\d+%$/.test(rate)) return `+${rate}`;
  if (/^-?\d+$/.test(rate)) return Number(rate) >= 0 ? `+${rate}%` : `${rate}%`;
  return "+0%";
}

export function escapeFfmpegFilterPath(value) {
  return String(value)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,");
}
