// Package sizelint enforces the daemon's physical line limits on Go syntax.
package sizelint

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// Limits count comments and blank lines, matching the agent's ESLint rules.
type Limits struct {
	MaxFileLines     int `json:"maxFileLines"`
	MaxFunctionLines int `json:"maxFunctionLines"`
}

func LoadLimits(path string) (Limits, error) {
	file, err := os.Open(path)
	if err != nil {
		return Limits{}, err
	}

	defer file.Close()

	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	var limits Limits
	if err := decoder.Decode(&limits); err != nil {
		return Limits{}, err
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		return Limits{}, fmt.Errorf("%s: expected a single configuration object", path)
	}

	if limits.MaxFileLines <= 0 || limits.MaxFunctionLines <= 0 {
		return Limits{}, fmt.Errorf("%s: line limits must be positive", path)
	}

	return limits, nil
}
