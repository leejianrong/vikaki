"""One version for the package, the release tag and the image (VIK-129): see docs/release.md."""

import re
from pathlib import Path

import vikaki_client
from vikaki_client.client import CLIENT_NAME

ROOT = Path(__file__).resolve().parents[1]


def _pyproject_version() -> str:
    project = re.search(r"^\[project\]\s*$(.*?)(?=^\[|\Z)", (ROOT / "pyproject.toml").read_text(), re.S | re.M)
    assert project, "no [project] table"
    found = re.search(r'^version\s*=\s*"([^"]+)"', project.group(1), re.M)
    assert found, "no version in [project]"
    return found.group(1)


def test_the_version_is_the_one_in_pyproject():
    assert vikaki_client.__version__ == _pyproject_version()


def test_the_name_sent_to_the_hub_carries_major_minor():
    major_minor = ".".join(_pyproject_version().split(".")[:2])
    assert CLIENT_NAME == f"vikaki-client-python/{major_minor}"


def test_the_readme_names_the_image_tag_it_matches_and_the_protocol_it_speaks():
    readme = (ROOT / "README.md").read_text()
    major_minor = ".".join(_pyproject_version().split(".")[:2])
    assert f"ghcr.io/leejianrong/vikaki:{major_minor}" in readme, "the README must name the image tag that goes with this version"
    assert f"protocol_version` {vikaki_client.PROTOCOL_VERSION}" in readme
