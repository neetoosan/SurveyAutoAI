import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';

const container = document.getElementById('root');
if (!container) throw new Error('Side panel root element is missing.');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
