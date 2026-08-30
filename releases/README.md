# Local release packages

Self-hosted release archives and checksum files are stored in this directory.
The repository ignores `*.tar`, `*.tar.gz`, and `*.sha256` files here so they
remain available locally without being committed or pushed to GitHub.

To verify a package, run the checksum command from this directory, for example:

```bash
cd releases
shasum -a 256 -c badminton-availability-v1.1.6.sha256
```
