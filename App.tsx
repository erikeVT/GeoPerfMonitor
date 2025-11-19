
import React, { useState, useEffect, useMemo, useRef } from 'react';
import MapComponent from './components/MapComponent';
import { MetricCharts } from './components/MetricCharts';
import { PerformanceHistoryChart } from './components/PerformanceHistoryChart';
import { subscribeToMetrics } from './services/monitor';
import { analyzePerformance } from './services/ai';
import { MapLayer, NetworkRequestMetric, LayerPerformanceSummary, AIStatus, MapEventHistory } from './types';
import { DEFAULT_LAYERS } from './constants';
import { Layers, Activity, Plus, Trash2, AlertCircle, Cpu, Pencil, Check, X, BarChart3, ArrowRightLeft, Play, Pause, RotateCcw, Trophy, Timer, Loader2 } from 'lucide-react';

// Simple Markdown Renderer
const SimpleMarkdown: React.FC<{ content: string }> = ({ content }) => {
  if (!content) return null;
  return (
    <div className="space-y-3">
      {content.split('\n').map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-2" />;
        if (trimmed.startsWith('### ')) return <h3 key={i} className="text-xs font-bold text-white mt-2 mb-1 uppercase">{trimmed.replace('### ', '')}</h3>;
        if (trimmed.startsWith('## ')) return <h2 key={i} className="text-sm font-bold text-white mt-3 mb-1">{trimmed.replace('## ', '')}</h2>;
        if (trimmed.startsWith('# ')) return <h1 key={i} className="text-base font-bold text-white mb-2">{trimmed.replace('# ', '')}</h1>;
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) return <div key={i} className="flex gap-2 ml-1"><span className="text-zinc-500">•</span><span className="text-xs text-zinc-300">{trimmed.substring(2)}</span></div>;
        if (/^\d+\.\s/.test(trimmed)) {
             const parts = trimmed.split(/^\d+\.\s/);
             return <div key={i} className="flex gap-2 ml-1"><span className="text-zinc-500 text-xs">{trimmed.match(/^\d+\./)?.[0]}</span><span className="text-xs text-zinc-300">{parts[1] || ''}</span></div>
        }
        return <p key={i} className="text-xs text-zinc-300 leading-relaxed">{trimmed}</p>;
      })}
    </div>
  );
};

// Vivid colors for layers
const LAYER_COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#84cc16', // lime-500
];

const App: React.FC = () => {
  const [layers, setLayers] = useState<MapLayer[]>([...DEFAULT_LAYERS]);
  const [rawMetrics, setRawMetrics] = useState<NetworkRequestMetric[]>([]);
  const [history, setHistory] = useState<MapEventHistory[]>([]);
  const [activeTab, setActiveTab] = useState<'layers' | 'ai'>('layers');
  
  // Recording State
  const [isRecording, setIsRecording] = useState(false); 
  const isRecordingRef = useRef(false);
  
  // Map Event State
  const [isMapUpdating, setIsMapUpdating] = useState(false);
  const prevUpdatingRef = useRef(false);
  
  // Individual Layer Status (Loading Indicators)
  const [layerStatuses, setLayerStatuses] = useState<Record<string, boolean>>({});

  // Layer Adding/Editing State
  const [newLayerUrl, setNewLayerUrl] = useState('');
  const [newLayerName, setNewLayerName] = useState('');
  const [newLayerType, setNewLayerType] = useState<'feature' | 'tile' | 'map-image' | 'vector-tile'>('feature');
  const [isFetchingName, setIsFetchingName] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [aiStatus, setAiStatus] = useState<AIStatus>(AIStatus.IDLE);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);

  // Assign colors to layers dynamically (Only for those in metrics)
  const layersWithColors = useMemo(() => {
      return layers.map((l, i) => ({
          ...l,
          color: l.excludeFromMetrics ? '#52525b' : LAYER_COLORS[i % LAYER_COLORS.length]
      }));
  }, [layers]);

  const layerColorMap = useMemo(() => {
      const map: Record<string, string> = {};
      layersWithColors.forEach(l => map[l.id] = l.color!);
      return map;
  }, [layersWithColors]);

  useEffect(() => {
    const unsubscribe = subscribeToMetrics((metric) => {
      if (isRecordingRef.current) {
        setRawMetrics(prev => [...prev.slice(-3000), metric]); 
      }
    });
    return unsubscribe;
  }, []);

  const handlePlay = () => {
      setIsRecording(true);
      isRecordingRef.current = true;
  };

  const handlePause = () => {
      setIsRecording(false);
      isRecordingRef.current = false;
  };

  const handleReset = () => {
      setRawMetrics([]);
      setHistory([]);
      setCompareIds([]);
  };

  // Auto-detect type logic
  useEffect(() => {
    if (!newLayerUrl) return;
    const lowerUrl = newLayerUrl.toLowerCase();
    if (/\/\d+$/.test(lowerUrl)) setNewLayerType('feature');
    else if (lowerUrl.includes('vectortile')) setNewLayerType('vector-tile');
    else if (lowerUrl.includes('mapserver')) setNewLayerType('map-image');
    else if (lowerUrl.includes('featureserver')) setNewLayerType('feature');

    const timer = setTimeout(() => {
        if (newLayerUrl.startsWith('http')) {
            setIsFetchingName(true);
            fetch(`${newLayerUrl}?f=json`)
                .then(res => res.json())
                .then(data => {
                    const name = data.name || data.mapName;
                    if (name) setNewLayerName(name);
                })
                .catch(err => console.debug(err))
                .finally(() => setIsFetchingName(false));
        }
    }, 800);
    return () => clearTimeout(timer);
  }, [newLayerUrl]);

  // Aggregate metrics: Calculate Load Time (Wall Clock)
  // Filter out excluded layers
  const aggregatedMetrics = useMemo(() => {
    const stats: Record<string, LayerPerformanceSummary> = {};
    
    // Only initialize stats for layers NOT excluded from metrics
    const metricLayers = layersWithColors.filter(l => !l.excludeFromMetrics);

    metricLayers.forEach(l => {
        stats[l.id] = {
            id: l.id,
            title: l.title,
            domain: new URL(l.url).hostname,
            requestCount: 0,
            avgLatency: 0,
            totalDuration: 0, 
            loadTime: 0,      
            totalSize: 0,
            errorCount: 0,
            requests: []
        };
    });

    // Bin requests to layers
    rawMetrics.forEach(m => {
        // Only match against metric-enabled layers
        const matchedLayer = metricLayers.find(l => m.url.toLowerCase().includes(l.url.toLowerCase()));
        if (matchedLayer) {
            const s = stats[matchedLayer.id];
            if (s) {
                s.requestCount++;
                s.totalDuration += m.duration;
                s.requests.push(m);
            }
        }
    });

    // Calculate Wall Clock Time (Min Start -> Max End)
    Object.values(stats).forEach(s => {
        if (s.requests.length > 0) {
            const startTimes = s.requests.map(r => r.startTime);
            const endTimes = s.requests.map(r => r.endTime);
            const minStart = Math.min(...startTimes);
            const maxEnd = Math.max(...endTimes);
            s.loadTime = maxEnd - minStart;
        }
    });

    return Object.values(stats).sort((a, b) => b.loadTime - a.loadTime);
  }, [rawMetrics, layersWithColors]);

  // Logic to Snapshot Metrics when Map Event Ends
  useEffect(() => {
    if (!isRecording) return;

    // Start of an event
    if (isMapUpdating && !prevUpdatingRef.current) {
        setRawMetrics([]);
    }

    // End of an event: Snapshot using loadTime
    if (!isMapUpdating && prevUpdatingRef.current) {
        if (aggregatedMetrics.some(m => m.requestCount > 0)) {
             const snapshot: MapEventHistory = {
                 id: history.length + 1,
                 timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                 layerDurations: {}
             };
             aggregatedMetrics.forEach(m => {
                 snapshot.layerDurations[m.id] = m.loadTime / 1000; // Store in Seconds
             });
             setHistory(prev => [...prev.slice(-19), snapshot]);
        }
    }

    prevUpdatingRef.current = isMapUpdating;
  }, [isMapUpdating, isRecording, aggregatedMetrics, history.length]);

  const handleAddLayer = () => {
    if (!newLayerUrl) return;
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const title = newLayerName || `Layer ${layers.length + 1} (${newLayerType})`;
    const newLayer: MapLayer = { id, title, url: newLayerUrl, type: newLayerType, visible: true };
    setLayers([...layers, newLayer]);
    setNewLayerUrl('');
    setNewLayerName('');
  };

  const handleToggleLayer = (id: string) => {
    setLayers(layers.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  };

  const handleRemoveLayer = (id: string) => {
    setLayers(layers.filter(l => l.id !== id));
    setCompareIds(prev => prev.filter(cid => cid !== id));
  };

  const startEditing = (layer: MapLayer) => {
      setEditingId(layer.id);
      setEditTitle(layer.title);
  };

  const saveEditing = (id: string) => {
      setLayers(layers.map(l => l.id === id ? { ...l, title: editTitle } : l));
      setEditingId(null);
  };

  const handleCompareToggle = (id: string) => {
      setCompareIds(prev => {
          if (prev.includes(id)) return prev.filter(p => p !== id);
          if (prev.length >= 2) return [prev[1], id];
          return [...prev, id];
      });
  };
  
  const handleLayerStatusChange = (layerId: string, isUpdating: boolean) => {
      setLayerStatuses(prev => ({ ...prev, [layerId]: isUpdating }));
  };

  const runAIAnalysis = async () => {
    setAiStatus(AIStatus.ANALYZING);
    try {
      const result = await analyzePerformance(aggregatedMetrics);
      setAiAnalysis(result);
      setAiStatus(AIStatus.COMPLETE);
    } catch (e) {
      console.error(e);
      setAiStatus(AIStatus.ERROR);
    }
  };

  const comparisonData = useMemo(() => {
      if (compareIds.length !== 2) return null;
      const l1 = aggregatedMetrics.find(m => m.id === compareIds[0]);
      const l2 = aggregatedMetrics.find(m => m.id === compareIds[1]);
      if (!l1 || !l2) return null;
      
      const fast = l1.loadTime <= l2.loadTime ? l1 : l2;
      const slow = l1.loadTime <= l2.loadTime ? l2 : l1;
      
      const diff = slow.loadTime - fast.loadTime;
      const percentDiff = fast.loadTime > 0 ? ((diff / fast.loadTime) * 100) : 0;
      
      return { l1, l2, fast, slow, diff, percentDiff };
  }, [compareIds, aggregatedMetrics]);

  return (
    <div className="flex flex-col h-screen w-full bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      <header className="h-14 border-b border-zinc-800 flex items-center px-4 bg-zinc-900/50 backdrop-blur-md z-10 justify-between">
        <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-500" />
            <h1 className="font-bold text-lg tracking-tight">GeoPerf <span className="text-zinc-500 font-normal">Monitor</span></h1>
        </div>
        <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800">
                <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-zinc-500'}`}></div>
                <span className={isRecording ? 'text-red-400 font-medium' : 'text-zinc-500'}>
                    {isRecording ? 'Session Active' : 'Paused'}
                </span>
            </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* LEFT Sidebar */}
        <div className="absolute left-4 top-4 bottom-4 w-80 z-20 flex flex-col gap-2 pointer-events-none">
            <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto max-h-full transition-all duration-300">
                <div className="flex border-b border-zinc-800">
                    <button onClick={() => setActiveTab('layers')} className={`flex-1 py-3 text-sm font-medium flex justify-center items-center gap-2 transition-colors ${activeTab === 'layers' ? "text-white border-b-2 border-blue-500" : "text-zinc-500"}`}>
                        <Layers className="w-4 h-4" /> Layers
                    </button>
                    <button onClick={() => setActiveTab('ai')} className={`flex-1 py-3 text-sm font-medium flex justify-center items-center gap-2 transition-colors ${activeTab === 'ai' ? "text-white border-b-2 border-purple-500" : "text-zinc-500"}`}>
                        <Cpu className="w-4 h-4" /> AI
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    {activeTab === 'layers' && (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Active Layers</h3>
                                <ul className="space-y-2">
                                    {layersWithColors.map(layer => (
                                        <li key={layer.id} className="flex items-center justify-between bg-zinc-950/50 p-2 rounded-lg border border-zinc-800/50 group">
                                            <div className="flex items-center gap-2 overflow-hidden flex-1">
                                                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: layer.color }}></div>
                                                <input type="checkbox" checked={layer.visible} onChange={() => handleToggleLayer(layer.id)} className="rounded border-zinc-700 bg-zinc-900 text-blue-600" />
                                                {editingId === layer.id ? (
                                                    <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs w-full" autoFocus />
                                                ) : (
                                                    <span className="text-sm truncate cursor-default select-none" title={layer.title}>{layer.title}</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1 ml-2">
                                                {/* Status Indicator */}
                                                {layerStatuses[layer.id] ? (
                                                    <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                                                ) : (
                                                    <div className="w-3 h-3 flex items-center justify-center">
                                                        {/* Only show checkmark if visible and recently loaded? Or just empty if idle? */}
                                                        {layer.visible && <div className="w-1.5 h-1.5 rounded-full bg-zinc-700"></div>}
                                                    </div>
                                                )}

                                                {/* Actions */}
                                                {editingId === layer.id ? (
                                                    <>
                                                        <button onClick={() => saveEditing(layer.id)} className="text-green-400 p-1"><Check className="w-3 h-3" /></button>
                                                        <button onClick={() => setEditingId(null)} className="text-zinc-400 p-1"><X className="w-3 h-3" /></button>
                                                    </>
                                                ) : (
                                                    !layer.excludeFromMetrics && (
                                                    <>
                                                        <button onClick={() => startEditing(layer)} className="text-zinc-600 hover:text-zinc-300 p-1 opacity-0 group-hover:opacity-100"><Pencil className="w-3 h-3" /></button>
                                                        <button onClick={() => handleRemoveLayer(layer.id)} className="text-zinc-600 hover:text-red-400 p-1"><Trash2 className="w-3 h-3" /></button>
                                                    </>
                                                    )
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="space-y-2 pt-4 border-t border-zinc-800">
                                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Add Service Layer</h3>
                                <div className="flex flex-col gap-2">
                                    <input type="text" value={newLayerUrl} onChange={(e) => setNewLayerUrl(e.target.value)} placeholder="https://.../MapServer" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm" />
                                    <div className="relative">
                                        <input type="text" value={newLayerName} onChange={(e) => setNewLayerName(e.target.value)} placeholder="Layer Name" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm" />
                                        {isFetchingName && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>}
                                    </div>
                                    <div className="flex gap-2">
                                        <select value={newLayerType} onChange={(e) => setNewLayerType(e.target.value as any)} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm w-2/3 text-zinc-300">
                                            <option value="feature">Feature Layer</option>
                                            <option value="map-image">Map Image</option>
                                            <option value="tile">Tile Layer</option>
                                            <option value="vector-tile">Vector Tile</option>
                                        </select>
                                        <button onClick={handleAddLayer} disabled={!newLayerUrl} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg flex justify-center"><Plus className="w-4 h-4" /></button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 'ai' && (
                        <div className="space-y-4 flex flex-col h-full">
                            <div className="p-4 bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-white/5 rounded-xl">
                                <h3 className="text-sm font-medium text-white mb-1">Gemini Insights</h3>
                                <button onClick={runAIAnalysis} disabled={aiStatus === AIStatus.ANALYZING} className="w-full py-2 px-4 mt-2 bg-white text-zinc-950 hover:bg-zinc-200 font-semibold text-sm rounded-lg flex items-center justify-center gap-2 disabled:opacity-70">
                                    {aiStatus === AIStatus.ANALYZING ? 'Analyzing...' : <><Cpu className="w-4 h-4" /> Analyze</>}
                                </button>
                            </div>
                            {aiAnalysis && <div className="flex-1 overflow-y-auto bg-zinc-950/50 border border-zinc-800 rounded-lg p-3"><SimpleMarkdown content={aiAnalysis} /></div>}
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* RIGHT Sidebar: Metrics */}
        <div className="absolute right-4 top-4 bottom-4 w-80 z-20 flex flex-col pointer-events-none">
             <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto h-full">
                <div className="p-3 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
                   <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-blue-500" />
                      Metrics {isRecording && isMapUpdating && <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-ping ml-1"></span>}
                   </h2>
                   <div className="flex items-center gap-1">
                      {!isRecording ? (
                          <button onClick={handlePlay} className="p-1.5 bg-zinc-800 hover:bg-green-600/20 hover:text-green-400 text-zinc-400 rounded transition-colors"><Play className="w-4 h-4 fill-current" /></button>
                      ) : (
                          <button onClick={handlePause} className="p-1.5 bg-zinc-800 hover:bg-amber-600/20 hover:text-amber-400 text-zinc-400 rounded transition-colors"><Pause className="w-4 h-4 fill-current" /></button>
                      )}
                      <button onClick={handleReset} className="p-1.5 bg-zinc-800 hover:bg-red-600/20 hover:text-red-400 text-zinc-400 rounded transition-colors"><RotateCcw className="w-4 h-4" /></button>
                   </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    
                    {comparisonData && (
                        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 space-y-3">
                            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider"><ArrowRightLeft className="w-3 h-3" /> Comparison</div>
                            
                            <div className="grid grid-cols-2 gap-2">
                                <div className={`p-2 rounded bg-zinc-900 border ${comparisonData.fast.id === comparisonData.l1.id ? 'border-green-500/30' : 'border-red-500/30'}`}>
                                     <div className="text-[10px] text-zinc-500 truncate mb-1" title={comparisonData.l1.title}>{comparisonData.l1.title}</div>
                                     <div className="font-mono font-bold text-sm">{(comparisonData.l1.loadTime/1000).toFixed(2)}s</div>
                                </div>
                                <div className={`p-2 rounded bg-zinc-900 border ${comparisonData.fast.id === comparisonData.l2.id ? 'border-green-500/30' : 'border-red-500/30'}`}>
                                     <div className="text-[10px] text-zinc-500 truncate mb-1" title={comparisonData.l2.title}>{comparisonData.l2.title}</div>
                                     <div className="font-mono font-bold text-sm">{(comparisonData.l2.loadTime/1000).toFixed(2)}s</div>
                                </div>
                            </div>

                            <div className="bg-zinc-900/80 rounded p-2 border border-zinc-800 flex flex-col items-center text-center">
                                <div className="flex items-center gap-1 text-xs text-zinc-400 mb-1">
                                    <Trophy className="w-3 h-3 text-yellow-500" />
                                    <span className="font-semibold text-zinc-200">{comparisonData.fast.title}</span> is faster
                                </div>
                                <div className="text-xs text-zinc-500">
                                    <span className="text-green-400 font-bold">{comparisonData.percentDiff.toFixed(1)}%</span> faster than {comparisonData.slow.title}
                                </div>
                                <div className="text-[10px] text-zinc-600 mt-1">
                                    Difference: {(comparisonData.diff / 1000).toFixed(3)}s
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1"><Timer className="w-3 h-3" /> Load Times</h3>
                            {compareIds.length > 0 && <button onClick={() => setCompareIds([])} className="text-[10px] text-blue-400 hover:underline">Clear Selection</button>}
                        </div>
                        
                        {rawMetrics.length === 0 && !isRecording && (
                            <div className="p-4 border border-dashed border-zinc-800 rounded-lg text-center">
                                <p className="text-zinc-500 text-xs mb-2">Monitoring is paused.</p>
                                <button onClick={handlePlay} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded">Start</button>
                            </div>
                        )}

                        <MetricCharts 
                            data={aggregatedMetrics} 
                            selectedIds={compareIds}
                            onToggleSelection={handleCompareToggle}
                            layerColors={layerColorMap}
                        />
                    </div>
                    
                    {history.length > 0 && (
                        <PerformanceHistoryChart history={history} layers={layersWithColors.filter(l => !l.excludeFromMetrics)} />
                    )}
                </div>
             </div>
        </div>

        <MapComponent 
            layers={layers} 
            onMapUpdate={setIsMapUpdating} 
            onLayerStatusChange={handleLayerStatusChange}
        />
      </div>
    </div>
  );
};

export default App;
