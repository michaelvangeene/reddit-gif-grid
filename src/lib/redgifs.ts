export function redgifsId(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['redgifs.com', 'www.redgifs.com'].includes(url.hostname)) return null;
    return /^\/(?:watch|ifr)\/([a-zA-Z0-9]+)\/?$/.exec(url.pathname)?.[1].toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export interface RedgifsMedia {
  url: string;
  hasAudio: boolean;
}

// Keep the temporary provider token on the server. Retry once if it expires.
export function createRedgifsResolver(request: typeof fetch = fetch) {
  let token: string | undefined;
  let tokenRequest: Promise<string> | undefined;
  async function getToken(): Promise<string> {
    if (token) return token;
    tokenRequest ??= (async () => {
      const response = await request('https://api.redgifs.com/v2/auth/temporary', {
        cache: 'no-store', signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('RedGIFs authentication unavailable');
      const data = await response.json();
      if (typeof data.token !== 'string' || !data.token) throw new Error('Invalid RedGIFs token');
      const nextToken: string = data.token;
      token = nextToken;
      return nextToken;
    })();
    try { return await tokenRequest; } finally { tokenRequest = undefined; }
  }
  return async function resolve(id: string, quality: 'hd' | 'sd' = 'hd'): Promise<RedgifsMedia> {
    if (!/^[a-z0-9]{1,100}$/i.test(id)) throw new Error('Invalid RedGIFs ID');
    for (let attempt = 0; attempt < 2; attempt++) {
      const bearer = await getToken();
      const response = await request(`https://api.redgifs.com/v2/gifs/${id.toLowerCase()}`, {
        headers: { Authorization: `Bearer ${bearer}` },
        cache: 'no-store', signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401 && attempt === 0) {
        if (token === bearer) token = undefined;
        continue;
      }
      if (!response.ok) throw new Error('RedGIFs video unavailable');
      const { gif } = await response.json();
      // Never select urls.silent: it explicitly omits the audio track.
      const source = quality === 'sd' ? gif?.urls?.sd || gif?.urls?.hd : gif?.urls?.hd || gif?.urls?.sd;
      if (typeof source !== 'string') throw new Error('Missing RedGIFs video');
      const url = new URL(source);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.redgifs.com') || !url.pathname.endsWith('.mp4')) {
        throw new Error('Invalid RedGIFs video URL');
      }
      return { url: url.href, hasAudio: gif.hasAudio === true };
    }
    throw new Error('RedGIFs authentication expired');
  };
}
