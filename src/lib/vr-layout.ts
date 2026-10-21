export const VR_PAGE_SIZE = 3;

export function galleryPositions(count: number, radius = 3.2) {
  const distance = Math.max(radius, count > 3 ? count * 0.6 : radius);
  const spread = Math.PI * (count > 3 ? 0.9 : 0.6);
  return Array.from({ length: count }, (_, index) => {
    const angle = count === 1 ? 0 : (index / (count - 1) - 0.5) * spread;
    return { x: Math.sin(angle) * distance, y: 1.65, z: -Math.cos(angle) * distance };
  });
}

export function nextGalleryPage(start: number, count: number, direction: number, pageSize = VR_PAGE_SIZE) {
  if (count <= 0) return 0;
  const size = Math.max(1, Math.min(6, Math.floor(pageSize)));
  const pages = Math.ceil(count / size);
  return ((Math.floor(start / size) + direction + pages) % pages) * size;
}

export function fitVideo(width: number, height: number) {
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
  return ratio > 1.8 / 1.5 ? { width: 1.8, height: 1.8 / ratio } : { width: 1.5 * ratio, height: 1.5 };
}
