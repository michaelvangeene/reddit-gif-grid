import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { galleryPositions, nextGalleryPage, fitVideo } from '../src/lib/vr-layout.ts';

test('screens form a symmetric arc at a consistent distance and eye height', () => {
  const positions = galleryPositions(3);
  assert.equal(positions.length, 3);
  assert.ok(Math.abs(positions[0].x + positions[2].x) < 1e-10);
  assert.equal(positions[1].x, 0);
  for (const position of positions) {
    assert.equal(position.y, 1.65);
    assert.ok(Math.abs(Math.hypot(position.x, position.z) - 3.2) < 1e-10);
    assert.ok(position.z < 0);
  }
  assert.deepEqual(galleryPositions(0), []);
  assert.equal(galleryPositions(1)[0].x, 0);
});

test('navigation covers incomplete final pages and wraps in both directions', () => {
  assert.equal(nextGalleryPage(0, 7, 1), 3);
  assert.equal(nextGalleryPage(3, 7, 1), 6);
  assert.equal(nextGalleryPage(6, 7, 1), 0);
  assert.equal(nextGalleryPage(0, 7, -1), 6);
  assert.equal(nextGalleryPage(0, 1, 1), 0);
  assert.equal(nextGalleryPage(0, 0, -1), 0);
});

test('portrait and landscape videos fit the screen without stretching', () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920], [1000, 1000]]) {
    const fitted = fitVideo(width, height);
    assert.ok(fitted.width <= 1.8 && fitted.height <= 1.5);
    assert.ok(Math.abs(fitted.width / fitted.height - width / height) < 1e-10);
  }
  assert.ok(Number.isFinite(fitVideo(0, 0).width));
});
