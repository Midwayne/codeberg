package httpserver

import "encoding/json"

type toolCallRequest struct {
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}
