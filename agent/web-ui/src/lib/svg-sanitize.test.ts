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

  it('refuses drawings whose references would draw far more shapes than they hold, or loop', () => {
    // Each group draws the one before it twice: 40 levels would be 2^40 paths.
    const levels = Array.from({ length: 40 }, (_, i) => `<g id='a${i + 1}'><use href='#a${i}'/><use href='#a${i}'/></g>`).join('');
    const doubling = wrap(`<defs><g id='a0'><path d='M0 0h1v1z'/></g>${levels}</defs><use href='#a40'/>`);

    // The same growth through masks instead of <use>.
    const masks = Array.from({ length: 30 }, (_, i) => `<mask id='m${i + 1}'><rect width='9' height='9' mask='url(#m${i})'/><rect width='9' height='9' mask='url(#m${i})'/></mask>`).join('');
    const masked = wrap(`<defs><mask id='m0'><rect width='9' height='9'/></mask>${masks}</defs><rect width='9' height='9' mask='url(#m30)'/>`);

    const loop = wrap("<defs><g id='x'><use href='#y'/></g><g id='y'><use href='#x'/></g></defs><use href='#x'/>");

    // A petal drawn twelve times, each filled with a gradient, is ordinary art.
    const petals = wrap(`<defs><radialGradient id='p'><stop offset='0' stop-color='#fff'/></radialGradient><path id='petal' d='M0 0q5 5 0 10z' fill='url(#p)'/></defs>${"<use href='#petal'/>".repeat(12)}`);

    expect(sanitizeSvg(doubling, true)).toBeUndefined();
    expect(sanitizeSvg(masked, true)).toBeUndefined();
    expect(sanitizeSvg(loop, true)).toBeUndefined();
    expect(sanitizeSvg(petals, true)).toContain('<use href="#petal"/>');
  });

  it('counts the element the browser draws when ids repeat: the first one by its opening tag', () => {
    // Each layer draws the one before it ten times; a later empty decoy shares its id.
    const layers = Array.from({ length: 8 }, (_, i) => `<g id='a${i + 1}'>${`<use href='#a${i}'/>`.repeat(10)}</g><g id='a${i + 1}'/>`).join('');
    const decoyed = wrap(`<defs><g id='a0'><path d='M0 0h1v1z'/></g>${layers}</defs><use href='#a8'/>`);

    // A nested duplicate closes first, but the browser still resolves the outer element.
    const nested = wrap(`<defs><g id='b0'><path d='M0 0h1v1z'/></g><g id='b1'>${"<use href='#b0'/>".repeat(80)}<g id='b1'/></g><g id='b2'>${"<use href='#b1'/>".repeat(80)}</g></defs><use href='#b2'/>`);

    expect(sanitizeSvg(decoyed, true)).toBeUndefined();
    expect(sanitizeSvg(nested, true)).toBeUndefined();
  });

  it('bounds what each filter costs: octaves, blur, region, and animated filter values', () => {
    const svg = sanitizeSvg(wrap(
      "<filter id='f' x='-5000%' y='-5000%' width='10000%' height='10000%' filterUnits='userSpaceOnUse' primitiveUnits='objectBoundingBox'>"
      + "<feTurbulence numOctaves='1000' baseFrequency='0.9'><animate attributeName='baseFrequency' values='0.1;9;0.1' dur='8s'/></feTurbulence>"
      + "<feGaussianBlur stdDeviation='100000'><animate attributeName='stdDeviation' values='1;100000;1' dur='8s'/></feGaussianBlur>"
      + "<feGaussianBlur stdDeviation='4 8'/></filter><rect width='100' height='200' filter='url(#f)'/>",
    ), true) ?? '';

    expect(svg).toContain('<filter id="f"><feTurbulence baseFrequency="0.9"></feTurbulence><feGaussianBlur></feGaussianBlur><feGaussianBlur stdDeviation="4 8"/></filter>');
    expect(sanitizeSvg(wrap("<filter id='f'><feTurbulence numOctaves='4'/></filter>"), true)).toContain('numOctaves="4"');
  });

  it('refuses drawings that run more filter passes than a backdrop can afford, and keeps ordinary filtered art', () => {
    const heavy = "<filter id='f'><feTurbulence numOctaves='4'/><feDisplacementMap in='SourceGraphic' scale='9'/><feGaussianBlur stdDeviation='3'/></filter>";
    const crowded = wrap(`<defs>${heavy}</defs>${"<rect width='9' height='9' filter='url(#f)'/>".repeat(60)}`);
    const painted = wrap(`<defs>${heavy}</defs><g filter='url(#f)'>${"<path d='M0 0q5 5 0 10z'/>".repeat(40)}</g>`);

    expect(sanitizeSvg(crowded, true)).toBeUndefined();
    expect(sanitizeSvg(painted, true)).toContain('<g filter="url(#f)">');
  });
});
