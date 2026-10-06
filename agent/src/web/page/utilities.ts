export const PAGE_UTILITIES = `function renderHits(container, hits) {
  hits.forEach(function (h) {
    if (!h || !h.path) return;
    var lines = h.lines;
    if (!lines && h.start_line) {
      lines = h.start_line + "-" + (h.end_line || h.start_line);
    }
    var card = document.createElement("div");
    card.className = "hit";
    var hd = document.createElement("div");
    hd.className = "hit-hd";
    if (h.repo) { var repo = document.createElement("span"); repo.className = "hit-repo"; repo.textContent = h.repo; hd.appendChild(repo); }
    var path = document.createElement("span"); path.className = "hit-path"; path.textContent = h.path; hd.appendChild(path);
    if (lines) {
      var ln = document.createElement("span"); ln.className = "hit-lines";
      ln.textContent = ":" + lines;
      hd.appendChild(ln);
    }
    card.appendChild(hd);
    if (h.symbol) { var sym = document.createElement("div"); sym.className = "grep-line"; sym.textContent = h.symbol; card.appendChild(sym); }
    var snip = h.snippet || h.body;
    if (snip) { var pre = document.createElement("pre"); pre.className = "hit-snippet"; pre.textContent = snip; card.appendChild(pre); }
    container.appendChild(card);
  });
}

function pretty(v) {
  try { return typeof v === "string" ? v : JSON.stringify(v, null, 2); }
  catch (_) { return String(v); }
}
function uid() { return Math.random().toString(36).slice(2); }
function setBusy(b) { input.disabled = b; attach.disabled = b; form.querySelector('button[type="submit"]').disabled = b; }
`;
