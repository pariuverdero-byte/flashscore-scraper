import fs from 'fs/promises';
import path from 'path';

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

export function safeNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const cleaned = String(value).replace('%', '').replace(',', '.').trim();
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

export function nowIso() {
  return new Date().toISOString();
}

export function minutesBetween(a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

export function stableSignalId(matchId, type, minute) {
  const bucket = Math.floor(Number(minute || 0) / 5) * 5;
  return `${matchId}:${type}:${bucket}`;
}

export function splitTeams(text = '') {
  const separator = text.includes(' – ') ? ' – ' : text.includes(' - ') ? ' - ' : null;
  if (!separator) return { home: text.trim(), away: '' };
  const [home, ...rest] = text.split(separator);
  return { home: home.trim(), away: rest.join(separator).trim() };
}
