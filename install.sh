#!/usr/bin/env bash
#
# Prefrontal — Powered by AI
# Copyright (C) 2026 sidx1-scratch
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
#
# install.sh — Installs the runtime-required files for Prefrontal
# (https://github.com/sidx1-scratch/prefrontal) into a local "prefrontal" dir.
#
# What gets installed:
#   app.js, index.html, style.css, manifest.json, server.js, .env.example,
#   package.json, package-lock.json, and the vendor/ JS+CSS libs it loads.
#
# What is intentionally skipped (not needed to run the app):
#   README.md, LICENSE, .gitattributes, google site-verification file,
#   docs/ (GitHub Pages site), tests/ and .github/workflows/ (CI only).
#
# Usage:
#   ./install.sh [target-dir]      (default target-dir: ./prefrontal)

set -euo pipefail

REPO="sidx1-scratch/prefrontal"
BRANCH="main"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
TARGET_DIR="${1:-prefrontal}"

# Files required for the app and its Express launcher.
REQUIRED_FILES=(
  "app.js"
  "index.html"
  "style.css"
  "manifest.json"
  "server.js"
  ".env.example"
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
echo "  cp .env.example .env  # optional: configure server-side provider keys"
echo "  npm install"
echo "  npm start              # serves the app at http://localhost:3000"
echo ""
echo "Make sure a local AI backend (Ollama or Llama.cpp) is running,"
echo "then configure its Server URL in Prefrontal's Settings."
