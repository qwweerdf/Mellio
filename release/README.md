# Release artifacts

Installers are **not committed** to this repository.

- GitHub rejects files over 100 MB; the current macOS dmg is ~115 MB
- Binaries do not belong in source history
- Installers should be distributed through GitHub Releases so they can be verified, rolled back and later updated

## Local builds

```bash
npm run dist:mac   # release/Mellio-<version>-arm64.dmg
npm run dist:win   # release/Mellio Setup <version>.exe (Windows / CI)
```

## Publishing through GitHub Actions

1. Update `version` in `package.json`
2. Commit and push a tag: `git tag v0.1.0 && git push origin v0.1.0`
3. `.github/workflows/release.yml` builds on macOS and Windows
4. A **draft GitHub Release** is created with the dmg and exe
5. Review and publish it from the GitHub Releases page

Running the workflow manually (`workflow_dispatch`) produces workflow artifacts only and does not create a release.
