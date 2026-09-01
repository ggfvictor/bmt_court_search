#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
web_dir="$repo_root/web"
release_dir="$repo_root/releases"

version=$(node -e "const fs=require('fs'); console.log(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).version)" "$web_dir/package.json")
release_name="badminton-availability-v$version"
archive_path="$release_dir/$release_name.tar.gz"
checksum_path="$release_dir/$release_name.sha256"

if [ -n "$(git -C "$repo_root" status --porcelain --untracked-files=no)" ]; then
  echo "Release aborted: commit all tracked changes first." >&2
  exit 1
fi

if [ -e "$archive_path" ] || [ -e "$checksum_path" ]; then
  echo "Release aborted: v$version already exists in releases/." >&2
  exit 1
fi

commit=$(git -C "$repo_root" rev-parse --short=7 HEAD)
stage_root=$(mktemp -d "${TMPDIR:-/tmp}/badminton-release.XXXXXX")
trap 'rm -rf "$stage_root"' EXIT HUP INT TERM

git -C "$repo_root" archive --format=tar --prefix="$release_name/" HEAD | tar -xf - -C "$stage_root"

metadata_path="$stage_root/$release_name/web/public/release.json"
mkdir -p "$(dirname -- "$metadata_path")"
printf '{\n  "version": "%s",\n  "commit": "%s"\n}\n' "$version" "$commit" > "$metadata_path"
cp "$metadata_path" "$web_dir/public/release.json"

mkdir -p "$release_dir"
COPYFILE_DISABLE=1 tar -czf "$archive_path" -C "$stage_root" "$release_name"
digest=$(shasum -a 256 "$archive_path" | awk '{print $1}')
printf '%s  %s\n' "$digest" "$(basename -- "$archive_path")" > "$checksum_path"

echo "Created $archive_path"
echo "Created $checksum_path"
echo "Release v$version uses commit $commit"
