
import React, { useMemo } from 'react';
import { MapEventHistory, MapLayer } from '../types';

interface PerformanceHistoryChartProps {
  history: MapEventHistory[];
  layers: MapLayer[];
}

export const PerformanceHistoryChart: React.FC<PerformanceHistoryChartProps> = ({ history, layers }) => {
  const height = 150;
  const width = 300;
  const padding = 20;

  const chartData = useMemo(() => {
    if (history.length === 0) return null;

    let maxDuration = 0;
    history.forEach(h => {
      Object.values(h.layerDurations).forEach(d => {
        // FIX: Cast `d` to number as its type is inferred as `unknown`.
        if ((d as number) > maxDuration) maxDuration = d as number;
      });
    });
    // Minimum scale of 1s
    maxDuration = Math.max(maxDuration, 1); 

    return {
      maxDuration,
      points: history
    };
  }, [history]);

  if (!chartData || history.length < 2) {
    return (
      <div className="h-32 flex flex-col items-center justify-center border border-dashed border-zinc-800 rounded-lg text-xs text-zinc-600 bg-zinc-900/30 p-4 text-center">
        <span className="font-medium mb-1">History Trend (Load Time)</span>
        <span>Waiting for multiple map events...</span>
      </div>
    );
  }

  const getX = (index: number) => {
    const count = history.length;
    const availableWidth = width - (padding * 2);
    return padding + (index / (count - 1)) * availableWidth;
  };

  const getY = (duration: number) => {
    const availableHeight = height - (padding * 2);
    return height - padding - (duration / chartData.maxDuration) * availableHeight;
  };

  return (
    <div className="w-full bg-zinc-900/30 rounded-lg border border-zinc-800/50 p-3">
      <div className="flex justify-between text-[10px] text-zinc-500 mb-2 uppercase tracking-wider font-semibold">
        <span>Load Time History</span>
        <span>Max: {chartData.maxDuration.toFixed(2)}s</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-32 overflow-visible">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#3f3f46" strokeWidth="1" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#3f3f46" strokeWidth="1" />

        {layers.filter(l => l.visible).map(layer => {
          const points = history.map((h, i) => {
            const duration = h.layerDurations[layer.id] || 0;
            return `${getX(i)},${getY(duration)}`;
          }).join(' ');

          return (
            <g key={layer.id}>
              <polyline
                points={points}
                fill="none"
                stroke={layer.color || '#3b82f6'}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="opacity-80 hover:opacity-100 transition-opacity"
              />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-600 px-1 mt-1">
        <span>Oldest</span>
        <span>Newest</span>
      </div>
    </div>
  );
};
