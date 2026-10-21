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

test('navigation honors every window-count option without skipping the last page', () => {
  for (let size = 1; size <= 6; size++) {
    const count = 17;
    const starts: number[] = [];
    let start = 0;
    do { starts.push(start); start = nextGalleryPage(start, count, 1, size); } while (start !== 0);
    const indices = starts.flatMap(first => Array.from({ length: Math.min(size, count - first) }, (_, index) => first + index));
    assert.deepEqual(indices, Array.from({ length: count }, (_, index) => index));
    assert.equal(nextGalleryPage(0, count, -1, size), starts.at(-1));
  }
});

test('six windows have enough horizontal separation for the frames', () => {
  const positions = galleryPositions(6);
  for (let index = 1; index < positions.length; index++) {
    assert.ok(Math.hypot(positions[index].x - positions[index - 1].x, positions[index].z - positions[index - 1].z) > 1.95);
  }
});

test('portrait and landscape videos fit the screen without stretching', () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920], [1000, 1000]]) {
    const fitted = fitVideo(width, height);
    assert.ok(fitted.width <= 1.8 && fitted.height <= 1.5);
    assert.ok(Math.abs(fitted.width / fitted.height - width / height) < 1e-10);
  }
  assert.ok(Number.isFinite(fitVideo(0, 0).width));
});
