# ADR-0046: A release is a version tag; the tag decides what is published

- Status: Accepted (VIK-124; VIK-129, VIK-133 and VIK-125 build on it)
- Date: 2026-10-24
- Deciders: Claude (default chosen; Jian may redirect)

## Context

CI builds the image to test it and throws it away, so a project that wants Vikaki has to clone, install pnpm and build. The Wavelength team wants to depend on a released image and a released Python client, and to be able to say which Vikaki a game was built against.

## Decision

- **The git tag is the release.** `vMAJOR.MINOR.PATCH` (or `-rc.N`, `-beta.N`, `-alpha.N`). One workflow, `.github/workflows/release.yml`, starts on a tag; `scripts/release-plan.mjs` turns the tag into everything it publishes, so the logic is a pure function with a unit test and the workflow only runs what it prints.
- **Image tags.** A final release pushes `ghcr.io/<owner>/vikaki:<version>`, `:<major.minor>` and `:latest`, for `linux/amd64` and `linux/arm64`. A release candidate pushes only its own tag, so `latest` and `X.Y` never point at one. No `:<major>` tag while the major is 0: a major tag would promise more than 0.x does. The voice variant (`vikaki-kokoro`, VIK-130) is published as the same tags with a `-kokoro` suffix (`0.1.0-kokoro`, `latest-kokoro`), amd64 only: the model download under emulation is too slow and nobody asked for arm64 speech yet.
- **One version for the image and the client.** The Python client's `version` in `clients/python/pyproject.toml` must equal the tag (a candidate's `-rc.1` is `rc1` in PEP 440); the workflow refuses a tag that disagrees, so the client and the image cannot drift. The version is changed in a PR and merged before tagging.
- **Nothing is published except from a tag on main.** A pull request, a branch push or a manual run is a dry run: it builds both platforms and starts the amd64 image and fetches the avatar page, but pushes nothing (a unit test holds that every push and login is guarded). A tag that is not a commit of `main` is refused.
- **Smoke before push.** The amd64 image is built, started and asked for the avatar page first; the multi-arch push comes after, so a broken image is never published.
- **Pinned actions.** Third-party actions are pinned to a commit; first-party ones to a major version.
- **Not automatic.** Nobody tags by script. A person pushes the tag; the workflow does the rest. The first image push creates a private GHCR package: making it public is a one-time click ([release.md](../release.md)).

- **Signed, keyless, by digest (VIK-133).** After the push, a `sign` job signs each image's digest with `cosign sign` using the workflow's GitHub OIDC identity (no key to store; recorded in Rekor), makes an SPDX SBOM of each image with `syft` and attaches it as a signed attestation (`cosign attest --type spdxjson`). The verifier checks the identity is this repo's `release.yml` on a `v*` tag. The SBOM files are kept for the release. Only that job may ask for an identity token.
- **The GitHub release is made by the same run (VIK-125).** After signing, a `github-release` job creates the release from `docs/releases/<tag>.md` with the SBOMs (and the Python wheel, VIK-129) attached. The notes file must exist before the tag is accepted. The job is the only one with `contents: write`.

- **The client is released from the same tag (VIK-129).** Its version is read from the package metadata (`pyproject.toml` is the only place it is written). Each run builds the wheel and sdist and installs the wheel into a clean environment; a tag attaches them to the GitHub release. PyPI is a separate, last job, behind the repository variable `PUBLISH_TO_PYPI`, using trusted publishing (no stored token), because the PyPI project and publisher have to be set up by the owner and an upload is permanent. Compatibility is stated by `protocol_version` (the client README): any hub of protocol 1 works with any 0.x client.

## Rejected

- **Publish `main` as `:edge`.** Not asked for, and an unreleased image is what a game should not depend on.
- **A signing key in a repository secret.** Something to rotate and leak; keyless needs nothing stored.
- **semantic-release or release-please.** A changelog automation is out of scope for the cards, and a two-person project can write its notes.
- **docker/metadata-action for the tags.** It cannot be run or tested locally; the 30 lines of `release-plan.mjs` can.
- **arm64 for the voice image.** See above; add it when asked.

## Consequences

The release is one command (`git tag -a v0.1.0 -m ... && git push origin v0.1.0`) once main is ready. What a tag run does that a dry run cannot show (the push, the visibility of the package) is listed in [release.md](../release.md).
