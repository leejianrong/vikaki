# Releases

A release is a git tag. Pushing `vX.Y.Z` makes `.github/workflows/release.yml` build and publish the image ([ADR-0046](adr/0046-a-release-is-a-version-tag.md)).

## What a game can pull

| Image | What it is |
| --- | --- |
| `ghcr.io/leejianrong/vikaki:0.1.0` | exactly that release |
| `ghcr.io/leejianrong/vikaki:0.1` | the newest 0.1.x |
| `ghcr.io/leejianrong/vikaki:latest` | the newest final release |
| `ghcr.io/leejianrong/vikaki:0.1.0-kokoro` (and `0.1-kokoro`, `latest-kokoro`) | the same with the real voice, amd64 only |

All three non-voice tags are for `linux/amd64` and `linux/arm64`. A release candidate (`v0.2.0-rc.1`) has only its own tag. Pin `0.1` to take fixes and nothing that breaks, or the full version to take nothing.

```bash
docker run --rm -p 127.0.0.1:8787:8787 ghcr.io/leejianrong/vikaki:0.1
```

What each image does and how to configure it: [docker.md](docker.md).

## Checking where an image came from

Each published image is signed with `cosign` without a key: the signature is made with the release workflow's own identity (GitHub's OIDC token) and recorded in the public Rekor log, so there is no signing key to trust or lose. Each image also carries its SBOM (SPDX, made by `syft`) as a signed attestation, and the SBOM files are attached to the GitHub release.

```bash
cosign verify ghcr.io/leejianrong/vikaki:0.1.0 \
  --certificate-identity-regexp '^https://github.com/leejianrong/vikaki/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

cosign verify-attestation --type spdxjson ghcr.io/leejianrong/vikaki:0.1.0 \
  --certificate-identity-regexp '^https://github.com/leejianrong/vikaki/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com | jq -r .payload | base64 -d | jq '.predicate.packages | length'
```

The identity names this repository's `release.yml` on a `v*` tag, so an image pushed by anyone else, or from a branch, does not verify. Pull by digest (`@sha256:...`, shown on the release run's summary) when a tag moving under you is not acceptable. This is provenance, not a vulnerability policy: scanning is not part of the release.

## Cutting a release (for the maintainer)

1. `main` is green and the notes are ready (`docs/releases/vX.Y.Z.md`; the workflow refuses a tag without that file).
2. The Python client's version in `clients/python/pyproject.toml` is the tag's (`0.1.0` for `v0.1.0`; `0.2.0rc1` for `v0.2.0-rc.1`). Change it in a PR first: the workflow refuses a tag that disagrees.
3. Dry-run the workflow on any branch: Actions, Release, Run workflow (it builds both platforms, starts the image and fetches the page, and pushes nothing).
4. Tag a commit of `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag -a v0.1.0 -m "Vikaki 0.1.0"
   git push origin v0.1.0
   ```

5. First release only: GitHub makes a new package private. Open the package (github.com/leejianrong?tab=packages, `vikaki`), Package settings, Change visibility, Public, and link it to the repository.

A tag that is not on `main`, is not shaped like a version, has no notes file, or disagrees with the client is refused before anything is pushed. After the push the workflow signs both images, attaches the SBOMs, and creates the GitHub release from the notes file.

## What a dry run cannot show

The login, the push, the tags that land in the registry and the package's visibility only happen on a real tag. The workflow's shape is checked by `actionlint`, by tests that pin its safety rules (`packages/cli/test/release-workflow.test.ts`) and by `scripts/release-plan.mjs`'s unit test; the amd64 image is built and started in every dry run, and the arm64 build runs under emulation there too.
