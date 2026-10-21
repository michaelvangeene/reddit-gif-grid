import { auth } from '@/auth';
import { redditAudioUrl } from '@/lib/reddit-audio';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.accessToken) return Response.json({ error: 'Sign in required' }, { status: 401 });
  const { id } = await params;
  if (!/^[a-z0-9]{1,100}$/i.test(id)) return Response.json({ error: 'Invalid video ID' }, { status: 400 });
  try {
    const response = await fetch(`https://v.redd.it/${id}/DASHPlaylist.mpd`, {
      signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    if (!response.ok) throw new Error('Manifest unavailable');
    return Response.json({ url: redditAudioUrl(await response.text(), id) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'Audio temporarily unavailable' }, { status: 502 });
  }
}
