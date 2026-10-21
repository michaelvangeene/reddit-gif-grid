import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { redditAudioUrl, redditVideoId } from '../src/lib/reddit-audio.ts';

test('finds Reddit stream IDs and rejects unrelated hosts', () => {
  assert.equal(redditVideoId('https://v.redd.it/abc123/CMAF_480.mp4'), 'abc123');
  assert.equal(redditVideoId('https://v.redd.it.evil.test/abc123/CMAF_480.mp4'), null);
  assert.equal(redditVideoId('invalid'), null);
});

test('selects the separate audio track rather than the video representation', () => {
  const manifest = `<MPD><Period>
    <AdaptationSet contentType="video"><Representation><BaseURL>CMAF_480.mp4</BaseURL></Representation></AdaptationSet>
    <AdaptationSet contentType="audio"><Representation mimeType="audio/mp4"><BaseURL>CMAF_AUDIO_128.mp4</BaseURL></Representation></AdaptationSet>
  </Period></MPD>`;
  assert.equal(redditAudioUrl(manifest, 'abc123'), 'https://v.redd.it/abc123/CMAF_AUDIO_128.mp4');
  assert.equal(redditAudioUrl('<MPD><AdaptationSet contentType="video"><BaseURL>CMAF_480.mp4</BaseURL></AdaptationSet></MPD>', 'abc123'), null);
});

test('does not return external or unrelated media URLs', () => {
  for (const source of ['https://evil.test/audio.mp4', '../../other/audio.mp4', 'http://v.redd.it/abc123/audio.mp4']) {
    assert.equal(redditAudioUrl(`<AdaptationSet contentType="audio"><BaseURL>${source}</BaseURL></AdaptationSet>`, 'abc123'), null);
  }
});
