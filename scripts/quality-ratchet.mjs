import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ESLint } from 'eslint';

const baseline = JSON.parse(fs.readFileSync(new URL('./quality-baseline.json', import.meta.url), 'utf8'));
const lintResults = await new ESLint().lintFiles(['.']);
const lint = lintResults.reduce(
  (total, result) => ({
    errors: total.errors + result.errorCount,
    warnings: total.warnings + result.warningCount,
  }),
  { errors: 0, warnings: 0 },
);

const typecheck = spawnSync(
  process.execPath,
  ['./node_modules/typescript/bin/tsc', '-p', 'tsconfig.app.json', '--pretty', 'false'],
  { encoding: 'utf8', shell: false },
);
if (typecheck.error) throw typecheck.error;
const typecheckOutput = `${typecheck.stdout || ''}\n${typecheck.stderr || ''}`;
const typescriptErrors = (typecheckOutput.match(/error TS\d+:/g) || []).length;

console.log(
  `Quality ratchet: ESLint ${lint.errors} error(s), ${lint.warnings} warning(s); `
  + `TypeScript ${typescriptErrors} error(s).`,
);

const regressions = [];
if (lint.errors > baseline.eslintErrors) regressions.push(`ESLint errors ${lint.errors} > ${baseline.eslintErrors}`);
if (lint.warnings > baseline.eslintWarnings) regressions.push(`ESLint warnings ${lint.warnings} > ${baseline.eslintWarnings}`);
if (typescriptErrors > baseline.typescriptErrors) regressions.push(`TypeScript errors ${typescriptErrors} > ${baseline.typescriptErrors}`);

if (regressions.length) {
  console.error(`Quality regression blocked:\n- ${regressions.join('\n- ')}`);
  process.exit(1);
}

if (lint.errors || typescriptErrors) {
  console.error('Compiler and lint errors are not permitted.');
  process.exit(1);
}

if (lint.warnings) {
  console.warn(`Reviewed React hook warning ceiling: ${baseline.eslintWarnings}. Reduce this ceiling whenever warnings are removed.`);
}
