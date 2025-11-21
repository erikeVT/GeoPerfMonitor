<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1_kJnRVK8fHxzr3fu0eel9SF-cpoBLyhF

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deployment / Production notes

- The ArcGIS JavaScript SDK requires static assets (workers, components icons, translations) that are copied
   from `node_modules/@arcgis/core/assets` into `public/arcgis-assets` by the `postinstall` script.
- To verify production under a non-root mount (for example `/websites/dist/`), build and serve the `dist` folder
   with the included `serve-dist` helper which mounts `dist` at `/websites/dist` and serves `public/arcgis-assets`.

Local verification steps:

```powershell
npm install
npm run build
npm run serve-dist
# then open http://localhost:5174/websites/dist/
```

If you see 404s for ArcGIS worker files or component assets, make sure the directory `public/arcgis-assets` is present
and contains `esri/core/workers/RemoteClient.js` and the `components` subfolders. The `copy-arcgis-assets` script runs
automatically on `postinstall` but you can run it manually with `npm run copy-arcgis-assets`.
