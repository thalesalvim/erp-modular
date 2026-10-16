import { NextResponse, type NextRequest } from 'next/server';
import { updateSupabaseSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  // Block these routes before the shared session refresh can contact Auth.
  let pathname = request.nextUrl.pathname;
  try { pathname = decodeURIComponent(pathname); } catch { /* Invalid paths cannot enable the feature. */ }
  pathname = pathname.replace(/\/+$/, '');
  if (pathname === '/api/customers' && process.env.HANDYHUB_CUSTOMER_PERSISTENCE_ENABLED !== 'true') {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  }
  if ((pathname === '/meus-agendamentos' || pathname === '/api/agenda/own') &&
      process.env.HANDYHUB_OWN_AGENDA_ENABLED !== 'true') {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  }
  return updateSupabaseSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
