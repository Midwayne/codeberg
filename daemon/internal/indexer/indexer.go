package indexer

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"

	"codeberg.org/codeberg/daemon/internal/cberg"
	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/walk"
)

type Indexer struct {
	mu      sync.RWMutex
	ready   atomic.Bool
	cfg     config.Indexer
	root    string
	chunker *cberg.Chunker
	table   *cberg.ChunkTable
	watcher *cberg.Watcher
	embed   *cberg.Embedder
	index   *cberg.Index
}

func Open(cfg config.Indexer) (*Indexer, error) {
	chunker, err := cberg.OpenChunker()
	if err != nil {
		return nil, err
	}
	table := cberg.NewChunkTable()
	watcher, err := cberg.OpenWatcher(cfg.Root)
	if err != nil {
		chunker.Close()
		table.Close()
		return nil, err
	}
	idx := &Indexer{cfg: cfg, root: cfg.Root, chunker: chunker, table: table, watcher: watcher}
	if cfg.Vectors {
		embed, err := cberg.OpenEmbedder(cfg.Model)
		if err != nil {
			idx.Close()
			return nil, err
		}
		index, err := cberg.OpenIndex(cfg.Index, embed.Dim())
		if err != nil {
			embed.Close()
			idx.Close()
			return nil, err
		}
		idx.embed = embed
		idx.index = index
	}
	return idx, nil
}

func (idx *Indexer) Close() {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	if idx.index != nil {
		_ = idx.index.Save()
		idx.index.Close()
		idx.index = nil
	}
	if idx.embed != nil {
		idx.embed.Close()
		idx.embed = nil
	}
	if idx.watcher != nil {
		idx.watcher.Close()
		idx.watcher = nil
	}
	if idx.table != nil {
		idx.table.Close()
		idx.table = nil
	}
	if idx.chunker != nil {
		idx.chunker.Close()
		idx.chunker = nil
	}
}

func (idx *Indexer) Bootstrap(ctx context.Context) error {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	var lists []*cberg.ChunkList
	defer func() {
		for _, l := range lists {
			l.Close()
		}
	}()

	batch := cberg.NewChunkBatch()
	err := walk.Files(idx.root, func(abs, rel string) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		list, err := idx.chunkFile(abs, rel)
		if err != nil {
			return err
		}
		if list == nil {
			return nil
		}
		lists = append(lists, list)
		batch.AddList(list)
		return nil
	})
	if err != nil {
		return err
	}
	changes, err := idx.table.SyncBatch(batch)
	if err != nil {
		return err
	}
	if err := idx.applyVectors(changes); err != nil {
		if err2 := idx.reconcileVectors(); err2 != nil {
			return fmt.Errorf("apply vectors: %w; reconcile: %w", err, err2)
		}
	}
	idx.ready.Store(true)
	return nil
}

func (idx *Indexer) Run(ctx context.Context) error {
	pollMs := int(idx.cfg.Poll / 1000000)
	if pollMs <= 0 {
		pollMs = 1000
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		events, err := idx.watcher.Poll(pollMs)
		if err != nil {
			return err
		}
		if len(events) == 0 {
			continue
		}
		rechunk := make(map[string]struct{})
		deleted := make(map[string]struct{})
		for _, ev := range events {
			if ev.Kind == cberg.WatchDelete {
				deleted[ev.Path] = struct{}{}
			} else {
				rechunk[ev.Path] = struct{}{}
			}
		}
		if err := idx.syncPaths(rechunk, deleted); err != nil {
			return err
		}
	}
}

func (idx *Indexer) Search(query string, k int) ([]cberg.SearchResult, error) {
	if !idx.ready.Load() {
		return nil, cberg.StatusNotFound
	}
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	if idx.embed == nil || idx.index == nil {
		return nil, cberg.StatusNotImplemented
	}
	return cberg.Search(idx.embed, idx.index, query, k)
}

func (idx *Indexer) chunkFile(abs, rel string) (*cberg.ChunkList, error) {
	data, err := os.ReadFile(abs)
	if err != nil {
		return nil, err
	}
	return idx.chunker.Parse(rel, data)
}

func (idx *Indexer) syncPaths(rechunk, deleted map[string]struct{}) error {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	var lists []*cberg.ChunkList
	defer func() {
		for _, l := range lists {
			l.Close()
		}
	}()

	skip := func(path string) bool {
		if _, ok := deleted[path]; ok {
			return true
		}
		if _, ok := rechunk[path]; ok {
			return true
		}
		return false
	}

	batch := cberg.NewChunkBatch()
	batch.AddTable(idx.table, skip)

	for rel := range rechunk {
		abs := filepath.Join(idx.root, rel)
		list, err := idx.chunkFile(abs, rel)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		if list == nil {
			continue
		}
		lists = append(lists, list)
		batch.AddList(list)
	}

	changes, err := idx.table.SyncBatch(batch)
	if err != nil {
		return err
	}
	if err := idx.applyVectors(changes); err != nil {
		return idx.reconcileVectors()
	}
	return nil
}

func (idx *Indexer) reconcileVectors() error {
	idx.ready.Store(false)
	if idx.embed == nil || idx.index == nil {
		return nil
	}
	if err := idx.index.Reload(); err != nil {
		return err
	}
	if err := idx.rebuildIndexFromTable(); err != nil {
		return err
	}
	idx.ready.Store(true)
	return nil
}

func (idx *Indexer) rebuildIndexFromTable() error {
	tempPath := idx.cfg.Index + ".rebuild"
	_ = os.Remove(tempPath)
	temp, err := cberg.OpenIndex(tempPath, idx.embed.Dim())
	if err != nil {
		return err
	}

	const batchSize = 32
	dim := idx.embed.Dim()
	build := func() error {
		for i := 0; i < idx.table.Len(); {
			end := i + batchSize
			if end > idx.table.Len() {
				end = idx.table.Len()
			}
			texts := make([]string, 0, end-i)
			ids := make([]uint64, 0, end-i)
			for j := i; j < end; j++ {
				sc, ok := idx.table.StoredAt(j)
				if !ok {
					continue
				}
				body, err := sc.Body(idx.root)
				if err != nil {
					return err
				}
				texts = append(texts, body)
				ids = append(ids, sc.ID)
			}
			if len(texts) > 0 {
				vecs, err := idx.embed.Embed(texts)
				if err != nil {
					return err
				}
				for k, id := range ids {
					if err := temp.Add(id, vecs[k*dim:(k+1)*dim]); err != nil {
						return err
					}
				}
			}
			i = end
		}
		return temp.Save()
	}

	buildErr := build()
	temp.Close()
	if buildErr != nil {
		_ = os.Remove(tempPath)
		return buildErr
	}
	if err := idx.index.ReplaceFile(tempPath); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	return nil
}

func (idx *Indexer) applyVectors(changes *cberg.Changes) error {
	if idx.embed == nil || idx.index == nil {
		return nil
	}

	upsert := append([]cberg.StoredChunk{}, changes.Added...)
	upsert = append(upsert, changes.Modified...)

	var vecs []float32
	dim := idx.embed.Dim()
	if len(upsert) > 0 {
		texts := make([]string, len(upsert))
		for i, sc := range upsert {
			body, err := sc.Body(idx.root)
			if err != nil {
				return err
			}
			texts[i] = body
		}
		var err error
		vecs, err = idx.embed.Embed(texts)
		if err != nil {
			return err
		}
	}

	for _, sc := range changes.Deleted {
		if err := idx.index.Remove(sc.ID); err != nil {
			return err
		}
	}
	for i, sc := range upsert {
		if err := idx.index.Add(sc.ID, vecs[i*dim:(i+1)*dim]); err != nil {
			return err
		}
	}
	return idx.index.Save()
}
