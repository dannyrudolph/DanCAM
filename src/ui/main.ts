import { createDrawing } from '../model/drawing';
import { App } from './app';
import { loadDemo } from './demo';
import './style.css';

const drawing = createDrawing('in');
if (new URLSearchParams(location.search).has('demo')) loadDemo(drawing);
new App(drawing);
