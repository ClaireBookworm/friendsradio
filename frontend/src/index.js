import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// 1) Grab the root DOM element
const rootElement = document.getElementById('root');

// 2) Create a React root
const root = ReactDOM.createRoot(rootElement);

// 3) Render your App
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
