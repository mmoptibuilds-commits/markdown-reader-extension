import React from 'react';
import { createRoot } from 'react-dom/client';
import { PopupApp } from '../../src/ui/PopupApp';
import '../../src/ui/popup.css';

const root = document.getElementById('root');
if (!root) throw new Error('Popup root element is missing.');
createRoot(root).render(<React.StrictMode><PopupApp /></React.StrictMode>);
