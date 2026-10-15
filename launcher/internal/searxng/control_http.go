package searxng

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// ControlServer is a private loopback bridge for the browser server. Its random
// bearer token is passed only through the child process environment.
type ControlServer struct {
	URL        string
	Token      string
	server     *http.Server
	controller *Controller
}

func ListenControl(controller *Controller) (*ControlServer, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}

	control := &ControlServer{URL: "http://" + listener.Addr().String(),
		Token: hex.EncodeToString(secret), controller: controller}
	control.server = &http.Server{Handler: http.HandlerFunc(control.handle), ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = control.server.Serve(listener) }()

	return control, nil
}

func (c *ControlServer) Close() {
	_ = c.server.Close()
	c.controller.Close()
}

func (c *ControlServer) handle(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if r.Header.Get("Origin") != "" || subtle.ConstantTimeCompare([]byte(token), []byte(c.Token)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)

		return
	}
	if r.URL.Path != "/" {
		http.NotFound(w, r)

		return
	}
	status := c.controller.Current()
	if r.Method == http.MethodPut {
		enabled, valid := readControlEnabled(w, r)
		if !valid {
			http.Error(w, "enabled must be a boolean", http.StatusBadRequest)

			return
		}
		status = c.controller.Configure(enabled)
	} else if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)

		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(status)
}

func readControlEnabled(w http.ResponseWriter, r *http.Request) (bool, bool) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return false, false
	}
	var input struct {
		Enabled *bool `json:"enabled"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	if decoder.Decode(&input) != nil || input.Enabled == nil {
		return false, false
	}
	if decoder.Decode(new(any)) != io.EOF {
		return false, false
	}

	return *input.Enabled, true
}
