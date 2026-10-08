import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 });

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: 'Não foi possível validar a função de plataforma.' }, { status: 503 });
    return NextResponse.json({ isPlatformAdmin: Boolean(data) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Validação Master indisponível no servidor.' }, { status: 503 });
  }
}
