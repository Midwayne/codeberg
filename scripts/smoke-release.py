#!/usr/bin/env python3
"""Start a relocated release with no system Node and no configured project/model."""

from pathlib import Path
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return str(sock.getsockname()[1])


def smoke(archive):
    with tempfile.TemporaryDirectory(prefix="codeberg smoke ") as work:
        root = Path(work)
        dist = root / "relocated"
        dist.mkdir()
        subprocess.run(["tar", "-xzf", archive, "-C", str(dist)], check=True)
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("CODEBERG_", "CBERG_", "ONNXRUNTIME", "DYLD_", "LD_"))}
        tools = root / "tools"
        tools.mkdir()
        for tool in ("open", "xdg-open"):
            path = tools / tool
            path.write_text("#!/bin/sh\nexit 0\n")
            path.chmod(0o755)

        env.update(HOME=str(root), PATH=f"{tools}:/usr/bin:/bin",
                   CODEBERG_WEB_USE="false", CODEBERG_MCP_USE="false")
        command = tools / "codeberg"
        command.symlink_to(dist / "bin/codeberg")
        node = dist / "libexec/runtime/bin/node"
        subprocess.run([node, "-e", "if (!AbortSignal.any) process.exit(1)"], env=env, check=True)
        subprocess.run([dist / "libexec/runtime/bin/rg", "--version"], env=env, check=True)
        port, web_port = free_port(), free_port()
        with (root / "startup.log").open("w+") as log:
            process = subprocess.Popen([
                command, "--no-vector", "--home", str(root / "data"),
                "--port", port, "--web-port", web_port,
            ], env=env, stdout=log, stderr=log)
            try:
                for _ in range(120):
                    if process.poll() is not None:
                        raise RuntimeError("launcher exited during startup")

                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{web_port}/docs", timeout=1) as response:
                            assert response.status == 200
                            assert b"<html" in response.read().lower()
                        print("Release smoke passed: docs work without a project or chat model")
                        return
                    except (urllib.error.URLError, TimeoutError):
                        time.sleep(0.5)

                raise RuntimeError("web UI startup timed out")
            except Exception:
                log.seek(0)
                print(log.read(), file=sys.stderr)
                raise
            finally:
                if process.poll() is None:
                    process.send_signal(signal.SIGTERM)
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()


if __name__ == "__main__":
    smoke(str(Path(sys.argv[1]).resolve()))
