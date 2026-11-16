package deps

import (
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
)

func warnMissing(w io.Writer, r requirement) {
	msg := "⚠ " + r.label + " not found"
	if r.note != "" {
		msg += " — " + r.note
	}
	fmt.Fprintln(w, msg)
}

func blockingErr(pm *pkgManager, autoInstall bool, missing []requirement) error {
	var b strings.Builder
	b.WriteString("missing build prerequisites:\n")
	for _, r := range missing {
		fmt.Fprintf(&b, "  • %s", r.label)
		if r.label == "node" {
			if node, err := exec.LookPath("node"); err == nil {
				if reason := CheckNode(node); reason != nil {
					fmt.Fprintf(&b, " — %v", reason)
					b.WriteByte('\n')
					continue
				}
			}
		}
		if cmd := manualInstall(pm, r); cmd != "" {
			fmt.Fprintf(&b, " — install with: %s", cmd)
		} else if r.note != "" {
			fmt.Fprintf(&b, " — %s", r.note)
		}
		b.WriteByte('\n')
	}
	switch {
	case pm == nil:
		b.WriteString("no supported package manager (brew/apt-get) found to auto-install them")
	case !autoInstall:
		b.WriteString("auto-install is off (CODEBERG_SKIP_DEP_INSTALL); install the above and re-run")
	default:
		b.WriteString("auto-install could not satisfy them; install manually and re-run")
	}
	return errors.New(b.String())
}
