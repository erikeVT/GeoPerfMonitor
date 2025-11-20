
export interface MapLayer {
  id: string;
  title: string;
  url: string;
  type: 'feature' | 'tile' | 'map-image' | 'vector-tile';
  visible: boolean;
  color?: string;
  excludeFromMetrics?: boolean;
}

export interface NetworkRequestMetric {
  id: string;
  url: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: number;
  size?: number;
}

export interface LayerPerformanceSummary {
  id: string;
  title: string;
  domain: string;
  requestCount: number;
  avgLatency: number;
  totalDuration: number;
  loadTime: number; // Wall clock time (Max End - Min Start)
  totalSize: number;
  errorCount: number;
  requests: NetworkRequestMetric[];
}

export interface MapEventHistory {
  id: number;
  timestamp: string;
  layerDurations: Record<string, number>;
}

export interface BenchmarkStepResult {
  stepName: string;
  type: 'nav' | 'query';
  layerMetrics: Record<string, { loadTime: number; requestCount: number }>;
}

export interface BenchmarkReportData {
  date: string;
  steps: BenchmarkStepResult[];
  summary: Record<string, { 
      avgNavLoadTime: number; 
      avgQueryLoadTime: number; 
      totalRequests: number; 
      score: number 
  }>;
  fastestLayerId: string;
  slowestLayerId: string;
  percentFaster: number;
}

export enum AIStatus {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR',
}
