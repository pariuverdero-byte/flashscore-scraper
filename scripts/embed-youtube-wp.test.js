import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../embed_youtube_wp.js', import.meta.url));

async function runEmbed(t, { payload, distribution, alreadyPublished = false }) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-embed-test-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, body });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.method === 'GET'
      ? { content: { raw: '<p>Original article</p>' } }
      : { link: 'https://example.com/article' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await fs.writeFile(path.join(cwd, 'published_posts.json'), JSON.stringify({
    posts: [{ ticket: 'cota-2', success: true, id: 42, alreadyPublished }],
  }));
  const dir = path.join(cwd, 'output', 'bilet_cota2');
  await fs.mkdir(dir, { recursive: true });
  if (payload) await fs.writeFile(path.join(dir, 'shorts_payload.json'), JSON.stringify(payload));
  if (distribution) await fs.writeFile(path.join(dir, 'distribution_results.json'), JSON.stringify(distribution));
  const child = spawn(process.execPath, [script], {
    cwd,
    env: { ...process.env, WP_URL: `http://127.0.0.1:${server.address().port}`, WP_USER: 'test', WP_APP_PASS: 'test', LANG: 'ro' },
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  return { code, output, requests };
}

test('skipped video without distribution results exits successfully without WordPress requests', async t => {
  const result = await runEmbed(t, { payload: { status: 'skipped', reason: 'No verified statistics' } });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /video skipped/);
  assert.deepEqual(result.requests, []);
});

test('skipped payload ignores stale successful distribution results', async t => {
  const result = await runEmbed(t, {
    payload: { status: 'skipped' },
    distribution: { status: 'success', youtube: { url: 'https://www.youtube.com/watch?v=abcdefghijk' } },
  });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(result.requests, []);
});

test('ready video embeds the published URL and preserves article content', async t => {
  const result = await runEmbed(t, {
    payload: { status: 'ready' },
    distribution: { status: 'success', youtube: { url: 'https://www.youtube.com/watch?v=abcdefghijk' } },
  });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(result.requests.map(req => req.method), ['GET', 'POST']);
  const content = JSON.parse(result.requests[1].body).content;
  assert.match(content, /<p>Original article<\/p>/);
  assert.match(content, /youtube-nocookie.com\/embed\/abcdefghijk/);
});

test('ready video with missing distribution results still fails', async t => {
  const result = await runEmbed(t, { payload: { status: 'ready' } });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /ENOENT/);
  assert.deepEqual(result.requests, []);
});

test('unexpected payload status remains an error', async t => {
  const result = await runEmbed(t, { payload: { status: 'broken' } });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Unexpected Shorts payload status/);
});

test('previously published post needs no video artifacts', async t => {
  const result = await runEmbed(t, { alreadyPublished: true });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(result.requests, []);
});
