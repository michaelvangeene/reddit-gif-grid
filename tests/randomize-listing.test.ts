import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { collectListing, shuffled } from '../src/lib/randomize-listing.ts';

test('collects every page, including middle and oldest items, and removes duplicates', async () => {
  const cursors: (string | null)[] = [];
  const progress: number[] = [];
  const posts = await collectListing(async cursor => {
    cursors.push(cursor);
    if (!cursor) return { items: [{ id: 'new' }], after: 'page2' };
    if (cursor === 'page2') return { items: [{ id: 'new' }, { id: 'middle' }], after: 'page3' };
    return { items: [{ id: 'oldest' }], after: null };
  }, new AbortController().signal, count => progress.push(count));
  assert.deepEqual(cursors, [null, 'page2', 'page3']);
  assert.deepEqual(posts.map(p => p.id), ['new', 'middle', 'oldest']);
  assert.deepEqual(progress, [1, 2, 3]);
});

test('an empty page with a next cursor does not prematurely end the history', async () => {
  const posts = await collectListing(async cursor => cursor
    ? { items: [{ id: 'oldest' }], after: null }
    : { items: [], after: 'next' }, new AbortController().signal);
  assert.equal(posts[0].id, 'oldest');
});

test('cancellation stops pagination without returning a partial pool', async () => {
  const controller = new AbortController();
  let requests = 0;
  await assert.rejects(collectListing(async () => {
    requests++;
    controller.abort();
    return { items: [{ id: 'one' }], after: 'next' };
  }, controller.signal), { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('upstream failures and repeated cursors do not silently yield incomplete history', async () => {
  await assert.rejects(collectListing(async () => { throw new Error('rate limited'); }, new AbortController().signal), /rate limited/);
  await assert.rejects(collectListing(async () => ({ items: [{ id: 'one' }], after: 'same' }), new AbortController().signal), /repeated/);
});

test('shuffles the entire pool before displaying a batch, preserving all items and input order', () => {
  const original = Array.from({ length: 150 }, (_, id) => id);
  const pool = shuffled(original, () => 0);
  assert.ok(pool.slice(0, 50).includes(50), 'an item outside the initial batch can appear');
  assert.deepEqual([...pool].sort((a, b) => a - b), original);
  assert.deepEqual(original, Array.from({ length: 150 }, (_, id) => id));
  assert.deepEqual(shuffled([]), []);
  assert.deepEqual(shuffled([1]), [1]);
});
