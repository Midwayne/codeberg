package indexctl

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"time"
)

func roundTrip(ctx context.Context, socket, req string, dest any) error {
	d := net.Dialer{Timeout: 5 * time.Second}
	conn, err := d.DialContext(ctx, "unix", socket)
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

	sc := bufio.NewScanner(conn)
	if !sc.Scan() {
		if err := sc.Err(); err != nil {
			return fmt.Errorf("indexer read: %w", err)
		}
		return fmt.Errorf("indexer: empty response")
	}
	if err := json.Unmarshal(sc.Bytes(), dest); err != nil {
		return fmt.Errorf("indexer decode: %w", err)
	}

	return sc.Err()
}
