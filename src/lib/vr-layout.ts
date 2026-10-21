export const VR_PAGE_SIZE = 3;

export function galleryPositions(count: number, radius = 3.2) {
  return Array.from({ length: count }, (_, index) => {
    const angle = count === 1 ? 0 : (index / (count - 1) - 0.5) * Math.PI * 0.6;
    return { x: Math.sin(angle) * radius, y: 1.65, z: -Math.cos(angle) * radius };
  });
}

export function nextGalleryPage(start: number, count: number, direction: number) {
  if (count <= 0) return 0;
  const pages = Math.ceil(count / VR_PAGE_SIZE);
  return ((Math.floor(start / VR_PAGE_SIZE) + direction + pages) % pages) * VR_PAGE_SIZE;
}

export function fitVideo(width: number, height: number) {
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
  return ratio > 1.8 / 1.5 ? { width: 1.8, height: 1.8 / ratio } : { width: 1.5 * ratio, height: 1.5 };
}
