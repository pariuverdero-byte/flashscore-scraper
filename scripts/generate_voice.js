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
const pythonCommand = String(process.env.PYTHON_COMMAND || "python").trim();
const ffmpegCommand = String(process.env.FFMPEG_COMMAND || "ffmpeg").trim();

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

function command(name, args, options = {}) {
  const result = spawnSync(name, args, { stdio: "inherit", shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} failed with exit code ${result.status}`);
}

function approximateSrt(text, duration) {
  const chunks = String(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map(value => value.trim())
    .filter(Boolean)
    .flatMap(sentence => {
      if (sentence.length <= 82) return [sentence];
      const words = sentence.split(/\s+/);
      const parts = [];
      let current = "";
      for (const word of words) {
        if (current && `${current} ${word}`.length > 74) {
          parts.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      if (current) parts.push(current);
      return parts;
    });

  const weights = chunks.map(chunk => Math.max(8, chunk.replace(/\s/g, "").length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = 0;
  return chunks.map((chunk, index) => {
    const start = cursor;
    cursor = index === chunks.length - 1
      ? duration
      : Math.min(duration, cursor + duration * weights[index] / totalWeight);
    return `${index + 1}\n${timestamp(start)} --> ${timestamp(cursor)}\n${chunk}\n`;
  }).join("\n");
}

function wavDuration(filePath) {
  const wav = fs.readFileSync(filePath);
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Piper output is not a valid WAV file");
  }
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt " && size >= 12) byteRate = wav.readUInt32LE(offset + 16);
    if (id === "data") {
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  const duration = dataSize / byteRate;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid Piper WAV duration");
  return duration;
}

function runPiper() {
  const voice = String(process.env.PIPER_VOICE || "ro_RO-mihai-medium").trim();
  const dataDir = path.resolve(process.env.PIPER_DATA_DIR || ".cache/piper");
  const wavFile = `${audioFile}.piper.wav`;
  const text = fs.readFileSync(scriptFile, "utf8").trim();
  if (!text) throw new Error(`Voice script is empty: ${scriptFile}`);

  fs.mkdirSync(dataDir, { recursive: true });
  command(pythonCommand, ["-m", "piper.download_voices", "--data-dir", dataDir, voice]);
  command(pythonCommand, ["-m", "piper", "-m", voice, "--data-dir", dataDir, "-f", wavFile, "--input-file", scriptFile]);
  const duration = wavDuration(wavFile);
  command(ffmpegCommand, ["-y", "-hide_banner", "-loglevel", "error", "-i", wavFile, "-codec:a", "libmp3lame", "-b:a", "128k", audioFile]);
  fs.writeFileSync(subtitlesFile, approximateSrt(text, duration), "utf8");
  fs.rmSync(wavFile, { force: true });
  console.log(`[VOICE] Piper ${voice} generated local Romanian audio and subtitles.`);
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

if (provider === "piper") {
  try {
    runPiper();
  } catch (error) {
    console.warn(`[VOICE] Piper failed (${error?.message || error}); using Edge TTS fallback.`);
    runEdgeFallback();
  }
} else if (provider === "edge") {
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
