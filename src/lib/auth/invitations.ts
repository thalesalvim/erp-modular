import { isTenantRole, type TenantRole } from './authorization';

export interface InvitationInput { tenantId: string; email: string; role: TenantRole }

export function parseInvitationInput(body: unknown): InvitationInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid invitation.');
  const input = body as Record<string, unknown>;
  // Owner controls a requested role/tenant only within their server-verified authority.
  // Callers cannot choose redirect URLs, trusted user IDs or administrative flags.
  if (Object.keys(input).some((key) => !['tenantId', 'email', 'role'].includes(key))) {
    throw new Error('Invalid invitation.');
  }
  const tenantId = typeof input.tenantId === 'string' ? input.tenantId : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId) ||
      email.length > 254 || !/^[^\s@<>"\x00-\x1f]+@[^\s@<>"\x00-\x1f]+\.[^\s@<>"\x00-\x1f]+$/.test(email) ||
      !isTenantRole(input.role)) throw new Error('Invalid invitation.');
  return { tenantId, email, role: input.role };
}

export function invitationRedirect(siteUrl: string | undefined): string {
  if (!siteUrl) throw new Error('Invitation origin unavailable.');
  const parsed = new URL(siteUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash ||
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local))) {
    throw new Error('Invalid invitation origin.');
  }
  return new URL('/auth/callback', parsed.origin).toString();
}
