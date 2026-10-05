import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  /* outras opções de configuração se precisar no futuro */
};

export default nextConfig;