package cleanindex

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// confirm asks a yes/no question; it answers No when stdin is not a terminal.
func confirm(question string, assumeYes bool) bool {
	if assumeYes {
		fmt.Printf("%s [y/N] y (--yes)\n", question)
		return true
	}
	if fi, err := os.Stdin.Stat(); err != nil || fi.Mode()&os.ModeCharDevice == 0 {
		fmt.Printf("%s [y/N] n (non-interactive)\n", question)
		return false
	}
	fmt.Printf("%s [y/N] ", question)
	line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "y", "yes":
		return true
	}
	return false
}

// human renders a byte count compactly.
func human(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for x := n / unit; x >= unit; x /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}
