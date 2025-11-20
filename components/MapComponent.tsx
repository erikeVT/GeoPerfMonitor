
import React, { useEffect, useRef } from 'react';
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
  
  // Track handles to clean up watchers if needed
  const layerWatchers = useRef<Map<string, IHandle>> (new Map());

  useEffect(() => {
    initInterceptor();

    let cancelled = false;
    let handle: any = null;

    const loadArcGIS = async () => {
      if (!mapDiv.current) return;

      // Try to set worker URL before loading modules so importScripts uses correct path.
      // Prefer local assets at /arcgis-assets if available, otherwise fall back to the CDN.
      try {
        const cfg = await import('@arcgis/core/config.js');
        try {
          const localWorkerPath = '/arcgis-assets/esri/core/workers/RemoteClient.js';
          let useLocal = false;
          try {
            const resp = await fetch(localWorkerPath, { method: 'HEAD' });
            if (resp.ok) useLocal = true;
          } catch (e) {
            useLocal = false;
          }

          if (useLocal) {
            cfg.default.assetsPath = '/arcgis-assets';
            cfg.default.workersUrl = '/arcgis-assets/esri/core/workers/';
            console.log('Using local ArcGIS assets at /arcgis-assets');
          } else {
            cfg.default.workersUrl = 'https://js.arcgis.com/4.28/esri/core/workers/';
          }
        } catch (e) {
          console.warn('Failed setting ArcGIS workersUrl', e);
        }
      } catch (e) {
        // Not fatal - continue to attempt loading modules
        console.warn('Could not import ArcGIS config module', e);
      }

        try {
        const [{ default: ArcGISMap }, { default: MapView }, { default: Extent }, { default: FeatureLayer }, { default: TileLayer }, { default: MapImageLayer }, { default: VectorTileLayer }, { default: reactiveUtils }] = await Promise.all([
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

        // Watch for the 'updating' property to track global map events using reactiveUtils (watch is deprecated)
        try {
          handle = reactiveUtils.watch(() => view.updating, (val: any) => {
            if (onMapUpdate) onMapUpdate(val);
          });
        } catch (e) {
          // Fallback to old API if reactiveUtils unavailable
          try { handle = view.watch('updating', (val: any) => { if (onMapUpdate) onMapUpdate(val); }); } catch (err) { console.warn('Failed to attach view watcher', err); }
        }

        view.when(() => { if (onViewReady) onViewReady(view); });

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
        const [{ default: FeatureLayer }, { default: TileLayer }, { default: MapImageLayer }, { default: VectorTileLayer }, { default: reactiveUtils }] = await Promise.all([
          import('@arcgis/core/layers/FeatureLayer.js'),
          import('@arcgis/core/layers/TileLayer.js'),
          import('@arcgis/core/layers/MapImageLayer.js'),
          import('@arcgis/core/layers/VectorTileLayer.js'),
          import('@arcgis/core/core/reactiveUtils.js'),
        ]);

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
                layer = new FeatureLayer({ id: layerConfig.id, url: layerConfig.url, title: layerConfig.title, outFields: ['*'], popupTemplate: { title: '{title}', content: 'OBJECTID: {OBJECTID}' } });
              } else if (layerConfig.type === 'tile') {
                layer = new TileLayer({ id: layerConfig.id, url, title: layerConfig.title });
              } else if (layerConfig.type === 'map-image') {
                layer = new MapImageLayer({ id: layerConfig.id, url, title: layerConfig.title });
              } else if (layerConfig.type === 'vector-tile') {
                layer = new VectorTileLayer({ id: layerConfig.id, url, title: layerConfig.title });
              }

              if (layer) {
                map.add(layer);

                // Order logic: Base layers at bottom
                if (layerConfig.id === 'world-imagery') {
                  map.reorder(layer, 0);
                } else if (layerConfig.id === 'vermont-basemap') {
                  map.reorder(layer, 1);
                }

                // Watch for individual layer updating status
                view.whenLayerView(layer).then((layerView: any) => {
                  if (layerWatchers.current.has(layerConfig.id)) {
                    layerWatchers.current.get(layerConfig.id)?.remove();
                  }

                  const watchHandle = ((): any => {
                    try {
                      return reactiveUtils.watch(() => layerView.updating, (val: any) => {
                        if (onLayerStatusChange) onLayerStatusChange(layerConfig.id, val);
                      });
                    } catch (e) {
                      // fallback to deprecated API
                      try { return layerView.watch('updating', (val: any) => { if (onLayerStatusChange) onLayerStatusChange(layerConfig.id, val); }); } catch (err) { console.warn('Failed to attach layerView watcher', err); return null; }
                    }
                  })();

                  // @ts-ignore
                  layerWatchers.current.set(layerConfig.id, watchHandle);
                }).catch((e: any) => console.warn('LayerView failed', e));

                layer.when(() => {
                  if (!layerConfig.excludeFromMetrics) {
                    view.goTo(layer.fullExtent).catch((e: any) => console.warn('Zoom failed', e));
                  }
                });
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

  }, [layers, onLayerStatusChange]);

  return <div className="w-full h-full outline-none" ref={mapDiv} />;
};

export default MapComponent;