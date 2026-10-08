package indexctl

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"
)

// IPC responses are newline-delimited JSON. Search batches and chunk bodies
// routinely exceed Scanner's 64 KiB token limit; bound the whole reply instead.
const maxResponseBytes = 16 * 1024 * 1024

func roundTrip(ctx context.Context, socket, req string, dest any) error {
	release, err := acquireSlot(ctx, socket)
	if err != nil {
		return err
	}

	defer release()

	conn, err := dialIndexer(ctx, socket)
	if err != nil {
		return fmt.Errorf("indexer connect: %w", err)
	}

	defer conn.Close()

	deadline, ok := ctx.Deadline()
	if !ok {
		deadline = time.Now().Add(30 * time.Second)
	}

	if err := conn.SetDeadline(deadline); err != nil {
		return fmt.Errorf("indexer deadline: %w", err)
	}

	if _, err := conn.Write([]byte(req + "\n")); err != nil {
		return fmt.Errorf("indexer write: %w", err)
	}

	return readReply(conn, dest)
}

// readReply decodes one newline-terminated JSON reply, bounded in size.
func readReply(conn io.Reader, dest any) error {
	reader := bufio.NewReader(io.LimitReader(conn, maxResponseBytes+1))
	line, err := reader.ReadBytes('\n')
	if err != nil {
		if err == io.EOF && len(line) == 0 {
			return fmt.Errorf("indexer: empty response")
		}

		if err == io.EOF && len(line) >= maxResponseBytes+1 {
			return fmt.Errorf("indexer read: response exceeds %d bytes", maxResponseBytes)
		}
		return fmt.Errorf("indexer read: %w", err)
	}

	if len(line) > maxResponseBytes {
		return fmt.Errorf("indexer read: response exceeds %d bytes", maxResponseBytes)
	}

	if err := json.Unmarshal(line, dest); err != nil {
		return fmt.Errorf("indexer decode: %w", err)
	}

	return nil
}
