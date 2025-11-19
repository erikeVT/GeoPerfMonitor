
import React, { useEffect, useRef } from 'react';
import ArcGISMap from '@arcgis/core/Map.js';
import MapView from '@arcgis/core/views/MapView.js';
import FeatureLayer from '@arcgis/core/layers/FeatureLayer.js';
import TileLayer from '@arcgis/core/layers/TileLayer.js';
import MapImageLayer from '@arcgis/core/layers/MapImageLayer.js';
import VectorTileLayer from '@arcgis/core/layers/VectorTileLayer.js';
import { MapLayer } from '../types';
import { initInterceptor } from '../services/monitor';

interface MapComponentProps {
  layers: MapLayer[];
  onViewReady?: (view: MapView) => void;
  onMapUpdate?: (isUpdating: boolean) => void;
  onLayerStatusChange?: (layerId: string, isUpdating: boolean) => void;
}

// Define IHandle compatible with ArcGIS WatchHandle
type IHandle = {
  remove(): void;
};

const MapComponent: React.FC<MapComponentProps> = ({ layers, onViewReady, onMapUpdate, onLayerStatusChange }) => {
  const mapDiv = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const mapRef = useRef<ArcGISMap | null>(null);
  
  // Track handles to clean up watchers if needed
  const layerWatchers = useRef<Map<string, IHandle>> (new Map());

  useEffect(() => {
    initInterceptor();

    if (mapDiv.current) {
      const map = new ArcGISMap({
        basemap: "dark-gray-vector"
      });

      const view = new MapView({
        container: mapDiv.current,
        map: map,
        center: [-72.5778, 44.5588], // Vermont Center
        zoom: 8,
        ui: {
            components: ["zoom", "compass", "attribution"] 
        }
      });

      viewRef.current = view;
      mapRef.current = map;

      // Watch for the 'updating' property to track global map events
      const handle = view.watch('updating', (val) => {
        if (onMapUpdate) {
            onMapUpdate(val);
        }
      });

      view.when(() => {
        if (onViewReady) onViewReady(view);
      });

      return () => {
        handle.remove();
        layerWatchers.current.forEach(h => h.remove());
        layerWatchers.current.clear();
        if (view) {
          view.destroy();
        }
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync layers
  useEffect(() => {
    if (!mapRef.current || !viewRef.current) return;

    const map = mapRef.current;
    const view = viewRef.current;

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
            layer = new FeatureLayer({
              id: layerConfig.id,
              url: layerConfig.url,
              title: layerConfig.title,
              outFields: ["*"],
              popupTemplate: {
                 title: "{title}",
                 content: "OBJECTID: {OBJECTID}"
              }
            });
          } else if (layerConfig.type === 'tile') {
            layer = new TileLayer({
               id: layerConfig.id,
               url: url,
               title: layerConfig.title
            });
          } else if (layerConfig.type === 'map-image') {
              layer = new MapImageLayer({
                  id: layerConfig.id,
                  url: url,
                  title: layerConfig.title
              });
          } else if (layerConfig.type === 'vector-tile') {
              layer = new VectorTileLayer({
                  id: layerConfig.id,
                  url: url,
                  title: layerConfig.title
              });
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
            view.whenLayerView(layer).then((layerView) => {
                // Remove existing watcher for this layer if any (re-add scenario)
                if (layerWatchers.current.has(layerConfig.id)) {
                    layerWatchers.current.get(layerConfig.id)?.remove();
                }

                const watchHandle = layerView.watch("updating", (val) => {
                    if (onLayerStatusChange) {
                        onLayerStatusChange(layerConfig.id, val);
                    }
                });
                
                // @ts-ignore
                layerWatchers.current.set(layerConfig.id, watchHandle);
            }).catch((e) => console.warn("LayerView failed", e));

            layer.when(() => {
                if (!layerConfig.excludeFromMetrics) {
                     view.goTo(layer.fullExtent).catch((e) => console.warn("Zoom failed", e));
                }
            });
          }
        } catch (error) {
          console.error("Failed to create layer", layerConfig, error);
        }
      }

      if (layer) {
        layer.visible = layerConfig.visible;
        if (layer.title !== layerConfig.title) {
            layer.title = layerConfig.title;
        }
      }
    });

    // Clean up removed layers
    map.layers.forEach(existingLayer => {
        if (!layers.find(l => l.id === existingLayer.id)) {
            map.remove(existingLayer);
            // Clean up watcher
            if (layerWatchers.current.has(existingLayer.id)) {
                layerWatchers.current.get(existingLayer.id)?.remove();
                layerWatchers.current.delete(existingLayer.id);
            }
        }
    });

  }, [layers, onLayerStatusChange]);

  return <div className="w-full h-full outline-none" ref={mapDiv} />;
};

export default MapComponent;