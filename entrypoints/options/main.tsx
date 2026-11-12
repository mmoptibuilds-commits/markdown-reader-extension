import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsApp } from '../../src/ui/SettingsApp';
import '../../src/ui/settings.css';

const root = document.getElementById('root');
if (!root) throw new Error('Settings root element is missing.');
createRoot(root).render(<React.StrictMode><SettingsApp /></React.StrictMode>);
