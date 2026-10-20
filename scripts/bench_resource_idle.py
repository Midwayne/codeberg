"""Measure idle worker residency with a deterministic 64 MiB embedding fixture.

Usage: python3 scripts/bench_resource_idle.py /path/to/cberg-index --trials 5
This tests process lifecycle, not inference speed or real-model memory usage.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

WORKER = '''import os, struct, sys
from pathlib import Path
memory = bytearray(64 * 1024 * 1024)
for i in range(0, len(memory), 4096): memory[i] = 1
Path(os.environ["BENCH_WORKER_PID"]).write_text(str(os.getpid()))
sys.stdout.buffer.write(b"READY 3\\n")
sys.stdout.buffer.flush()
while header := sys.stdin.buffer.read(4):
    count = struct.unpack("=I", header)[0]
    for _ in range(count):
        length = struct.unpack("=I", sys.stdin.buffer.read(4))[0]
        sys.stdin.buffer.read(length)
        sys.stdout.buffer.write(struct.pack("=3f", 1, 0, 0))
    sys.stdout.buffer.flush()
'''


def rss(pid):
    result = subprocess.run(["ps", "-p", str(pid), "-o", "rss="], capture_output=True, text=True)
    return int(result.stdout.strip() or "0") * 1024


def request(path, command):
    with socket.socket(socket.AF_UNIX) as sock:
        sock.settimeout(2)
        sock.connect(str(path))
        sock.sendall(command.encode() + b"\n")
        response = b""
        while b"\n" not in response:
            part = sock.recv(65536)
            if not part:
                raise RuntimeError("short IPC response")
            response += part
        return json.loads(response)


def trial(binary):
    # Short paths keep Unix sockets within the macOS sockaddr_un limit.
    with tempfile.TemporaryDirectory(prefix="cberg-idle-", dir="/tmp") as temporary:
        work = Path(temporary)
        root = work / "repo"
        root.mkdir()
        (root / "main.go").write_text("package main\nfunc Example() {}\n")
        (work / "model").touch()
        (work / "worker.py").write_text(WORKER)
        env = dict(os.environ, CODEBERG_ROOTS=f"repo\t{root}", CBERG_MODEL=str(work / "model"),
                   CBERG_INDEX_PATH=str(work / "index"), CBERG_SOCKET=str(work / "sock"),
                   CBERG_EMBED_BACKEND="llama", CBERG_EMBED_WORKER=str(work / "worker.py"),
                   CBERG_EMBED_PYTHON=sys.executable, CBERG_EMBED_IDLE_SECONDS="1",
                   CBERG_POLL_MS="50", BENCH_WORKER_PID=str(work / "pid"))
        with (work / "log").open("w") as log:
            process = subprocess.Popen([binary], env=env, stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    try:
                        if request(work / "sock.health", "status").get("ready"):
                            break
                    except (OSError, ValueError):
                        pass
                    if process.poll() is not None:
                        raise RuntimeError((work / "log").read_text())
                    time.sleep(0.02)
                else:
                    raise RuntimeError("indexer not ready")

                pid = int((work / "pid").read_text())
                before = rss(pid)
                indexer_before = rss(process.pid)
                time.sleep(1.3)
                after = rss(pid)
                indexer_after = rss(process.pid)
                start = time.perf_counter()
                response = request(work / "sock", "search\tExample\t1\trepo")
                elapsed = (time.perf_counter() - start) * 1000
                if not response.get("ok"):
                    raise RuntimeError(response)
                return {"workerBeforeBytes": before, "workerIdleBytes": after,
                        "totalBeforeBytes": before + indexer_before,
                        "totalIdleBytes": after + indexer_after,
                        "workerRestarted": int((work / "pid").read_text()) != pid,
                        "firstQueryMs": elapsed}
            finally:
                process.terminate()
                process.wait(timeout=10)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("indexer")
    parser.add_argument("--trials", type=int, default=5)
    args = parser.parse_args()
    for _ in range(args.trials):
        print(json.dumps(trial(str(Path(args.indexer).resolve()))), flush=True)
