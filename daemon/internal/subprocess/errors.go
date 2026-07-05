package subprocess

import "errors"

var (
	ErrInvalid = errors.New("codeberg: invalid pipeline argument")
	ErrUnsafe  = errors.New("codeberg: pipeline command is not allowed")
)
