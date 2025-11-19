import React from 'react';
import { BenchmarkReportData, MapLayer } from '../types';
import { Download, Trophy, AlertTriangle, FileBarChart } from 'lucide-react';

interface BenchmarkReportProps {
  report: BenchmarkReportData;
  layers: MapLayer[];
  onClose: () => void;
}

export const BenchmarkReport: React.FC<BenchmarkReportProps> = ({ report, layers, onClose }) => {
  const layerMap = new Map(layers.map(l => [l.id, l]));
  const metricLayers = layers.filter(l => !l.excludeFromMetrics);

  const downloadReport = () => {
    // Create detailed CSV
    const headers = ['Step', ...metricLayers.map(l => `${l.title} (s)`)];
    const rows = report.steps.map(step => {
        return [
            step.stepName,
            ...metricLayers.map(l => (step.layerMetrics[l.id]?.loadTime || 0).toFixed(3))
        ].join(',');
    });

    // Add Summary Section to CSV
    const summaryHeader = ['Layer', 'Avg Load Time (s)', 'Total Requests'];
    const summaryRows = metricLayers.map(l => {
        const s = report.summary[l.id];
        return [l.title, s?.avgLoadTime.toFixed(3) || '0', s?.totalRequests || '0'].join(',');
    });

    const csvContent = [
        'BENCHMARK RESULTS',
        `Date,${report.date}`,
        '',
        'STEP DETAILS',
        headers.join(','),
        ...rows,
        '',
        'SUMMARY',
        summaryHeader.join(','),
        ...summaryRows
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Benchmark_Report_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fastest = layerMap.get(report.fastestLayerId);
  const slowest = layerMap.get(report.slowestLayerId);

  return (
    <div className="flex flex-col h-full bg-zinc-900/50 rounded-lg border border-zinc-800 overflow-hidden">
      <div className="p-4 border-b border-zinc-800 bg-zinc-900 flex justify-between items-center">
        <div className="flex items-center gap-2">
            <FileBarChart className="w-5 h-5 text-purple-500" />
            <h2 className="font-bold text-zinc-100">Performance Report</h2>
        </div>
        <button onClick={downloadReport} className="flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded border border-zinc-700 transition-colors">
            <Download className="w-3 h-3" /> Export CSV
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Winner / Loser Cards */}
        <div className="grid grid-cols-2 gap-3">
            <div className="bg-gradient-to-br from-green-900/20 to-zinc-900 border border-green-500/30 p-3 rounded-lg">
                <div className="flex items-center gap-2 mb-2 text-green-400 text-xs font-bold uppercase tracking-wider">
                    <Trophy className="w-4 h-4" /> Fastest Layer
                </div>
                <div className="text-sm font-medium text-zinc-100 truncate" title={fastest?.title}>{fastest?.title || 'N/A'}</div>
                <div className="text-xs text-zinc-400 mt-1">
                    Avg: <span className="text-green-400 font-mono font-bold">{report.summary[report.fastestLayerId]?.avgLoadTime.toFixed(3)}s</span>
                </div>
            </div>
            <div className="bg-gradient-to-br from-red-900/20 to-zinc-900 border border-red-500/30 p-3 rounded-lg">
                <div className="flex items-center gap-2 mb-2 text-red-400 text-xs font-bold uppercase tracking-wider">
                    <AlertTriangle className="w-4 h-4" /> Slowest Layer
                </div>
                <div className="text-sm font-medium text-zinc-100 truncate" title={slowest?.title}>{slowest?.title || 'N/A'}</div>
                <div className="text-xs text-zinc-400 mt-1">
                    Avg: <span className="text-red-400 font-mono font-bold">{report.summary[report.slowestLayerId]?.avgLoadTime.toFixed(3)}s</span>
                </div>
            </div>
        </div>

        {/* Detailed Table */}
        <div>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Step-by-Step Load Times (s)</h3>
            <div className="border border-zinc-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-950">
                        <tr>
                            <th className="p-2 text-zinc-500 font-medium border-b border-zinc-800">Test Step</th>
                            {metricLayers.map(l => (
                                <th key={l.id} className="p-2 text-zinc-500 font-medium border-b border-zinc-800 truncate max-w-[80px]" title={l.title}>{l.title}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                        {report.steps.map((step, idx) => (
                            <tr key={idx} className="hover:bg-zinc-800/30">
                                <td className="p-2 font-medium text-zinc-300">{step.stepName}</td>
                                {metricLayers.map(l => {
                                    const val = step.layerMetrics[l.id]?.loadTime;
                                    // Highlight outliers
                                    const isSlow = val > 2;
                                    const color = isSlow ? 'text-red-400' : 'text-zinc-400';
                                    return <td key={l.id} className={`p-2 font-mono ${color}`}>{val ? val.toFixed(3) : '-'}</td>
                                })}
                            </tr>
                        ))}
                        {/* Averages Row */}
                        <tr className="bg-zinc-900/50 font-bold border-t-2 border-zinc-800">
                            <td className="p-2 text-zinc-200">Average</td>
                            {metricLayers.map(l => (
                                <td key={l.id} className="p-2 text-blue-400 font-mono">
                                    {report.summary[l.id]?.avgLoadTime.toFixed(3)}
                                </td>
                            ))}
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
        
        <button onClick={onClose} className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 rounded hover:bg-zinc-800 transition-colors">Close Report</button>
      </div>
    </div>
  );
};
