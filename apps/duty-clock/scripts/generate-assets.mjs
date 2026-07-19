import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const assets = new URL('../assets/', import.meta.url);
const assetPath = (name) => fileURLToPath(new URL(name, assets));

await Promise.all([
  sharp(assetPath('icon-source.svg')).resize(1024, 1024).flatten({ background: '#0F4C81' }).removeAlpha().png().toFile(assetPath('icon.png')),
  sharp(assetPath('adaptive-icon-source.svg')).resize(1024, 1024).png().toFile(assetPath('adaptive-icon.png')),
  sharp(assetPath('monochrome-icon-source.svg')).resize(432, 432).png().toFile(assetPath('monochrome-icon.png')),
]);
