"""Test embed worker: records every text it embeds to $CBERG_TEST_EMBED_LOG.

Each record is "<byte length>\\n<text bytes>\\n" so the C test can replay the
exact bodies the indexer sent, including embedded newlines.
"""

import os
import struct
import sys

log = open(os.environ["CBERG_TEST_EMBED_LOG"], "ab", buffering=0)

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
        log.write(b"%d\n" % size + text + b"\n")
        sys.stdout.buffer.write(struct.pack("=3f", float(len(text)), 1.0, 1.0))
    sys.stdout.buffer.flush()
