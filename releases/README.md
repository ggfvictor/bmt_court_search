# Local release packages

Self-hosted release archives and checksum files are stored in this directory.
The repository ignores `*.tar`, `*.tar.gz`, and `*.sha256` files here so they
remain available locally without being committed or pushed to GitHub.

Create a release only after committing all tracked changes. The script reads
that final commit SHA before any push and injects it into `web/public/release.json`
inside the archive, so publishing does not require another metadata commit:

```bash
./scripts/package-release.sh
```

To verify a package, run the checksum command from this directory, for example:

```bash
cd releases
shasum -a 256 -c badminton-availability-v1.1.11.sha256
```
