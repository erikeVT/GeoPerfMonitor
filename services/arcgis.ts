// Lightweight ArcGIS initialization helper
// Ensures `globalThis.esriConfig` is set early and patches `fetch` to rewrite ArcGIS CDN and absolute
// /arcgis-assets requests to local `siteBase` when local assets are present.

export async function initArcGIS(): Promise<{ usingLocal: boolean; siteBase: string }>{
  // compute site base (directory of current document path)
  const siteBase = (() => {
    try {
      const p = location.pathname || '';
      if (p.endsWith('/')) return p.slice(0, -1);
      if (p.endsWith('/index.html')) return p.replace(/index\.html$/, '').replace(/\/$/, '');
      return p.replace(/\/$/, '');
    } catch (e) { return ''; }
  })();

  // ensure global esriConfig exists early so ArcGIS will pick it up on module load
  (globalThis as any).esriConfig = (globalThis as any).esriConfig || {};

  const publicWorkerPath = `${siteBase}/arcgis-assets/esri/core/workers/RemoteClient.js`;
  let usingLocal = false;
  try {
    const resp = await fetch(publicWorkerPath, { method: 'HEAD' });
    if (resp.ok) usingLocal = true;
  } catch (e) {
    usingLocal = false;
  }

  if (usingLocal) {
    const assetsBase = `${location.origin}${siteBase}/arcgis-assets`;
    // set both assetsPath and workersUrl so ArcGIS knows where to load components and workers from
    (globalThis as any).esriConfig.assetsPath = `${assetsBase}`;
    (globalThis as any).esriConfig.workersUrl = `${assetsBase}/esri/core/workers/`;
    (globalThis as any).esriConfig.workers = (globalThis as any).esriConfig.workers || {};
    (globalThis as any).esriConfig.workers.loaderConfig = (globalThis as any).esriConfig.workers.loaderConfig || {};
    (globalThis as any).esriConfig.workers.loaderConfig.paths = (globalThis as any).esriConfig.workers.loaderConfig.paths || {};
    (globalThis as any).esriConfig.workers.loaderConfig.paths['esri/core/workers'] = `${assetsBase}/esri/core/workers`;

    // Patch fetch to rewite CDN or absolute /arcgis-assets requests to our local assets location
    if (!(window as any).__arcgisFetchPatched) {
      const origFetch = window.fetch.bind(window);
      window.fetch = async (input: any, init?: any) => {
        try {
          let urlStr = typeof input === 'string' ? input : input?.url || '';
          const u = new URL(urlStr, location.href);

          const arcIdx = u.pathname.indexOf('/arcgis-assets/');
          if (arcIdx !== -1) {
            const newPath = u.pathname.substring(arcIdx);
            const newUrl = `${location.origin}${siteBase}${newPath}`;
            input = typeof input === 'string' ? newUrl : new Request(newUrl, input);
          } else if (u.hostname.includes('js.arcgis.com')) {
            // Map CDN asset paths like /4.28/components/... to /<siteBase>/arcgis-assets/components/...
            const newPath = u.pathname.replace(/^\/4\.\d+/, '');
            const newUrl = `${location.origin}${siteBase}/arcgis-assets${newPath}`;
            input = typeof input === 'string' ? newUrl : new Request(newUrl, input);
          }
        } catch (e) {
          // ignore and fall back to original input
        }
        return origFetch(input, init);
      };
      (window as any).__arcgisFetchPatched = true;
    }

    // Diagnostic logging: expose debug info and wrap Worker to log worker script URLs
    try {
      console.debug('[initArcGIS] usingLocalAssets:', usingLocal, 'assetsBase:', assetsBase, 'workersUrl:', (globalThis as any).esriConfig.workersUrl);
      (globalThis as any).__arcgis_assetsBase = assetsBase;

      if (!(window as any).__ArcGISWorkerWrapInstalled) {
        const RealWorker = (window as any).Worker;
        // Wrap Worker constructor to log URLs used by ArcGIS when creating workers
        (window as any).Worker = function (scriptUrl: any, options?: any) {
          try {
            console.debug('[ArcGIS Worker] new Worker called with', scriptUrl, 'options:', options);
          } catch (e) { /* ignore */ }

          try {
            const s = typeof scriptUrl === 'string' ? scriptUrl : scriptUrl?.toString?.() || '';
            // If scriptUrl points to a blob URL, create a wrapper blob that installs an importScripts shim
            // which rewrites js.arcgis.com and absolute /arcgis-assets requests to the local assetsBase.
            if (s.startsWith('blob:')) {
              try {
                const originalBlobUrl = s;
                const wrapper = `
                  // Wrapper injected by app to rewrite ArcGIS CDN/absolute asset urls to local assets
                  (function(){
                    const assetsBase = ${JSON.stringify(assetsBase)};
                    const siteBase = ${JSON.stringify(siteBase)};
                    const origBlob = ${JSON.stringify(originalBlobUrl)};
                    // Fetch the original blob text, rewrite known CDN and absolute asset URLs, then import it
                    fetch(origBlob).then(resp => resp.text()).then(text => {
                      try {
                        // Replace js.arcgis.com versioned prefix (e.g. https://js.arcgis.com/4.28) => local assetsBase
                        text = text.replace(/https?:\/\/js\.arcgis\.com\/4\.\d+/g, location.origin + siteBase + '/arcgis-assets');
                        // Replace absolute /arcgis-assets/ occurrences
                        text = text.replace(/(["'])\/arcgis-assets\//g, '$1' + location.origin + siteBase + '/arcgis-assets/');
                      } catch(e) { /* ignore replacements if something fails */ }
                      const newBlob = new Blob([text], { type: 'application/javascript' });
                      const url = URL.createObjectURL(newBlob);
                      importScripts(url);
                    }).catch(e => {
                      // Fall back to importing original blob if fetch/replace fails
                      importScripts(origBlob);
                    });
                  })();
                `;
                const blob = new Blob([wrapper], { type: 'application/javascript' });
                const wrappedUrl = URL.createObjectURL(blob);
                console.debug('[ArcGIS Worker] created wrapper blob for', originalBlobUrl, '->', wrappedUrl);
                // @ts-ignore
                return new RealWorker(wrappedUrl, options);
              } catch (e) {
                console.warn('Failed to create wrapped worker blob', e);
              }
            }
            // If scriptUrl is a relative esri path, rewrite to assetsBase
            if (s && s.indexOf('/esri/core/workers') !== -1 && !s.startsWith('http')) {
              const fixed = `${assetsBase}${s.replace(/.*\/esri\/core\/workers/, '/esri/core/workers')}`;
              scriptUrl = fixed;
              console.debug('[ArcGIS Worker] rewritten worker url ->', scriptUrl);
            }
          } catch (e) {}

          // @ts-ignore
          return new RealWorker(scriptUrl, options);
        };
        (window as any).__ArcGISWorkerWrapInstalled = true;
      }
    } catch (e) {
      console.warn('Failed to install ArcGIS worker diagnostics', e);
    }
  } else {
    // fallback to CDN workers
    (globalThis as any).esriConfig.workers = (globalThis as any).esriConfig.workers || {};
    (globalThis as any).esriConfig.workers.loaderConfig = (globalThis as any).esriConfig.workers.loaderConfig || {};
    (globalThis as any).esriConfig.workers.loaderConfig.paths = (globalThis as any).esriConfig.workers.loaderConfig.paths || {};
    (globalThis as any).esriConfig.assetsPath = (globalThis as any).esriConfig.assetsPath || 'https://js.arcgis.com/4.28/@arcgis/core/assets';
    (globalThis as any).esriConfig.workersUrl = (globalThis as any).esriConfig.workersUrl || 'https://js.arcgis.com/4.28/esri/core/workers/';
  }

  return { usingLocal, siteBase };
}

export default initArcGIS;
