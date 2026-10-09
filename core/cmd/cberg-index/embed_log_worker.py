"""Test embed worker: records every text it embeds to $CBERG_TEST_EMBED_LOG.

Each record is "<byte length>\\n<text bytes>\\n" so the C test can replay the
exact bodies the indexer sent, including embedded newlines. When
$CBERG_TEST_EMBED_CALLS is set, each call appends one "<texts> <long texts>"
line, where long texts are at least 1024 bytes. Texts mentioning "Shared" embed to (0, 0, 1) so a search for "Shared" can
prove every duplicate kept the right vector; everything else is (len, 1, 1).
"""

import os
import struct
import sys

log = open(os.environ["CBERG_TEST_EMBED_LOG"], "ab", buffering=0)
calls_path = os.environ.get("CBERG_TEST_EMBED_CALLS")
calls = open(calls_path, "ab", buffering=0) if calls_path else None

sys.stdout.buffer.write(b"READY 3\n")
sys.stdout.buffer.flush()


def exact(n):
    data = sys.stdin.buffer.read(n)
    if len(data) != n:
        raise EOFError()
    return data


def vector(text):
    if b"Shared" in text:
        return (0.0, 0.0, 1.0)
    return (float(len(text)), 1.0, 1.0)


while header := sys.stdin.buffer.read(4):
    count = struct.unpack("=I", header)[0]
    long_texts = 0
    for _ in range(count):
        size = struct.unpack("=I", exact(4))[0]
        text = exact(size)
        long_texts += size >= 1024
        log.write(b"%d\n" % size + text + b"\n")
        sys.stdout.buffer.write(struct.pack("=3f", *vector(text)))
    if calls is not None:
        calls.write(b"%d %d\n" % (count, long_texts))
    sys.stdout.buffer.flush()
