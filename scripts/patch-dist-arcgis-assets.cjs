const fs = require('fs');
const path = require('path');

function walk(dir, filelist = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filepath = path.join(dir, file);
    const stat = fs.statSync(filepath);
    if (stat.isDirectory()) walk(filepath, filelist);
    else filelist.push(filepath);
  });
  return filelist;
}

function patchDist(distDir) {
  if (!fs.existsSync(distDir)) {
    console.error('dist directory not found:', distDir);
    process.exit(0);
  }

  const files = walk(distDir).filter(f => f.endsWith('.js') || f.endsWith('.mjs'));
  console.log(`Patching ${files.length} JS files in ${distDir} to rewrite ArcGIS CDN paths...`);

  const cdnRegex = /https:\/\/js\.arcgis\.com\/4\.[0-9]+/g;
  files.forEach(file => {
    let text = fs.readFileSync(file, 'utf8');
    if (cdnRegex.test(text)) {
      const patched = text.replace(cdnRegex, './arcgis-assets');
      fs.writeFileSync(file, patched, 'utf8');
      console.log('Patched', path.relative(distDir, file));
    }
  });

  console.log('Patch complete.');
}

const distDir = path.join(__dirname, '..', 'dist');
patchDist(distDir);
