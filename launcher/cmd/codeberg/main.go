// Command codeberg is the one-shot launcher for the code-search stack. It loads
// config, makes sure the core, daemon, and agent are built (and the embedding
// model downloaded), starts the daemon (which brings up the C indexer), waits
// for it to be healthy, and opens the browser agent.
//
//	codeberg                 boot everything and open the browser chat
//	codeberg build           (re)build/download the components and model
//	codeberg doctor          check toolchains, binaries, and resolved config
//	codeberg config [init]   print resolved config, or write a template file
//	codeberg version
//
// It is a standalone wrapper: it talks to core/daemon/agent only as
// subprocesses and over HTTP, never as imported code.
package main

import (
	"fmt"
	"os"
)

var version = "dev"

func main() {
	if err := dispatch(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "codeberg: "+err.Error())
		os.Exit(1)
	}
}

func dispatch(args []string) error {
	cmd := "run"
	if len(args) > 0 && !isFlag(args[0]) {
		cmd, args = args[0], args[1:]
	}
	switch cmd {
	case "run":
		return cmdRun(args)
	case "build":
		return cmdBuild(args)
	case "doctor":
		return cmdDoctor(args)
	case "config":
		return cmdConfig(args)
	case "clean-index", "clean":
		return cmdCleanIndex(args)
	case "repos":
		return cmdRepos(args)
	case "learning":
		return cmdLearning(args)
	case "uninstall":
		return cmdUninstall(args)
	case "version", "--version", "-v":
		fmt.Println("codeberg " + version)
		return nil
	case "help", "-h", "--help":
		usage(os.Stdout)
		return nil
	default:
		// `codeberg <dir>` runs against that directory, like `--root <dir>`.
		if fi, err := os.Stat(cmd); err == nil && fi.IsDir() {
			return cmdRun(append([]string{"--root", cmd}, args...))
		}
		usage(os.Stderr)
		return fmt.Errorf("unknown command %q", cmd)
	}
}

func isFlag(s string) bool { return len(s) > 0 && s[0] == '-' }
