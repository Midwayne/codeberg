import type { CSSProperties } from 'react';

import './onboarding.css';

const CODE_LINES = [40, 28, 46, 32, 42, 22];

const PACKET_ROWS = [38, 54, 70];

// Mirrors the file's footprint (x 16–80) around the centre line at x = 100.
const NODES: Array<[number, number]> = [[127, 24], [176, 28], [152, 56], [178, 86], [130, 90]];

const EDGES: Array<[number, number]> = [[0, 1], [0, 2], [1, 2], [2, 3], [2, 4], [3, 4]];

/** Decorative first-run loop: source lines are scanned, chunked, and embedded. */
export function OnboardingMark() {
  return (
    <svg data-onboarding-mark aria-hidden="true" viewBox="0 0 200 112" focusable="false"
      className="onboard-mark h-28 w-auto text-foreground">
      <SourceFile />
      {PACKET_ROWS.map((y, index) => (
        <rect key={y} className="onboard-packet" style={stagger(index, 600)}
          x="86" y={y} width="14" height="8" rx="2" />
      ))}
      <VectorGraph />
    </svg>
  );
}

function SourceFile() {
  return (
    <g>
      <rect className="onboard-file" x="16" y="8" width="64" height="96" rx="8" />
      {CODE_LINES.map((width, index) => (
        <rect key={index} className="onboard-line" style={stagger(index, 260)}
          x="25" y={22 + index * 12} width={width} height="5" rx="2.5" />
      ))}
      <rect className="onboard-scan" x="20" y="14" width="56" height="2" rx="1" />
    </g>
  );
}

function VectorGraph() {
  return (
    <g>
      {EDGES.map(([from, to], index) => (
        <line key={`${from}-${to}`} className="onboard-edge" style={stagger(index, 220)}
          x1={NODES[from]![0]} y1={NODES[from]![1]} x2={NODES[to]![0]} y2={NODES[to]![1]} />
      ))}
      {NODES.map(([cx, cy], index) => (
        <circle key={`${cx}-${cy}`} className="onboard-node" style={stagger(index, 340)}
          cx={cx} cy={cy} r={index === 2 ? 6 : 4.5} />
      ))}
    </g>
  );
}

function stagger(index: number, stepMs: number): CSSProperties {
  return { animationDelay: `${index * stepMs}ms` };
}
