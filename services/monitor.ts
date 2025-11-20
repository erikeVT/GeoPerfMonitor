import config from '@arcgis/core/config.js';
import { NetworkRequestMetric } from '../types';

// Event system for notifying React components
type Listener = (metric: NetworkRequestMetric) => void;
const listeners: Set<Listener> = new Set();

export const subscribeToMetrics = (callback: Listener) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};

const notifyListeners = (metric: NetworkRequestMetric) => {
  listeners.forEach((l) => l(metric));
};

let initialized = false;

// Safe ID generator for environments where crypto.randomUUID might be restricted or missing
const generateId = () => {
    const cryptoObj = typeof window !== 'undefined' ? (window.crypto || (window as any).msCrypto) : undefined;
    if (cryptoObj && cryptoObj.randomUUID) {
        return cryptoObj.randomUUID();
    }
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
};

export const initInterceptor = () => {
  if (initialized) return;
  initialized = true;

  if (!config) {
      console.error("ArcGIS config not loaded correctly");
      return;
  }

  // Essential for CDN usage without local assets
  config.assetsPath = "https://js.arcgis.com/4.28/";

  if (!config.request) {
    return;
  }

  config.request.interceptors.push({
    urls: /.*/, // Intercept everything to check performance
    // @ts-ignore - ArcGIS types can be strict about the callback signature
    before: function (params: any) {
      // Tag the request with a start time
      if (params.requestOptions) {
        params.requestOptions.customStartTime = Date.now();
      }
    },
    // @ts-ignore
    after: function (response: any) {
      const endTime = Date.now();
      const requestOptions = response.requestOptions || {};
      const startTime = requestOptions.customStartTime || (endTime - 50); // Fallback
      const duration = endTime - startTime;

      let size = 0;
      try {
          if (response.data) {
             if (requestOptions.responseType === 'json') {
                 size = JSON.stringify(response.data).length;
             } else if (response.data.byteLength) {
                 size = response.data.byteLength; // ArrayBuffer
             } else if (response.data.size) {
                 size = response.data.size; // Blob
             }
          }
      } catch (e) {
          // Ignore serialization errors to prevent interceptor crash
      }

      const metric: NetworkRequestMetric = {
        id: generateId(),
        url: response.url,
        startTime,
        endTime,
        duration,
        status: 200, // Simplified status
        size,
      };

      notifyListeners(metric);
    },
    error: function(error: any) {
        // Handle error monitoring
         const endTime = Date.now();
         const metric: NetworkRequestMetric = {
            id: generateId(),
            url: error.url || 'unknown',
            startTime: endTime - 100, // Estimate
            endTime,
            duration: 100,
            status: error.details?.httpStatus || 500,
            size: 0,
          };
          notifyListeners(metric);
    }
  });
};