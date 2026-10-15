#!/usr/bin/env python3
"""Bundle non-system shared libraries and rewrite loader paths for a release."""

from pathlib import Path
import os
import re
import shutil
import subprocess
import sys


def output(*args):
    return subprocess.check_output(args, text=True)


def dependencies(binary):
    if sys.platform == "darwin":
        names = [line.strip().split(" (compatibility")[0]
                 for line in output("otool", "-L", str(binary)).splitlines()[1:]]
        identities = output("otool", "-D", str(binary)).splitlines()[1:]
        names = [name for name in names if name not in identities]
        commands = output("otool", "-l", str(binary))
        rpaths = re.findall(r"cmd LC_RPATH\n.*?\n\s*path (.*?) \(offset", commands)
        return [(name, resolve_macos(name, binary, rpaths)) for name in names]

    lines = output("ldd", str(binary)).splitlines()
    if any("not found" in line for line in lines):
        raise RuntimeError(f"unresolved library for {binary}: {lines}")

    return [(match[1], Path(match[2])) for line in lines
            if (match := re.match(r"\s*(\S+) => (/\S+) ", line))]


def resolve_macos(name, binary, rpaths):
    if name.startswith("/"):
        return Path(name)

    def expand(path):
        return path.replace("@loader_path", str(binary.parent)).replace(
            "@executable_path", str(binary.parent))

    if name.startswith("@rpath/"):
        for prefix in rpaths:
            candidate = Path(expand(name.replace("@rpath", prefix, 1)))
            if candidate.exists():
                return candidate

        raise RuntimeError(f"cannot resolve {name} for {binary}")

    candidate = Path(expand(name))
    if not candidate.exists():
        raise RuntimeError(f"cannot resolve {name} for {binary}")

    return candidate


def is_system(path):
    if sys.platform == "darwin":
        return str(path).startswith(("/usr/lib/", "/System/Library/"))

    # Keep the target's glibc and loader together. Everything else (including
    # libstdc++, libcurl, libpq and their dependencies) travels with the bundle.
    return bool(re.match(r"lib(c|m|pthread|dl|rt|resolv|util|anl)\.so\.", path.name)
                or path.name.startswith("ld-linux"))


def bundle(root):
    library_dir = root / "libexec" / "lib"
    library_dir.mkdir(parents=True, exist_ok=True)
    binaries = [root / "libexec/core/build/bin/cberg-index",
                root / "libexec/runtime/bin/rg", root / "libexec/runtime/bin/node"]
    queue = binaries.copy()
    resolved = {}
    libraries = {}
    while queue:
        binary = queue.pop()
        if binary in resolved:
            continue

        resolved[binary] = [(name, path) for name, path in dependencies(binary)
                            if not is_system(path)]
        for _, path in resolved[binary]:
            if path.name in libraries and path.resolve() != libraries[path.name].resolve():
                raise RuntimeError(f"conflicting library name: {path}")

            libraries[path.name] = path
            queue.append(path)

    for name, source in libraries.items():
        shutil.copy2(source, library_dir / name)
        (library_dir / name).chmod(0o755)

    for original, deps in resolved.items():
        target = original if original in binaries else library_dir / original.name
        relative = os.path.relpath(library_dir, target.parent)
        if sys.platform == "darwin":
            for name, path in deps:
                replacement = f"@loader_path/{relative}/{path.name}"
                subprocess.run(["install_name_tool", "-change", name, replacement, str(target)], check=True)

            if deps or original not in binaries:
                subprocess.run(["codesign", "--force", "--sign", "-", str(target)], check=True)
        else:
            subprocess.run(["patchelf", "--set-rpath", f"$ORIGIN/{relative}", str(target)], check=True)


if __name__ == "__main__":
    bundle(Path(sys.argv[1]).resolve())
