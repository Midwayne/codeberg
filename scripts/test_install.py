"""Exercise the installer offline, with release downloads served by a curl stub."""

import hashlib
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

INSTALLER = Path(__file__).resolve().parents[1] / "install.sh"


class InstallTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tools = self.root / "tools"
        self.tools.mkdir()
        self.assets = self.root / "assets"
        self.assets.mkdir()
        self.prefix = self.root / "install with spaces"
        self.bin = self.root / "bin"
        self.env = {
            **os.environ,
            "PATH": f"{self.tools}:/usr/bin:/bin",
            "HOME": str(self.root),
            "CODEBERG_VERSION": "v1.2.3",
            "CODEBERG_INSTALL_DIR": str(self.prefix),
            "CODEBERG_BIN_DIR": str(self.bin),
            "TEST_ASSETS": str(self.assets),
            "TEST_OS": "Linux",
            "TEST_ARCH": "x86_64",
        }
        self.tool("uname", '#!/bin/sh\ncase "$1" in -s) echo "$TEST_OS";; -m) echo "$TEST_ARCH";; esac\n')
        self.tool("curl", '''#!/bin/sh
while [ "$#" -gt 0 ]; do
    case "$1" in
        --write-out) printf "https://github.com/Midwayne/codeberg/releases/tag/v1.2.3"; exit 0 ;;
        -o) out="$2"; shift 2 ;;
        https://*) url="$1"; shift ;;
        *) shift ;;
    esac
done
cp "$TEST_ASSETS/${url##*/}" "$out"
''')
        self.archive()

    def tool(self, name, content):
        path = self.tools / name
        path.write_text(content)
        path.chmod(0o755)

    def archive(self, missing=None, platform="linux-x64"):
        asset = self.assets / f"codeberg-v1.2.3-{platform}.tar.gz"
        files = {
            "bin/codeberg": "#!/bin/sh\necho codeberg-test\n",
            "libexec/core/build/bin/codeberg-d": "binary",
            "libexec/core/build/bin/cberg-index": "binary",
            "libexec/agent/dist/web.js": "server",
            "libexec/agent/web-ui/dist/index.html": "ui",
            "libexec/runtime/bin/node": "node",
            "libexec/runtime/bin/rg": "rg",
        }
        with tarfile.open(asset, "w:gz") as archive:
            for name, value in files.items():
                if name == missing:
                    continue

                content = value.encode()
                info = tarfile.TarInfo(name)
                info.size = len(content)
                info.mode = 0o755
                archive.addfile(info, io.BytesIO(content))

        digest = hashlib.sha256(asset.read_bytes()).hexdigest()
        (self.assets / "SHA256SUMS").write_text(f"{digest}  {asset.name}\n")

    def install(self):
        return subprocess.run(["/bin/sh", str(INSTALLER)], env=self.env, capture_output=True, text=True)

    def test_install_and_upgrade_preserve_data(self):
        config = self.root / ".codeberg" / "config"
        config.parent.mkdir()
        config.write_text("existing config")
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        command = self.bin / "codeberg"
        first = command.resolve()
        self.assertEqual(subprocess.check_output([str(command)], text=True).strip(), "codeberg-test")
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotEqual(command.resolve(), first)
        self.assertTrue(first.exists())
        self.assertEqual(config.read_text(), "existing config")

    def test_bad_checksum_preserves_existing_command(self):
        self.assertEqual(self.install().returncode, 0)
        before = (self.bin / "codeberg").resolve()
        (self.assets / "SHA256SUMS").write_text("0" * 64 + "  codeberg-v1.2.3-linux-x64.tar.gz\n")
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum", result.stderr.lower())
        self.assertEqual((self.bin / "codeberg").resolve(), before)

    def test_incomplete_bundle_is_rejected(self):
        self.archive(missing="libexec/runtime/bin/node")
        self.assertNotEqual(self.install().returncode, 0)
        self.assertFalse((self.bin / "codeberg").exists())

    def test_unsupported_platform_is_rejected_before_download(self):
        self.tool("uname", "#!/bin/sh\necho Windows\n")
        self.assertNotEqual(self.install().returncode, 0)
        self.assertFalse(self.prefix.exists())

    def test_latest_release_is_resolved_and_pinned(self):
        self.env.pop("CODEBERG_VERSION")
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("v1.2.3-linux-x64", str((self.bin / "codeberg").resolve()))

    def test_both_mac_architectures(self):
        for machine, platform in [("arm64", "darwin-arm64"), ("x86_64", "darwin-x64")]:
            with self.subTest(machine=machine):
                self.env.update(TEST_OS="Darwin", TEST_ARCH=machine)
                self.archive(platform=platform)
                result = self.install()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(platform, str((self.bin / "codeberg").resolve()))

    def test_existing_regular_command_is_not_overwritten(self):
        self.bin.mkdir()
        command = self.bin / "codeberg"
        command.write_text("existing command")
        self.assertNotEqual(self.install().returncode, 0)
        self.assertEqual(command.read_text(), "existing command")

    def test_download_failure_preserves_existing_command(self):
        self.assertEqual(self.install().returncode, 0)
        before = (self.bin / "codeberg").resolve()
        self.tool("curl", "#!/bin/sh\nexit 22\n")
        self.assertNotEqual(self.install().returncode, 0)
        self.assertEqual((self.bin / "codeberg").resolve(), before)


if __name__ == "__main__":
    unittest.main()
