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

	if _, err := conn.Write([]byte(req + "\n")); err != nil {
		return fmt.Errorf("indexer write: %w", err)
	}

	sc := bufio.NewScanner(conn)
	if !sc.Scan() {
		return fmt.Errorf("indexer: empty response")
	}
	if err := json.Unmarshal(sc.Bytes(), dest); err != nil {
		return fmt.Errorf("indexer decode: %w", err)
	}

	return sc.Err()
}
