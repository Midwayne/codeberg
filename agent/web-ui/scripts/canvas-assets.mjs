import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = new URL('../node_modules/@excalidraw/excalidraw/dist/prod/fonts/', import.meta.url);
const target = new URL('../public/excalidraw/fonts/', import.meta.url);
await mkdir(fileURLToPath(target), { recursive: true });
await cp(fileURLToPath(source), fileURLToPath(target), { recursive: true });
