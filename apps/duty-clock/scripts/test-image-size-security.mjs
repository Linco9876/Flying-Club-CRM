import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const metroRequire = createRequire(require.resolve('metro/package.json'));
const { imageSize } = metroRequire('image-size');
const installedPackage = metroRequire('image-size/package.json');

assert.equal(
  installedPackage.version,
  '2.0.3-bfc.1',
  'The audited image-size security backport is not installed.',
);

const writeUInt32 = (buffer, offset, value) => {
  buffer[offset] = (value >>> 24) & 0xff;
  buffer[offset + 1] = (value >>> 16) & 0xff;
  buffer[offset + 2] = (value >>> 8) & 0xff;
  buffer[offset + 3] = value & 0xff;
};

const ascii = (buffer, offset, value) => {
  for (let index = 0; index < value.length; index += 1) {
    buffer[offset + index] = value.charCodeAt(index);
  }
};

const icns = new Uint8Array(16);
ascii(icns, 0, 'icns');
writeUInt32(icns, 4, icns.length);
ascii(icns, 8, 'ic07');
writeUInt32(icns, 12, 0);
assert.throws(() => imageSize(icns), /Invalid ICNS image entry length/);

const jxl = new Uint8Array(24);
writeUInt32(jxl, 0, 12);
ascii(jxl, 4, 'JXL ');
writeUInt32(jxl, 12, 0);
ascii(jxl, 16, 'ftyp');
assert.throws(() => imageSize(jxl));

const heif = new Uint8Array(24);
writeUInt32(heif, 0, 0);
ascii(heif, 4, 'ftyp');
ascii(heif, 8, 'heic');
assert.throws(() => imageSize(heif));

console.log('image-size security backport rejected ICNS, JXL and HEIF zero-length structures.');
