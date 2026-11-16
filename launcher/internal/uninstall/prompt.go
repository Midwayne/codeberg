package uninstall

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// prompter asks yes/no questions; it answers No when stdin is not a terminal.
type prompter struct {
	r         *bufio.Reader
	assumeYes bool
}

func (p *prompter) confirm(question string) bool {
	if p.assumeYes {
		fmt.Printf("%s [y/N] y (--yes)\n", question)
		return true
	}
	if !stdinIsTTY() {
		fmt.Printf("%s [y/N] n (non-interactive)\n", question)
		return false
	}
	fmt.Printf("%s [y/N] ", question)
	line, _ := p.r.ReadString('\n')
	return isYes(line)
}

func isYes(line string) bool {
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "y", "yes":
		return true
	}
	return false
}

func stdinIsTTY() bool {
	fi, err := os.Stdin.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}
