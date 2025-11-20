
import React, { useState, useEffect, useMemo, useRef } from 'react';
import MapView from '@arcgis/core/views/MapView.js';
import Legend from '@arcgis/core/widgets/Legend.js';
import MapComponent from './components/MapComponent';
import { MetricCharts } from './components/MetricCharts';
import { BenchmarkReport } from './components/BenchmarkReport';
import { subscribeToMetrics } from './services/monitor';
import { analyzePerformance } from './services/ai';
import { MapLayer, NetworkRequestMetric, LayerPerformanceSummary, AIStatus, MapEventHistory, BenchmarkReportData, BenchmarkStepResult } from './types';
import { DEFAULT_LAYERS } from './constants';
import { Layers, Activity, Plus, Trash2, Cpu, Pencil, Check, X, ArrowRightLeft, Play, Pause, RotateCcw, Trophy, Timer, Loader2, Table as TableIcon, Download, CheckCircle2, Gauge, Map as MapIcon, List } from 'lucide-react';

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

const BASEMAP_IDS = ['vermont-basemap'];

const App: React.FC = () => {
  const [layers, setLayers] = useState<MapLayer[]>([...DEFAULT_LAYERS]);
  const [rawMetrics, setRawMetrics] = useState<NetworkRequestMetric[]>([]);
  const [history, setHistory] = useState<MapEventHistory[]>([]);
  const [activeTab, setActiveTab] = useState<'layers' | 'basemaps' | 'ai' | 'legend'>('layers');
  const [activeMetricsTab, setActiveMetricsTab] = useState<'current' | 'history' | 'benchmark'>('current');
  
  // Recording State
  const [isRecording, setIsRecording] = useState(false); 
  const isRecordingRef = useRef(false);
  
  // Map Control
  const viewRef = useRef<MapView | null>(null);
  const mapRef = useRef<any | null>(null); // To access layers for query
  const legendDiv = useRef<HTMLDivElement>(null);

  // Map Event State
  const [isMapUpdating, setIsMapUpdating] = useState(false);
  const prevUpdatingRef = useRef(false);
  
  // Individual Layer Status
  const [layerStatuses, setLayerStatuses] = useState<Record<string, boolean>>({});
  const layerStatusesRef = useRef<Record<string, boolean>>({}); // For async access in benchmark

  // Benchmark State
  const [isRunningBenchmark, setIsRunningBenchmark] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState('');
  const [benchmarkReport, setBenchmarkReport] = useState<BenchmarkReportData | null>(null);
  const benchmarkMetricsRef = useRef<NetworkRequestMetric[]>([]);

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

  // Assign colors
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

  const metricLayers = useMemo(() => {
      return layersWithColors.filter(l => !l.excludeFromMetrics);
  }, [layersWithColors]);

  useEffect(() => {
    const unsubscribe = subscribeToMetrics((metric) => {
      // Standard recording
      if (isRecordingRef.current) {
        setRawMetrics(prev => [...prev.slice(-3000), metric]); 
      }
      // Separate Benchmark recording
      if (isRunningBenchmark) {
          benchmarkMetricsRef.current.push(metric);
      }
    });
    return unsubscribe;
  }, [isRunningBenchmark]);

  const handlePlay = () => { setIsRecording(true); isRecordingRef.current = true; };
  const handlePause = () => { setIsRecording(false); isRecordingRef.current = false; };
  const handleReset = () => { setRawMetrics([]); setHistory([]); setCompareIds([]); };

  // Auto-detect layer type
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

  // Init Legend Widget when tab is active
  useEffect(() => {
    if (activeTab === 'legend' && viewRef.current && legendDiv.current) {
        const view = viewRef.current;
        
        // Filter for operational layers only (exclude basemaps)
        const layerInfos = view.map.layers
            .filter(layer => !BASEMAP_IDS.includes(layer.id))
            .map(layer => ({ layer: layer, title: layer.title }))
            .toArray();

        const legend = new Legend({
            view: view,
            container: legendDiv.current,
            layerInfos: layerInfos,
            style: 'card' 
        });

        return () => {
            legend.destroy();
        };
    }
  }, [activeTab, layers]);

  // Aggregation Logic (Reusable)
  const calculateMetrics = (metrics: NetworkRequestMetric[]) => {
    const stats: Record<string, LayerPerformanceSummary> = {};
    metricLayers.forEach(l => {
        stats[l.id] = {
            id: l.id, title: l.title, domain: new URL(l.url).hostname,
            requestCount: 0, avgLatency: 0, totalDuration: 0, loadTime: 0,
            totalSize: 0, errorCount: 0, requests: []
        };
    });

    metrics.forEach(m => {
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

    Object.values(stats).forEach(s => {
        if (s.requests.length > 0) {
            const minStart = Math.min(...s.requests.map(r => r.startTime));
            const maxEnd = Math.max(...s.requests.map(r => r.endTime));
            s.loadTime = maxEnd - minStart;
        }
    });
    return Object.values(stats);
  };

  const aggregatedMetrics = useMemo(() => calculateMetrics(rawMetrics), [rawMetrics, metricLayers]);

  // Map Event Handling
  useEffect(() => {
    if (!isRecording) return;
    // Start Event
    if (isMapUpdating && !prevUpdatingRef.current) {
        if (!isRunningBenchmark) setRawMetrics([]); // Auto-clear only if regular usage
    }
    // End Event
    if (!isMapUpdating && prevUpdatingRef.current) {
        // Only record history if regular usage
        if (!isRunningBenchmark && aggregatedMetrics.some(m => m.requestCount > 0)) {
             const snapshot: MapEventHistory = {
                 id: history.length + 1,
                 timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                 layerDurations: {}
             };
             aggregatedMetrics.forEach(m => snapshot.layerDurations[m.id] = m.loadTime / 1000);
             setHistory(prev => [...prev, snapshot]);
        }
    }
    prevUpdatingRef.current = isMapUpdating;
  }, [isMapUpdating, isRecording, aggregatedMetrics, history.length, isRunningBenchmark]);

  // --- BENCHMARK LOGIC ---
  const waitForIdle = async (timeout = 15000) => {
      const start = Date.now();
      
      // Wait until view updating is false AND all layers are done
      while (Date.now() - start < timeout) {
         await new Promise(r => setTimeout(r, 200));
         
         if (viewRef.current?.updating) continue;
         const layersBusy = Object.values(layerStatusesRef.current).some(status => status === true);
         if (layersBusy) continue;

         // Settlement period to catch stragglers
         await new Promise(r => setTimeout(r, 800));
         if (!viewRef.current?.updating && !Object.values(layerStatusesRef.current).some(s => s)) {
             return true;
         }
      }
      return false; 
  };

  const runBenchmark = async () => {
      if (!viewRef.current) return;
      setIsRunningBenchmark(true);
      setBenchmarkReport(null);
      
      // Temporarily disable regular recording to keep UI clean
      const originalRecording = isRecordingRef.current;
      setIsRecording(false); 
      isRecordingRef.current = false; // Use explicit benchmark ref instead

      // Defined Towns for meaningful benchmark locations
      const TOWNS = [
          { name: 'Montpelier', center: [-72.5778, 44.2601] },
          { name: 'Burlington', center: [-73.2121, 44.4759] },
          { name: 'Rutland', center: [-72.9726, 43.6106] },
          { name: 'St. Albans', center: [-73.0825, 44.8109] },
          { name: 'Brattleboro', center: [-72.5579, 42.8509] },
          { name: 'Middlebury', center: [-73.1673, 44.0153] },
          { name: 'Newport', center: [-72.2053, 44.9362] },
          { name: 'Bennington', center: [-73.1968, 42.8781] },
          { name: 'St. Johnsbury', center: [-72.0158, 44.4196] },
          { name: 'Stowe', center: [-72.6856, 44.4654] },
      ];

      const navSteps = [];
      // Create 10 navigation steps. 
      // We cycle zoom levels from 10 to 16 to avoid going too deep (past 16).
      for (let i = 0; i < 10; i++) {
          const zoom = 10 + (i % 7); // Results in 10, 11, 12, 13, 14, 15, 16, 10, 11, 12
          const town = TOWNS[i % TOWNS.length];
          
          navSteps.push({
              name: `Nav ${i+1}: ${town.name} (Z${zoom})`,
              type: 'nav',
              action: () => viewRef.current?.goTo({ zoom: zoom, center: town.center })
          });
      }

      // Define Query Steps (5 queries)
      const querySteps = [];
      for (let i = 1; i <= 5; i++) {
          querySteps.push({
              name: `Query ${i}: Features`,
              type: 'query',
              action: async () => {
                  const view = viewRef.current;
                  if (!view) return;
                  // Find all active feature layers
                  const featureLayers = view.map.layers.filter((l: any) => l.type === 'feature' && l.visible);
                  const queryPromises = featureLayers.map((layer: any) => {
                      if (layer.queryFeatures) {
                          // Query current extent, small random offset to avoid cache if possible
                          const query = layer.createQuery();
                          query.geometry = view.extent;
                          query.outFields = ['*'];
                          query.returnGeometry = false;
                          return layer.queryFeatures(query).catch((e: any) => console.warn("Query failed", e));
                      }
                      return Promise.resolve();
                  });
                  await Promise.all(queryPromises);
              }
          });
      }

      const allSteps = [...navSteps, ...querySteps];
      const results: BenchmarkStepResult[] = [];

      try {
          setBenchmarkProgress("Initializing...");
          const startLon = -72.5778;
          const startLat = 44.5588;
          await viewRef.current.goTo({ zoom: 9, center: [startLon, startLat] });
          await waitForIdle();

          for (const step of allSteps) {
              setBenchmarkProgress(`Executing: ${step.name}`);
              
              // Clear accumulator
              benchmarkMetricsRef.current = [];
              
              // Run Action
              await step.action();
              
              // Wait
              if (step.type === 'nav') {
                  await waitForIdle();
              } else {
                  // For queries, give network time to resolve since 'updating' might not trigger
                  await new Promise(r => setTimeout(r, 2000)); 
              }
              
              // Process Results
              const stepMetrics = calculateMetrics(benchmarkMetricsRef.current);
              const resultLayerMetrics: Record<string, { loadTime: number; requestCount: number }> = {};
              metricLayers.forEach(l => {
                  const sm = stepMetrics.find(s => s.id === l.id);
                  resultLayerMetrics[l.id] = {
                      loadTime: sm ? sm.loadTime / 1000 : 0,
                      requestCount: sm ? sm.requestCount : 0
                  };
              });

              // @ts-ignore
              results.push({
                  stepName: step.name,
                  type: step.type as 'nav' | 'query',
                  layerMetrics: resultLayerMetrics
              });
              
              await new Promise(r => setTimeout(r, 800)); 
          }

          // Generate Report
          const summary: BenchmarkReportData['summary'] = {};
          
          metricLayers.forEach(l => {
              const layerNavSteps = results.filter(r => r.type === 'nav').map(r => r.layerMetrics[l.id]);
              const layerQuerySteps = results.filter(r => r.type === 'query').map(r => r.layerMetrics[l.id]);
              
              const totalNavLoad = layerNavSteps.reduce((acc, curr) => acc + curr.loadTime, 0);
              const totalQueryLoad = layerQuerySteps.reduce((acc, curr) => acc + curr.loadTime, 0);
              const totalReq = [...layerNavSteps, ...layerQuerySteps].reduce((acc, curr) => acc + curr.requestCount, 0);
              
              const avgNavLoad = layerNavSteps.length > 0 ? totalNavLoad / layerNavSteps.length : 0;
              const avgQueryLoad = layerQuerySteps.length > 0 ? totalQueryLoad / layerQuerySteps.length : 0;

              summary[l.id] = {
                  avgNavLoadTime: avgNavLoad,
                  avgQueryLoadTime: avgQueryLoad,
                  totalRequests: totalReq,
                  score: avgNavLoad // Use Navigation Speed as primary ranking score
              };
          });

          let fastestId = metricLayers[0]?.id;
          let slowestId = metricLayers[0]?.id;
          
          if (fastestId) {
              metricLayers.forEach(l => {
                  if (summary[l.id].score < summary[fastestId].score) fastestId = l.id;
                  if (summary[l.id].score > summary[slowestId].score) slowestId = l.id;
              });
          }
          
          const fastTime = summary[fastestId]?.avgNavLoadTime || 0;
          const slowTime = summary[slowestId]?.avgNavLoadTime || 0;
          const percentFaster = fastTime > 0 ? ((slowTime / fastTime) - 1) * 100 : 0;

          setBenchmarkReport({
              date: new Date().toLocaleString(),
              steps: results,
              summary,
              fastestLayerId: fastestId,
              slowestLayerId: slowestId,
              percentFaster
          });

      } catch (e) {
          console.error("Benchmark Failed", e);
      } finally {
          setIsRunningBenchmark(false);
          setBenchmarkProgress("");
          if (originalRecording) {
              setIsRecording(true);
              isRecordingRef.current = true;
          }
      }
  };

  // --- End Benchmark Logic ---

  const handleAddLayer = () => {
    if (!newLayerUrl) return;
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const title = newLayerName || `Layer ${layers.length + 1} (${newLayerType})`;
    const newLayer: MapLayer = { id, title, url: newLayerUrl, type: newLayerType, visible: true };
    setLayers([...layers, newLayer]);
    setNewLayerUrl(''); setNewLayerName('');
  };
  const handleToggleLayer = (id: string) => setLayers(layers.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  const handleRemoveLayer = (id: string) => { setLayers(layers.filter(l => l.id !== id)); setCompareIds(prev => prev.filter(cid => cid !== id)); };
  const startEditing = (layer: MapLayer) => { setEditingId(layer.id); setEditTitle(layer.title); };
  const saveEditing = (id: string) => { setLayers(layers.map(l => l.id === id ? { ...l, title: editTitle } : l)); setEditingId(null); };
  const handleCompareToggle = (id: string) => setCompareIds(prev => { if (prev.includes(id)) return prev.filter(p => p !== id); if (prev.length >= 2) return [prev[1], id]; return [...prev, id]; });
  
  const handleLayerStatusChange = (layerId: string, isUpdating: boolean) => {
      setLayerStatuses(prev => ({ ...prev, [layerId]: isUpdating }));
      layerStatusesRef.current[layerId] = isUpdating; // Sync ref for benchmark
  };

  const runAIAnalysis = async () => {
    setAiStatus(AIStatus.ANALYZING);
    try {
      const result = await analyzePerformance(aggregatedMetrics);
      setAiAnalysis(result);
      setAiStatus(AIStatus.COMPLETE);
    } catch (e) { console.error(e); setAiStatus(AIStatus.ERROR); }
  };

  const downloadCSV = () => {
      if (history.length === 0) return;
      const headers = ['Event ID', 'Timestamp', ...metricLayers.map(l => `"${l.title}" (s)`)];
      const rows = history.map(h => {
          const values = metricLayers.map(l => (h.layerDurations[l.id] || 0).toFixed(3));
          return [h.id, h.timestamp, ...values];
      });
      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `geoperf_metrics_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
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
        <div className="flex items-center gap-4">
            <img 
              src="https://anrmaps.vermont.gov/websites/Images/Logos/MOMlogo.png" 
              alt="Vermont State Logo" 
              className="h-12 w-auto object-contain"
            />
            <div>
                <h1 className="font-bold text-sm leading-tight text-zinc-100">VCGI Map Performance Monitor</h1>
                <div className="text-[10px] text-zinc-500 font-medium tracking-wide">STATE OF VERMONT</div>
            </div>
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
                    <button onClick={() => setActiveTab('layers')} className={`flex-1 py-3 text-xs font-medium flex justify-center items-center gap-2 transition-colors ${activeTab === 'layers' ? "text-white border-b-2 border-blue-500" : "text-zinc-500"}`}>
                        <Layers className="w-3 h-3" /> Layers
                    </button>
                    <button onClick={() => setActiveTab('basemaps')} className={`flex-1 py-3 text-xs font-medium flex justify-center items-center gap-2 transition-colors ${activeTab === 'basemaps' ? "text-white border-b-2 border-green-500" : "text-zinc-500"}`}>
                        <MapIcon className="w-3 h-3" /> Basemaps
                    </button>
                    <button onClick={() => setActiveTab('legend')} className={`flex-1 py-3 text-xs font-medium flex justify-center items-center gap-2 transition-colors ${activeTab === 'legend' ? "text-white border-b-2 border-amber-500" : "text-zinc-500"}`}>
                        <List className="w-3 h-3" /> Legend
                    </button>
                    <button onClick={() => setActiveTab('ai')} className={`flex-1 py-3 text-xs font-medium flex justify-center items-center gap-2 transition-colors ${activeTab === 'ai' ? "text-white border-b-2 border-purple-500" : "text-zinc-500"}`}>
                        <Cpu className="w-3 h-3" /> AI
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    {(activeTab === 'layers' || activeTab === 'basemaps') && (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                                    {activeTab === 'layers' ? 'Operational Layers' : 'Basemap Layers'}
                                </h3>
                                <ul className="space-y-2">
                                    {layersWithColors
                                        .filter(layer => activeTab === 'basemaps' ? BASEMAP_IDS.includes(layer.id) : !BASEMAP_IDS.includes(layer.id))
                                        .map(layer => (
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
                                                {layerStatuses[layer.id] ? (
                                                    <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                                                ) : (
                                                    <div className="w-3 h-3 flex items-center justify-center">
                                                        {layer.visible && <div className="w-1.5 h-1.5 rounded-full bg-zinc-700"></div>}
                                                    </div>
                                                )}

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

                            {activeTab === 'layers' && (
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
                            )}
                        </div>
                    )}
                    {activeTab === 'legend' && (
                        <div className="h-full flex flex-col">
                             <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">Map Legend</div>
                             <div className="flex-1 bg-zinc-950/50 rounded-lg border border-zinc-800 p-2 overflow-y-auto min-h-[200px]">
                                 <div ref={legendDiv} className="w-full"></div>
                             </div>
                             <div className="text-[10px] text-zinc-600 mt-2 text-center">
                                 Showing operational layers only
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
        <div className="absolute right-4 top-4 bottom-4 w-96 z-20 flex flex-col pointer-events-none">
             <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto h-full">
                
                {/* Metrics Header */}
                <div className="p-3 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
                   <div className="flex items-center gap-3">
                       <div className="flex bg-zinc-950 rounded-lg p-0.5 border border-zinc-800">
                            <button onClick={() => setActiveMetricsTab('current')} className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${activeMetricsTab === 'current' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}>Current</button>
                            <button onClick={() => setActiveMetricsTab('history')} className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${activeMetricsTab === 'history' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}>History</button>
                            <button onClick={() => setActiveMetricsTab('benchmark')} className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${activeMetricsTab === 'benchmark' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}>Benchmark</button>
                       </div>
                       {(isRecording && isMapUpdating) || isRunningBenchmark ? <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-ping"></span> : null}
                   </div>
                   <div className="flex items-center gap-1">
                      {!isRecording ? (
                          <button onClick={handlePlay} disabled={isRunningBenchmark} className="p-1.5 bg-zinc-800 hover:bg-green-600/20 hover:text-green-400 text-zinc-400 rounded transition-colors disabled:opacity-50"><Play className="w-4 h-4 fill-current" /></button>
                      ) : (
                          <button onClick={handlePause} disabled={isRunningBenchmark} className="p-1.5 bg-zinc-800 hover:bg-amber-600/20 hover:text-amber-400 text-zinc-400 rounded transition-colors disabled:opacity-50"><Pause className="w-4 h-4 fill-current" /></button>
                      )}
                      <button onClick={handleReset} disabled={isRunningBenchmark} className="p-1.5 bg-zinc-800 hover:bg-red-600/20 hover:text-red-400 text-zinc-400 rounded transition-colors disabled:opacity-50"><RotateCcw className="w-4 h-4" /></button>
                   </div>
                </div>

                <div className="flex-1 overflow-hidden relative flex flex-col">
                    
                    {/* CURRENT TAB */}
                    {activeMetricsTab === 'current' && (
                        <div className="flex-1 overflow-y-auto p-4 space-y-6">
                            {comparisonData && (
                                <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider"><ArrowRightLeft className="w-3 h-3" /> Comparison</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className={`p-2 rounded bg-zinc-900 border ${comparisonData.fast.id === comparisonData.l1.id ? 'border-green-500/30' : 'border-red-500/30'}`}>
                                            <div className="text-[10px] text-zinc-500 truncate mb-1">{comparisonData.l1.title}</div>
                                            <div className="font-mono font-bold text-sm">{(comparisonData.l1.loadTime/1000).toFixed(2)}s</div>
                                        </div>
                                        <div className={`p-2 rounded bg-zinc-900 border ${comparisonData.fast.id === comparisonData.l2.id ? 'border-green-500/30' : 'border-red-500/30'}`}>
                                            <div className="text-[10px] text-zinc-500 truncate mb-1">{comparisonData.l2.title}</div>
                                            <div className="font-mono font-bold text-sm">{(comparisonData.l2.loadTime/1000).toFixed(2)}s</div>
                                        </div>
                                    </div>
                                    <div className="bg-zinc-900/80 rounded p-2 border border-zinc-800 flex flex-col items-center text-center">
                                        <div className="flex items-center gap-1 text-xs text-zinc-400 mb-1">
                                            <Trophy className="w-3 h-3 text-yellow-500" />
                                            <span className="font-semibold text-zinc-200">{comparisonData.fast.title}</span> is faster
                                        </div>
                                        <div className="text-xs text-zinc-500">
                                            <span className="text-green-400 font-bold">{comparisonData.percentDiff.toFixed(1)}%</span> faster
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1"><Timer className="w-3 h-3" /> Load Times</h3>
                                    {compareIds.length > 0 && <button onClick={() => setCompareIds([])} className="text-[10px] text-blue-400 hover:underline">Clear Selection</button>}
                                </div>
                                
                                {rawMetrics.length === 0 && !isRecording && !isRunningBenchmark && (
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
                        </div>
                    )}

                    {/* HISTORY TAB */}
                    {activeMetricsTab === 'history' && (
                        <div className="flex flex-col h-full">
                            {history.length > 0 && (
                                <div className="p-2 border-b border-zinc-800 flex justify-end">
                                    <button onClick={downloadCSV} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors">
                                        <Download className="w-3 h-3" /> Export CSV
                                    </button>
                                </div>
                            )}
                            <div className="flex-1 overflow-auto">
                                {history.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-zinc-600 p-4 text-center space-y-2">
                                        <TableIcon className="w-8 h-8 opacity-50" />
                                        <p className="text-xs">No history recorded yet.</p>
                                    </div>
                                ) : (
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-zinc-950 sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th className="text-[10px] uppercase font-bold text-zinc-500 p-2 border-b border-zinc-800 w-8">#</th>
                                                <th className="text-[10px] uppercase font-bold text-zinc-500 p-2 border-b border-zinc-800 w-16">Time</th>
                                                {metricLayers.map(l => (
                                                    <th key={l.id} className="text-[10px] uppercase font-bold text-zinc-500 p-2 border-b border-zinc-800 truncate max-w-[80px]" title={l.title}>{l.title}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-800/50">
                                            {[...history].reverse().map((h) => (
                                                <tr key={h.id} className="hover:bg-zinc-900/50 transition-colors group">
                                                    <td className="p-2 text-xs font-mono text-zinc-600">{h.id}</td>
                                                    <td className="p-2 text-xs text-zinc-400 whitespace-nowrap">{h.timestamp}</td>
                                                    {metricLayers.map(l => {
                                                        const duration = h.layerDurations[l.id];
                                                        return <td key={l.id} className="p-2 text-xs font-mono text-zinc-300">{duration ? duration.toFixed(3) : '-'}</td>
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    )}

                    {/* BENCHMARK TAB */}
                    {activeMetricsTab === 'benchmark' && (
                        <div className="flex flex-col h-full">
                            {benchmarkReport ? (
                                <BenchmarkReport report={benchmarkReport} layers={layers} onClose={() => setBenchmarkReport(null)} />
                            ) : (
                                <div className="flex flex-col h-full items-center justify-center p-6 space-y-6">
                                    {isRunningBenchmark ? (
                                        <div className="text-center space-y-4">
                                            <div className="relative w-16 h-16 mx-auto">
                                                <div className="absolute inset-0 border-4 border-blue-500/30 rounded-full"></div>
                                                <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                            </div>
                                            <div>
                                                <h3 className="text-zinc-100 font-semibold">Running Benchmark...</h3>
                                                <p className="text-zinc-500 text-xs mt-1">{benchmarkProgress}</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="w-16 h-16 bg-zinc-800/50 rounded-full flex items-center justify-center border border-zinc-700">
                                                <Gauge className="w-8 h-8 text-blue-500" />
                                            </div>
                                            <div className="text-center space-y-2">
                                                <h2 className="text-lg font-semibold text-zinc-100">Performance Benchmark</h2>
                                                <p className="text-xs text-zinc-500 max-w-[240px] mx-auto leading-relaxed">
                                                    Run an automated sequence of Zoom (10-16), Pan, and Feature Query operations to stress-test active layers.
                                                </p>
                                            </div>
                                            <div className="flex flex-col gap-2 w-full max-w-[200px]">
                                                <button 
                                                    onClick={runBenchmark}
                                                    className="bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                                                >
                                                    <Play className="w-4 h-4 fill-current" /> Run Benchmark
                                                </button>
                                            </div>
                                            <div className="text-[10px] text-zinc-600 border-t border-zinc-800 pt-4 mt-2">
                                                <p>Steps: 10 Nav (Z10-16) • 5 Queries</p>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                </div>
                
                {/* METRICS FOOTER */}
                <div className="border-t border-zinc-800 bg-zinc-950/50 p-3 backdrop-blur-sm">
                    <div className="flex items-center justify-between mb-2">
                         <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Event Status</span>
                         <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium border ${isMapUpdating || isRunningBenchmark ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
                             {isMapUpdating || isRunningBenchmark ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                             {isRunningBenchmark ? 'Running Benchmark...' : (isMapUpdating ? 'Processing Requests...' : 'All Layers Complete')}
                         </div>
                    </div>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                        {metricLayers.map(layer => {
                            const loading = layerStatuses[layer.id];
                            return (
                                <div key={layer.id} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                         <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${loading ? 'bg-blue-500 animate-pulse' : 'bg-zinc-600'}`}></div>
                                         <span className={`text-[11px] truncate max-w-[180px] ${loading ? 'text-blue-200' : 'text-zinc-500'}`} title={layer.title}>{layer.title}</span>
                                    </div>
                                    <span className="text-[10px] font-mono text-zinc-600">
                                        {loading ? 'Running' : 'Done'}
                                    </span>
                                </div>
                            )
                        })}
                        {metricLayers.length === 0 && <div className="text-[10px] text-zinc-600 text-center italic">No active service layers</div>}
                    </div>
                </div>

             </div>
        </div>

        <MapComponent 
            layers={layers} 
            onViewReady={(v) => viewRef.current = v}
            onMapUpdate={setIsMapUpdating} 
            onLayerStatusChange={handleLayerStatusChange}
        />
      </div>
    </div>
  );
};

export default App;