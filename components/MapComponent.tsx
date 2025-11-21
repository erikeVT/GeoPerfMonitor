
import React, { useEffect, useRef, useState } from 'react';
import { MapLayer } from '../types';
import { initInterceptor } from '../services/monitor';

interface MapComponentProps {
  layers: MapLayer[];
  onViewReady?: (view: any) => void;
  onMapUpdate?: (isUpdating: boolean) => void;
  onLayerStatusChange?: (layerId: string, isUpdating: boolean) => void;
}

// Define IHandle compatible with ArcGIS WatchHandle
type IHandle = {
  remove(): void;
};

const MapComponent: React.FC<MapComponentProps> = ({ layers, onViewReady, onMapUpdate, onLayerStatusChange }) => {
  const mapDiv = useRef<HTMLDivElement>(null);
  const viewRef = useRef<any | null>(null);
  const mapRef = useRef<any | null>(null);
   const [arcgisReady, setArcgisReady] = useState(false);
  
  // Track handles to clean up watchers if needed
  const layerWatchers = useRef<Map<string, IHandle>> (new Map());

  useEffect(() => {
    initInterceptor();

    let cancelled = false;
    let handle: any = null;

    const loadArcGIS = async () => {
      if (!mapDiv.current) return;
      // Initialize ArcGIS config and (if possible) patch fetch to route CDN/absolute asset
      // requests to local `arcgis-assets` before loading ArcGIS modules.
      try {
        const { initArcGIS } = await import('../services/arcgis');
        await initArcGIS();
      } catch (e) {
        console.warn('ArcGIS init helper failed', e);
      }

        try {
        const [{ default: ArcGISMap }, { default: MapView }, { default: Extent }, { default: FeatureLayer }, { default: TileLayer }, { default: MapImageLayer }, { default: VectorTileLayer }, reactiveUtilsModule] = await Promise.all([
          import('@arcgis/core/Map.js'),
          import('@arcgis/core/views/MapView.js'),
          import('@arcgis/core/geometry/Extent.js'),
          import('@arcgis/core/layers/FeatureLayer.js'),
          import('@arcgis/core/layers/TileLayer.js'),
          import('@arcgis/core/layers/MapImageLayer.js'),
          import('@arcgis/core/layers/VectorTileLayer.js'),
          import('@arcgis/core/core/reactiveUtils.js'),
        ]);

        if (cancelled) return;

        const map = new ArcGISMap({ basemap: 'satellite' });

        const view = new MapView({
          container: mapDiv.current,
          map,
          extent: new Extent({ xmin: -73.4377, ymin: 42.7268, xmax: -71.5102, ymax: 45.0156 }),
          ui: { components: ['zoom', 'compass', 'attribution'] }
        });

        viewRef.current = view;
        mapRef.current = map;
        // Signal that ArcGIS map/view are initialized so layer-sync effect can run
        setArcgisReady(true);

        const reactiveUtils = reactiveUtilsModule as any;
        // Watch for the 'updating' property to track global map events using reactiveUtils (watch is deprecated)
        try {
          handle = reactiveUtils?.watch(() => view.updating, (val: any) => {
            if (onMapUpdate) onMapUpdate(val);
          });
        } catch (e) {
          // Fallback to old API if reactiveUtils unavailable
          try { handle = view.watch('updating', (val: any) => { if (onMapUpdate) onMapUpdate(val); }); } catch (err) { console.warn('Failed to attach view watcher', err); }
        }

        view.when(() => {
          console.debug('[MapComponent] view is ready');
          // expose view for debugging in the browser console
          try { (window as any).__geoPerfView = view; } catch (e) {}
          if (onViewReady) onViewReady(view);
          // Force a tiny, non-visual pan (offset + restore) to trigger a robust initial render
          (async () => {
            try {
              const c: any = view.center;
              const lon = (c && (c.longitude ?? c.x)) || 0;
              const lat = (c && (c.latitude ?? c.y)) || 0;
              const offset = 0.00001;
              // offset then restore without animation
              // @ts-ignore
              await view.goTo({ center: [lon + offset, lat] }, { animate: false });
              // @ts-ignore
              await view.goTo({ center: [lon, lat] }, { animate: false });
            } catch (e) {
              try {
                // Fallback: single no-op goTo
                // @ts-ignore
                view.goTo({ center: view.center, zoom: view.zoom }, { animate: false }).catch(() => {});
              } catch (err) { /* ignore */ }
            }
          })();
          // helper to force a layer load/refresh from the console
          try {
            (window as any).__forceLayerLoad = async (layerId: string) => {
              const v = (window as any).__geoPerfView;
              if (!v) return console.warn('view not available');
              const layer = v.map.findLayerById(layerId);
              if (!layer) return console.warn('layer not found', layerId);
              try {
                console.debug('forcing load for', layerId);
                if (layer.load) await layer.load();
                await v.whenLayerView(layer);
                await v.goTo({ center: v.center }, { animate: false });
                console.debug('force load complete for', layerId);
              } catch (e) { console.warn('force load failed', e); }
            };
          } catch (e) {}
        });

      } catch (error) {
        console.error('Failed to load ArcGIS modules', error);
      }
    };

    loadArcGIS();

    return () => {
      cancelled = true;
      try { if (handle && handle.remove) handle.remove(); } catch (e) {}
      layerWatchers.current.forEach(h => h.remove());
      layerWatchers.current.clear();
      if (viewRef.current && viewRef.current.destroy) {
        try { viewRef.current.destroy(); } catch (e) {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync layers
  useEffect(() => {
    if (!mapRef.current || !viewRef.current) return;

    const map = mapRef.current;
    const view = viewRef.current;

    let cancelled = false;

    const ensureAndSync = async () => {
      // Dynamically import layer classes so bundler doesn't fail if ArcGIS modules are unavailable at startup
      try {
        const [{ default: FeatureLayer }, { default: TileLayer }, { default: MapImageLayer }, { default: VectorTileLayer }, reactiveUtilsModule] = await Promise.all([
          import('@arcgis/core/layers/FeatureLayer.js'),
          import('@arcgis/core/layers/TileLayer.js'),
          import('@arcgis/core/layers/MapImageLayer.js'),
          import('@arcgis/core/layers/VectorTileLayer.js'),
          import('@arcgis/core/core/reactiveUtils.js'),
        ]);
        const reactiveUtils = reactiveUtilsModule as any;

        if (cancelled) return;

        layers.forEach(layerConfig => {
          let layer = map.findLayerById(layerConfig.id);
          if (!layer) {
            try {
              let url = layerConfig.url;
              const isSubLayer = /\/\d+$/.test(url);

              if ((layerConfig.type === 'map-image' || layerConfig.type === 'tile') && isSubLayer) {
                 url = url.replace(/\/\d+$/, '');
              }

                  if (layerConfig.type === 'feature') {
                    layer = new FeatureLayer({ id: layerConfig.id, url: layerConfig.url, title: layerConfig.title, visible: layerConfig.visible, outFields: ['*'], popupTemplate: { title: '{title}', content: 'OBJECTID: {OBJECTID}' } });
                  } else if (layerConfig.type === 'tile') {
                    layer = new TileLayer({ id: layerConfig.id, url, title: layerConfig.title, visible: layerConfig.visible });
                  } else if (layerConfig.type === 'map-image') {
                    layer = new MapImageLayer({ id: layerConfig.id, url, title: layerConfig.title, visible: layerConfig.visible });
                  } else if (layerConfig.type === 'vector-tile') {
                    layer = new VectorTileLayer({ id: layerConfig.id, url, title: layerConfig.title, visible: layerConfig.visible });
              }

              if (layer) {
                map.add(layer);

                // Ensure the layer is loaded before attaching LayerView watchers.
                (async () => {
                  console.debug('[MapComponent] added layer', layerConfig.id, layerConfig.type, layerConfig.url);
                  try {
                    if (layer.load) {
                      console.debug(`[MapComponent] starting layer.load() for ${layerConfig.id}`);
                      await layer.load();
                      console.debug(`[MapComponent] layer.load() resolved for ${layerConfig.id}`);
                    }
                  } catch (e) {
                    console.warn('layer.load failed', e);
                  }

                  // Order logic: Base layers at bottom
                  try {
                    if (layerConfig.id === 'world-imagery') {
                      map.reorder(layer, 0);
                    } else if (layerConfig.id === 'vermont-basemap') {
                      map.reorder(layer, 1);
                    }
                  } catch (e) { /* ignore reorder errors */ }

                  // Watch for individual layer updating status
                  try {
                    console.debug(`[MapComponent] waiting for layerView for ${layerConfig.id}`);
                    const layerView = await view.whenLayerView(layer);
                    console.debug(`[MapComponent] layerView ready for ${layerConfig.id}`);
                    if (layerWatchers.current.has(layerConfig.id)) {
                      layerWatchers.current.get(layerConfig.id)?.remove();
                    }

                    const watchHandle = ((): any => {
                      try {
                        return reactiveUtils.watch(() => layerView.updating, (val: any) => {
                          console.debug(`[MapComponent] layerView.updating ${layerConfig.id}:`, val);
                          if (onLayerStatusChange) onLayerStatusChange(layerConfig.id, val);
                        });
                      } catch (e) {
                        try { return layerView.watch('updating', (val: any) => { if (onLayerStatusChange) onLayerStatusChange(layerConfig.id, val); }); } catch (err) { console.warn('Failed to attach layerView watcher', err); return null; }
                      }
                    })();

                    // @ts-ignore
                    layerWatchers.current.set(layerConfig.id, watchHandle);
                  } catch (e) {
                    console.warn('LayerView failed', e);
                  }

                  try {
                    console.debug(`[MapComponent] waiting layer.when() for ${layerConfig.id}`);
                    await layer.when();
                    console.debug(`[MapComponent] layer.when() resolved for ${layerConfig.id}`);
                    if (!layerConfig.excludeFromMetrics) {
                      view.goTo(layer.fullExtent).catch((e: any) => console.warn('Zoom failed', e));
                    }
                  } catch (e) {
                    console.warn('layer.when failed', e);
                  }
                })();
              }
            } catch (error) {
              console.error('Failed to create layer', layerConfig, error);
            }
          }

          if (layer) {
            layer.visible = layerConfig.visible;
            if (layer.title !== layerConfig.title) layer.title = layerConfig.title;
          }
        });

        // Clean up removed layers
        map.layers.forEach((existingLayer: any) => {
          if (!layers.find(l => l.id === existingLayer.id)) {
            map.remove(existingLayer);
            if (layerWatchers.current.has(existingLayer.id)) {
              layerWatchers.current.get(existingLayer.id)?.remove();
              layerWatchers.current.delete(existingLayer.id);
            }
          }
        });

      } catch (e) {
        console.warn('Could not import layer classes', e);
      }
    };

    ensureAndSync();

    return () => { cancelled = true; };

  }, [layers, onLayerStatusChange, arcgisReady]);

  return <div className="w-full h-full outline-none" ref={mapDiv} />;
};

export default MapComponent;