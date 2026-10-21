import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { createRedgifsResolver, redgifsId } from '../src/lib/redgifs.ts';

test('extracts watch/embed IDs but rejects lookalike hosts and arbitrary paths', () => {
  assert.equal(redgifsId('https://www.redgifs.com/watch/ExampleClip?x=1'), 'exampleclip');
  assert.equal(redgifsId('https://redgifs.com/ifr/ExampleClip/'), 'exampleclip');
  for (const url of ['https://redgifs.com.evil.test/watch/clip', 'https://evil.test/watch/clip', 'invalid', 'https://redgifs.com/watch/a/b']) {
    assert.equal(redgifsId(url), null);
  }
});

test('uses original HD with audio, never the silent stream, and shares token across concurrent loads', async () => {
  const calls: string[] = [];
  const request = (async (input, init) => {
    calls.push(String(input));
    if (String(input).endsWith('/temporary')) return Response.json({ token: 'temporary-test-token' });
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer temporary-test-token');
    return Response.json({ gif: { hasAudio: true, urls: { hd: 'https://media.redgifs.com/Example.mp4', silent: 'https://media.redgifs.com/Example-silent.mp4' } } });
  }) as typeof fetch;
  const resolve = createRedgifsResolver(request);
  const results = await Promise.all([resolve('one'), resolve('two')]);
  assert.equal(calls.filter(url => url.endsWith('/temporary')).length, 1);
  assert.deepEqual(results[0], { url: 'https://media.redgifs.com/Example.mp4', hasAudio: true });
});

test('refreshes an expired token once and supports SD and silent originals', async () => {
  let tokens = 0;
  const request = (async (input) => {
    if (String(input).endsWith('/temporary')) return Response.json({ token: `token-${++tokens}` });
    if (tokens === 1) return new Response(null, { status: 401 });
    return Response.json({ gif: { hasAudio: false, urls: { sd: 'https://media.redgifs.com/Example-mobile.mp4' } } });
  }) as typeof fetch;
  assert.deepEqual(await createRedgifsResolver(request)('example'), {
    url: 'https://media.redgifs.com/Example-mobile.mp4', hasAudio: false,
  });
  assert.equal(tokens, 2);
});

test('VR can prefer a smaller SD video while the normal grid keeps HD', async () => {
  const request = (async (input) => Response.json(String(input).endsWith('/temporary')
    ? { token: 'test' }
    : { gif: { hasAudio: true, urls: { hd: 'https://media.redgifs.com/Example.mp4', sd: 'https://media.redgifs.com/Example-mobile.mp4' } } })) as typeof fetch;
  const resolve = createRedgifsResolver(request);
  assert.equal((await resolve('example', 'sd')).url, 'https://media.redgifs.com/Example-mobile.mp4');
  assert.equal((await resolve('example')).url, 'https://media.redgifs.com/Example.mp4');
});

test('rejects invalid IDs without fetching, upstream failures, and untrusted media URLs', async () => {
  const resolve = createRedgifsResolver((async () => { throw new Error('must not fetch'); }) as typeof fetch);
  await assert.rejects(resolve('../other'), /Invalid/);
  for (const source of ['https://evil.test/video.mp4', 'http://media.redgifs.com/video.mp4', 'https://media.redgifs.com/file.jpg']) {
    const request = (async (input) => Response.json(String(input).endsWith('/temporary')
      ? { token: 'test' } : { gif: { urls: { hd: source } } })) as typeof fetch;
    await assert.rejects(createRedgifsResolver(request)('example'), /Invalid/);
  }
  await assert.rejects(createRedgifsResolver((async () => new Response(null, { status: 503 })) as typeof fetch)('example'), /unavailable/);
});
