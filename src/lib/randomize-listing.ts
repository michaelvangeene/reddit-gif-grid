export function shuffled<T>(items: readonly T[], random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export async function collectListing<T extends { id: string }>(
  loadPage: (after: string | null, signal: AbortSignal) => Promise<{ items: T[]; after: string | null }>,
  signal: AbortSignal,
  onProgress: (scanned: number) => void = () => {},
): Promise<T[]> {
  const posts = new Map<string, T>();
  const cursors = new Set<string>();
  let after: string | null = null;
  do {
    signal.throwIfAborted();
    const page = await loadPage(after, signal);
    signal.throwIfAborted();
    for (const post of page.items) posts.set(post.id, post);
    onProgress(posts.size);
    after = page.after;
    if (after) {
      if (cursors.has(after)) throw new Error('Reddit repeated a page. Please try again.');
      cursors.add(after);
    }
  } while (after);
  return [...posts.values()];
}
