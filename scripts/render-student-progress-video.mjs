import { spawn } from 'node:child_process';
import path from 'node:path';

function parseArgs() {
  const args = new Map();
  for (const arg of process.argv.slice(2)) {
    const [key, ...valueParts] = arg.replace(/^--/, '').split('=');
    args.set(key, valueParts.join('=') || 'true');
  }
  return args;
}

const args = parseArgs();
const props = args.get('props');
const out = args.get('out') || path.join('dist', 'student-progress-video.mp4');

if (!props) {
  console.error('Missing --props path. Export the JSON file from a student profile first.');
  process.exit(1);
}

const remotionBin = process.platform === 'win32'
  ? path.join('node_modules', '.bin', 'remotion.cmd')
  : path.join('node_modules', '.bin', 'remotion');

const child = spawn(remotionBin, [
  'render',
  'src/remotion/index.tsx',
  'StudentProgressVideo',
  out,
  `--props=${props}`,
], {
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
