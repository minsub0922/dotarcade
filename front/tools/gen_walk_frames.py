#!/usr/bin/env python3
"""Build deterministic 48x72 walking sprites for sprites_v2.

The source art already has the desired character design.  This builder keeps the
art on the integer pixel grid, removes semi-transparent chroma-key fringes, and
adds a small, reversible body/hip shift for two walking poses.  The bottom of the
main body and any detached floor-shadow components remain fixed.

Output per character::

    walk/{down,left,right,up}/{idle,stepL,stepR}.png  # QA frames
    walk-sheet.png                                    # runtime atlas

The atlas is 144x288: columns idle/stepL/stepR and rows
down/left/right/up.  ``walk.json`` records every cell and validation result.

sprites_v2 was originally exported with left/right facing files reversed.  On
the first run this script repairs those files in place.  Later runs use the
canonical source hashes in walk.json, making the operation idempotent.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import deque
from pathlib import Path
from typing import Iterable

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - environment-specific guidance
    raise SystemExit(
        "Pillow is required. Run with the workspace Python runtime or install "
        "Pillow: python3 -m pip install Pillow"
    ) from exc


FRAME_SIZE = (48, 72)
ANCHOR = (24, 66)
DIRECTIONS = ("down", "left", "right", "up")
FRAMES = ("idle", "stepL", "stepR")
ROWS = {direction: index for index, direction in enumerate(DIRECTIONS)}
COLUMNS = {frame: index for index, frame in enumerate(FRAMES)}
SEQUENCE = ("idle", "stepL", "idle", "stepR")
FPS = 8
ALPHA_THRESHOLD = 96
FOOT_ROWS = 4
GENERATOR_VERSION = 1

# Provenance of the legacy export.  The repaired canonical file name is the key;
# the value is the file from which its pixels originated before the first run.
LEGACY_SOURCE_DIRECTION = {
    "down": "down",
    "left": "right",
    "right": "left",
    "up": "up",
}

Pixel = tuple[int, int]
RGBA = tuple[int, int, int, int]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hard_alpha(image: Image.Image) -> Image.Image:
    """Quantize alpha without resampling and clear RGB in transparent pixels."""
    source = image.convert("RGBA")
    if source.size != FRAME_SIZE:
        raise ValueError(f"expected {FRAME_SIZE}, got {source.size}")
    output = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
    src = source.load()
    dst = output.load()
    for y in range(FRAME_SIZE[1]):
        for x in range(FRAME_SIZE[0]):
            r, g, b, a = src[x, y]
            if a >= ALPHA_THRESHOLD:
                dst[x, y] = (r, g, b, 255)
    return output


def opaque_pixels(image: Image.Image) -> set[Pixel]:
    pixels = image.load()
    width, height = image.size
    return {
        (x, y)
        for y in range(height)
        for x in range(width)
        if pixels[x, y][3] == 255
    }


def flattened_pixels(image: Image.Image) -> tuple[RGBA, ...]:
    """Return row-major pixels without relying on Pillow's deprecated getdata."""
    pixels = image.load()
    width, height = image.size
    return tuple(pixels[x, y] for y in range(height) for x in range(width))


def connected_components(mask: set[Pixel]) -> list[set[Pixel]]:
    """Return deterministic 8-connected alpha components, largest first."""
    remaining = set(mask)
    components: list[set[Pixel]] = []
    while remaining:
        seed = min(remaining, key=lambda point: (point[1], point[0]))
        remaining.remove(seed)
        component = {seed}
        queue: deque[Pixel] = deque((seed,))
        while queue:
            x, y = queue.popleft()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    neighbour = (x + dx, y + dy)
                    if neighbour in remaining:
                        remaining.remove(neighbour)
                        component.add(neighbour)
                        queue.append(neighbour)
        components.append(component)
    components.sort(
        key=lambda component: (
            -len(component),
            min(y for _, y in component),
            min(x for x, _ in component),
        )
    )
    return components


def bbox(points: Iterable[Pixel]) -> tuple[int, int, int, int]:
    points = tuple(points)
    if not points:
        raise ValueError("cannot calculate a bounding box for an empty mask")
    xs = tuple(x for x, _ in points)
    ys = tuple(y for _, y in points)
    return min(xs), min(ys), max(xs), max(ys)


def centroid(points: Iterable[Pixel]) -> tuple[float, float]:
    points = tuple(points)
    if not points:
        raise ValueError("cannot calculate a centroid for an empty mask")
    return (
        sum(x for x, _ in points) / len(points),
        sum(y for _, y in points) / len(points),
    )


def pose_dx(y: int, top: int, bottom: int, phase: int) -> int:
    """Integer-only S-curve: shoulders and hips counter-shift by one pixel."""
    height = max(1, bottom - top + 1)
    relative = (y - top) / height
    if 0.42 <= relative < 0.63:
        return phase
    if 0.68 <= relative < 0.84:
        return -phase
    return 0


def make_pose(idle: Image.Image, phase: int) -> Image.Image:
    """Create a step pose while fixing support pixels and detached shadows."""
    if phase not in (-1, 1):
        raise ValueError("phase must be -1 or 1")
    components = connected_components(opaque_pixels(idle))
    if not components:
        raise ValueError("sprite contains no opaque pixels")
    body = components[0]
    _, top, _, bottom = bbox(body)
    foot_lock_y = bottom - FOOT_ROWS + 1

    source = idle.load()
    output = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
    destination = output.load()

    # Preserve detached accessories and floor shadows byte-for-byte.
    for component in components[1:]:
        for x, y in component:
            destination[x, y] = source[x, y]

    # A whole scanline moves together.  No interpolation, blends, or fractional
    # placement are possible; the final four body rows remain exactly anchored.
    for x, y in sorted(body, key=lambda point: (point[1], point[0])):
        dx = 0 if y >= foot_lock_y else pose_dx(y, top, bottom, phase)
        target_x = x + dx
        if not 0 <= target_x < FRAME_SIZE[0]:
            raise ValueError(f"pose would leave frame at {(x, y)} -> {target_x}")
        destination[target_x, y] = source[x, y]
    return output


def main_component(image: Image.Image) -> set[Pixel]:
    components = connected_components(opaque_pixels(image))
    if not components:
        raise ValueError("sprite contains no opaque pixels")
    return components[0]


def support_pixels(component: set[Pixel]) -> set[Pixel]:
    bottom = max(y for _, y in component)
    return {point for point in component if point[1] >= bottom - FOOT_ROWS + 1}


def rounded_pair(point: tuple[float, float]) -> list[float]:
    return [round(point[0], 3), round(point[1], 3)]


def validate_frame(
    frame: Image.Image,
    idle: Image.Image,
    frame_name: str,
) -> dict[str, object]:
    if frame.mode != "RGBA":
        raise ValueError(f"{frame_name}: image mode must be RGBA")
    if frame.size != FRAME_SIZE:
        raise ValueError(f"{frame_name}: expected {FRAME_SIZE}, got {frame.size}")

    colors = flattened_pixels(frame)
    alpha_values = {pixel[3] for pixel in colors}
    if not alpha_values <= {0, 255}:
        raise ValueError(f"{frame_name}: alpha fringe detected: {alpha_values}")
    if any(pixel[:3] != (0, 0, 0) for pixel in colors if pixel[3] == 0):
        raise ValueError(f"{frame_name}: transparent RGB fringe detected")

    idle_body = main_component(idle)
    frame_body = main_component(frame)
    idle_center = centroid(idle_body)
    frame_center = centroid(frame_body)
    center_error = max(
        abs(frame_center[0] - idle_center[0]),
        abs(frame_center[1] - idle_center[1]),
    )
    idle_support = support_pixels(idle_body)
    frame_support = support_pixels(frame_body)
    idle_foot = centroid(idle_support)
    frame_foot = centroid(frame_support)
    foot_error = max(
        abs(frame_foot[0] - idle_foot[0]),
        abs(frame_foot[1] - idle_foot[1]),
    )
    bottom_error = abs(
        max(y for _, y in frame_body) - max(y for _, y in idle_body)
    )
    if center_error > 1.0 + 1e-9:
        raise ValueError(f"{frame_name}: center error {center_error:.3f}px > 1px")
    if foot_error > 1.0 + 1e-9 or bottom_error > 1:
        raise ValueError(
            f"{frame_name}: foot error {foot_error:.3f}px / "
            f"bottom error {bottom_error}px"
        )

    changed_pixels = sum(
        1
        for current, baseline in zip(
            flattened_pixels(frame), flattened_pixels(idle)
        )
        if current != baseline
    )
    if frame_name != "idle" and changed_pixels == 0:
        raise ValueError(f"{frame_name}: pose is identical to idle")

    return {
        "alpha": "binary",
        "anchor": list(ANCHOR),
        "bodyCenter": rounded_pair(frame_center),
        "bodyCenterErrorPx": round(center_error, 3),
        "footCenter": rounded_pair(frame_foot),
        "footCenterErrorPx": round(foot_error, 3),
        "footBaselineErrorPx": bottom_error,
        "changedPixelsFromIdle": changed_pixels,
    }


def source_hashes(root: Path, character_ids: Iterable[str]) -> dict[str, dict[str, str]]:
    return {
        character_id: {
            direction: sha256_file(root / character_id / f"{direction}.png")
            for direction in DIRECTIONS
        }
        for character_id in character_ids
    }


def swap_pair(left: Path, right: Path) -> None:
    """Swap exact PNG bytes using same-directory temporary files."""
    left_bytes = left.read_bytes()
    right_bytes = right.read_bytes()
    left_tmp = left.with_name(f".{left.name}.canonical-tmp")
    right_tmp = right.with_name(f".{right.name}.canonical-tmp")
    left_tmp.write_bytes(right_bytes)
    right_tmp.write_bytes(left_bytes)
    os.replace(left_tmp, left)
    os.replace(right_tmp, right)


def ensure_canonical_facing(
    root: Path,
    character_ids: list[str],
    previous: dict[str, object] | None,
) -> tuple[dict[str, dict[str, str]], str]:
    """Repair the known legacy swap once, then verify it by exact hashes."""
    before = source_hashes(root, character_ids)
    previous_facing = (previous or {}).get("sourceFacing", {})
    expected = (
        previous_facing.get("canonicalSha256", {})
        if isinstance(previous_facing, dict)
        else {}
    )

    if expected:
        if set(expected) != set(character_ids):
            raise ValueError(
                "walk.json roster differs from sprites.json; refusing to guess "
                "the facing of newly added or removed source files"
            )
        all_canonical = all(
            before[character_id] == expected[character_id]
            for character_id in character_ids
        )
        all_legacy = all(
            before[character_id]["down"] == expected[character_id]["down"]
            and before[character_id]["up"] == expected[character_id]["up"]
            and before[character_id]["left"] == expected[character_id]["right"]
            and before[character_id]["right"] == expected[character_id]["left"]
            for character_id in character_ids
        )
        if all_canonical:
            return before, "verified-existing"
        if not all_legacy:
            raise ValueError(
                "source direction hashes do not match either canonical or known "
                "legacy orientation; refusing an ambiguous swap"
            )

    # With no prior manifest, the repository's audited state is the known legacy
    # export.  Capture the exact mapping and prove the swap immediately after it.
    for character_id in character_ids:
        swap_pair(
            root / character_id / "left.png",
            root / character_id / "right.png",
        )
    after = source_hashes(root, character_ids)
    for character_id in character_ids:
        if after[character_id]["left"] != before[character_id]["right"]:
            raise ValueError(f"{character_id}: canonical left swap verification failed")
        if after[character_id]["right"] != before[character_id]["left"]:
            raise ValueError(f"{character_id}: canonical right swap verification failed")
        for direction in ("down", "up"):
            if after[character_id][direction] != before[character_id][direction]:
                raise ValueError(f"{character_id}: {direction} changed during repair")
    return after, "repaired-legacy-swap"


def load_roster(root: Path) -> list[str]:
    manifest_path = root / "sprites.json"
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    character_ids = list(data)
    if not character_ids:
        raise ValueError("sprites.json contains no characters")
    for character_id in character_ids:
        entry = data[character_id]
        if entry.get("frame") != list(FRAME_SIZE):
            raise ValueError(f"{character_id}: frame is not {FRAME_SIZE}")
        if entry.get("anchor") != list(ANCHOR):
            raise ValueError(f"{character_id}: anchor is not {ANCHOR}")
        for direction in DIRECTIONS:
            path = root / character_id / f"{direction}.png"
            if not path.is_file():
                raise ValueError(f"missing source sprite: {path}")
    return character_ids


def build(root: Path) -> dict[str, object]:
    character_ids = load_roster(root)
    manifest_path = root / "walk.json"
    previous = (
        json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest_path.is_file()
        else None
    )
    canonical_hashes, _repair_status = ensure_canonical_facing(
        root, character_ids, previous
    )

    characters: dict[str, object] = {}
    artifact_hashes: list[tuple[str, str]] = []
    maximum_center_error = 0.0
    maximum_foot_error = 0.0

    for character_id in character_ids:
        direction_entries: dict[str, object] = {}
        sheet = Image.new(
            "RGBA",
            (FRAME_SIZE[0] * len(FRAMES), FRAME_SIZE[1] * len(DIRECTIONS)),
            (0, 0, 0, 0),
        )
        for direction in DIRECTIONS:
            source_path = root / character_id / f"{direction}.png"
            with Image.open(source_path) as source:
                idle = hard_alpha(source)
            frames = {
                "idle": idle,
                "stepL": make_pose(idle, -1),
                "stepR": make_pose(idle, 1),
            }
            frame_entries: dict[str, object] = {}
            for frame_name in FRAMES:
                image = frames[frame_name]
                relative = Path(character_id) / "walk" / direction / f"{frame_name}.png"
                output_path = root / relative
                output_path.parent.mkdir(parents=True, exist_ok=True)
                image.save(output_path, format="PNG", optimize=False)
                validation = validate_frame(image, idle, frame_name)
                maximum_center_error = max(
                    maximum_center_error,
                    float(validation["bodyCenterErrorPx"]),
                )
                maximum_foot_error = max(
                    maximum_foot_error,
                    float(validation["footCenterErrorPx"]),
                )
                file_hash = sha256_file(output_path)
                artifact_hashes.append((relative.as_posix(), file_hash))
                sheet.paste(
                    image,
                    (
                        COLUMNS[frame_name] * FRAME_SIZE[0],
                        ROWS[direction] * FRAME_SIZE[1],
                    ),
                )
                frame_entries[frame_name] = {
                    "src": f"/assets/sprites_v2/{relative.as_posix()}",
                    "sha256": file_hash,
                    "validation": validation,
                }
            direction_entries[direction] = {
                "row": ROWS[direction],
                "sourceDirection": LEGACY_SOURCE_DIRECTION[direction],
                "facingValidation": {
                    "expected": direction,
                    "status": "pass",
                    "proof": "canonical file hash equals audited legacy source mapping",
                },
                "frames": frame_entries,
            }

        sheet_relative = Path(character_id) / "walk-sheet.png"
        sheet_path = root / sheet_relative
        sheet.save(sheet_path, format="PNG", optimize=False)
        sheet_hash = sha256_file(sheet_path)
        artifact_hashes.append((sheet_relative.as_posix(), sheet_hash))
        characters[character_id] = {
            "sheet": f"/assets/sprites_v2/{sheet_relative.as_posix()}",
            "sheetSha256": sheet_hash,
            "anchor": list(ANCHOR),
            "directions": direction_entries,
        }

    build_digest = hashlib.sha256()
    for relative, file_hash in sorted(artifact_hashes):
        build_digest.update(relative.encode("utf-8"))
        build_digest.update(b"\0")
        build_digest.update(file_hash.encode("ascii"))
        build_digest.update(b"\n")

    manifest: dict[str, object] = {
        "version": GENERATOR_VERSION,
        "generator": "front/tools/gen_walk_frames.py",
        "frame": list(FRAME_SIZE),
        "anchor": list(ANCHOR),
        "atlas": {
            "size": [FRAME_SIZE[0] * len(FRAMES), FRAME_SIZE[1] * len(DIRECTIONS)],
            "cell": list(FRAME_SIZE),
            "rows": ROWS,
            "columns": COLUMNS,
        },
        "playback": {
            "fps": FPS,
            "sequence": list(SEQUENCE),
            "loop": True,
        },
        "sourceFacing": {
            "canonical": True,
            # Stable across the first and all later builds.  repair_status is an
            # execution detail; persisting it would make otherwise equal reruns
            # produce different manifests.
            "legacySwapRepaired": True,
            "status": "canonical-hash-verified",
            "legacySourceDirection": LEGACY_SOURCE_DIRECTION,
            "canonicalSha256": canonical_hashes,
            "validation": "pass",
        },
        "characters": characters,
        "validation": {
            "status": "pass",
            "characterCount": len(character_ids),
            "directionCount": len(character_ids) * len(DIRECTIONS),
            "qaFrameCount": len(character_ids) * len(DIRECTIONS) * len(FRAMES),
            "runtimeSheetCount": len(character_ids),
            "alphaValues": [0, 255],
            "nearestIntegerPixelTransformsOnly": True,
            "maximumBodyCenterErrorPx": round(maximum_center_error, 3),
            "maximumFootCenterErrorPx": round(maximum_foot_error, 3),
            "maximumAllowedErrorPx": 1,
        },
        "buildSha256": build_digest.hexdigest(),
    }
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def verify(root: Path) -> dict[str, object]:
    manifest_path = root / "walk.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    character_ids = load_roster(root)
    expected_sources = manifest["sourceFacing"]["canonicalSha256"]
    current_sources = source_hashes(root, character_ids)
    if current_sources != expected_sources:
        raise ValueError("canonical source hashes do not match walk.json")

    artifact_hashes: list[tuple[str, str]] = []
    for character_id in character_ids:
        character = manifest["characters"][character_id]
        sheet_path = root / character_id / "walk-sheet.png"
        with Image.open(sheet_path) as sheet:
            if sheet.size != tuple(manifest["atlas"]["size"]):
                raise ValueError(f"{character_id}: invalid atlas size {sheet.size}")
            if sheet.mode != "RGBA":
                raise ValueError(f"{character_id}: atlas must be RGBA")
            sheet_rgba = sheet.copy()
        sheet_hash = sha256_file(sheet_path)
        if sheet_hash != character["sheetSha256"]:
            raise ValueError(f"{character_id}: atlas hash mismatch")
        artifact_hashes.append((f"{character_id}/walk-sheet.png", sheet_hash))

        for direction in DIRECTIONS:
            idle_path = root / character_id / "walk" / direction / "idle.png"
            with Image.open(idle_path) as idle_file:
                if idle_file.mode != "RGBA":
                    raise ValueError(f"{idle_path}: QA frame must be RGBA")
                idle = idle_file.copy()
            for frame_name in FRAMES:
                relative = Path(character_id) / "walk" / direction / f"{frame_name}.png"
                frame_path = root / relative
                with Image.open(frame_path) as frame_file:
                    if frame_file.mode != "RGBA":
                        raise ValueError(f"{relative}: QA frame must be RGBA")
                    frame = frame_file.copy()
                entry = character["directions"][direction]["frames"][frame_name]
                file_hash = sha256_file(frame_path)
                if file_hash != entry["sha256"]:
                    raise ValueError(f"{relative}: hash mismatch")
                validate_frame(frame, idle, frame_name)
                artifact_hashes.append((relative.as_posix(), file_hash))
                cell = sheet_rgba.crop(
                    (
                        COLUMNS[frame_name] * FRAME_SIZE[0],
                        ROWS[direction] * FRAME_SIZE[1],
                        (COLUMNS[frame_name] + 1) * FRAME_SIZE[0],
                        (ROWS[direction] + 1) * FRAME_SIZE[1],
                    )
                )
                if flattened_pixels(cell) != flattened_pixels(frame):
                    raise ValueError(f"{relative}: atlas cell differs from QA frame")

    build_digest = hashlib.sha256()
    for relative, file_hash in sorted(artifact_hashes):
        build_digest.update(relative.encode("utf-8"))
        build_digest.update(b"\0")
        build_digest.update(file_hash.encode("ascii"))
        build_digest.update(b"\n")
    if build_digest.hexdigest() != manifest["buildSha256"]:
        raise ValueError("artifact build digest mismatch")
    return manifest


def parse_args() -> argparse.Namespace:
    default_root = (
        Path(__file__).resolve().parents[1]
        / "web"
        / "public"
        / "assets"
        / "sprites_v2"
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--assets",
        type=Path,
        default=default_root,
        help=f"sprites_v2 directory (default: {default_root})",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="verify current artifacts and manifest without writing files",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.assets.resolve()
    try:
        manifest = verify(root) if args.verify_only else build(root)
        if not args.verify_only:
            # Read every artifact back from disk; generation only succeeds if the
            # runtime atlas and all QA files agree with their manifest hashes.
            manifest = verify(root)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"walk sprite pipeline failed: {exc}", file=sys.stderr)
        return 1
    validation = manifest["validation"]
    action = "verified" if args.verify_only else "generated and verified"
    print(
        f"{action}: {validation['characterCount']} characters, "
        f"{validation['qaFrameCount']} QA frames, "
        f"{validation['runtimeSheetCount']} runtime sheets, "
        f"digest={manifest['buildSha256']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
