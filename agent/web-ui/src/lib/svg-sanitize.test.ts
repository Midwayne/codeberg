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
    expect(sanitizeSvg(wrap(`<!-- ${'x'.repeat(MAX_SVG_CHARS)} -->`), true)).toBeUndefined();
    expect(sanitizeSvg({ svg: wrap('') }, true)).toBeUndefined();
  });

  it('keeps slow animations only in moving art, and never ones that retarget a reference', () => {
    const slow = '<animateTransform attributeName="transform" type="rotate" values="0;8;0" dur="6s" repeatCount="indefinite"/>';
    const source = wrap(`<g>${slow}<animate attributeName="opacity" values="1;0;1" dur="0.2s"/><animate attributeName="href" to="#x" dur="5s"/></g>`);

    expect(sanitizeSvg(source, true)).toContain(`<g>${slow}</g>`);
    expect(sanitizeSvg(source, true)).not.toContain('0.2s');
    expect(sanitizeSvg(source, false)).toContain('<g></g>');
  });
});
