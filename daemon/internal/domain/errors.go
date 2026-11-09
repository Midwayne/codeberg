package domain

import "errors"

// ErrEscape marks a path that would leave its repository root. File tools and
// pipeline validation both report it so clients see one FORBIDDEN error.
var ErrEscape = errors.New("codeberg: path escapes repo root")
