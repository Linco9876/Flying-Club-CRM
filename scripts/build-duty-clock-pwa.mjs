import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const appDirectory = resolve(root, 'apps', 'duty-clock');
const productionEnvPath = resolve(root, '.env.production');
const buildEnvironment = { ...process.env };

if (existsSync(productionEnvPath)) {
  for (const line of readFileSync(productionEnvPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && buildEnvironment[match[1]] === undefined) buildEnvironment[match[1]] = match[2];
  }
}

buildEnvironment.EXPO_PUBLIC_SUPABASE_URL ||= buildEnvironment.VITE_SUPABASE_URL;
buildEnvironment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||= buildEnvironment.VITE_SUPABASE_ANON_KEY;

if (!buildEnvironment.EXPO_PUBLIC_SUPABASE_URL || !buildEnvironment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Duty Clock PWA requires the public Supabase URL and publishable key.');
}

const run = (args, cwd = appDirectory) => {
  const npmCli = process.env.npm_execpath;
  const result = npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], { cwd, env: buildEnvironment, stdio: 'inherit' })
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, env: buildEnvironment, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(['ci']);
run(['run', 'assets:generate']);
run(['exec', '--', 'expo', 'export', '--platform', 'web', '--output-dir', '../../dist/duty-clock/app']);
