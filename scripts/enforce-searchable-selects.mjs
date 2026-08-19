import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, 'src');
const componentPath = resolve(sourceRoot, 'components/common/SearchableSelect.tsx');
const write = process.argv.includes('--write');

const files = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) visit(path);
    else if (path.endsWith('.tsx') && path !== componentPath) files.push(path);
  }
};
visit(sourceRoot);

const nativeSelectPattern = /<select(?=[\s>])/g;
const nativeSelectClosePattern = /<\/select\s*>/g;
const importPattern = /import\s+\{\s*SearchableSelect\s*\}\s+from\s+['"][^'"]+SearchableSelect['"];?/;
const changed = [];
const offenders = [];
const nativeDatalistPattern = /<datalist(?=[\s>])/g;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (nativeDatalistPattern.test(source)) offenders.push(`${relative(root, file)} (native datalist)`);
  nativeDatalistPattern.lastIndex = 0;
  if (!nativeSelectPattern.test(source)) continue;
  nativeSelectPattern.lastIndex = 0;
  if (!write) {
    offenders.push(relative(root, file));
    continue;
  }

  let importPath = relative(dirname(file), componentPath.replace(/\.tsx$/, '')).split(sep).join('/');
  if (!importPath.startsWith('.')) importPath = `./${importPath}`;
  let next = source
    .replace(nativeSelectPattern, '<SearchableSelect')
    .replace(nativeSelectClosePattern, '</SearchableSelect>');
  if (!importPattern.test(next)) next = `import { SearchableSelect } from '${importPath}';\n${next}`;
  writeFileSync(file, next, 'utf8');
  changed.push(relative(root, file));
}

if (write) {
  console.log(`Converted ${changed.length} portal files to SearchableSelect.`);
} else if (offenders.length) {
  console.error(`Native portal dropdowns remain in:\n${offenders.map(file => `  ${file}`).join('\n')}`);
  process.exit(1);
} else {
  console.log(`Searchable dropdown audit passed across ${files.length} TSX files.`);
}
