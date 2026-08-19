import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const functionsRoot = path.resolve('supabase/functions');

const findFunctionSources = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '_shared') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findFunctionSources(absolute));
    else if (entry.name === 'index.ts') files.push(absolute);
  }
  return files;
};

test('every portal Brevo sender applies the shared company-logo branding layer', async () => {
  const sources = await findFunctionSources(functionsRoot);
  const senders = [];

  for (const sourcePath of sources) {
    const source = await readFile(sourcePath, 'utf8');
    if (!source.includes('api.brevo.com/v3/smtp/email')) continue;
    senders.push(path.relative(functionsRoot, sourcePath));
    assert.match(source, /from ["']\.\.\/_shared\/emailBranding\.ts["']/, `${sourcePath} must import shared email branding`);
    const htmlPayloads = source.match(/htmlContent\s*:/g) || [];
    const brandedPayloads = source.match(/await\s+brandPortalEmailHtml\s*\(/g) || [];
    assert.ok(htmlPayloads.length > 0, `${sourcePath} should include an HTML email payload`);
    assert.equal(
      brandedPayloads.length,
      htmlPayloads.length,
      `${sourcePath} must brand every HTML email payload`,
    );
  }

  assert.equal(senders.length, 13, `Expected to audit 13 Brevo senders, found ${senders.length}: ${senders.join(', ')}`);
});
