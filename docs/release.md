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

## The Python client

`vikaki-client` has the same version as the image: tag `v0.1.0` releases image `0.1.0` and `vikaki-client 0.1.0` (the workflow refuses a tag that disagrees with `clients/python/pyproject.toml`; `vikaki_client.__version__` reads the installed metadata, so the wheel cannot disagree either). Every run, a dry run too, builds the wheel and the source distribution, installs the wheel into a clean environment and checks it imports, says the right version, and carries the protocol schema. On a tag, both files are attached to the GitHub release, so a game can depend on a URL instead of a git commit:

```bash
pip install https://github.com/leejianrong/vikaki/releases/download/v0.1.0/vikaki_client-0.1.0-py3-none-any.whl
```

**PyPI is off until you opt in** (it needs an account step that only you can do, and an upload cannot be taken back). To turn it on: on pypi.org add a *pending publisher* for the project `vikaki-client` (owner `leejianrong`, repository `vikaki`, workflow `release.yml`, environment `pypi`), create the `pypi` environment in the repository settings (optionally with a required reviewer), and set the repository variable `PUBLISH_TO_PYPI` to `true`. No token is stored anywhere: the upload uses trusted publishing. The `pypi` job runs last, after the GitHub release exists. Which hub versions the client speaks to is in [the client's README](../clients/python/README.md#which-hub-it-speaks-to).

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

## Release checklist (v0.1.0 as the example)

Nothing here has been done for v0.1.0: the tag is the maintainer's to push.

- [ ] Every card of the release epic is merged and `main` CI is green (typecheck, unit, build; e2e and the Docker workflow too).
- [ ] `docs/releases/v0.1.0.md` is read and correct (it becomes the GitHub release's text; the file name must be the tag).
- [ ] `clients/python/pyproject.toml` says `0.1.0`.
- [ ] A dry run of the Release workflow (Actions, Release, Run workflow) is green.
- [ ] One-time: the GHCR package will be private after the first push: be ready to make it public (step 5 above).
- [ ] Optional, one-time: the PyPI trusted publisher and `PUBLISH_TO_PYPI` (see "The Python client"). Leave it off to release the wheel on GitHub only.
- [ ] Push the tag (the exact command is in "Cutting a release").
- [ ] Watch the run: images pushed, signed, the SBOMs attached, the GitHub release created.
- [ ] `cosign verify` and `docker run` the published tag from a clean machine (the commands above).
- [ ] Tell the Wavelength team the tag, and pin their compose file to `0.1`.
