import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.loadEnvFile('.env.staging.local');
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'https://gbblkkgowccjycxtexvx.supabase.co');
assert.equal(process.env.NEXT_PUBLIC_APP_ENV, 'local');
const mode = process.argv[2] || 'dev';
assert.ok(['dev', 'build', 'start'].includes(mode));
const require = createRequire(import.meta.url);
process.argv = [process.execPath, require.resolve('next/dist/bin/next'), mode,
  ...(mode === 'start' ? [] : ['--webpack']), ...(mode === 'build' ? [] : ['--hostname', '127.0.0.1'])];
await import('next/dist/bin/next');
