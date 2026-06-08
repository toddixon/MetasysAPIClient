import { readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '../src/assets/icons');
const manifestPath = join(iconsDir, 'manifest.json');

const icons = readdirSync(iconsDir)
  .filter(f => f.endsWith('.svg'))
  .map(f => f.replace('.svg', ''));

writeFileSync(manifestPath, JSON.stringify(icons, null, 2));
console.log(`Generated icon manifest with ${icons.length} icons: ${icons.join(', ')}`);
