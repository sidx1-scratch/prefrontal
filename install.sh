#!/usr/bin/env bash
#
# install.sh — Installs only the runtime-required files for Prefrontal
# (https://github.com/sidx1-scratch/prefrontal) into a local "prefrontal" dir.
#
# What gets installed (the app actually needs these to run):
#   app.js, index.html, style.css, manifest.json, package.json,
#   package-lock.json, and the vendor/ JS+CSS libs it loads at runtime.
#
# What is intentionally skipped (not needed to run the app):
#   README.md, LICENSE, .gitattributes, google site-verification file,
#   docs/ (GitHub Pages site), tests/ and .github/workflows/ (CI only).
#   These are all marked export-ignore in the repo's own .gitattributes,
#   confirming they're considered non-essential to the shipped app.
#
# Usage:
#   ./install.sh [target-dir]      (default target-dir: ./prefrontal)

set -euo pipefail

REPO="sidx1-scratch/prefrontal"
BRANCH="main"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
TARGET_DIR="${1:-prefrontal}"

# Files required for the app to actually run, relative to repo root.
REQUIRED_FILES=(
  "app.js"
  "index.html"
  "style.css"
  "manifest.json"
  "package.json"
  "package-lock.json"
  "vendor/marked.min.js"
  "vendor/highlight.min.js"
  "vendor/highlight-dark.min.css"
  "vendor/highlight-light.min.css"
)

echo "Installing Prefrontal (required files only) into: ${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"

for f in "${REQUIRED_FILES[@]}"; do
  dest="${TARGET_DIR}/${f}"
  mkdir -p "$(dirname "${dest}")"
  echo "  fetching ${f}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${RAW_BASE}/${f}" -o "${dest}"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "${RAW_BASE}/${f}" -O "${dest}"
  else
    echo "Error: need curl or wget installed." >&2
    exit 1
  fi
done

echo ""
echo "Done. Installed files:"
( cd "${TARGET_DIR}" && find . -type f | sed 's|^\./|  |' | sort )

echo ""
echo "Next steps:"
echo "  cd ${TARGET_DIR}"
echo "  npm start          # serves the app at http://localhost:3000"
echo ""
echo "Make sure a local AI backend (Ollama or Llama.cpp) is running,"
echo "then configure its Server URL in Prefrontal's Settings."
