import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;

const temporaryExceptions = new Map([
  ['https://github.com/advisories/GHSA-qwww-vcr4-c8h2', {
    packages: new Set(['react-router', 'react-router-dom']),
    versions: new Set(['7.18.2']),
    reviewedOn: '2026-08-03',
    expiresOn: '2026-08-15',
    reason: 'The React Router maintainer advisory identifies >=7.18.2 as patched, while npm advisory metadata still flags 7.18.2. The portal also does not use the affected unstable RSC APIs. Recheck npm metadata before expiry.',
  }],
]);

const runAudit = (directory, label, allowExceptions) => {
  const options = {
    cwd: directory,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  };
  const result = npmCli
    ? spawnSync(process.execPath, [npmCli, 'audit', '--audit-level=high', '--json'], options)
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--audit-level=high', '--json'], {
      ...options,
      shell: process.platform === 'win32',
    });

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`${label} dependency audit did not return valid JSON.`);
  }

  const vulnerabilities = report.vulnerabilities ?? {};
  if (Object.keys(vulnerabilities).length === 0) {
    console.log(`${label}: 0 vulnerabilities.`);
    return;
  }

  const lock = JSON.parse(readFileSync(resolve(directory, 'package-lock.json'), 'utf8'));
  const advisoryUrlsFor = (name, visited = new Set()) => {
    if (visited.has(name)) return new Set();
    visited.add(name);
    const urls = new Set();
    for (const item of vulnerabilities[name]?.via ?? []) {
      if (typeof item === 'string') {
        for (const url of advisoryUrlsFor(item, visited)) urls.add(url);
      } else if (item?.url) {
        urls.add(item.url);
      }
    }
    return urls;
  };

  const accepted = [];
  const blocked = [];

  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    const urls = advisoryUrlsFor(name);
    const installedVersion = lock.packages?.[`node_modules/${name}`]?.version;
    const exceptions = [...urls].map(url => ({ url, exception: temporaryExceptions.get(url) }));
    const canAccept = allowExceptions
      && urls.size > 0
      && exceptions.every(({ exception }) => (
        exception
        && exception.packages.has(name)
        && exception.versions.has(installedVersion)
        && Date.now() <= new Date(`${exception.expiresOn}T23:59:59Z`).getTime()
      ));

    if (canAccept) accepted.push({ name, installedVersion, urls: [...urls] });
    else blocked.push({ name, vulnerability, installedVersion, urls: [...urls] });
  }

  if (blocked.length > 0) {
    console.error(`${label}: dependency audit blocked ${blocked.length} vulnerable package(s).`);
    for (const item of blocked) {
      console.error(`- ${item.name}@${item.installedVersion ?? 'unknown'}: ${item.urls.join(', ') || item.vulnerability.severity}`);
    }
    process.exitCode = 1;
    return;
  }

  const acceptedUrls = new Set(accepted.flatMap(item => item.urls));
  console.log(`${label}: 0 actionable vulnerabilities; ${acceptedUrls.size} time-limited, reviewed advisory exception.`);
  for (const url of acceptedUrls) {
    const exception = temporaryExceptions.get(url);
    console.log(`- ${url} (reviewed ${exception.reviewedOn}; expires ${exception.expiresOn}): ${exception.reason}`);
  }
};

runAudit(root, 'Portal', true);
runAudit(resolve(root, 'apps', 'duty-clock'), 'Duty Clock PWA', false);

if (process.exitCode) process.exit(process.exitCode);
