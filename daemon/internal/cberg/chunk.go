package cberg

/*
#include <codeberg/codeberg.h>
*/
import "C"

import (
	"os"
	"path/filepath"
	"unsafe"
)

type Chunker struct {
	ch *C.cberg_chunker
}

func OpenChunker() (*Chunker, error) {
	var ch *C.cberg_chunker
	if err := Statusf(C.cberg_chunker_open(&ch), "chunker open"); err != nil {
		return nil, err
	}
	return &Chunker{ch: ch}, nil
}

func (c *Chunker) Close() {
	if c == nil || c.ch == nil {
		return
	}
	C.cberg_chunker_close(c.ch)
	c.ch = nil
}

type ChunkList struct {
	list *C.cberg_chunk_list
}

func (c *Chunker) Parse(path string, src []byte) (*ChunkList, error) {
	cpath := cString(path)
	defer freeCString(cpath)
	lang := C.cberg_language_from_path(cpath)
	if lang == C.CBERG_LANG_UNKNOWN {
		return nil, nil
	}
	var out *C.cberg_chunk_list
	var srcPtr *C.char
	if len(src) > 0 {
		srcPtr = (*C.char)(unsafe.Pointer(&src[0]))
	}
	if err := Statusf(C.cberg_chunker_parse(c.ch, lang, cpath, srcPtr, C.size_t(len(src)), &out), "chunker parse"); err != nil {
		return nil, err
	}
	if out == nil {
		return nil, nil
	}
	if err := Statusf(C.cberg_chunk_list_hash_bodies(out, srcPtr, C.size_t(len(src))), "hash bodies"); err != nil {
		C.cberg_chunk_list_free(out)
		return nil, err
	}
	return &ChunkList{list: out}, nil
}

func (l *ChunkList) Close() {
	if l == nil || l.list == nil {
		return
	}
	C.cberg_chunk_list_free(l.list)
	l.list = nil
}

func (l *ChunkList) Len() int {
	if l == nil || l.list == nil {
		return 0
	}
	return int(C.cberg_chunk_list_len(l.list))
}

func (l *ChunkList) At(i int) C.cberg_chunk {
	return *C.cberg_chunk_list_at(l.list, C.size_t(i))
}

type ChunkTable struct {
	table *C.cberg_chunk_table
}

func NewChunkTable() *ChunkTable {
	return &ChunkTable{table: C.cberg_chunk_table_new()}
}

func (t *ChunkTable) Close() {
	if t == nil || t.table == nil {
		return
	}
	C.cberg_chunk_table_free(t.table)
	t.table = nil
}

func (t *ChunkTable) Len() int {
	return int(C.cberg_chunk_table_len(t.table))
}

func (t *ChunkTable) At(i int) *C.cberg_stored_chunk {
	return C.cberg_chunk_table_at(t.table, C.size_t(i))
}

func (t *ChunkTable) StoredAt(i int) (StoredChunk, bool) {
	sc := t.At(i)
	if sc == nil {
		return StoredChunk{}, false
	}
	return storedChunkFromC(*sc), true
}

type Changes struct {
	Added    []StoredChunk
	Modified []StoredChunk
	Deleted  []StoredChunk
}

type StoredChunk struct {
	ID        uint64
	Path      string
	StartByte int
	EndByte   int
}

func (sc StoredChunk) Body(root string) (string, error) {
	path := filepath.Join(root, sc.Path)
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	start, end := sc.StartByte, sc.EndByte
	if start < 0 || end > len(data) || start > end {
		return "", StatusInvalidArgument
	}
	return string(data[start:end]), nil
}

func storedChunkFromC(sc C.cberg_stored_chunk) StoredChunk {
	ch := sc.chunk
	return StoredChunk{
		ID:        uint64(sc.id),
		Path:      goString(ch.path),
		StartByte: int(ch.span.start_byte),
		EndByte:   int(ch.span.end_byte),
	}
}

func (t *ChunkTable) Sync(chunks []C.cberg_chunk) (*Changes, error) {
	var out C.cberg_changes
	var ptr *C.cberg_chunk
	if len(chunks) > 0 {
		ptr = &chunks[0]
	}
	if err := Statusf(C.cberg_chunk_table_sync(t.table, ptr, C.size_t(len(chunks)), &out), "chunk table sync"); err != nil {
		return nil, err
	}
	return readChanges(&out), nil
}

func readChanges(out *C.cberg_changes) *Changes {
	ch := &Changes{}
	if out.added_len > 0 {
		added := unsafe.Slice(out.added, int(out.added_len))
		for _, sc := range added {
			ch.Added = append(ch.Added, storedChunkFromC(sc))
		}
	}
	if out.modified_len > 0 {
		modified := unsafe.Slice(out.modified, int(out.modified_len))
		for _, sc := range modified {
			ch.Modified = append(ch.Modified, storedChunkFromC(sc))
		}
	}
	if out.deleted_len > 0 {
		deleted := unsafe.Slice(out.deleted, int(out.deleted_len))
		for _, sc := range deleted {
			ch.Deleted = append(ch.Deleted, storedChunkFromC(sc))
		}
	}
	return ch
}

func AppendListChunks(dst []C.cberg_chunk, l *ChunkList) []C.cberg_chunk {
	for i := 0; i < l.Len(); i++ {
		dst = append(dst, l.At(i))
	}
	return dst
}

func TableChunksExcept(table *ChunkTable, skip func(path string) bool) []C.cberg_chunk {
	var out []C.cberg_chunk
	for i := 0; i < table.Len(); i++ {
		sc := table.At(i)
		if sc == nil {
			continue
		}
		path := goString(sc.chunk.path)
		if skip(path) {
			continue
		}
		out = append(out, sc.chunk)
	}
	return out
}

type ChunkBatch struct {
	chunks []C.cberg_chunk
}

func NewChunkBatch() *ChunkBatch {
	return &ChunkBatch{}
}

func (b *ChunkBatch) AddList(l *ChunkList) {
	b.chunks = AppendListChunks(b.chunks, l)
}

func (b *ChunkBatch) AddTable(table *ChunkTable, skip func(path string) bool) {
	b.chunks = append(b.chunks, TableChunksExcept(table, skip)...)
}

func (t *ChunkTable) SyncBatch(b *ChunkBatch) (*Changes, error) {
	return t.Sync(b.chunks)
}
