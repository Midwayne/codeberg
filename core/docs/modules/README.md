# Implementation modules

Internal source layout under `src/`. Each document lists **every function** in that
module (public wrappers and `static` helpers).

| Module | Sources | Documentation |
|--------|---------|---------------|
| Common | `arena`, `config`, `hash`, `lang`, `pathutil`, `status`, `version` | [common.md](common.md) |
| Chunk | `chunker`, `chunk_table` | [chunk.md](chunk.md) |
| Watch | `watch` | [watch.md](watch.md) |
| Embed | `embed`, `embed_onnx`, `tokenize` | [embed.md](embed.md) |
| Search | `index`, `search` | [search.md](search.md) |

Public symbols re-exported through `codeberg.h` are also summarized in [../API.md](../API.md).
