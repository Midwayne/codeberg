package run

import (
	"net"
	"os/exec"
	"runtime"
	"time"
)

// openBrowserWhenReady polls the local web port until it accepts a connection
// (or a short deadline passes), then opens the default browser at that URL. It
// is best effort: any failure just leaves the user to open the URL themselves.
func openBrowserWhenReady(port string) {
	addr := net.JoinHostPort("127.0.0.1", port)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 500*time.Millisecond)
		if err == nil {
			conn.Close()
			openBrowser("http://" + addr)
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// openBrowser launches the platform's default handler for url, detached, and
// ignores the result — codeberg keeps running whether or not a browser opens.
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default: // linux, *bsd
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}
