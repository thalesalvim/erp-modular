import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPasswordContext, issuePasswordContext, validatePasswordInput, validatedSessionId, PASSWORD_CONTEXT_SECONDS } from '../src/lib/auth/password-context.ts';

const secret = 'synthetic-test-secret-not-a-service-key';
const now = 100000;
const context = { kind: 'invite', userId: 'user-a', sessionId: 'a1234567-1234-1234-1234-123456789012', authVersion: 'v1' };
test('signed password context requires matching user, session, flow, Auth version and expiry', () => {
  const cookie = issuePasswordContext(context, secret, now);
  assert.equal(checkPasswordContext(cookie, context, secret, now), true);
  for (const mismatch of [{ kind: 'recovery' }, { userId: 'user-b' }, { sessionId: 'other' }, { authVersion: 'v2' }]) {
    assert.equal(checkPasswordContext(cookie, { ...context, ...mismatch }, secret, now), false);
  }
  assert.equal(checkPasswordContext(cookie, context, secret, now + PASSWORD_CONTEXT_SECONDS * 1000), false);
  assert.equal(checkPasswordContext(cookie, context, 'wrong', now), false);
  assert.equal(checkPasswordContext(undefined, context, secret, now), false);
  assert.equal(checkPasswordContext(cookie + '.extra', context, secret, now), false);
  const payload = Buffer.from(JSON.stringify({ ...context, expiresAt: now + 99999999 })).toString('base64url');
  assert.equal(checkPasswordContext(payload + '.' + cookie.split('.')[1], context, secret, now), false);
});
test('validated session ID rejects a different JWT subject and missing session ID', () => {
  const token = (claims) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  assert.equal(validatedSessionId(token({ sub: context.userId, session_id: context.sessionId }), context.userId), context.sessionId);
  for (const claims of [{ sub: 'other', session_id: context.sessionId }, { sub: context.userId }, { sub: context.userId, session_id: 'any' }]) {
    assert.throws(() => validatedSessionId(token(claims), context.userId));
  }
});
test('password request rejects weak/mismatched passwords and arbitrary identity/tenant fields', () => {
  const input = { kind: 'invite', password: 'Synthetic-long-pass', confirmation: 'Synthetic-long-pass' };
  assert.equal(validatePasswordInput(input).kind, 'invite');
  for (const changed of [{ password: 'short', confirmation: 'short' }, { confirmation: 'different' }, { kind: 'email' },
    { userId: 'other' }, { tenant_id: 'other' }, { password: 'a'.repeat(129), confirmation: 'a'.repeat(129) }]) {
    assert.throws(() => validatePasswordInput({ ...input, ...changed }));
  }
});
