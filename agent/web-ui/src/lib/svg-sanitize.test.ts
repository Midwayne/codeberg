import { describe, expect, it } from 'vitest';

import { MAX_SVG_CHARS, sanitizeSvg } from './svg-sanitize';

const wrap = (body: string, root = "viewBox='0 0 100 200'") => `<svg ${root}>${body}</svg>`;

describe('svg art sanitizing', () => {
  it('rebuilds shapes, gradients, and local references under a sized root', () => {
    const svg = sanitizeSvg(wrap(
      "<defs><radialGradient id='petal'><stop offset='0' stop-color='#ffd1dc'/></radialGradient></defs>"
      + "<g transform='rotate(12 50 50)'><path d='M10 10 C 20 0, 40 0, 50 10Z' fill='url(#petal)'/></g>"
      + "<use xlink:href='#petal'/>",
      "viewBox='0 0 100 200' width='9999' onload='alert(1)'",
    ), true);

    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200" width="100" height="200">'
      + '<defs><radialGradient id="petal"><stop offset="0" stop-color="#ffd1dc"/></radialGradient></defs>'
      + '<g transform="rotate(12 50 50)"><path d="M10 10 C 20 0, 40 0, 50 10Z" fill="url(#petal)"/></g>'
      + '<use href="#petal"/></svg>',
    );
  });

  it('drops scripts, foreign content, styles, text, handlers, and outside links with their children', () => {
    const svg = sanitizeSvg(wrap(
      '<script>alert(1)</script><foreignObject><div><circle r="1"/></div></foreignObject>'
      + '<style>circle{fill:red}</style><text>hello</text>'
      + '<circle r="4" onclick="alert(1)" style="fill:red" fill="url(https://evil.test/x)"/>'
      + '<use href="https://evil.test/a.svg#x"/><rect fill="javascript:alert(1)" width="2"/>'
      + '<image href="data:image/png;base64,AAAA"/><a href="https://evil.test"><circle r="2"/></a>',
    ), true);

    expect(svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200" width="100" height="200"><circle r="4"/><use/><rect width="2"/></svg>');
  });

  it('rejects drawings without a usable viewBox, with broken nesting, or hidden in CDATA', () => {
    expect(sanitizeSvg('<svg><circle r="1"/></svg>', true)).toBeUndefined();
    expect(sanitizeSvg(wrap('<circle r="1"/>', "viewBox='0 0 0 10'"), true)).toBeUndefined();
    expect(sanitizeSvg(wrap('<g><circle r="1"/>'), true)).toBeUndefined();
    expect(sanitizeSvg(wrap('<g></path>'), true)).toBeUndefined();
    expect(sanitizeSvg(wrap('<![CDATA[<script>alert(1)</script>]]>'), true)).toBeUndefined();
    expect(sanitizeSvg(`${wrap('')}<script>alert(1)</script>`, true)).toBeUndefined();
    expect(sanitizeSvg(wrap(`<!-- ${'x'.repeat(MAX_SVG_CHARS * 2)} -->`), true)).toBeUndefined();
    expect(sanitizeSvg({ svg: wrap('') }, true)).toBeUndefined();
  });

  it('keeps slow animations only in moving art, and never ones that retarget a reference', () => {
    const slow = '<animateTransform attributeName="transform" type="rotate" values="0;8;0" dur="6s" repeatCount="indefinite"/>';
    const source = wrap(`<g>${slow}<animate attributeName="opacity" values="1;0;1" dur="0.2s"/><animate attributeName="href" to="#x" dur="5s"/></g>`);

    expect(sanitizeSvg(source, true)).toContain(`<g>${slow}</g>`);
    expect(sanitizeSvg(source, true)).not.toContain('0.2s');
    expect(sanitizeSvg(source, false)).toContain('<g></g>');
  });

  it('drops animations that could flash: bunched, jumping, restarted, or faster than a step a second', () => {
    const flash = "<animate attributeName='opacity' dur='2s' values='0;1;0;1;0;1;0;1' calcMode='discrete' repeatCount='indefinite'/>";
    const bunched = "<animate attributeName='opacity' dur='8s' values='1;0;1' keyTimes='0;0.01;0.02'/>";
    const restarted = "<animate attributeName='fill' dur='4s' values='#fff;#000' begin='0s;0.1s;0.2s'/>";
    const gentle = "<animate attributeName='opacity' dur='6s' values='0.6;1;0.6' repeatCount='indefinite'/>";
    const svg = sanitizeSvg(wrap(`<circle r='4'>${flash}${bunched}${restarted}${gentle}</circle>`), true) ?? '';

    // The strobe goes; the bunched and restarted ones survive only as even, single-start fades.
    expect(svg.match(/<animate /g)).toHaveLength(3);
    expect(svg).not.toContain('2s');
    expect(svg).toContain('<animate attributeName="opacity" dur="6s" values="0.6;1;0.6" repeatCount="indefinite"/>');
    expect(svg).toContain('<animate attributeName="opacity" dur="8s" values="1;0;1"/>');
    expect(svg).toContain('<animate attributeName="fill" dur="4s" values="#fff;#000"/>');
    expect(svg).not.toMatch(/keyTimes|calcMode|begin/);
  });

  it('keeps a long path whole, and drops a shape whose geometry it refuses', () => {
    const long = `M0 0 ${'L10 10 '.repeat(1_200)}Z`;
    const svg = sanitizeSvg(wrap(`<path d='${long}' fill='#c33'/><path d='M0 0 "evil"' fill='#3c3'/><polygon fill='#33c'/>`), true) ?? '';

    expect(long.length).toBeGreaterThan(8_000);
    expect(svg).toContain(`<path d="${long}" fill="#c33"/>`);
    expect(svg).not.toMatch(/#3c3|#33c/);
  });

  it('accepts again what it accepted once, even at the size limit, so saved art survives a reload', () => {
    // A compact root grows when rebuilt; fill the drawing until the rebuilt copy just fits.
    const body = (count: number) => `<path d='M0 0 ${'h1'.repeat(count)}'/>`;
    let count = 1;
    while ((sanitizeSvg(wrap(body(count + 50)), true)?.length ?? Infinity) <= MAX_SVG_CHARS) count += 50;

    const first = sanitizeSvg(wrap(body(count)), true);

    expect(first!.length).toBeGreaterThan(MAX_SVG_CHARS - 200);
    expect(sanitizeSvg(first, true)).toBe(first);
    expect(sanitizeSvg(wrap(body(count + 50)), true)).toBeUndefined();
  });
});
