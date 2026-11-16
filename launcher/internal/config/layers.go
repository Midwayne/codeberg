package config

import "os"

// layers resolves one setting across the three configured layers, highest
// precedence first: CLI flag, environment, config file. Built-in defaults are
// applied by the caller.
type layers struct {
	file map[string]string
}

// value returns the setting for key; cli is the flag's value, "" when the
// flag was not given (or the key has no flag).
func (l layers) value(key, cli string) string {
	if cli != "" {
		return cli
	}

	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}

	return l.file[key]
}

// valueOr is value with a built-in default.
func (l layers) valueOr(key, cli, fallback string) string {
	return firstNonEmpty(l.value(key, cli), fallback)
}

// enabled resolves an on/off setting. A given flag wins; otherwise any
// env/file value other than false/0/no/off turns it on; unset keeps fallback.
func (l layers) enabled(key string, cli *bool, fallback bool) bool {
	if cli != nil {
		return *cli
	}

	if v := l.value(key, ""); v != "" {
		return !isFalsey(v)
	}

	return fallback
}
