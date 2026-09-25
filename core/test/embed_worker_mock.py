import struct
import sys

sys.stdout.buffer.write(b"READY 3\n")
sys.stdout.buffer.flush()


def exact(n):
    data = sys.stdin.buffer.read(n)
    if len(data) != n:
        raise EOFError()
    return data


while header := sys.stdin.buffer.read(4):
    count = struct.unpack("=I", header)[0]
    for _ in range(count):
        size = struct.unpack("=I", exact(4))[0]
        text = exact(size)
        sys.stdout.buffer.write(struct.pack("=3f", float(len(text)), 0.0, 1.0))
    sys.stdout.buffer.flush()
