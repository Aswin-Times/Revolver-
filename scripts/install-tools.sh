#!/usr/bin/env bash
# Installs the pinned static-analysis tools PR Mentor uses (Linux runners).
# Shared by CI and the GitHub Action so both run exactly the same versions.
set -euo pipefail

RUFF_VERSION="${RUFF_VERSION:-0.17.6}"
SEMGREP_VERSION="${SEMGREP_VERSION:-1.186.0}"
GITLEAKS_VERSION="${GITLEAKS_VERSION:-8.30.1}"
GITLEAKS_SHA256="${GITLEAKS_SHA256:-551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb}"

pipx install "ruff==${RUFF_VERSION}"
pipx install "semgrep==${SEMGREP_VERSION}"

file="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
tmp="$(mktemp -d)"
curl -sSfL -o "${tmp}/${file}" "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${file}"
(cd "${tmp}" && echo "${GITLEAKS_SHA256}  ${file}" | sha256sum -c -)
tar -xzf "${tmp}/${file}" -C "${tmp}" gitleaks
sudo mv "${tmp}/gitleaks" /usr/local/bin/gitleaks
rm -rf "${tmp}"

ruff --version
semgrep --version
gitleaks version
