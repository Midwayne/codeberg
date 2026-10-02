import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const trials = [];
for (let trial = 0; trial < 5; trial++) {
  execFileSync('npm', ['run', 'build', '--', '--manifest'], { cwd: root, stdio: 'pipe' });
  const manifest = JSON.parse(readFileSync(resolve(root, 'dist/.vite/manifest.json'), 'utf8'));
  const visited = new Set();
  function collect(key) {
    if (visited.has(key)) return;
    visited.add(key);
    for (const dependency of manifest[key].imports ?? []) collect(dependency);
  }
  collect('index.html');
  const files = [...visited].map((key) => manifest[key].file).filter((file) => file.endsWith('.js'));
  trials.push(files.reduce((sum, file) => {
    const bytes = readFileSync(resolve(root, 'dist', file));
    return { raw: sum.raw + bytes.length, gzip: sum.gzip + gzipSync(bytes).length };
  }, { raw: 0, gzip: 0 }));
}
console.log(JSON.stringify({ trials, median: { raw: [...trials].sort((a, b) => a.raw - b.raw)[2].raw, gzip: [...trials].sort((a, b) => a.gzip - b.gzip)[2].gzip } }, null, 2));
