import { createDrawing } from '../model/drawing';
import { App } from './app';
import { loadDemo } from './demo';
import { loadReference } from './referenceDrawing';
import './style.css';

const drawing = createDrawing('in');
const params = new URLSearchParams(location.search);
if (params.has('demo')) loadDemo(drawing);
else if (params.has('reference')) loadReference(drawing); // the Phase 4 done-when drawing
new App(drawing);
