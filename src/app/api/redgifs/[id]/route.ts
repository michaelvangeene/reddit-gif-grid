import { auth } from '@/auth';
import { createRedgifsResolver } from '@/lib/redgifs';

const resolve = createRedgifsResolver();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.accessToken) return Response.json({ error: 'Sign in required' }, { status: 401 });
  const { id } = await params;
  if (!/^[a-z0-9]{1,100}$/i.test(id)) {
    return Response.json({ error: 'Invalid RedGIFs ID' }, { status: 400 });
  }
  try {
    return Response.json(await resolve(id), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.warn('RedGIFs resolver failed', error);
    return Response.json({ error: 'RedGIFs video temporarily unavailable' }, { status: 502 });
  }
}
