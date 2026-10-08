import type { NextConfig } from "next";
import { getSupabaseConfig } from "./src/lib/supabaseConfig";

// Fail before bundling a mistakenly configured privileged key into client JS.
getSupabaseConfig({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  publicKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  appEnvironment: process.env.NEXT_PUBLIC_APP_ENV,
  deploymentEnvironment: process.env.VERCEL_ENV,
});

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  /* outras opções de configuração se precisar no futuro */
};

export default nextConfig;
