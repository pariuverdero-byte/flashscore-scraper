import test from 'node:test';
import assert from 'node:assert/strict';
import { observe, parseFeed, parseFinal, settle } from '../scripts/log-published-signals.js';

const html = `<div class="pv-live-grid">
  <article class="pv-live-card" data-match-id="08XQVXDL">
    <div class="pv-live-meta"><strong>LIVE · 58'</strong><span>2. Bundesliga</span></div>
    <div class="pv-live-score"><span>Home</span><b>1 – 2</b><span>Away</span></div>
    <div class="pv-live-stats"><div><small>Cornere</small><b>4 – 1</b></div></div>
    <div class="pv-live-signal"><h3>Peste cornere live 8,5</h3>
      <p>Presiune ofensivă</p><b>76/100</b><em>Cotă minimă: 1,55</em>
    </div>
  </article>
</div>`;

test('a visible signal keeps its first score and closes only after a newer snapshot omits it', () => {
  const [signal] = parseFeed(html);
  assert.equal(signal.market, 'match_corners_over');
  assert.equal(signal.line, 8.5);
  assert.equal(signal.minimumOdd, 1.55);
  assert.deepEqual(signal.stats, { Cornere: '4 – 1' });

  const state = { records: [], lastFeed: {} };
  const site = 'pariuverde.ro';
  const day = '2026-11-22T';
  observe(state, site, day + '13:00:00Z', [signal]);
  observe(state, site, day + '13:05:00Z', [{ ...signal, minute: '63', scoreAtSignal: [2, 2] }]);
  observe(state, site, day + '13:05:00Z', []);
  assert.equal(state.records[0].firstAbsentAt, null);
  observe(state, site, day + '13:10:00Z', []);
  assert.equal(state.records[0].lastSeenMinute, '63');
  assert.deepEqual(state.records[0].scoreAtSignal, [1, 2]);
  assert.equal(state.records[0].firstAbsentAt, day + '13:10:00Z');
  assert.equal(state.records[0].outcome, 'pending');
  observe(state, site, day + '13:15:00Z', [{ ...signal, minute: '73' }]);
  assert.equal(state.records.length, 2);
});

test('next goal uses a verified goal order and refuses to guess when both teams score', () => {
  const result = parseFinal(`<title>HOM 1-1 AWY | Home - Away</title>
    <h3>Home - Away</h3><div class="detail"><b>1-1</b></div>
    <div class="detail">Finished</div><p>Summary</p><div id="detail-tab-content">
      <div class="incident"><p class="icon ball"></p> A. Player [AWY]</div>
      <div class="incident"><p class="icon ball"></p> H. Player [HOM]</div>
    </div>`);
  const record = { market: 'home_next_goal', scoreAtSignal: [0, 0] };
  assert.equal(settle(record, result), 'lost');
  assert.equal(settle(record, { ...result, goalOrder: null }), 'unverified');
  assert.equal(settle(record, { finalScore: [0, 0] }), 'no_more_goals');
  assert.equal(settle({ ...record, market: 'goal_after_signal' }, result), 'won');
  assert.equal(settle({ ...record, market: 'match_goals_over', line: 1.5, scoreAtSignal: [1, 1] }, result), 'unverified');
  assert.equal(settle({ ...record, market: 'match_corners_over', line: 8.5 }, { ...result, corners: null }), 'unverified');
});
