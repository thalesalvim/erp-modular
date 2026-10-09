import 'server-only';
import { cookies } from 'next/headers';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkPasswordContext, PASSWORD_CONTEXT_COOKIE, validatedSessionId, type PasswordFlow } from './password-context';

export async function requirePasswordFlow(kind: PasswordFlow) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.updated_at) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  try {
    const sessionId = validatedSessionId(session.access_token, user.id);
    const cookie = (await cookies()).get(PASSWORD_CONTEXT_COOKIE)?.value;
    if (!checkPasswordContext(cookie, { kind, userId: user.id, sessionId, authVersion: user.updated_at },
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '')) return null;
    return { supabase, user };
  } catch { return null; }
}
