
import { MapLayer } from "./types";

export const DEFAULT_LAYERS: MapLayer[] = [
  {
    id: 'world-imagery',
    title: 'World Imagery (Tile)',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
    type: 'tile',
    visible: true,
    excludeFromMetrics: true,
  },
  {
    id: 'vermont-basemap',
    title: 'Vermont Basemap',
    url: 'https://tiles.arcgis.com/tiles/Uzks6LSde6r23wwG/arcgis/rest/services/Vermont_Basemap_v5/VectorTileServer',
    type: 'vector-tile',
    visible: true,
    excludeFromMetrics: true,
  }
];
