import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const assets = new URL('../assets/', import.meta.url);
const publicAssets = new URL('../public/', import.meta.url);
const assetPath = (name) => fileURLToPath(new URL(name, assets));
const publicPath = (name) => fileURLToPath(new URL(name, publicAssets));

await Promise.all([
  sharp(assetPath('icon-source.svg')).resize(1024, 1024).flatten({ background: '#0F4C81' }).removeAlpha().png().toFile(assetPath('icon.png')),
  sharp(assetPath('adaptive-icon-source.svg')).resize(1024, 1024).png().toFile(assetPath('adaptive-icon.png')),
  sharp(assetPath('monochrome-icon-source.svg')).resize(432, 432).png().toFile(assetPath('monochrome-icon.png')),
  sharp(assetPath('icon-source.svg')).resize(192, 192).flatten({ background: '#0F4C81' }).removeAlpha().png().toFile(publicPath('pwa-icon-192.png')),
  sharp(assetPath('icon-source.svg')).resize(512, 512).flatten({ background: '#0F4C81' }).removeAlpha().png().toFile(publicPath('pwa-icon-512.png')),
  sharp(assetPath('adaptive-icon-source.svg')).resize(512, 512).flatten({ background: '#0F4C81' }).removeAlpha().png().toFile(publicPath('pwa-icon-maskable-512.png')),
]);
