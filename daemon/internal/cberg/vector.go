package cberg

/*
#include <codeberg/codeberg.h>
*/
import "C"

import (
	"os"
	"unsafe"
)

type Embedder struct {
	emb *C.cberg_embedder
	dim int
}

func OpenEmbedder(modelPath string) (*Embedder, error) {
	cpath := cString(modelPath)
	defer freeCString(cpath)
	cfg := C.cberg_embed_config{
		provider:    C.CBERG_EMBED_ONNX,
		model_path:  cpath,
		num_threads: 0,
	}
	var emb *C.cberg_embedder
	if err := Statusf(C.cberg_embedder_open(&cfg, &emb), "embedder open"); err != nil {
		return nil, err
	}
	return &Embedder{emb: emb, dim: int(C.cberg_embedder_dim(emb))}, nil
}

func (e *Embedder) Close() {
	if e == nil || e.emb == nil {
		return
	}
	C.cberg_embedder_close(e.emb)
	e.emb = nil
}

func (e *Embedder) Dim() int {
	return e.dim
}

func (e *Embedder) Embed(texts []string) ([]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}
	cstrs := make([]*C.char, len(texts))
	lens := make([]C.size_t, len(texts))
	for i, t := range texts {
		cstrs[i] = cString(t)
		lens[i] = C.size_t(len(t))
	}
	defer func() {
		for _, s := range cstrs {
			freeCString(s)
		}
	}()
	var vecs *C.float
	if err := Statusf(C.cberg_embedder_embed(e.emb, &cstrs[0], &lens[0], C.size_t(len(texts)), &vecs), "embed"); err != nil {
		return nil, err
	}
	defer C.cberg_vectors_free(vecs)
	n := len(texts) * e.dim
	out := make([]float32, n)
	slice := unsafe.Slice(vecs, n)
	for i := range out {
		out[i] = float32(slice[i])
	}
	return out, nil
}

type Index struct {
	idx  *C.cberg_index
	path string
	dim  int
}

func OpenIndex(path string, dim int) (*Index, error) {
	cpath := cString(path)
	defer freeCString(cpath)
	var idx *C.cberg_index
	if err := Statusf(C.cberg_index_open(cpath, C.size_t(dim), nil, &idx), "index open"); err != nil {
		return nil, err
	}
	return &Index{idx: idx, path: path, dim: dim}, nil
}

func (i *Index) Close() {
	if i == nil || i.idx == nil {
		return
	}
	C.cberg_index_close(i.idx)
	i.idx = nil
}

func (i *Index) Add(id uint64, vector []float32) error {
	if len(vector) == 0 {
		return StatusInvalidArgument
	}
	return Statusf(C.cberg_index_add(i.idx, C.uint64_t(id), (*C.float)(unsafe.Pointer(&vector[0]))), "index add")
}

func (i *Index) Remove(id uint64) error {
	return Statusf(C.cberg_index_remove(i.idx, C.uint64_t(id)), "index remove")
}

func (i *Index) Save() error {
	return Statusf(C.cberg_index_save(i.idx), "index save")
}

func (i *Index) Reload() error {
	if i == nil || i.path == "" {
		return nil
	}
	path, dim := i.path, i.dim
	i.Close()
	reopened, err := OpenIndex(path, dim)
	if err != nil {
		return err
	}
	i.idx = reopened.idx
	i.path = reopened.path
	i.dim = reopened.dim
	reopened.idx = nil
	return nil
}

func (i *Index) ReplaceFile(stagedPath string) error {
	if i == nil || i.path == "" {
		return StatusInvalidArgument
	}
	live, dim := i.path, i.dim
	i.Close()
	if err := os.Rename(stagedPath, live); err != nil {
		reopened, reopenErr := OpenIndex(live, dim)
		if reopenErr == nil {
			i.idx = reopened.idx
			i.path = reopened.path
			i.dim = reopened.dim
			reopened.idx = nil
		}
		return err
	}
	reopened, err := OpenIndex(live, dim)
	if err != nil {
		return err
	}
	i.idx = reopened.idx
	i.path = reopened.path
	i.dim = reopened.dim
	reopened.idx = nil
	return nil
}

type SearchResult struct {
	ID    uint64
	Score float32
}

func Search(embedder *Embedder, index *Index, query string, k int) ([]SearchResult, error) {
	cquery := cString(query)
	defer freeCString(cquery)
	ids := make([]C.uint64_t, k)
	scores := make([]C.float, k)
	var found C.size_t
	if err := Statusf(C.cberg_search_query(embedder.emb, index.idx, cquery, C.size_t(len(query)), nil, C.size_t(k), &ids[0], &scores[0], &found), "search"); err != nil {
		return nil, err
	}
	out := make([]SearchResult, 0, int(found))
	for i := 0; i < int(found); i++ {
		out = append(out, SearchResult{ID: uint64(ids[i]), Score: float32(scores[i])})
	}
	return out, nil
}

func ResolveIndexRoot() (string, error) {
	buf := make([]byte, 4096)
	st := C.cberg_config_resolve_index_root((*C.char)(unsafe.Pointer(&buf[0])), C.size_t(len(buf)))
	if st == C.CBERG_ERR_NOT_FOUND {
		return "", StatusNotFound
	}
	if err := Statusf(st, "resolve index root"); err != nil {
		return "", err
	}
	n := 0
	for n < len(buf) && buf[n] != 0 {
		n++
	}
	return string(buf[:n]), nil
}
