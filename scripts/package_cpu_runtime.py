#!/usr/bin/env python3
"""Package the generated Windows CPU Python runtime as a deterministic ZIP."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import zipfile
from pathlib import Path
from typing import Iterable

REQUIRED_FILES = (
    "python.exe",
    "Lib/site-packages/torch/__init__.py",
    "Lib/site-packages/torchvision/__init__.py",
    "Lib/site-packages/transformers/__init__.py",
    "Lib/site-packages/sam3/model_builder.py",
    "Lib/site-packages/sam3/assets/bpe_simple_vocab_16e6.txt.gz",
)
SKIP_DIRECTORY_NAMES = {"__pycache__"}
SKIP_SUFFIXES = {".pyc", ".pyo"}


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def iter_runtime_files(root: Path) -> Iterable[tuple[Path, str]]:
    paths = sorted(root.rglob("*"), key=lambda value: value.relative_to(root).as_posix().lower())
    for path in paths:
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part in SKIP_DIRECTORY_NAMES for part in relative.parts):
            continue
        if path.suffix.lower() in SKIP_SUFFIXES:
            continue
        yield path, relative.as_posix()


def validate_runtime(root: Path) -> None:
    missing = [relative for relative in REQUIRED_FILES if not (root / relative).is_file()]
    if missing:
        formatted = ", ".join(missing)
        raise RuntimeError(f"CPU runtime is missing required files: {formatted}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_archive(runtime: Path, output: Path) -> tuple[int, int]:
    files = list(iter_runtime_files(runtime))
    if not files:
        raise RuntimeError(f"No files found in CPU runtime: {runtime}")

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.tmp")
    if temporary.exists():
        temporary.unlink()

    uncompressed_bytes = 0
    with zipfile.ZipFile(
        temporary,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=6,
        allowZip64=True,
    ) as archive:
        for path, relative in files:
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 0
            info.external_attr = 0
            with path.open("rb") as source, archive.open(info, mode="w") as target:
                shutil.copyfileobj(source, target, length=8 * 1024 * 1024)
            uncompressed_bytes += path.stat().st_size

    temporary.replace(output)
    return len(files), uncompressed_bytes


def verify_archive(output: Path) -> None:
    with zipfile.ZipFile(output, mode="r") as archive:
        names = set(archive.namelist())
        missing = [relative for relative in REQUIRED_FILES if relative not in names]
        if missing:
            formatted = ", ".join(missing)
            raise RuntimeError(f"Packaged CPU runtime is missing required entries: {formatted}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    runtime = args.runtime.resolve()
    output = args.output.resolve()
    if not runtime.is_dir():
        raise RuntimeError(f"CPU runtime directory does not exist: {runtime}")
    if _is_within(output, runtime):
        raise RuntimeError("The runtime archive must be outside the runtime directory")

    validate_runtime(runtime)
    file_count, uncompressed_bytes = write_archive(runtime, output)
    verify_archive(output)
    archive_sha256 = sha256_file(output)
    manifest = {
        "formatVersion": 1,
        "runtime": "windows-x64-cpu",
        "fingerprint": archive_sha256,
        "sha256": archive_sha256,
        "fileCount": file_count,
        "uncompressedBytes": uncompressed_bytes,
        "archiveBytes": output.stat().st_size,
        "requiredFiles": list(REQUIRED_FILES),
    }
    manifest_path = output.with_suffix(".manifest.json")
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Packaged CPU runtime: {output} "
        f"({file_count} files, {uncompressed_bytes} uncompressed bytes, "
        f"{output.stat().st_size} archive bytes)"
    )
    print(f"Runtime manifest: {manifest_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, zipfile.BadZipFile) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
