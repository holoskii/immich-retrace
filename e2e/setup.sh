#!/usr/bin/env bash
# One-time setup for the e2e suite, without root: Playwright and its browsers into e2e/ (gitignored).
# Playwright's WebKit wants a few system libraries Ubuntu 24.04 doesn't ship by default; instead of
# `sudo playwright install-deps`, their .debs are downloaded (apt-get download needs no root), unpacked
# into .deps/ and linked into WebKit's own sys/lib (its MiniBrowser wrapper overrides LD_LIBRARY_PATH).
set -euo pipefail
cd "$(dirname "$0")"
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers"

npm install --no-audit --no-fund
npx playwright install chromium webkit 2>&1 | grep -v '^\s*at ' || true

if command -v apt-get >/dev/null; then
  mkdir -p .deps && cd .deps
  for p in libevent-2.1-7t64 libgstreamer-plugins-bad1.0-0 libavif16 libgav1-1 libyuv0 libnice10; do
    ls "${p}"_*.deb >/dev/null 2>&1 || apt-get download "$p"
  done
  for f in ./*.deb; do dpkg-deb -x "$f" root; done
  cd ..
  for d in .browsers/webkit-*/minibrowser-*/sys/lib; do
    for so in .deps/root/usr/lib/x86_64-linux-gnu/*.so*; do ln -sf "$PWD/$so" "$d/"; done
  done
fi
echo "e2e ready: npm --prefix e2e test"
