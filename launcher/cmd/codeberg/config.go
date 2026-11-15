package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"codeberg.org/codeberg/launcher/internal/config"
)

// cmdConfig handles `codeberg config [sub] [flags] [args]`.
func cmdConfig(args []string) error {
	sub := ""
	if len(args) > 0 && !isFlag(args[0]) {
		sub, args = args[0], args[1:]
	}

	rest, c, err := loadConfigSub(args)
	if err != nil {
		return err
	}

	switch sub {
	case "":
		fmt.Print(c.Summary())
		return nil
	case "path":
		fmt.Println(c.ConfigPath)
		return nil
	case "init":
		return configInit(c)
	case "edit":
		return configEdit(c)
	case "get":
		return configGet(c, rest)
	case "set":
		return configSet(c, rest)
	case "unset":
		return configUnset(c, rest)
	default:
		return fmt.Errorf("unknown config subcommand %q (try: path, init, edit, get, set, unset)", sub)
	}
}

func configInit(c *config.Config) error {
	created, err := config.InitFile(c.ConfigPath)
	if err != nil {
		return err
	}
	reportStarterFile(c.ConfigPath, created, "run `codeberg` and add a project in the browser")

	created, err = config.InitMcpFile(mcpConfigPath(c))
	if err != nil {
		return err
	}
	reportStarterFile(mcpConfigPath(c), created, "add MCP servers (Cursor-compatible mcpServers JSON)")

	return nil
}

func reportStarterFile(path string, created bool, nextStep string) {
	if created {
		fmt.Printf("wrote %s — %s\n", path, nextStep)
	} else {
		fmt.Printf("%s already exists (not overwritten)\n", path)
	}
}

func configEdit(c *config.Config) error {
	if _, err := config.InitFile(c.ConfigPath); err != nil {
		return err
	}

	return openEditor(c.ConfigPath)
}

func configGet(c *config.Config, keys []string) error {
	if len(keys) != 1 {
		return fmt.Errorf("usage: codeberg config get KEY")
	}

	value, ok := c.Get(keys[0])
	if !ok {
		return fmt.Errorf("unknown key %q (see `codeberg config` for known keys)", keys[0])
	}

	fmt.Println(value)
	return nil
}

func configSet(c *config.Config, pairs []string) error {
	if len(pairs) == 0 {
		return fmt.Errorf("usage: codeberg config set KEY=VALUE [KEY=VALUE ...]")
	}

	values := map[string]string{}
	for _, pair := range pairs {
		key, value, found := strings.Cut(pair, "=")
		if !found || key == "" {
			return fmt.Errorf("expected KEY=VALUE, got %q", pair)
		}

		if !config.IsKnownKey(key) {
			fmt.Fprintf(os.Stderr, "warning: %q is not a key codeberg reads (writing it anyway)\n", key)
		}
		values[key] = value
	}

	if err := config.SetValues(c.ConfigPath, values); err != nil {
		return err
	}

	fmt.Printf("updated %s (%d key(s)); applies on the next `codeberg` run\n", c.ConfigPath, len(values))
	return nil
}

func configUnset(c *config.Config, keys []string) error {
	if len(keys) == 0 {
		return fmt.Errorf("usage: codeberg config unset KEY [KEY ...]")
	}

	if err := config.UnsetValues(c.ConfigPath, keys); err != nil {
		return err
	}

	fmt.Printf("removed %d key(s) from %s\n", len(keys), c.ConfigPath)
	return nil
}

// openEditor opens path in $VISUAL/$EDITOR (falling back to vi), inheriting the
// terminal so the user can edit interactively.
func openEditor(path string) error {
	editor := "vi"
	for _, name := range []string{"VISUAL", "EDITOR"} {
		if value := os.Getenv(name); value != "" {
			editor = value
			break
		}
	}

	parts := strings.Fields(editor) // allow e.g. EDITOR="code -w"
	parts = append(parts, path)

	cmd := exec.Command(parts[0], parts[1:]...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	return cmd.Run()
}
