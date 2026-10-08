/** Only the email flows our application handles; no phone or arbitrary OTP type. */
export const EMAIL_CALLBACK_TYPES = ['invite', 'recovery', 'email', 'email_change'] as const;
export type EmailCallbackType = (typeof EMAIL_CALLBACK_TYPES)[number];

const allowedDestinations = new Set(['/', '/equipe', '/auth/account', '/auth/update-password']);

export type AuthCallback =
  | { kind: 'pkce'; code: string; destination: string }
  | { kind: 'otp'; tokenHash: string; type: EmailCallbackType; destination: string };

export function parseAuthCallback(parameters: URLSearchParams): AuthCallback {
  const code = parameters.get('code');
  const tokenHash = parameters.get('token_hash');
  const allowedKeys = code ? new Set(['code', 'next']) : new Set(['token_hash', 'type', 'next']);
  for (const key of parameters.keys()) {
    if (!allowedKeys.has(key) || parameters.getAll(key).length !== 1) throw new Error('Invalid callback.');
  }
  const next = parameters.get('next');
  // Exact paths: no schemes, query strings, fragments, escapes or alternate origins.
  if (next !== null && !allowedDestinations.has(next)) throw new Error('Invalid callback.');

  if (code) {
    if (!/^[A-Za-z0-9._~-]{8,2048}$/.test(code)) throw new Error('Invalid callback.');
    return { kind: 'pkce', code, destination: next ?? '/' };
  }

  const type = parameters.get('type');
  if (!tokenHash || !/^[A-Za-z0-9_-]{32,512}$/.test(tokenHash) ||
      !EMAIL_CALLBACK_TYPES.includes(type as EmailCallbackType)) throw new Error('Invalid callback.');
  return {
    kind: 'otp', tokenHash, type: type as EmailCallbackType,
    // Password setup cannot be skipped by an invitation/recovery URL parameter.
    destination: type === 'invite' || type === 'recovery' ? '/auth/update-password' : next ?? '/',
  };
}

export function escapeHtml(value: string) {
  const replacements: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (character) => replacements[character]);
}
