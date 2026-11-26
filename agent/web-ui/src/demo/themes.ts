/* The motion demo answers theme requests with a sample in the chat model's reply format. */
const synthwave = {
  label: 'Neon Sunset',
  description: 'Synthwave dusk · drifting grid',
  colorScheme: 'dark',
  heading: 'sans',
  body: 'sans',
  radius: 1,
  transition: 'reveal',
  palette: {
    background: '#140b24',
    foreground: '#f5e9ff',
    surface: '#1b1030',
    raised: '#2a1745',
    popover: '#24143c',
    mutedForeground: '#c4a8e0',
    primary: '#ff4fa3',
    primaryForeground: '#140b24',
    destructive: '#ff6b6b',
    border: '#ffffff1a',
  },
  backdrop: {
    sky: { from: '#2b0f45', to: '#140b24', angle: 180 },
    layers: [
      { kind: 'glow', color: '#ff4fa3', opacity: 0.22, x: 50, y: 100, size: 70, animation: 'pulse', duration: 14 },
      { kind: 'glow', color: '#4fd6ff', opacity: 0.14, x: 15, y: 10, size: 40, animation: 'drift', duration: 40 },
      { kind: 'grid', color: '#ff4fa3', opacity: 0.08, size: 30, animation: 'pan', duration: 30 },
      { kind: 'stars', color: '#ffffff', opacity: 0.5, size: 90, animation: 'twinkle', duration: 9 },
    ],
  },
};

export function themeDemoResponse(url: URL, init?: RequestInit): Response | undefined {
  if (url.pathname !== '/api/themes/generate' || init?.method !== 'POST') return;

  return Response.json({ theme: synthwave });
}
