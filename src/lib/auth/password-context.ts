import { createHmac, timingSafeEqual } from 'node:crypto';

export type PasswordFlow = 'invite' | 'recovery';
export const PASSWORD_CONTEXT_COOKIE = 'handyhub-password-context';
export const PASSWORD_CONTEXT_SECONDS = 30 * 60;
interface PasswordContext {
  kind: PasswordFlow;
  userId: string;
  sessionId: string;
  authVersion: string;
  expiresAt: number;
}

function sign(payload: string, secret: string) {
  if (!secret) throw new Error('Password context unavailable.');
  return createHmac('sha256', secret).update('handyhub:password-context:v1:').update(payload).digest();
}

// Called only after getUser validated this session with Supabase Auth.
// Decoding a JWT here identifies the session; it never authorizes a request.
export function validatedSessionId(accessToken: string, userId: string) {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString());
    if (claims.sub !== userId || typeof claims.session_id !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(claims.session_id)) throw new Error();
    return claims.session_id as string;
  } catch { throw new Error('Invalid validated session.'); }
}

export function issuePasswordContext(context: Omit<PasswordContext, 'expiresAt'>, secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ ...context, expiresAt: now + PASSWORD_CONTEXT_SECONDS * 1000 })).toString('base64url');
  return `${payload}.${sign(payload, secret).toString('base64url')}`;
}

export function checkPasswordContext(cookie: string | undefined, expected: Omit<PasswordContext, 'expiresAt'>, secret: string, now = Date.now()) {
  try {
    if (!cookie || cookie.length > 2048 || !secret) return false;
    const [payload, signature, extra] = cookie.split('.');
    if (!payload || !signature || extra) return false;
    const received = Buffer.from(signature, 'base64url');
    const required = sign(payload, secret);
    if (received.length !== required.length || !timingSafeEqual(received, required)) return false;
    const context: PasswordContext = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return context.kind === expected.kind && context.userId === expected.userId &&
      context.sessionId === expected.sessionId && context.authVersion === expected.authVersion &&
      Number.isFinite(context.expiresAt) && context.expiresAt > now &&
      context.expiresAt <= now + PASSWORD_CONTEXT_SECONDS * 1000;
  } catch { return false; }
}

export function validatePasswordInput(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid password request.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['kind', 'password', 'confirmation'].includes(key)) ||
      !['invite', 'recovery'].includes(String(input.kind)) || typeof input.password !== 'string' ||
      input.password.length < 8 || input.password.length > 128 || input.password !== input.confirmation) throw new Error('Invalid password request.');
  return { kind: input.kind as PasswordFlow, password: input.password };
}
