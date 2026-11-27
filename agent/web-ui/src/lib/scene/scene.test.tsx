import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SceneFrame } from '../../components/scene-frame';
import { normalizeTheme } from '../theme-normalize';
import { sceneEventFor } from './scene-events';
import { MAX_SCENE_CHARS } from './scene-normalize';

const palette = { background: '#140a24', foreground: '#f6e9ff' };

function sceneOf(scene: unknown, animated = true) {
  const theme = normalizeTheme({ palette, backdrop: { scene } }, { id: 'custom-scene', prompt: 'synthwave', animated });

  return typeof theme.backdrop === 'object' ? theme.backdrop.scene : undefined;
}

describe('theme scenes', () => {
  it('keeps a scene-only backdrop, holds it still when Animated is off, and drops oversized scripts', () => {
    expect(sceneOf({ script: ' scene({}) ' })).toEqual({ script: 'scene({})', motion: true });
    expect(sceneOf({ script: 'scene({})' }, false)).toEqual({ script: 'scene({})', motion: false });
    expect(sceneOf({ script: 'scene({})', motion: false })?.motion).toBe(false);
    expect(sceneOf({ script: 'x'.repeat(MAX_SCENE_CHARS + 1) })).toBeUndefined();
    expect(sceneOf({ script: 42 })).toBeUndefined();
  });

  it('runs scenes in a frame sandboxed to scripts alone, whose page refuses every request', () => {
    const html = renderToStaticMarkup(
      <SceneFrame colorScheme="dark" colors={normalizeTheme({ palette }, { id: 'custom-a', prompt: '', animated: true }).palette} scene={{ script: 'scene({})', motion: true }} onFail={() => undefined} />,
    );

    expect(html).toContain('sandbox="allow-scripts"');

    const page = html.match(/srcDoc="([^"]*)"/i)?.[1]?.replaceAll('&quot;', '"').replaceAll('&#x27;', "'") ?? '';
    const policy = page.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';

    const directives = Object.fromEntries(policy.split('; ').map((directive) => [directive.split(' ')[0], directive]));

    // Everything not named falls back to default-src 'none': no connect, img, font, frame, or media.
    expect(Object.keys(directives).sort()).toEqual(['base-uri', 'default-src', 'form-action', 'script-src', 'style-src', 'worker-src']);
    expect(directives['default-src']).toBe("default-src 'none'");
    expect(directives['script-src']).toMatch(/^script-src 'nonce-[0-9a-f]{32}' blob:$/);
    expect(directives['worker-src']).toBe('worker-src blob:');

    // The model's script is posted to the frame at load, never written into its page.
    expect(page).not.toContain('scene({})');
  });

  it('maps chat status changes to sent, finished, and failed replies', () => {
    expect(sceneEventFor('ready', 'submitted')).toBe('send');
    expect(sceneEventFor('submitted', 'streaming')).toBeUndefined();
    expect(sceneEventFor('streaming', 'ready')).toBe('reply');
    expect(sceneEventFor('submitted', 'error')).toBe('error');
    expect(sceneEventFor('error', 'ready')).toBeUndefined();
    expect(sceneEventFor('ready', 'ready')).toBeUndefined();
  });
});
