import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const required = name => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const scriptFile = required("VOICE_SCRIPT_FILE");
const audioFile = required("VOICE_AUDIO_FILE");
const subtitlesFile = required("VOICE_SUBTITLES_FILE");
const language = String(process.env.VOICE_LANGUAGE || "en").trim().toLowerCase();
const apiKey = String(process.env.ELEVENLABS_API_KEY || "").trim();
const voiceId = String(
  process.env[`ELEVENLABS_VOICE_ID_${language.toUpperCase()}`] ||
  process.env.ELEVENLABS_VOICE_ID ||
  ""
).trim();
const provider = String(process.env.VOICE_PROVIDER || "auto").trim().toLowerCase();

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function timestamp(seconds) {
  const milliseconds = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor(milliseconds % 3600000 / 60000);
  const secs = Math.floor(milliseconds % 60000 / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function alignmentToSrt(alignment) {
  const chars = alignment?.characters || [];
  const starts = alignment?.character_start_times_seconds || [];
  const ends = alignment?.character_end_times_seconds || [];
  if (!chars.length || chars.length !== starts.length || chars.length !== ends.length) {
    throw new Error("ElevenLabs returned no usable character alignment.");
  }

  const cues = [];
  let start = 0;
  while (start < chars.length) {
    while (start < chars.length && /\s/.test(chars[start])) start += 1;
    if (start >= chars.length) break;

    let end = start;
    while (end + 1 < chars.length) {
      const text = chars.slice(start, end + 1).join("");
      const boundary = /[.!?;:]\s*$/.test(text) || text.length >= 74;
      if (boundary && /\s/.test(chars[end + 1])) break;
      end += 1;
    }

    const text = chars.slice(start, end + 1).join("").replace(/\s+/g, " ").trim();
    if (text) cues.push({ start: starts[start], end: ends[end], text });
    start = end + 1;
  }

  return cues.map((cue, index) =>
    `${index + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`
  ).join("\n");
}

function runEdgeFallback() {
  const voice = required("EDGE_TTS_VOICE");
  const rate = String(process.env.EDGE_TTS_RATE || "+0%").trim();
  const pitch = String(process.env.EDGE_TTS_PITCH || "+0Hz").trim();
  const result = spawnSync("edge-tts", [
    "--voice", voice,
    `--rate=${rate}`,
    `--pitch=${pitch}`,
    "--volume=+0%",
    "--file", scriptFile,
    "--write-media", audioFile,
    "--write-subtitles", subtitlesFile
  ], { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`edge-tts failed with exit code ${result.status}`);
  console.log("[VOICE] Edge TTS fallback generated audio and subtitles.");
}

async function runElevenLabs() {
  const text = fs.readFileSync(scriptFile, "utf8").trim();
  if (!text) throw new Error(`Voice script is empty: ${scriptFile}`);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
        voice_settings: {
          stability: Number(process.env.ELEVENLABS_STABILITY || 0.55),
          similarity_boost: Number(process.env.ELEVENLABS_SIMILARITY_BOOST || 0.82),
          style: Number(process.env.ELEVENLABS_STYLE || 0.15),
          use_speaker_boost: true
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }

  const body = await response.json();
  const alignment = body.normalized_alignment || body.alignment;
  fs.writeFileSync(audioFile, Buffer.from(body.audio_base64, "base64"));
  fs.writeFileSync(subtitlesFile, alignmentToSrt(alignment), "utf8");
  console.log(`[VOICE] ElevenLabs clone generated audio and synchronized subtitles (${language}).`);
}

ensureParent(audioFile);
ensureParent(subtitlesFile);

if (provider === "edge") {
  runEdgeFallback();
} else if (apiKey && voiceId) {
  await runElevenLabs();
} else {
  console.warn(`[VOICE] ElevenLabs secrets are incomplete for ${language}; using Edge TTS fallback.`);
  runEdgeFallback();
}

for (const filePath of [audioFile, subtitlesFile]) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    throw new Error(`Voice output is missing or empty: ${filePath}`);
  }
}
