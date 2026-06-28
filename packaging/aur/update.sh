#!/usr/bin/env bash
# Refresh the AUR package dir for a release: bump pkgver, recompute checksums,
# copy in the shared desktop/metainfo files and regenerate .SRCINFO. Intended to
# run in an `archlinux` container that has `pacman-contrib` (updpkgsums) and
# makepkg available. The resulting packaging/aur dir is what gets pushed to AUR.
#
# Usage: update.sh <version>   e.g. update.sh 0.6.3
set -euo pipefail

VERSION="${1:?usage: update.sh <version>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

# Bump version and reset pkgrel.
sed -i -E "s/^pkgver=.*/pkgver=${VERSION}/" PKGBUILD
sed -i -E "s/^pkgrel=.*/pkgrel=1/" PKGBUILD

# updpkgsums downloads each source and writes real sha256sums into PKGBUILD.
# Must run as a non-root user (makepkg refuses root).
updpkgsums

# Regenerate .SRCINFO from the updated PKGBUILD.
makepkg --printsrcinfo > .SRCINFO

echo "AUR package updated to ${VERSION}"
