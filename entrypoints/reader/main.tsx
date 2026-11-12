import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReaderApp } from '../../src/ui/ReaderApp';
import '../../src/ui/reader.css';

const root = document.getElementById('root');
if (!root) throw new Error('Reader root element is missing.');
createRoot(root).render(<React.StrictMode><ReaderApp /></React.StrictMode>);
