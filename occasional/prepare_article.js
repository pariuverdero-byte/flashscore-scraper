import fs from "fs";
import path from "path";
import { cleanInline, ensureDir, slugify, writeJson } from "./helpers.js";

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map(cleanInline)
    .filter(sentence => sentence.length >= 35 && sentence.length <= 260);
}

function buildSummary(post, language) {
  const preferred = cleanInline(post.excerpt);
  const source = preferred.length >= 100 ? preferred : cleanInline(post.contentText);
  const sentences = splitSentences(source);
  const selected = [];
  let characters = 0;

  for (const sentence of sentences) {
    if (selected.length >= 5 || characters + sentence.length > 850) break;
    selected.push(sentence);
    characters += sentence.length;
  }

  if (selected.length === 0 && source) {
    selected.push(source.slice(0, 750));
  }

  return selected.join(" ");
}

function buildScript({ post, site }) {
  const summary = buildSummary(post, site.language);

  if (site.language === "ro") {
    return [
      `Astăzi vorbim despre: ${post.title}.`,
      summary,
      `Pentru articolul complet și toate detaliile, intră pe ${site.brandName}, la ${site.websiteDisplay.replace(/^WWW\./, "").toLowerCase().replace(/\./g, " punct ")}.`,
      "Joacă responsabil. Informațiile prezentate nu garantează un câștig."
    ].filter(Boolean).join("\n\n");
  }

  return [
    `Today we are looking at: ${post.title}.`,
    summary,
    `Read the full article and all details on ${site.brandName}, at ${site.websiteDisplay.replace(/^WWW\./, "").toLowerCase().replace(/\./g, " dot ")}.`,
    "Bet responsibly. The information presented does not guarantee a profit."
  ].filter(Boolean).join("\n\n");
}

function wrapTitle(value, maxLineLength = 28, maxLines = 4) {
  const words = cleanInline(value).split(" ").filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxLineLength || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length >= maxLines - 1) break;
  }

  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(" ").length;
  if (consumed < cleanInline(value).length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.\s]+$/, "")}…`;
  }
  return lines.join("\n");
}

export function prepareArticle({ post, site, outputRoot }) {
  const articleDir = path.join(outputRoot, site.key, `${post.id}-${slugify(post.slug || post.title)}`);
  ensureDir(articleDir);

  const script = buildScript({ post, site });
  const titleFile = path.join(articleDir, "title.txt");
  const websiteFile = path.join(articleDir, "website.txt");
  const scriptFile = path.join(articleDir, "voice_script.txt");
  const articleFile = path.join(articleDir, "article.json");

  fs.writeFileSync(titleFile, wrapTitle(post.title), "utf8");
  fs.writeFileSync(websiteFile, site.websiteDisplay, "utf8");
  fs.writeFileSync(scriptFile, script, "utf8");

  const article = {
    status: "ready",
    generatedAt: new Date().toISOString(),
    site,
    post,
    files: {
      articleDir,
      titleFile,
      websiteFile,
      scriptFile,
      voiceFile: path.join(articleDir, "voice.mp3"),
      videoFile: path.join(articleDir, "short.mp4"),
      manifestFile: path.join(articleDir, "distribution_manifest.json"),
      resultsFile: path.join(articleDir, "distribution_results.json")
    }
  };

  writeJson(articleFile, article);
  return { ...article, files: { ...article.files, articleFile } };
}
