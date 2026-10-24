"""The one place the package's version is read: the installed metadata, which comes from `pyproject.toml` (VIK-129). A release tag, the wheel
and `vikaki_client.__version__` therefore cannot disagree."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("vikaki-client")
except PackageNotFoundError:  # running from a source tree that was never installed
    __version__ = "0+unknown"

__all__ = ["__version__"]
