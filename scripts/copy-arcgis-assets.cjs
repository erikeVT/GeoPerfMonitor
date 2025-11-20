const fs = require('fs');
const path = require('path');

async function copyDir(src, dest) {
  try {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.promises.copyFile(srcPath, destPath);
      }
    }
  } catch (err) {
    throw err;
  }
}

async function main() {
  const pkgRoot = path.resolve(__dirname, '..');
  const src = path.join(pkgRoot, 'node_modules', '@arcgis', 'core', 'assets');
  const dest = path.join(pkgRoot, 'public', 'arcgis-assets');

  try {
    const stat = await fs.promises.stat(src);
    if (!stat.isDirectory()) {
      console.error('ArcGIS assets not found in node_modules');
      process.exit(0);
    }
  } catch (e) {
    console.error('ArcGIS assets not found in node_modules; run `npm install @arcgis/core` first.');
    process.exit(0);
  }

  console.log(`Copying ArcGIS assets from ${src} -> ${dest} ...`);
  try {
    await copyDir(src, dest);
    console.log('ArcGIS assets copied successfully.');
  } catch (err) {
    console.error('Failed to copy ArcGIS assets:', err);
  }
}

main();
