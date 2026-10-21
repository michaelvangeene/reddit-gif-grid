export function redditVideoId(source: string): string | null {
  try {
    const url = new URL(source);
    return url.hostname === 'v.redd.it' ? /^\/([a-z0-9]+)\//i.exec(url.pathname)?.[1] ?? null : null;
  } catch { return null; }
}

export function redditAudioUrl(manifest: string, id: string): string | null {
  for (const match of manifest.matchAll(/<AdaptationSet\b[^>]*>[\s\S]*?<\/AdaptationSet>/g)) {
    const set = match[0];
    if (!/(?:contentType=["']audio["']|mimeType=["']audio\/)/.test(set)) continue;
    const base = /<BaseURL(?:\s[^>]*)?>([^<]+)<\/BaseURL>/.exec(set)?.[1];
    if (!base) continue;
    const url = new URL(base.trim().replaceAll('&amp;', '&'), `https://v.redd.it/${id}/DASHPlaylist.mpd`);
    if (url.protocol === 'https:' && url.hostname === 'v.redd.it' && url.pathname.startsWith(`/${id}/`) && url.pathname.endsWith('.mp4')) return url.href;
  }
  return null;
}
