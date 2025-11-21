const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 5174;

// Serve the built `dist` directory under the `/websites/dist` path
const distDir = path.join(__dirname, '..', 'dist');
app.use('/websites/dist', express.static(distDir, { index: false }));

// Also serve arcgis static assets and other files from the local `public` folder
const publicDir = path.join(__dirname, '..', 'public');
// Serve arcgis-assets under the app path so requests for /websites/dist/arcgis-assets/... succeed
app.use('/websites/dist/arcgis-assets', express.static(path.join(publicDir, 'arcgis-assets')));
// Also serve arcgis-assets at the site root path so requests to `/arcgis-assets/...` succeed
app.use('/arcgis-assets', express.static(path.join(publicDir, 'arcgis-assets')));
// Serve favicon from public for convenience (handles /favicon.ico and /websites/dist/favicon.ico)
app.use('/favicon.ico', express.static(path.join(publicDir, 'favicon.ico')));
app.use('/websites/dist/favicon.ico', express.static(path.join(publicDir, 'favicon.ico')));

// Redirect root to the apps path for convenience
app.get('/', (req, res) => {
  res.redirect('/websites/dist/');
});

// Serve index.html for the app path
app.get('/websites/dist/*', (req, res) => {
  // If path maps directly to a file, let static middleware handle it
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Static server for dist running at http://localhost:${port}/websites/dist/`);
});
