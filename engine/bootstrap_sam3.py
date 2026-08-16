"""Install/repair local sam3 package against FigOne-model/sam3.pt and source tree."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).with_name("bootstrap_sam3_out.txt")
lines: list[str] = []


def log(msg: str) -> None:
    print(msg)
    lines.append(msg)


def main() -> int:
    log(f"exe={sys.executable}")
    log(f"version={sys.version}")

    here = Path(__file__).resolve()
    project = here.parents[1]
    model_dir = project.parent / "FigOne-model"
    if not model_dir.is_dir():
        model_dir = project.parent / "Figra-model"
    ckpt = model_dir / "sam3.pt"
    src = project / "engine" / "sam3-src"
    if not src.is_dir():
        src = here.parent / "sam3-src"
    legacy = project.parent / "FigureSmith-sam3-src"

    log(f"ckpt exists={ckpt.is_file()} path={ckpt}")
    log(f"src exists={src.is_dir()} path={src}")
    log(f"legacy exists={legacy.is_dir()} path={legacy}")

    # Prefer existing source trees
    if not src.is_dir():
        if legacy.is_dir():
            log(f"using legacy source at {legacy}")
            src = legacy
        else:
            log("ERROR: bundled sam3 source is missing")
            OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
            return 1

    if not src.is_dir():
        log("ERROR: sam3 source still missing")
        OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return 1

    # The package uses pkg_resources; retain setuptools until SAM3 removes that import.
    proc0 = subprocess.run(
        [sys.executable, "-m", "pip", "install", "setuptools<81"],
        capture_output=True,
        text=True,
        timeout=600,
    )
    log(f"setuptools pip rc={proc0.returncode}")
    if proc0.returncode != 0:
        OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return proc0.returncode

    log(f"pip install -e {src}")
    proc = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-e", str(src)],
        capture_output=True,
        text=True,
        timeout=600,
    )
    log(f"pip rc={proc.returncode}")
    if proc.stdout:
        log(proc.stdout[-3000:])
    if proc.stderr:
        log(proc.stderr[-3000:])
    if proc.returncode != 0:
        OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return proc.returncode

    # Install missing web/server deps into eeg as well
    extras = [
        "fastapi>=0.110,<1.0",
        "uvicorn[standard]>=0.24,<1.0",
        "pydantic>=2.6,<3.0",
        "python-multipart>=0.0.9,<1.0",
        "openai>=1.0,<2.0",
        "kornia>=0.7,<1.0",
        "setuptools<81",
    ]
    proc2 = subprocess.run(
        [sys.executable, "-m", "pip", "install", *extras],
        capture_output=True,
        text=True,
        timeout=600,
    )
    log(f"extras pip rc={proc2.returncode}")
    if proc2.stdout:
        log(proc2.stdout[-2000:])
    if proc2.stderr:
        log(proc2.stderr[-2000:])

    try:
        import sam3
        from sam3.model_builder import build_sam3_image_model
        import inspect

        log(f"sam3 ok file={getattr(sam3, '__file__', None)}")
        log(f"sam3 path={list(getattr(sam3, '__path__', []))}")
        log(f"build_sig={inspect.signature(build_sam3_image_model)}")
    except Exception as e:
        log(f"import check failed: {type(e).__name__}: {e}")
        OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return 1

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
