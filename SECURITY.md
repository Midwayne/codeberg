# Security Policy

## Supported Versions

This project is pre-v1. Security fixes are provided for the latest released
minor version.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately by opening a GitHub security
advisory for this repository. If advisories are unavailable, contact the
maintainers through the repository owner profile.

Do not create a public issue for a suspected vulnerability. Include affected
versions, reproduction steps, impact, and any known mitigations.

## Secrets and sensitive data

- **`CODEBERG_ROOT`** and other paths point at local code on disk; do not commit
  credentials, API keys, or private repository contents into this project.
- Embedding models and ONNX Runtime are loaded from paths you configure locally
  (for example `CBERG_TEST_MODEL` in tests). Keep model downloads and runtime
  installs outside version control.
- Future daemon/agent layers must read tokens from environment variables only
  and must not write secrets into on-disk index files.
