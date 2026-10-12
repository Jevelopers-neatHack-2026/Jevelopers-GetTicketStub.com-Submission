"""Verify private installation bytes against the authorized archive before SDK loading."""

import base64
import hashlib
import io
import tarfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final

from integration_evals.artifacts import confined_path, digest, load_record
from integration_evals.contract_records import PackagePin
from integration_evals.contract_sources import Metadata
from integration_evals.errors import fail

MAX_PACKAGE_FILE_BYTES: Final = 64 * 1024 * 1024


class PackageMetadata(Metadata):
    """Package version bound to the reviewed archive."""

    version: str


class ContentManifest(Metadata):
    """Content digest advertised by the exact private package."""

    digest: str


def package_bytes(path: Path) -> bytes:
    """Bound private package files separately from small JSON evidence records."""
    if not path.is_file() or path.stat().st_size > MAX_PACKAGE_FILE_BYTES:
        return fail("contract_package_file_invalid", path.name)
    with path.open("rb") as source:
        data = source.read(MAX_PACKAGE_FILE_BYTES + 1)
    if len(data) > MAX_PACKAGE_FILE_BYTES:
        return fail("contract_package_file_invalid", path.name)
    return data


@dataclass(frozen=True, slots=True)
class InstalledPackage:
    """An installed package directory and the exact private archive it came from."""

    root: Path
    archive: Path


def verify_installed_package(installed: InstalledPackage, pin: PackagePin) -> None:
    """Reject archive substitution, unsafe members and any missing, extra or altered byte."""
    data = package_bytes(installed.archive)
    sri = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")
    if digest(data) != pin.archive_sha256 or sri != pin.archive_sri:
        fail("contract_archive_digest_mismatch", "shared-contracts")
    paths = tuple(installed.root.rglob("*"))
    if installed.root.is_symlink() or any(path.is_symlink() for path in paths):
        fail("contract_installed_symlink", "shared-contracts")
    expected: set[str] = set()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive.getmembers():
            name = PurePosixPath(member.name)
            if (
                not member.isfile()
                or name.is_absolute()
                or ".." in name.parts
                or name.parts[0] != "package"
                or not name.name
                or name.name == "package"
            ):
                fail("contract_archive_member_invalid", "shared-contracts")
            relative = str(name.relative_to("package"))
            if relative in expected:
                fail("contract_archive_member_duplicate", "shared-contracts")
            expected.add(relative)
            content = archive.extractfile(member)
            if content is None:
                fail("contract_archive_member_missing", "shared-contracts")
            with content:
                target = confined_path(installed.root, relative)
                if target.is_symlink() or package_bytes(target) != content.read(
                    MAX_PACKAGE_FILE_BYTES + 1
                ):
                    fail("contract_installed_bytes_mismatch", relative)
    actual = {
        str(path.relative_to(installed.root))
        for path in paths
        if path.is_file() or path.is_symlink()
    }
    if actual != expected:
        fail("contract_installed_scope_mismatch", "shared-contracts")

    metadata = load_record(installed.root / "package.json", PackageMetadata)
    manifest = load_record(
        installed.root / "generated/package-content-manifest.json", ContentManifest
    )
    if metadata.version != pin.version or manifest.digest != "sha256:" + pin.content_digest:
        fail("contract_package_metadata_mismatch", "shared-contracts")
