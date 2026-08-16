from __future__ import annotations

import json
import os
import queue
import shutil
import signal
import subprocess
import threading
import time
import uuid
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File
import mimetypes

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
RUNTIME_DIR = Path(
    os.environ.get(
        "FIGONE_RUNTIME_DIR",
        os.environ.get("FIGRA_RUNTIME_DIR", BASE_DIR / "runtime"),
    )
).resolve()
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR = RUNTIME_DIR / "outputs"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR = RUNTIME_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def _configured_sam3_checkpoint() -> Path | None:
    """Return the configured local SAM3 checkpoint without exposing its path."""
    for env_key in ("SAM3_CHECKPOINT", "AUTOFIGURE_SAM3_CHECKPOINT"):
        value = os.environ.get(env_key, "").strip()
        if value:
            path = Path(value)
            if path.is_file():
                return path
    return None


def _sam3_capabilities() -> dict[str, object]:
    """Probe imports used by local SAM3 without loading the checkpoint."""
    result: dict[str, object] = {
        "torch": None,
        "torchvision": None,
        "triton": None,
        "sam3": None,
        "cudaAvailable": False,
    }
    try:
        import torch

        result["torch"] = getattr(torch, "__version__", "unknown")
        result["cudaAvailable"] = bool(torch.cuda.is_available())
    except Exception as exc:
        result["torch"] = f"unavailable: {exc}"
    try:
        import torchvision

        result["torchvision"] = getattr(torchvision, "__version__", "unknown")
    except Exception as exc:
        result["torchvision"] = f"unavailable: {exc}"
    try:
        import triton

        result["triton"] = getattr(triton, "__version__", "available")
    except Exception as exc:
        result["triton"] = f"optional: {exc}"
    try:
        from sam3.model_builder import build_sam3_image_model  # noqa: F401

        result["sam3"] = "available"
    except Exception as exc:
        result["sam3"] = f"unavailable: {exc}"
    cpu_ready = result["sam3"] == "available" and not str(result["torch"]).startswith("unavailable:")
    cuda_ready = cpu_ready and bool(result["cudaAvailable"]) and not str(result["triton"]).startswith("optional:")
    result["supportsLocalCpu"] = cpu_ready
    result["supportsLocalCuda"] = cuda_ready
    result["recommendedBackend"] = "local" if cpu_ready else "fal"
    return result


def _local_sam3_status() -> dict[str, object]:
    checkpoint = _configured_sam3_checkpoint()
    capabilities = _sam3_capabilities()
    force_cpu = (
        os.environ.get("FIGONE_FORCE_CPU", os.environ.get("FIGRA_FORCE_CPU", "")).strip() == "1"
    )
    if checkpoint is None:
        return {
            "ready": False,
            "runtime": "CPU Float32" if force_cpu else "Automatic",
            "capabilities": capabilities,
        }

    metadata_path = checkpoint.with_suffix(".json")
    imported_at = None
    sha256 = None
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        imported_at = metadata.get("importedAt")
        sha256 = metadata.get("sha256")
    except (OSError, ValueError, TypeError):
        pass

    return {
        "ready": True,
        "fileName": checkpoint.name,
        "sizeBytes": checkpoint.stat().st_size,
        "sha256": sha256,
        "importedAt": imported_at,
        "runtime": "CPU Float32" if force_cpu else "Automatic",
        "capabilities": capabilities,
    }


def _resolve_python_executable() -> str:
    """Return the configured interpreter, or the current bundled runtime."""
    env_override = os.environ.get("AUTOFIGURE_PYTHON")
    if env_override and env_override.strip():
        return env_override.strip()
    return sys.executable


PYTHON_EXECUTABLE = _resolve_python_executable()

DEFAULT_SAM_PROMPT = "icon,person,robot,animal"
DEFAULT_PLACEHOLDER_MODE = "label"
DEFAULT_MERGE_THRESHOLD = 0.01


def _apply_pipeline_model_env(env: dict[str, str]) -> None:
    """Propagate local model paths / cache dirs into child pipeline jobs."""
    # Keep cache under FIGONE/FIGRA runtime when the desktop shell set HF_HOME.
    if "HF_HOME" not in env and os.environ.get("HF_HOME"):
        env["HF_HOME"] = os.environ["HF_HOME"]
    if "HUGGINGFACE_HUB_CACHE" not in env and os.environ.get("HUGGINGFACE_HUB_CACHE"):
        env["HUGGINGFACE_HUB_CACHE"] = os.environ["HUGGINGFACE_HUB_CACHE"]
    rmbg_path = (
        os.environ.get("FIGONE_RMBG_MODEL_PATH", os.environ.get("FIGRA_RMBG_MODEL_PATH", "")).strip()
    )
    if rmbg_path:
        env["FIGONE_RMBG_MODEL_PATH"] = rmbg_path
        env["FIGRA_RMBG_MODEL_PATH"] = rmbg_path


def _configured_rmbg_model_path() -> Path | None:
    """Return a local RMBG-2.0 model directory if FigOne has assembled one."""
    for env_key in ("FIGONE_RMBG_MODEL_PATH", "FIGRA_RMBG_MODEL_PATH", "RMBG_MODEL_PATH"):
        value = os.environ.get(env_key, "").strip()
        if not value:
            continue
        path = Path(value)
        if path.is_dir() and (path / "config.json").is_file():
            weight = path / "model.safetensors"
            legacy = path / "pytorch_model.bin"
            if weight.is_file() or legacy.is_file():
                return path
        if path.is_file():
            return path
    return None


def _local_rmbg_status() -> dict[str, object]:
    path = _configured_rmbg_model_path()
    if path is None:
        return {"ready": False}
    if path.is_dir():
        weight = path / "model.safetensors"
        if not weight.is_file():
            weight = path / "pytorch_model.bin"
        size = weight.stat().st_size if weight.is_file() else None
        return {
            "ready": True,
            "fileName": weight.name if weight.is_file() else path.name,
            "sizeBytes": size,
            "modelDir": str(path),
        }
    return {
        "ready": True,
        "fileName": path.name,
        "sizeBytes": path.stat().st_size,
        "modelDir": str(path.parent),
    }


SVG_EDIT_CANDIDATES = [
    ("vendor/svg-edit/editor/iife-index.html", WEB_DIR / "vendor" / "svg-edit" / "editor" / "iife-index.html"),
    ("vendor/svg-edit/editor/index.html", WEB_DIR / "vendor" / "svg-edit" / "editor" / "index.html"),
    ("vendor/svg-edit/editor.html", WEB_DIR / "vendor" / "svg-edit" / "editor.html"),
    ("vendor/svg-edit/index.html", WEB_DIR / "vendor" / "svg-edit" / "index.html"),
]

SENSITIVE_CMD_FLAGS = {"--api_key", "--image_api_key", "--sam_api_key"}


def _resolve_svg_edit_path() -> tuple[bool, str | None]:
    for rel, path in SVG_EDIT_CANDIDATES:
        if path.is_file():
            return True, f"/{rel}"
    return False, None


def _redact_cmd_args(cmd: list[str]) -> str:
    redacted: list[str] = []
    hide_next = False
    for token in cmd:
        if hide_next:
            redacted.append("***")
            hide_next = False
            continue
        redacted.append(token)
        if token in SENSITIVE_CMD_FLAGS:
            hide_next = True
    return " ".join(redacted)


@dataclass
class Job:
    job_id: str
    output_dir: Path
    process: subprocess.Popen
    queue: queue.Queue
    log_path: Path
    log_lock: threading.Lock = field(default_factory=threading.Lock)
    seen: set[str] = field(default_factory=set)
    done: bool = False

    def push(self, event: str, data: dict) -> None:
        self.queue.put({"event": event, "data": data})

    def write_log(self, stream: str, line: str) -> None:
        with self.log_lock:
            with open(self.log_path, "a", encoding="utf-8") as handle:
                handle.write(f"[{stream}] {line}\n")


class RunRequest(BaseModel):
    method_text: Optional[str] = None
    provider: str = "bianxie"
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    image_provider: Optional[str] = None
    image_api_key: Optional[str] = None
    image_base_url: Optional[str] = None
    image_model: Optional[str] = None
    image_size: Optional[str] = None
    enable_upscale: Optional[bool] = None
    svg_model: Optional[str] = None
    sam_prompt: Optional[str] = None
    sam_backend: Optional[str] = None
    sam_api_key: Optional[str] = None
    sam_max_masks: Optional[int] = None
    placeholder_mode: Optional[str] = None
    merge_threshold: Optional[float] = None
    optimize_iterations: Optional[int] = None
    multimodal_image_scale: Optional[float] = None
    start_from: Optional[int] = None
    reference_image_path: Optional[str] = None
    input_figure_path: Optional[str] = None
    resume_job_id: Optional[str] = None


JOB_SETTINGS_FILENAME = "figone_job_settings.json"
LEGACY_JOB_SETTINGS_FILENAME = "figra_job_settings.json"
MULTIMODAL_IMAGE_SCALE_CHOICES = (1.0, 0.75, 0.5, 0.4, 0.25)
DEFAULT_MULTIMODAL_IMAGE_SCALE = 0.5
SVG_RERUN_START_FROM = 4
SVG_ARCHIVE_NAMES = (
    "template.svg",
    "optimized_template.svg",
    "optimized_template.png",
    "final.svg",
)


app = FastAPI()
# Desktop shell loads from the local Tauri app origin and calls this engine over
# http://127.0.0.1. Allow local browser/shell origins so that split is possible.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
        "http://127.0.0.1",
        "http://localhost",
        "null",
    ],
    allow_origin_regex=r"https?://(127\.0\.0\.1|localhost)(:\d+)?|https?://tauri\.localhost|tauri://localhost",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBS: dict[str, Job] = {}
HISTORY_ARTIFACT_ORDER = [
    "figure.png",
    "samed.png",
    "template.svg",
    "optimized_template.svg",
    "final.svg",
    "boxlib.json",
    "run.log",
]
HISTORY_THUMBNAIL_KINDS = {
    "figure",
    "samed",
    "final_svg",
    "template_svg",
    "optimized_template_svg",
}
HISTORY_PRIMARY_KINDS = [
    "final_svg",
    "optimized_template_svg",
    "template_svg",
    "figure",
    "samed",
]


def _normalize_multimodal_image_scale(value: object | None) -> float:
    if value is None or value == "":
        return DEFAULT_MULTIMODAL_IMAGE_SCALE
    try:
        scale = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid multimodal_image_scale. Expected one of: "
                + ", ".join(str(v) for v in MULTIMODAL_IMAGE_SCALE_CHOICES)
            ),
        ) from exc
    for choice in MULTIMODAL_IMAGE_SCALE_CHOICES:
        if abs(scale - choice) < 1e-9:
            return float(choice)
    raise HTTPException(
        status_code=400,
        detail=(
            "Unsupported multimodal_image_scale. Expected one of: "
            + ", ".join(str(v) for v in MULTIMODAL_IMAGE_SCALE_CHOICES)
        ),
    )


def _job_settings_path(output_dir: Path) -> Path:
    return output_dir / JOB_SETTINGS_FILENAME


def _load_job_settings(output_dir: Path) -> dict:
    path = _job_settings_path(output_dir)
    if not path.is_file():
        legacy_path = output_dir / LEGACY_JOB_SETTINGS_FILENAME
        if legacy_path.is_file():
            path = legacy_path
        else:
            return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_job_settings(output_dir: Path, settings: dict) -> None:
    """Persist non-secret run settings for later SVG-only retries."""
    safe = {
        "provider": settings.get("provider"),
        "svg_model": settings.get("svg_model"),
        "image_provider": settings.get("image_provider"),
        "image_model": settings.get("image_model"),
        "image_size": settings.get("image_size"),
        "enable_upscale": settings.get("enable_upscale"),
        "sam_prompt": settings.get("sam_prompt"),
        "sam_backend": settings.get("sam_backend"),
        "sam_max_masks": settings.get("sam_max_masks"),
        "placeholder_mode": settings.get("placeholder_mode"),
        "merge_threshold": settings.get("merge_threshold"),
        "optimize_iterations": settings.get("optimize_iterations"),
        "multimodal_image_scale": settings.get("multimodal_image_scale"),
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
    # Drop empty values so older consumers stay simple.
    payload = {key: value for key, value in safe.items() if value is not None}
    path = _job_settings_path(output_dir)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _nonempty_file(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def _assert_svg_rerun_ready(output_dir: Path) -> None:
    """Require step-1..3 artifacts so SVG-only rerun can skip SAM/RMBG."""
    figure_path = output_dir / "figure.png"
    samed_path = output_dir / "samed.png"
    boxlib_path = output_dir / "boxlib.json"
    if not (_nonempty_file(figure_path) and _nonempty_file(samed_path) and _nonempty_file(boxlib_path)):
        raise HTTPException(
            status_code=400,
            detail="SVG rerun requires figure.png, samed.png, and boxlib.json",
        )
    try:
        boxes = (json.loads(boxlib_path.read_text(encoding="utf-8")) or {}).get("boxes") or []
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid boxlib.json: {exc}") from exc

    if not boxes:
        return

    icons_dir = output_dir / "icons"
    missing: list[str] = []
    for box_info in boxes:
        label = box_info.get("label", f"<AF>{int(box_info.get('id', 0)) + 1:02d}")
        label_clean = str(label).replace("<", "").replace(">", "")
        crop_path = icons_dir / f"icon_{label_clean}.png"
        nobg_path = icons_dir / f"icon_{label_clean}_nobg.png"
        if not (_nonempty_file(crop_path) and _nonempty_file(nobg_path)):
            missing.append(label_clean)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=(
                "SVG rerun is missing icon artifacts for: "
                + ", ".join(missing)
                + ". Re-run from step 3 first."
            ),
        )


def _archive_svg_outputs(output_dir: Path) -> Path | None:
    """Move previous SVG outputs aside so the artifact scanner cannot show stale files."""
    existing = [name for name in SVG_ARCHIVE_NAMES if _nonempty_file(output_dir / name)]
    if not existing:
        return None
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive_dir = output_dir / "revisions" / f"svg_{stamp}"
    archive_dir.mkdir(parents=True, exist_ok=True)
    for name in existing:
        src = output_dir / name
        dest = archive_dir / name
        try:
            shutil.move(str(src), str(dest))
        except OSError:
            # Fall back to copy+delete if move fails (e.g. locked handle).
            shutil.copy2(src, dest)
            try:
                src.unlink()
            except OSError:
                pass
    # Also archive any leftover temp optimization frames.
    for temp_path in output_dir.glob("temp_svg_iter_*.svg"):
        try:
            shutil.move(str(temp_path), str(archive_dir / temp_path.name))
        except OSError:
            pass
    for temp_path in output_dir.glob("temp_png_iter_*.png"):
        try:
            shutil.move(str(temp_path), str(archive_dir / temp_path.name))
        except OSError:
            pass
    return archive_dir


@app.get("/healthz")
def healthz() -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "figone-engine"})


@app.get("/api/config")
def get_config() -> JSONResponse:
    available, rel_path = _resolve_svg_edit_path()
    rmbg = _local_rmbg_status()
    return JSONResponse(
        {
            "svgEditAvailable": available,
            "svgEditPath": rel_path,
            "rmbgReady": bool(rmbg.get("ready")),
        }
    )


@app.get("/api/model-status")
def get_model_status() -> JSONResponse:
    return JSONResponse(_local_sam3_status())


@app.get("/api/rmbg-model-status")
def get_rmbg_model_status() -> JSONResponse:
    return JSONResponse(_local_rmbg_status())


@app.get("/api/history")
def list_history(limit: int = 200) -> JSONResponse:
    items = []
    if OUTPUTS_DIR.is_dir():
        output_dirs = [path for path in OUTPUTS_DIR.iterdir() if path.is_dir()]
        output_dirs.sort(key=_history_sort_key, reverse=True)
        for output_dir in output_dirs[: max(1, min(limit, 1000))]:
            item = _build_history_item(output_dir.name)
            if item:
                items.append(item)
    return JSONResponse({"items": items, "count": len(items)})


@app.get("/api/history/{job_id}")
def get_history_job(job_id: str) -> JSONResponse:
    item = _build_history_item(job_id)
    if not item:
        raise HTTPException(status_code=404, detail="History job not found")
    return JSONResponse(item)


@app.get("/api/history/{job_id}/artifacts/{path:path}")
def get_history_artifact(job_id: str, path: str) -> Response:
    output_dir = _resolve_output_dir(job_id)
    if not output_dir:
        raise HTTPException(status_code=404, detail="History job not found")
    return _artifact_file_response(output_dir, path)


@app.delete("/api/history/{job_id}")
def delete_history_job(job_id: str) -> JSONResponse:
    output_dir = _resolve_output_dir(job_id)
    if not output_dir:
        raise HTTPException(status_code=404, detail="History job not found")
    existing = JOBS.get(job_id)
    if existing is not None and not existing.done:
        raise HTTPException(status_code=409, detail="Cannot delete a running job")
    try:
        shutil.rmtree(output_dir)
    except OSError as exc:
        # Common on Windows when preview/editor still holds an open handle.
        raise HTTPException(
            status_code=500,
            detail=(
                "Failed to delete history output directory "
                f"(file may be in use; close previews and retry): {exc}"
            ),
        )
    if job_id in JOBS:
        del JOBS[job_id]
    return JSONResponse({"deleted": True, "job_id": job_id})



@app.post("/api/run")
def run_job(req: RunRequest) -> JSONResponse:
    method_text = (req.method_text or "").strip()
    input_figure_path = req.input_figure_path
    resume_job_id = (req.resume_job_id or "").strip() or None
    start_from = req.start_from
    if start_from is not None and start_from not in (1, 2, 3, 4, 5):
        raise HTTPException(status_code=400, detail="start_from must be an integer from 1 to 5")
    svg_only_rerun = bool(resume_job_id and start_from == SVG_RERUN_START_FROM)

    if resume_job_id:
        if method_text or input_figure_path:
            raise HTTPException(
                status_code=400,
                detail="resume_job_id cannot be combined with method_text or input_figure_path",
            )
    elif bool(method_text) == bool(input_figure_path):
        raise HTTPException(
            status_code=400,
            detail="Provide exactly one of method_text or input_figure_path",
        )

    # Resume/SVG-only may skip SAM; only require local SAM for fresh runs that still need step 2.
    needs_sam = (not resume_job_id) or (start_from is not None and start_from <= 2)
    if needs_sam and req.sam_backend == "local":
        status = _local_sam3_status()
        capabilities = status["capabilities"]
        if not status["ready"]:
            raise HTTPException(
                status_code=400,
                detail="未检测到本地 SAM3 模型。请先在“本地模型”页面导入 sam3.pt。",
            )
        if not capabilities.get("supportsLocalCpu"):
            raise HTTPException(
                status_code=400,
                detail=(
                    "本地 SAM3 运行时依赖不完整，无法启动 CPU 推理。"
                    "请重新安装应用或改用 fal/roboflow 远程后端。"
                ),
            )

    if resume_job_id:
        if not _is_safe_job_id(resume_job_id):
            raise HTTPException(status_code=400, detail="Invalid resume_job_id")
        output_dir = _resolve_output_dir(resume_job_id)
        if not output_dir:
            raise HTTPException(status_code=404, detail="Resume job not found")
        existing = JOBS.get(resume_job_id)
        if existing is not None and not existing.done:
            raise HTTPException(status_code=409, detail="Job is still running")
        job_id = resume_job_id
        if svg_only_rerun:
            _assert_svg_rerun_ready(output_dir)
    else:
        if start_from is not None:
            raise HTTPException(
                status_code=400,
                detail="start_from is only valid with resume_job_id",
            )
        job_id = datetime.now().strftime("%Y%m%d_%H%M%S_") + uuid.uuid4().hex[:8]
        output_dir = OUTPUTS_DIR / job_id
        output_dir.mkdir(parents=True, exist_ok=True)

    previous_settings = _load_job_settings(output_dir) if resume_job_id else {}

    def _pick(value, *keys, default=None):
        if value is not None and value != "":
            return value
        for key in keys:
            if key in previous_settings and previous_settings[key] is not None:
                return previous_settings[key]
        return default

    multimodal_image_scale = _normalize_multimodal_image_scale(
        _pick(req.multimodal_image_scale, "multimodal_image_scale", default=DEFAULT_MULTIMODAL_IMAGE_SCALE)
    )
    optimize_iterations = _pick(req.optimize_iterations, "optimize_iterations", default=0)
    try:
        optimize_iterations = int(optimize_iterations)
    except (TypeError, ValueError):
        optimize_iterations = 0

    sam_prompt = _pick(req.sam_prompt, "sam_prompt", default=DEFAULT_SAM_PROMPT) or DEFAULT_SAM_PROMPT
    placeholder_mode = (
        _pick(req.placeholder_mode, "placeholder_mode", default=DEFAULT_PLACEHOLDER_MODE)
        or DEFAULT_PLACEHOLDER_MODE
    )
    merge_threshold = _pick(
        req.merge_threshold, "merge_threshold", default=DEFAULT_MERGE_THRESHOLD
    )
    if merge_threshold is None:
        merge_threshold = DEFAULT_MERGE_THRESHOLD

    provider = (req.provider or previous_settings.get("provider") or "bianxie").strip() or "bianxie"
    svg_model = _pick(req.svg_model, "svg_model")
    image_provider = _pick(req.image_provider, "image_provider")
    image_model = _pick(req.image_model, "image_model")
    image_size = _pick(req.image_size, "image_size")
    enable_upscale = _pick(req.enable_upscale, "enable_upscale", default=True)
    sam_backend = _pick(req.sam_backend, "sam_backend")
    sam_max_masks = _pick(req.sam_max_masks, "sam_max_masks")

    if svg_only_rerun:
        archive_dir = _archive_svg_outputs(output_dir)
        if archive_dir is not None:
            print(f"[figone] archived previous SVG outputs to {archive_dir}")

    cmd = [
        PYTHON_EXECUTABLE,
        str(BASE_DIR / "autofigure2.py"),
        "--output_dir",
        str(output_dir),
        "--provider",
        provider,
    ]
    if resume_job_id and not start_from:
        cmd += ["--resume"]
    if start_from is not None:
        cmd += ["--start_from", str(start_from)]
    if method_text:
        cmd += ["--method_text", method_text]
    if input_figure_path:
        resolved_input_path = (
            str((BASE_DIR / input_figure_path).resolve())
            if not Path(input_figure_path).is_absolute()
            else input_figure_path
        )
        cmd += ["--input_figure_path", resolved_input_path]

    if req.api_key:
        cmd += ["--api_key", req.api_key]
    if req.base_url:
        cmd += ["--base_url", req.base_url]
    if image_provider:
        cmd += ["--image_provider", image_provider]
    if req.image_api_key:
        cmd += ["--image_api_key", req.image_api_key]
    if req.image_base_url:
        cmd += ["--image_base_url", req.image_base_url]
    if image_model:
        cmd += ["--image_model", image_model]
    if image_size:
        cmd += ["--image_size", image_size]
    if enable_upscale is False:
        cmd += ["--disable_auto_upscale"]
    if svg_model:
        cmd += ["--svg_model", svg_model]

    cmd += ["--sam_prompt", sam_prompt]
    cmd += ["--placeholder_mode", placeholder_mode]
    cmd += ["--merge_threshold", str(merge_threshold)]
    if sam_backend:
        cmd += ["--sam_backend", sam_backend]
    if req.sam_api_key:
        cmd += ["--sam_api_key", req.sam_api_key]
    if sam_max_masks is not None:
        cmd += ["--sam_max_masks", str(sam_max_masks)]
    cmd += ["--optimize_iterations", str(optimize_iterations)]
    cmd += ["--multimodal_image_scale", str(multimodal_image_scale)]

    rmbg_model = _configured_rmbg_model_path()
    if rmbg_model is not None:
        cmd += ["--rmbg_model_path", str(rmbg_model)]

    reference_path = req.reference_image_path
    if reference_path:
        reference_path = (
            str((BASE_DIR / reference_path).resolve())
            if not Path(reference_path).is_absolute()
            else reference_path
        )
        cmd += ["--reference_image_path", reference_path]

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    _apply_pipeline_model_env(env)

    _write_job_settings(
        output_dir,
        {
            "provider": provider,
            "svg_model": svg_model,
            "image_provider": image_provider,
            "image_model": image_model,
            "image_size": image_size,
            "enable_upscale": enable_upscale,
            "sam_prompt": sam_prompt,
            "sam_backend": sam_backend,
            "sam_max_masks": sam_max_masks,
            "placeholder_mode": placeholder_mode,
            "merge_threshold": merge_threshold,
            "optimize_iterations": optimize_iterations,
            "multimodal_image_scale": multimodal_image_scale,
        },
    )

    log_path = output_dir / "run.log"
    meta_line = f"[meta] python={PYTHON_EXECUTABLE}\n[meta] cmd={_redact_cmd_args(cmd)}\n"
    if resume_job_id and log_path.is_file():
        with open(log_path, "a", encoding="utf-8") as handle:
            label = "svg_rerun" if svg_only_rerun else "resume"
            handle.write(f"\n[meta] {label} at {datetime.now().isoformat()}\n")
            handle.write(meta_line)
            handle.write(
                f"[meta] multimodal_image_scale={multimodal_image_scale:g} "
                f"optimize_iterations={optimize_iterations}\n"
            )
    else:
        log_path.write_text(
            meta_line
            + f"[meta] multimodal_image_scale={multimodal_image_scale:g} "
            + f"optimize_iterations={optimize_iterations}\n",
            encoding="utf-8",
        )

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env=env,
        cwd=str(BASE_DIR),
    )

    job = Job(
        job_id=job_id,
        output_dir=output_dir,
        process=process,
        queue=queue.Queue(),
        log_path=log_path,
    )
    JOBS[job_id] = job

    monitor_thread = threading.Thread(target=_monitor_job, args=(job,), daemon=True)
    monitor_thread.start()

    return JSONResponse(
        {
            "job_id": job_id,
            "multimodal_image_scale": multimodal_image_scale,
            "start_from": start_from,
            "svg_only_rerun": svg_only_rerun,
        }
    )


@app.post("/api/upload")
async def upload_reference(file: UploadFile = File(...)) -> JSONResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    ext = Path(file.filename).suffix.lower()
    if ext not in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}:
        ext = ".png"

    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large")

    name = f"{uuid.uuid4().hex}{ext}"
    out_path = UPLOADS_DIR / name
    out_path.write_bytes(data)

    return JSONResponse(
        {"path": str(out_path), "url": f"/api/uploads/{name}", "name": file.filename}
    )


@app.get("/api/events/{job_id}")
def stream_events(job_id: str) -> StreamingResponse:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    def event_stream():
        while True:
            try:
                item = job.queue.get(timeout=1.0)
            except queue.Empty:
                if job.done:
                    break
                continue
            if item.get("event") == "close":
                break
            yield _format_sse(item["event"], item["data"])

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/api/artifacts/{job_id}/{path:path}")
def get_artifact(job_id: str, path: str) -> Response:
    job = JOBS.get(job_id)
    output_dir = job.output_dir if job else _resolve_output_dir(job_id)
    if not output_dir:
        raise HTTPException(status_code=404, detail="Job not found")
    return _artifact_file_response(output_dir, path)


@app.get("/api/uploads/{filename}")
def get_upload(filename: str) -> Response:
    candidate = (UPLOADS_DIR / filename).resolve()
    if not str(candidate).startswith(str(UPLOADS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        payload = candidate.read_bytes()
    except OSError as exc:
        raise HTTPException(status_code=404, detail=f"File unreadable: {exc}") from exc
    media_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
    return Response(
        content=payload,
        media_type=media_type,
        headers={
            "Content-Disposition": f'inline; filename="{candidate.name}"',
            "Cache-Control": "no-store",
        },
    )


def _format_sse(event: str, data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=True)
    return f"event: {event}\ndata: {payload}\n\n"


def _is_safe_job_id(job_id: str) -> bool:
    if not job_id or len(job_id) > 128:
        return False
    for ch in job_id:
        if not (ch.isalnum() or ch in {"_", "-"}):
            return False
    return True


def _resolve_output_dir(job_id: str) -> Path | None:
    if not job_id or "/" in job_id or "\\" in job_id:
        return None
    candidate = (OUTPUTS_DIR / job_id).resolve()
    try:
        candidate.relative_to(OUTPUTS_DIR.resolve())
    except ValueError:
        return None
    return candidate if candidate.is_dir() else None


def _artifact_file_response(output_dir: Path, path: str) -> Response:
    candidate = (output_dir / path).resolve()
    try:
        candidate.relative_to(output_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    # Read into memory so Content-Length matches the body even if the pipeline
    # is still appending to the same path (growing final.svg / figure.png).
    # Artifact files are job outputs, not multi-GB streams.
    try:
        payload = candidate.read_bytes()
    except OSError as exc:
        raise HTTPException(status_code=404, detail=f"File unreadable: {exc}") from exc
    media_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
    return Response(
        content=payload,
        media_type=media_type,
        headers={
            "Content-Disposition": f'inline; filename="{candidate.name}"',
            "Cache-Control": "no-store",
        },
    )


def _history_sort_key(output_dir: Path) -> float:
    try:
        return max(
            (path.stat().st_mtime for path in output_dir.rglob("*") if path.is_file()),
            default=output_dir.stat().st_mtime,
        )
    except OSError:
        return 0.0


def _history_timestamp_from_job_id(job_id: str) -> datetime | None:
    try:
        return datetime.strptime(job_id[:15], "%Y%m%d_%H%M%S")
    except ValueError:
        return None


def _iso_from_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp).isoformat(timespec="seconds")


def _build_history_item(job_id: str) -> dict | None:
    output_dir = _resolve_output_dir(job_id)
    if not output_dir:
        return None

    artifacts = _collect_artifacts(job_id, output_dir)
    if not artifacts:
        return None

    latest_mtime = _history_sort_key(output_dir)
    parsed_created_at = _history_timestamp_from_job_id(job_id)
    created_at = (
        parsed_created_at.isoformat(timespec="seconds")
        if parsed_created_at
        else _iso_from_timestamp(latest_mtime)
    )

    by_kind = {artifact["kind"]: artifact for artifact in artifacts}
    thumbnail = next(
        (artifact for artifact in artifacts if artifact["kind"] in HISTORY_THUMBNAIL_KINDS),
        artifacts[0],
    )
    primary = next(
        (by_kind[kind] for kind in HISTORY_PRIMARY_KINDS if kind in by_kind),
        thumbnail,
    )
    status = "complete" if "final_svg" in by_kind else "partial"
    settings = _load_job_settings(output_dir)

    return {
        "job_id": job_id,
        "created_at": created_at,
        "updated_at": _iso_from_timestamp(latest_mtime),
        "status": status,
        "artifact_count": len(artifacts),
        "thumbnail_url": thumbnail["url"],
        "thumbnail_kind": thumbnail["kind"],
        "primary_artifact": primary,
        "open_url": f"/canvas.html?job={job_id}&source=history",
        "artifacts": artifacts,
        "settings": {
            "multimodal_image_scale": settings.get(
                "multimodal_image_scale", DEFAULT_MULTIMODAL_IMAGE_SCALE
            ),
            "optimize_iterations": settings.get("optimize_iterations"),
            "svg_model": settings.get("svg_model"),
            "provider": settings.get("provider"),
        },
    }


def _collect_artifacts(job_id: str, output_dir: Path) -> list[dict]:
    candidates: list[Path] = []
    for name in HISTORY_ARTIFACT_ORDER:
        candidates.append(output_dir / name)

    icons_dir = output_dir / "icons"
    if icons_dir.is_dir():
        candidates.extend(sorted(icons_dir.glob("icon_*.png")))

    seen: set[str] = set()
    artifacts: list[dict] = []
    for path in candidates:
        if not path.is_file():
            continue
        rel_path = path.relative_to(output_dir).as_posix()
        if rel_path in seen:
            continue
        seen.add(rel_path)
        artifacts.append(_artifact_payload(job_id, path, rel_path))
    return artifacts


def _artifact_payload(job_id: str, path: Path, rel_path: str) -> dict:
    stat = path.stat()
    return {
        "kind": _classify_artifact(rel_path),
        "name": path.name,
        "path": rel_path,
        "url": f"/api/artifacts/{job_id}/{rel_path}",
        "updated_at": _iso_from_timestamp(stat.st_mtime),
        "size": stat.st_size,
    }


def _monitor_job(job: Job) -> None:
    job.push("status", {"state": "started"})

    stdout_thread = threading.Thread(
        target=_pipe_output, args=(job, job.process.stdout, "stdout"), daemon=True
    )
    stderr_thread = threading.Thread(
        target=_pipe_output, args=(job, job.process.stderr, "stderr"), daemon=True
    )
    stdout_thread.start()
    stderr_thread.start()

    idle_cycles = 0
    while True:
        _scan_artifacts(job)

        if job.process.poll() is not None:
            idle_cycles += 1
        else:
            idle_cycles = 0

        if idle_cycles >= 4:
            break
        time.sleep(0.5)

    _scan_artifacts(job)
    job.push("status", {"state": "finished", "code": job.process.returncode})
    job.push(
        "artifact",
        {
            "kind": "log",
            "name": job.log_path.name,
            "path": job.log_path.relative_to(job.output_dir).as_posix(),
            "url": f"/api/artifacts/{job.job_id}/{job.log_path.name}",
        },
    )
    job.done = True
    job.push("close", {})


def _pipe_output(job: Job, pipe, stream_name: str) -> None:
    if pipe is None:
        return
    for line in iter(pipe.readline, ""):
        text = line.rstrip()
        if text:
            job.write_log(stream_name, text)
            job.push("log", {"stream": stream_name, "line": text})
    pipe.close()


def _scan_artifacts(job: Job) -> None:
    output_dir = job.output_dir
    candidates = [
        output_dir / "figure.png",
        output_dir / "samed.png",
        output_dir / "template.svg",
        output_dir / "optimized_template.svg",
        output_dir / "final.svg",
    ]

    icons_dir = output_dir / "icons"
    if icons_dir.is_dir():
        candidates.extend(icons_dir.glob("icon_*.png"))

    for path in candidates:
        if not path.is_file():
            continue
        rel_path = path.relative_to(output_dir).as_posix()
        if rel_path in job.seen:
            continue
        job.seen.add(rel_path)

        job.push("artifact", _artifact_payload(job.job_id, path, rel_path))


def _classify_artifact(rel_path: str) -> str:
    if rel_path == "figure.png":
        return "figure"
    if rel_path == "samed.png":
        return "samed"
    if rel_path.endswith("_nobg.png"):
        return "icon_nobg"
    if rel_path.startswith("icons/") and rel_path.endswith(".png"):
        return "icon_raw"
    if rel_path == "template.svg":
        return "template_svg"
    if rel_path == "optimized_template.svg":
        return "optimized_template_svg"
    if rel_path == "final.svg":
        return "final_svg"
    if rel_path == "boxlib.json":
        return "boxlib"
    if rel_path == "run.log":
        return "log"
    return "artifact"


def _port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("0.0.0.0", port))
        except OSError:
            return True
    return False


def _pids_on_port(port: int) -> set[int]:
    pids: set[int] = set()

    if shutil.which("lsof"):
        result = subprocess.run(
            ["lsof", "-t", f"-i:{port}"],
            capture_output=True,
            text=True,
        )
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.isdigit():
                pids.add(int(line))
        return pids

    if shutil.which("ss"):
        result = subprocess.run(
            ["ss", "-lptn", f"sport = :{port}"],
            capture_output=True,
            text=True,
        )
        for line in result.stdout.splitlines():
            if "pid=" in line:
                for part in line.split("pid=")[1:]:
                    pid_str = "".join(ch for ch in part if ch.isdigit())
                    if pid_str:
                        pids.add(int(pid_str))
        return pids

    if shutil.which("netstat"):
        result = subprocess.run(
            ["netstat", "-tlnp"],
            capture_output=True,
            text=True,
        )
        for line in result.stdout.splitlines():
            if f":{port} " not in line or "LISTEN" not in line:
                continue
            fields = line.split()
            if fields and "/" in fields[-1]:
                pid_part = fields[-1].split("/")[0]
                if pid_part.isdigit():
                    pids.add(int(pid_part))

    return pids


def _read_cmdline(pid: int) -> str:
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as handle:
            data = handle.read()
        parts = [p for p in data.split(b"\x00") if p]
        return " ".join(part.decode(errors="ignore") for part in parts)
    except OSError:
        return ""


def _is_uvicorn_process(pid: int) -> bool:
    cmdline = _read_cmdline(pid)
    if not cmdline:
        return False
    if "uvicorn" not in cmdline:
        return False
    return "server:app" in cmdline or "server.py" in cmdline


def _terminate_pids(pids: set[int], timeout: float = 2.0) -> None:
    current_pid = os.getpid()
    for pid in sorted(pids):
        if pid <= 1 or pid == current_pid:
            continue
        if not _is_uvicorn_process(pid):
            continue
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue

    deadline = time.time() + timeout
    while time.time() < deadline:
        alive = False
        for pid in pids:
            if pid <= 1 or pid == current_pid:
                continue
            if not _is_uvicorn_process(pid):
                continue
            try:
                os.kill(pid, 0)
                alive = True
            except ProcessLookupError:
                continue
        if not alive:
            return
        time.sleep(0.1)

    for pid in sorted(pids):
        if pid <= 1 or pid == current_pid:
            continue
        if not _is_uvicorn_process(pid):
            continue
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            continue


def _ensure_port_free(port: int) -> None:
    if not _port_in_use(port):
        return
    pids = _pids_on_port(port)
    if not pids:
        return
    _terminate_pids(pids)


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("FIGONE_PORT", os.environ.get("FIGRA_PORT", "8000")))
    requested_host = os.environ.get("FIGONE_HOST", os.environ.get("FIGRA_HOST", "0.0.0.0"))

    try:
        print("--- Starting Server ---")
        print(f"Local access: http://127.0.0.1:{port}")
        print(f"Bind host: {requested_host}")
        print("-----------------------")

        uvicorn.run(
            "server:app",
            host=requested_host,
            port=port,
            reload=False,
            access_log=False,
        )
    except Exception as e:
        print(f"Startup failed: {e}")
        sys.exit(1)
