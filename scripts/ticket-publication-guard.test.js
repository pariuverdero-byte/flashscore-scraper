import test from 'node:test';
import assert from 'node:assert/strict';
import { findPublishedTicket, ticketSlug } from './ticket-publication-guard.js';

const base = { endpoint: 'https://example.com/wp-json/wp/v2/posts', auth: 'Basic test', date: '2026-09-08', type: 'cota-2', categoryId: 7 };
function mock(responses, urls = []) {
  return async url => {
    urls.push(new URL(url));
    const next = responses.shift();
    assert.ok(next, 'unexpected request');
    return new Response(JSON.stringify(next.posts), { status: next.status || 200, headers: { 'x-wp-totalpages': String(next.pages || 1) } });
  };
}
test('existing stable identity is reused', async () => {
  const post = { id: 1 };
  assert.deepEqual(await findPublishedTicket({ ...base, fetchImpl: mock([{ posts: [post] }]) }), post);
});
test('legacy title is recognized and date/category lookup is scoped', async () => {
  const urls = [];
  const post = { id: 2, title: { rendered: 'Odds 2 Ticket: Teams, odds 2.1 (08.09.2026)' } };
  assert.deepEqual(await findPublishedTicket({ ...base, fetchImpl: mock([{ posts: [] }, { posts: [post] }], urls) }), post);
  assert.equal(urls[1].searchParams.get('categories'), '7');
  assert.equal(urls[1].searchParams.get('search'), '08.09.2026');
});
test('legacy ticket date in content is recognized across pages', async () => {
  const post = { id: 3, content: { raw: '<p><em>Data biletului: 08.09.2026</em></p>' } };
  assert.deepEqual(await findPublishedTicket({ ...base, fetchImpl: mock([{ posts: [] }, { posts: [{ title: { raw: 'Other (07.09.2026)' } }], pages: 2 }, { posts: [post], pages: 2 }]) }), post);
});
test('missing ticket permits publication', async () => {
  assert.equal(await findPublishedTicket({ ...base, fetchImpl: mock([{ posts: [] }, { posts: [] }]) }), null);
});
test('API failure or malformed response stops publication', async () => {
  for (const response of [{ status: 503, posts: {} }, { posts: { error: 'captcha' } }]) {
    await assert.rejects(findPublishedTicket({ ...base, fetchImpl: mock([response]) }), /Duplicate check/);
  }
});
test('different dates and types have different identities', () => {
  assert.notEqual(ticketSlug(base.date, 'cota-2'), ticketSlug(base.date, 'biletul-zilei'));
  assert.notEqual(ticketSlug(base.date, 'cota-2'), ticketSlug('2026-09-09', 'cota-2'));
  assert.throws(() => ticketSlug('invalid', 'cota-2'));
});
