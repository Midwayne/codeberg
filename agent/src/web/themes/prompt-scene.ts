/*
 * How to write a scene: a canvas script the web UI runs in a sandboxed frame
 * and worker, with no access to the app or the network.
 */
export const SCENE_PROMPT = `Scenes:
- "backdrop" may also hold "scene": { "script": JavaScript source as a string, at most 16000 characters }.
  A scene is the most expressive backdrop: write one whenever the request asks for something the other
  fields cannot draw well, such as koi or turtles swimming along paths, birds flying, a perspective grid
  scrolling toward a horizon, a striped synthwave sun, halftone or pixel mosaics, aurora curtains, weather,
  fireworks, or anything procedural. While a scene runs it replaces layers, art, and sprites, which become
  its still preview and its fallback, so give a sky and a few light layers or art that suggest the scene.
- The script calls scene({ setup(s) {}, frame(s) {}, event(name, s) {} }) once; every hook is optional.
  setup runs at start and after each resize, frame runs up to 60 times a second, and event runs on app
  moments: "send" (the user sent a message), "reply" (a reply finished), "error" (a reply failed), and
  "new-chat". Use events for short effects of a few seconds, such as fireworks when a reply finishes.
- s.ctx is a 2D canvas context already scaled for the screen; draw in CSS pixels from 0,0 to s.width,
  s.height. The canvas is cleared before each frame unless the scene object has keep: true (for trails).
  s.t is seconds since start, s.dt seconds since the last frame, s.colors the theme palette (background,
  foreground, primary, link, surface, border, and so on), s.state an object to keep anything in, and
  s.random(seed) returns a repeatable random function. s.motion is false when the theme must be still:
  then frame runs once (and after resizes) and events do not run, so draw a complete still picture.
- It runs in a worker: no DOM, document, window, images, fonts, network, or storage. Draw with paths,
  gradients, and fillRect; new OffscreenCanvas(w, h) is available for pre-rendering sprites in setup.
- Messages sit in a center column that the app veils, so put detail and motion toward the sides, top,
  and bottom; a large shape such as a sun may sit behind the column. Keep the scene calm: slow motion,
  no flashing, and no brightness change faster than three times a second, even in event effects.
- Keep each frame under 4 ms: at most a few hundred shapes, no shadowBlur or filter in frame, and
  pre-rendered sprites for anything repeated. A scene that throws, stalls, or is too slow is stopped and
  its fallback shown.`;
