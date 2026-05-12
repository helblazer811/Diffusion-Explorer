// Expand the smiley dataset by jittering existing points with Gaussian noise.
// Output overwrites the input.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const TARGET_PATH = 'static/optimal_transport_coupling/data/smiley_face.json';
const TARGET_COUNT = 3000;
const JITTER_STD = 0.025;

function gauss(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function main() {
  const absPath = path.join(ROOT, TARGET_PATH);
  const raw = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
  const original: number[][] = raw.points;
  console.log(`Loaded ${original.length} original points`);

  const out: number[][] = [...original.map((p) => [...p])];
  while (out.length < TARGET_COUNT) {
    const base = original[Math.floor(Math.random() * original.length)];
    out.push([
      base[0] + gauss() * JITTER_STD,
      base[1] + gauss() * JITTER_STD,
    ]);
  }

  fs.writeFileSync(absPath, JSON.stringify({ points: out }, null, 0));
  console.log(`Wrote ${out.length} points to ${TARGET_PATH}`);
  console.log(`  File size: ${(fs.statSync(absPath).size / 1024).toFixed(1)} KB`);
}

main();
