import { describe, expect, it } from 'vitest';

import { htmlToText } from './html.js';

describe('htmlToText', () => {
  it('extracts the title and strips script/style/markup', () => {
    const html = `
      <html><head><title>Docs &amp; Guides</title>
        <style>.x{color:red}</style>
      </head>
      <body>
        <script>console.log("nope")</script>
        <h1>Hello</h1>
        <p>First paragraph.</p>
        <p>Second &mdash; with an entity &#65;.</p>
      </body></html>`;
    const { title, text } = htmlToText(html);

    expect(title).toBe('Docs & Guides');
    expect(text).not.toContain('console.log');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('<');
    expect(text).toContain('Hello');
    expect(text).toContain('First paragraph.');
    expect(text).toContain('Second — with an entity A.');
  });

  it('turns block boundaries and <br> into newlines', () => {
    const { text } = htmlToText('<p>one</p><p>two</p><div>three<br>four</div>');
    expect(text.split('\n').filter(Boolean)).toEqual(['one', 'two', 'three', 'four']);
  });

  it('collapses excess whitespace and caps blank lines', () => {
    const { text } = htmlToText('<p>a   b\t\tc</p>\n\n\n<p>d</p>');
    expect(text).toBe('a b c\n\nd');
  });

  it('prefers <main> content and drops surrounding chrome', () => {
    const { text } = htmlToText(
      '<body><nav>Home About</nav><main><p>real content</p></main><footer>copyright</footer></body>',
    );
    expect(text).toContain('real content');
    expect(text).not.toContain('Home About');
    expect(text).not.toContain('copyright');
  });

  it("falls back to the largest <article> when there's no <main>", () => {
    const { text } = htmlToText(
      '<article>tiny</article><article><p>the long article body here</p></article>',
    );
    expect(text).toContain('the long article body here');
    expect(text).not.toContain('tiny');
  });

  it("strips nav/header/footer when there's no main or article", () => {
    const { text } = htmlToText(
      '<header>site nav</header><div><p>body text</p></div><footer>legal</footer>',
    );
    expect(text).toBe('body text');
  });
});
