"""
检测框（box）几何与分割产物的共享工具。

拆出独立模块的原因：server.py 需要在不加载 torch/transformers 的前提下
读写 boxlib.json、重画 samed.png、判定"当前停在哪个审阅门"；而
autofigure2.py 的步骤二要产出同样的文件。两边共用一份实现，避免漂移。

只依赖 Pillow + 标准库，保持可被 server 轻量 import。
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from PIL import Image, ImageDraw, ImageFont

FIGURE_FILENAME = "figure.png"
SAMED_FILENAME = "samed.png"
BOXLIB_FILENAME = "boxlib.json"
ICON_REVIEW_FILENAME = "icon_review.json"
TEMPLATE_FILENAME = "template.svg"
FINAL_FILENAME = "final.svg"
ICONS_DIRNAME = "icons"
BOXLIB_NO_ICON_MODE_KEY = "no_icon_mode"

# 人工编辑框允许的最小边长（图像像素）：几像素的框没有保留价值，
# 且会在步骤三裁切出近乎空白的图标。
MIN_BOX_SIDE = 8

# label_clean 的合法字符（用于拼接文件名与 glob 前缀，必须收窄，
# 挡住 "../" 之类会改变路径含义的输入）。
_LABEL_CLEAN_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


def _safe_label_clean(label: str) -> Optional[str]:
    cleaned = normalize_label_clean(label)
    return cleaned if _LABEL_CLEAN_RE.match(cleaned) else None


def _nonempty_file(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def normalize_label_clean(label: str) -> str:
    """`<AF>1` / `AF1` / `1` -> `AF01`；其余原样返回。"""
    text = str(label or "").strip().replace("<", "").replace(">", "")
    upper = text.upper()
    if upper.startswith("AF") and text[2:].isdigit():
        return f"AF{int(text[2:]):02d}"
    if text.isdigit():
        return f"AF{int(text):02d}"
    return text


def clamp_box(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    width: int,
    height: int,
) -> Optional[tuple[int, int, int, int]]:
    """
    将 box 裁剪到图片边界内；越界坐标必须在写入 boxlib.json 之前收敛，
    否则 PIL 的 Image.crop() 会静默填充黑边。裁剪后为空框返回 None。
    """
    try:
        left, top, right, bottom = float(x1), float(y1), float(x2), float(y2)
    except (TypeError, ValueError):
        return None

    if right < left:
        left, right = right, left
    if bottom < top:
        top, bottom = bottom, top

    cx1 = max(0, min(width, int(round(left))))
    cy1 = max(0, min(height, int(round(top))))
    cx2 = max(0, min(width, int(round(right))))
    cy2 = max(0, min(height, int(round(bottom))))
    if cx2 - cx1 <= 0 or cy2 - cy1 <= 0:
        return None
    return (cx1, cy1, cx2, cy2)


def normalize_boxes(raw_boxes: list, image_size: tuple[int, int]) -> list[dict]:
    """
    规范化人工编辑后的框列表：收敛到图内、丢弃退化框、按阅读顺序
    （先上后下、先左后右）排序并重新编号 id/label。

    人工新增的框没有 score/prompt，填中性默认值以便下游字段完整。
    """
    width, height = int(image_size[0]), int(image_size[1])
    cleaned: list[dict] = []
    for raw in raw_boxes or []:
        if not isinstance(raw, dict):
            continue
        clamped = clamp_box(
            raw.get("x1"), raw.get("y1"), raw.get("x2"), raw.get("y2"), width, height
        )
        if clamped is None:
            continue
        x1, y1, x2, y2 = clamped
        if x2 - x1 < MIN_BOX_SIDE or y2 - y1 < MIN_BOX_SIDE:
            continue
        try:
            score = float(raw.get("score", 1.0))
        except (TypeError, ValueError):
            score = 1.0
        prompt = str(raw.get("prompt") or "manual")
        cleaned.append(
            {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "score": score, "prompt": prompt}
        )

    cleaned.sort(key=lambda b: (b["y1"], b["x1"]))
    numbered = []
    for idx, box in enumerate(cleaned):
        numbered.append(
            {
                "id": idx,
                "label": f"<AF>{idx + 1:02d}",
                **box,
            }
        )
    return numbered


def get_label_font(box_width: int, box_height: int) -> ImageFont.FreeTypeFont | None:
    """根据 box 短边动态选择字号（12-48），与步骤二的绘制规则一致。"""
    min_dim = min(box_width, box_height)
    font_size = max(12, min(48, min_dim // 4))

    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",  # macOS
        "C:/Windows/Fonts/arial.ttf",  # Windows
    ]
    for font_path in font_paths:
        try:
            return ImageFont.truetype(font_path, font_size)
        except (IOError, OSError):
            continue

    try:
        return ImageFont.load_default()
    except Exception:
        return None


def draw_samed_image(image: Image.Image, boxes: list) -> Image.Image:
    """在 figure 副本上绘制灰色填充 + 黑色边框 + 白色序号标签的 samed 标记图。"""
    samed_image = image.copy().convert("RGB")
    draw = ImageDraw.Draw(samed_image)

    for box_info in boxes:
        x1, y1, x2, y2 = box_info["x1"], box_info["y1"], box_info["x2"], box_info["y2"]
        label = box_info.get("label", "")

        draw.rectangle([x1, y1, x2, y2], fill="#808080", outline="black", width=3)

        cx = (x1 + x2) // 2
        cy = (y1 + y2) // 2
        font = get_label_font(x2 - x1, y2 - y1)

        if font:
            try:
                draw.text((cx, cy), label, fill="white", anchor="mm", font=font)
            except TypeError:
                bbox = draw.textbbox((0, 0), label, font=font)
                text_width = bbox[2] - bbox[0]
                text_height = bbox[3] - bbox[1]
                draw.text(
                    (cx - text_width // 2, cy - text_height // 2),
                    label,
                    fill="white",
                    font=font,
                )
        else:
            draw.text((cx, cy), label, fill="white")

    return samed_image


def write_samed_and_boxlib(
    output_dir: str | Path,
    image: Image.Image,
    boxes: list,
    prompts_used: list | None = None,
) -> tuple[Path, Path]:
    """写入 samed.png 与 boxlib.json，返回两个文件路径。"""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    samed_image = draw_samed_image(image, boxes)
    samed_path = output_dir / SAMED_FILENAME
    samed_image.save(str(samed_path))

    boxlib_data = {
        "image_size": {"width": image.width, "height": image.height},
        "prompts_used": list(prompts_used or []),
        "boxes": boxes,
        BOXLIB_NO_ICON_MODE_KEY: len(boxes) == 0,
    }
    boxlib_path = output_dir / BOXLIB_FILENAME
    with open(boxlib_path, "w", encoding="utf-8") as f:
        json.dump(boxlib_data, f, indent=2, ensure_ascii=False)
    return samed_path, boxlib_path


def load_boxlib(output_dir: str | Path) -> dict:
    """读取 boxlib.json；缺失或损坏时返回空骨架。"""
    path = Path(output_dir) / BOXLIB_FILENAME
    if not _nonempty_file(path):
        return {"image_size": None, "prompts_used": [], "boxes": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"image_size": None, "prompts_used": [], "boxes": []}
    if not isinstance(data, dict):
        return {"image_size": None, "prompts_used": [], "boxes": []}
    boxes = data.get("boxes") if isinstance(data.get("boxes"), list) else []
    return {
        "image_size": data.get("image_size"),
        "prompts_used": data.get("prompts_used") or [],
        "boxes": boxes,
    }


def _icon_files_for_label(icons_dir: Path, label_clean: str) -> list[Path]:
    """某 label 的全部图标产物（crop / nobg / matte 及未知后缀变体）。"""
    prefix = f"icon_{label_clean}"
    if not icons_dir.is_dir():
        return []
    return sorted(p for p in icons_dir.glob(f"{prefix}*.png") if p.is_file())


def _wipe_step3_artifacts(output_dir: Path) -> int:
    """
    清空步骤三产物（icons/*.png + icon_review.json）。

    框重新编号后 label 会整体移位，逐个清理既繁琐又易漏；
    步骤三必须全量重做，这里直接清空最稳妥。
    """
    removed = 0
    review_path = output_dir / ICON_REVIEW_FILENAME
    if review_path.is_file():
        try:
            review_path.unlink()
            removed += 1
        except OSError:
            pass
    icons_dir = output_dir / ICONS_DIRNAME
    if icons_dir.is_dir():
        for png in icons_dir.glob("icon_*.png"):
            try:
                png.unlink()
                removed += 1
            except OSError:
                pass
    return removed


def _filter_icon_review_labels(output_dir: Path, keep_labels: set[str]) -> bool:
    """从 icon_review.json 中剔除不在 keep_labels 里的条目。返回是否改动。"""
    review_path = output_dir / ICON_REVIEW_FILENAME
    if not _nonempty_file(review_path):
        return False
    try:
        data = json.loads(review_path.read_text(encoding="utf-8"))
        icons = data.get("icons")
        if not isinstance(icons, list):
            return False
        kept = [
            item
            for item in icons
            if isinstance(item, dict)
            and normalize_label_clean(item.get("label_clean") or item.get("label") or "")
            in keep_labels
        ]
        if len(kept) == len(icons):
            return False
        data["icons"] = kept
        data["updated_at"] = datetime.now().isoformat(timespec="seconds")
        review_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return True
    except (OSError, json.JSONDecodeError):
        return False


def apply_manual_box_edits(output_dir: str | Path, raw_boxes: list) -> dict:
    """
    应用人工编辑后的框列表（步骤二审阅门的保存动作）。

    - 规范化并重新编号，重写 boxlib.json
    - 用 figure.png 重画 samed.png，保证步骤四 LLM 看到的占位图与人工编辑一致
    - 全量清空步骤三产物（icons + icon_review.json），框变了裁切必须重做
    """
    output_dir = Path(output_dir)
    figure_path = output_dir / FIGURE_FILENAME
    if not _nonempty_file(figure_path):
        raise FileNotFoundError("缺少 figure.png，无法应用框编辑")

    image = Image.open(figure_path)
    try:
        boxes = normalize_boxes(raw_boxes, (image.width, image.height))
        previous = load_boxlib(output_dir)
        samed_path, boxlib_path = write_samed_and_boxlib(
            output_dir, image, boxes, previous.get("prompts_used")
        )
    finally:
        try:
            image.close()
        except Exception:
            pass
    pruned = _wipe_step3_artifacts(output_dir)
    return {
        "image_size": {"width": image.width, "height": image.height},
        "prompts_used": previous.get("prompts_used") or [],
        "boxes": boxes,
        BOXLIB_NO_ICON_MODE_KEY: len(boxes) == 0,
        "samed_path": str(samed_path),
        "boxlib_path": str(boxlib_path),
        "pruned_files": pruned,
    }


def delete_box(output_dir: str | Path, label: str) -> dict:
    """
    删除单个 box（审图台"误检删除"）。

    与 apply_manual_box_edits 的区别：**不重新编号**——步骤三已完成时，
    其余图标的 label 与裁切文件保持有效，可从步骤四直接继续。
    """
    output_dir = Path(output_dir)
    boxlib_path = output_dir / BOXLIB_FILENAME
    if not _nonempty_file(boxlib_path):
        raise FileNotFoundError("缺少 boxlib.json")
    figure_path = output_dir / FIGURE_FILENAME
    if not _nonempty_file(figure_path):
        raise FileNotFoundError("缺少 figure.png，无法重画 samed.png")

    data = load_boxlib(output_dir)
    target = _safe_label_clean(label)
    if target is None:
        raise KeyError(f"无效 box 标签: {label}")
    boxes = data.get("boxes") or []
    remaining = [
        b
        for b in boxes
        if normalize_label_clean(b.get("label") or "") != target
    ]
    if len(remaining) == len(boxes):
        raise KeyError(f"未找到 box: {label}")

    image = Image.open(figure_path)
    try:
        samed_path, boxlib_path = write_samed_and_boxlib(
            output_dir, image, remaining, data.get("prompts_used")
        )
    finally:
        try:
            image.close()
        except Exception:
            pass

    removed_files = 0
    icons_dir = output_dir / ICONS_DIRNAME
    for png in _icon_files_for_label(icons_dir, target):
        try:
            png.unlink()
            removed_files += 1
        except OSError:
            pass
    _filter_icon_review_labels(
        output_dir, {normalize_label_clean(b.get("label") or "") for b in remaining}
    )

    return {
        "image_size": {"width": image.width, "height": image.height},
        "prompts_used": data.get("prompts_used") or [],
        "boxes": remaining,
        BOXLIB_NO_ICON_MODE_KEY: len(remaining) == 0,
        "samed_path": str(samed_path),
        "boxlib_path": str(boxlib_path),
        "removed_label": target,
        "removed_files": removed_files,
    }


def _icons_complete(output_dir: Path, boxes: list) -> bool:
    """boxlib 里每个 box 都有非空的 crop 与 nobg 文件，才认为步骤三完成。"""
    icons_dir = output_dir / ICONS_DIRNAME
    for box in boxes:
        label_clean = normalize_label_clean(box.get("label") or "")
        if not label_clean:
            return False
        if not _nonempty_file(icons_dir / f"icon_{label_clean}.png"):
            return False
        if not _nonempty_file(icons_dir / f"icon_{label_clean}_nobg.png"):
            return False
    return True


def compute_awaiting_gate(output_dir: str | Path) -> Optional[int]:
    """
    根据磁盘产物判定任务当前停在哪个审阅门。

    Returns:
        1: figure.png 已生成，等待生图审阅
        2: samed/boxlib 已生成但图标未（全部）产出，等待框编辑
        3: 图标已齐（含零图标模式）但 template.svg 未生成，等待抠图审阅
        4: template.svg 已生成但 final.svg 未生成，等待模板审阅
        None: 无产物 / 全部完成 / 不处于任何门
    """
    output_dir = Path(output_dir)
    if not _nonempty_file(output_dir / FIGURE_FILENAME):
        return None
    if not _nonempty_file(output_dir / SAMED_FILENAME):
        return 1

    data = load_boxlib(output_dir)
    boxes = data.get("boxes") or []
    if not _nonempty_file(output_dir / BOXLIB_FILENAME) or not _icons_complete(
        output_dir, boxes
    ):
        return 2
    if not _nonempty_file(output_dir / TEMPLATE_FILENAME):
        return 3
    if not _nonempty_file(output_dir / FINAL_FILENAME):
        return 4
    return None
