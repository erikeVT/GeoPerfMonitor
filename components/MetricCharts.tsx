
import React from 'react';
import { LayerPerformanceSummary } from '../types';

interface MetricChartsProps {
  data: LayerPerformanceSummary[];
  selectedIds: string[];
  onToggleSelection: (id: string) => void;
  layerColors?: Record<string, string>;
}

export const MetricCharts: React.FC<MetricChartsProps> = ({ data, selectedIds, onToggleSelection, layerColors }) => {
  if (data.length === 0) {
    return (
      <div className="h-32 w-full flex items-center justify-center text-zinc-600 text-xs border border-zinc-800/50 rounded-lg bg-zinc-900/30">
        Waiting for map interaction...
      </div>
    );
  }

  // Scale based on Load Time (Wall Clock)
  const maxTimeMs = Math.max(...data.map(d => d.loadTime), 1000); 

  return (
    <div className="w-full space-y-3 py-1">
      {data.map((item) => {
        // Percentage for bar width based on Load Time
        const percentage = Math.min((item.loadTime / maxTimeMs) * 100, 100);
        const seconds = (item.loadTime / 1000).toFixed(2);
        
        const isHighLoad = item.loadTime > 3000;
        
        const hasCustomColor = layerColors && layerColors[item.id];
        const styleColor = hasCustomColor ? { backgroundColor: layerColors[item.id] } : undefined;
        const barBaseClass = hasCustomColor ? '' : (isHighLoad ? 'bg-red-500' : 'bg-blue-500');

        const isSelected = selectedIds.includes(item.id);
        
        return (
          <div key={item.id} className={`group rounded-lg p-2 transition-colors ${isSelected ? 'bg-zinc-800/80 ring-1 ring-blue-500/50' : 'bg-transparent hover:bg-zinc-900/30'}`}>
            <div className="flex items-center gap-2 mb-1.5">
                <input 
                    type="checkbox" 
                    checked={isSelected}
                    onChange={() => onToggleSelection(item.id)}
                    className="rounded border-zinc-600 bg-zinc-900 text-blue-500 focus:ring-offset-zinc-900 h-3 w-3 cursor-pointer"
                />
                <div className="flex-1 overflow-hidden">
                    <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-zinc-200 font-medium truncate pr-2" title={item.title}>
                            {item.title}
                        </span>
                        <span className={`font-mono font-bold ${isHighLoad ? 'text-red-400' : 'text-zinc-300'}`}>
                            {seconds}s
                        </span>
                    </div>
                    <div className="flex justify-between text-[10px] text-zinc-500">
                        <span className="truncate" title={item.domain}>{item.domain}</span>
                        <span>{item.requestCount} reqs</span>
                    </div>
                </div>
            </div>
            
            <div className="w-full bg-zinc-800/50 rounded-full h-1.5 overflow-hidden ml-5 max-w-[calc(100%-1.25rem)]">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${barBaseClass}`} 
                style={{ width: `${percentage}%`, ...styleColor }}
              />
            </div>
          </div>
        );
      })}
      
      <div className="flex justify-between text-[10px] text-zinc-600 pt-1 border-t border-zinc-800/30 mt-1 ml-5">
        <span>0s</span>
        <span>{(maxTimeMs / 1000).toFixed(1)}s</span>
      </div>
    </div>
  );
};
