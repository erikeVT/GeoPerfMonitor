import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Initialize ArcGIS config and local-asset fetch rewrite as early as possible
// so that any ArcGIS module imports (including workers) will use the configured paths.
import initArcGIS from './services/arcgis';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const start = async () => {
  try {
    await initArcGIS();
  } catch (e) {
    console.warn('initArcGIS failed at startup', e);
  }

  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};

start();