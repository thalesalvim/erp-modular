import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qmfwsnhpmsonndhggqsyi.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_JuGkK6_crCe97HVQX4T3mA_DVHOCaJ6';

export const supabase = createClient(supabaseUrl, supabaseKey);