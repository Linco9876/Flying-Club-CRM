import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import test from 'node:test';

type Rgb = readonly [number, number, number];

const sourceRoot = new URL('../', import.meta.url);
const darkThemeCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

const collectTsxSource = (directory: URL): string => readdirSync(directory, { withFileTypes: true })
  .map((entry) => {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
    if (entry.isDirectory()) return collectTsxSource(entryUrl);
    return entry.name.endsWith('.tsx') ? readFileSync(entryUrl, 'utf8') : '';
  })
  .join('\n');

const componentSource = collectTsxSource(sourceRoot);

const relativeLuminance = ([red, green, blue]: Rgb) => {
  const [r, g, b] = [red, green, blue].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (foreground: Rgb, background: Rgb) => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
};

test('dark theme action colours meet WCAG AA contrast for normal text', () => {
  const white: Rgb = [255, 255, 255];
  const actionBackgrounds: Array<[string, Rgb]> = [
    ['blue', [29, 78, 216]],
    ['green', [21, 128, 61]],
    ['emerald', [4, 120, 87]],
    ['amber', [180, 83, 9]],
    ['red', [220, 38, 38]],
  ];

  actionBackgrounds.forEach(([name, background]) => {
    assert.ok(contrastRatio(white, background) >= 4.5, `${name} action contrast must be at least 4.5:1`);
  });
});

test('every high-opacity white surface used by components has a dark surface mapping', () => {
  const tokens = new Set(componentSource.match(/bg-white\/(?:6\d|7\d|8\d|9\d)/g) ?? []);
  assert.ok(tokens.size > 0);

  tokens.forEach((token) => {
    assert.ok(darkThemeCss.includes(`.${token.replace('/', '\\/')}`), `Missing dark theme mapping for ${token}`);
  });
});

test('translucent light status surfaces cannot remain light in dark mode', () => {
  const tokens = new Set(
    componentSource.match(/bg-(?:gray|slate|blue|green|emerald|amber|yellow|orange|red)-(?:50|100)\/(?:[2-9]\d)/g) ?? [],
  );
  assert.ok(tokens.size > 0);

  tokens.forEach((token) => {
    assert.ok(darkThemeCss.includes(`.${token.replace('/', '\\/')}`), `Missing dark theme mapping for ${token}`);
  });
});

test('sky, cyan and rose light surfaces have complete dark theme families', () => {
  [
    '.bg-sky-50',
    '.bg-sky-100',
    '.text-sky-700',
    '.border-sky-200',
    '.bg-cyan-50',
    '.bg-cyan-100',
    '.text-cyan-700',
    '.border-cyan-200',
    '.bg-rose-50',
    '.bg-rose-100',
    '.text-rose-700',
    '.border-rose-200',
  ].forEach((selector) => assert.ok(darkThemeCss.includes(selector), `Missing ${selector}`));
});

test('known low-contrast white-on-light utility pairs are not reintroduced', () => {
  const lowContrastPair = /bg-(?:blue-300|amber-(?:400|500)|red-500)\s+[^"'`]{0,100}text-white|text-white\s+[^"'`]{0,100}bg-(?:blue-300|amber-(?:400|500)|red-500)/g;
  const matches = componentSource.match(lowContrastPair) ?? [];
  assert.deepEqual(matches, []);
});
