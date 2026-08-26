#!/usr/bin/env python3
"""Build deterministic 48x72 walking sprites for sprites_v2.

The source art already has the desired character design.  This builder keeps the
art on the integer pixel grid, removes semi-transparent chroma-key fringes and
baked floor debris, and normalises every visible body to the same foot baseline.
Two restrained walking poses alternate a real lower-body support shift instead
of making the torso wobble above motionless feet.

Output per character::

    walk/{down,left,right,up}/{idle,stepL,stepR}.png  # QA frames
    walk-sheet.png                                    # runtime atlas

The atlas is 144x288: columns idle/stepL/stepR and rows
down/left/right/up.  ``walk.json`` records every cell and validation result.

sprites_v2 was originally exported with left/right facing files reversed.  The
legacy manifest proves that repair by exact file hashes.  Version 3 migrates an
audited v1/v2 state once, then gates later runs on canonical RGBA pixel hashes so
destructive source cleanup is never re-applied.  Generated PNGs use an explicit
compression policy for byte-stable output across supported Pillow runtimes.
"""

from __future__ import annotations

import argparse
import colorsys
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
BODY_BASELINE = 65
MIN_VISIBLE_BODY_HEIGHT = 61
MAX_VISIBLE_BODY_HEIGHT = 63
TARGET_SHORT_BODY_HEIGHT = 61
MIN_EDGE_PADDING = 3
LEG_REGION_START = 0.69
GENERATOR_VERSION = 3
LEGACY_GENERATOR_VERSIONS = (1, 2)
PIXEL_HASH_VERSION = "dotarcade-rgba-v1"
PNG_COMPRESS_LEVEL = 9
ACTION_PROP_CHARACTERS = frozenset(("v01", "v13"))
ACTION_ARM_REFERENCE = "v02"
ACTION_SHIRT_BASE_FALLBACK = (224, 214, 178)
ACTION_SHIRT_ACCENT_FALLBACK = (104, 156, 160)
ACTION_SKIN_FALLBACK = (236, 188, 137)
# v01/v13 share this audited head silhouette; y<31 is never touched by cleanup.
ACTION_HEAD_LEFT = {"down": 7, "left": 7, "right": 10, "up": 8}

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


def image_pixel_sha256(image: Image.Image) -> str:
    """Hash decoded RGBA content, independent of PNG encoder metadata."""
    rgba = image.convert("RGBA")
    digest = hashlib.sha256()
    digest.update(PIXEL_HASH_VERSION.encode("ascii"))
    digest.update(b"\0")
    digest.update(rgba.width.to_bytes(4, "big"))
    digest.update(rgba.height.to_bytes(4, "big"))
    digest.update(rgba.tobytes())
    return digest.hexdigest()


def pixel_sha256_file(path: Path) -> str:
    with Image.open(path) as image:
        return image_pixel_sha256(image)


def save_png(image: Image.Image, path: Path) -> None:
    """Serialize PNGs identically across Pillow 11/12 for identical pixels."""
    image.save(
        path,
        format="PNG",
        optimize=False,
        compress_level=PNG_COMPRESS_LEVEL,
    )


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


def image_from_points(source: Image.Image, points: Iterable[Pixel]) -> Image.Image:
    """Copy selected opaque pixels into a clean transparent frame."""
    output = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
    src = source.load()
    dst = output.load()
    for x, y in points:
        dst[x, y] = src[x, y]
    return output


def place_inside_frame(source: Image.Image, dx: int, dy: int) -> Image.Image:
    """Translate non-transparent pixels, rejecting any clipped silhouette."""
    output = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
    src = source.load()
    dst = output.load()
    for x, y in opaque_pixels(source):
        target_x, target_y = x + dx, y + dy
        if not (0 <= target_x < FRAME_SIZE[0] and 0 <= target_y < FRAME_SIZE[1]):
            raise ValueError(
                f"source normalisation would clip {(x, y)} -> "
                f"{(target_x, target_y)}"
            )
        dst[target_x, target_y] = src[x, y]
    return output


def anchored_translation_x(image: Image.Image, body: set[Pixel]) -> int:
    """Centre body mass while reserving audited padding for the full artwork."""
    ideal = round(ANCHOR[0] - centroid(body)[0])
    art_left, _, art_right, _ = bbox(opaque_pixels(image))
    minimum = MIN_EDGE_PADDING - art_left
    maximum = FRAME_SIZE[0] - 1 - MIN_EDGE_PADDING - art_right
    if minimum > maximum:
        raise ValueError("sprite is too wide to preserve horizontal edge padding")
    return max(minimum, min(maximum, ideal))


def action_clear_mask(direction: str, x: int, y: int) -> bool:
    """Region occupied by the v01/v13 paint bags, excluding face and overalls."""
    if not 31 <= y <= 56:
        return False
    if direction in ("down", "up"):
        return x <= 15 or x >= 33
    if direction == "left":
        return x <= 20 or x >= 33
    return x <= 14 or x >= 27


def action_arm_mask(direction: str, x: int, y: int) -> bool:
    """Select clean, relaxed arm silhouettes from the audited v02 reference."""
    if not 31 <= y <= 55:
        return False
    if direction in ("down", "up"):
        if y <= 34:
            return 12 <= x <= 15 or 33 <= x <= 35
        return 7 <= x <= 15 or 33 <= x <= 41
    if direction == "left":
        return 33 <= x <= 38 and y >= 37
    return 9 <= x <= 14 and y >= 37


def median_rgb(
    pixels: Iterable[RGBA], fallback: tuple[int, int, int]
) -> tuple[int, int, int]:
    colors = [pixel[:3] for pixel in pixels]
    if not colors:
        return fallback
    middle = len(colors) // 2
    return tuple(
        sorted(color[channel] for color in colors)[middle] for channel in range(3)
    )


def is_warm_skin(pixel: RGBA) -> bool:
    red, green, blue, alpha = pixel
    return (
        alpha == 255
        and red > 125
        and red >= green + 18
        and green >= blue + 12
    )


def action_coordinate_offset(image: Image.Image, direction: str) -> int:
    """Track whole-sprite x translation using head pixels untouched by cleanup."""
    if direction not in DIRECTIONS:
        raise ValueError(f"unsupported action coordinate direction: {direction}")
    head = [(x, y) for x, y in opaque_pixels(image) if y < 31]
    if not head:
        raise ValueError("action cleanup cannot locate the character head")
    return min(x for x, _ in head) - ACTION_HEAD_LEFT[direction]


def sample_action_palette(
    image: Image.Image,
    direction: str,
) -> tuple[tuple[int, int, int], tuple[int, int, int], tuple[int, int, int]]:
    """Sample skin, shirt base and outfit accent from the target character.

    v01 and v13 share a silhouette but not a palette.  Sampling the face and
    central, prop-free bib keeps the replacement arms tied to each character
    (gold/teal v01 versus blue v13) instead of painting both with one costume.
    """
    source = hard_alpha(image)
    pixels = source.load()
    offset_x = action_coordinate_offset(source, direction)
    skin_candidates = [
        pixels[x + offset_x, y]
        for y in range(10, 31)
        for x in range(8, 40)
        if 0 <= x + offset_x < FRAME_SIZE[0]
        and is_warm_skin(pixels[x + offset_x, y])
        and pixels[x + offset_x, y][0] >= 190
        and pixels[x + offset_x, y][1] >= 130
    ]
    skin = (
        median_rgb(skin_candidates, ACTION_SKIN_FALLBACK)
        if len(skin_candidates) >= 40
        else ACTION_SKIN_FALLBACK
    )

    if direction in ("down", "up"):
        apparel_columns = range(16, 33)
    elif direction == "left":
        apparel_columns = range(23, 33)
    elif direction == "right":
        apparel_columns = range(15, 25)
    else:
        raise ValueError(f"unsupported action palette direction: {direction}")

    apparel_candidates: list[RGBA] = []
    neutral_candidates: list[RGBA] = []
    for y in range(35, 56):
        for base_x in apparel_columns:
            x = base_x + offset_x
            if not 0 <= x < FRAME_SIZE[0]:
                continue
            pixel = pixels[x, y]
            if pixel[3] != 255:
                continue
            red, green, blue, _ = pixel
            maximum = max(red, green, blue)
            minimum = min(red, green, blue)
            saturation = 0 if maximum == 0 else (maximum - minimum) / maximum
            if maximum >= 85 and saturation >= 0.38:
                apparel_candidates.append(pixel)
            if y <= 45 and maximum >= 145 and saturation <= 0.32:
                neutral_candidates.append(pixel)

    # Use the most populated hue family, not a single extreme pixel.  The bib
    # occupies most of this central window and therefore wins over tiny trims.
    hue_groups: dict[int, list[RGBA]] = {}
    for pixel in apparel_candidates:
        red, green, blue, _ = pixel
        hue, _saturation, _value = colorsys.rgb_to_hsv(
            red / 255, green / 255, blue / 255
        )
        hue_groups.setdefault(round(hue * 12) % 12, []).append(pixel)
    accent_group = max(
        hue_groups.values(),
        key=lambda group: (len(group), sum(max(pixel[:3]) for pixel in group)),
        default=[],
    )
    accent = median_rgb(accent_group, ACTION_SHIRT_ACCENT_FALLBACK)
    base = median_rgb(neutral_candidates, ACTION_SHIRT_BASE_FALLBACK)
    return skin, base, accent


def shade_palette_color(
    color: tuple[int, int, int], luminance: float, reference_luminance: float
) -> tuple[int, int, int]:
    factor = max(0.52, min(1.16, luminance / reference_luminance))
    return tuple(min(255, round(channel * factor)) for channel in color)


def recolor_action_arm(
    pixel: RGBA,
    skin: tuple[int, int, int],
    base: tuple[int, int, int],
    accent: tuple[int, int, int],
) -> RGBA:
    """Retain reference shading while using the target's identity palette."""
    red, green, blue, alpha = pixel
    luminance = (red + green + blue) / 3
    if is_warm_skin(pixel):
        return shade_palette_color(skin, luminance, 190) + (alpha,)
    value = max(red, green, blue)
    if value < 72:
        return pixel
    is_blue = (
        (blue > red + 18 and blue >= green - 4)
        or (green > red + 24 and blue > red + 20)
    )
    target = accent if is_blue else base
    return shade_palette_color(target, luminance, 190) + (alpha,)


def remove_action_props(
    image: Image.Image,
    direction: str,
    arm_reference: Image.Image,
) -> Image.Image:
    """Replace connected paint bags with a clean, relaxed arm pose.

    Component deletion is unsafe here: in the front/back source one detached
    component is a real shoe, while each paint bag is connected to an arm. The
    bounded action mask preserves the head, central overalls and both shoes, then
    borrows only the clean arm silhouette of a same-scale roster sprite.
    """
    if direction not in DIRECTIONS:
        raise ValueError(f"unsupported action cleanup direction: {direction}")
    source = hard_alpha(image)
    reference = hard_alpha(arm_reference)
    skin, base, accent = sample_action_palette(source, direction)
    offset_x = action_coordinate_offset(source, direction)
    src = source.load()
    ref = reference.load()
    for y in range(FRAME_SIZE[1]):
        for x in range(FRAME_SIZE[0]):
            base_x = x - offset_x
            if 0 <= base_x < FRAME_SIZE[0] and action_clear_mask(
                direction, base_x, y
            ):
                src[x, y] = (0, 0, 0, 0)
    for y in range(FRAME_SIZE[1]):
        for base_x in range(FRAME_SIZE[0]):
            x = base_x + offset_x
            if not 0 <= x < FRAME_SIZE[0]:
                continue
            if (
                action_arm_mask(direction, base_x, y)
                and ref[base_x, y][3] == 255
            ):
                src[x, y] = recolor_action_arm(
                    ref[base_x, y], skin, base, accent
                )
    return source


def normalize_source(
    image: Image.Image,
    *,
    character_id: str | None = None,
    direction: str | None = None,
    arm_reference: Image.Image | None = None,
) -> tuple[Image.Image, dict[str, object]]:
    """Remove baked floor debris and place the visible body on one baseline.

    A detached component is considered floor-only debris only when it starts
    strictly below the largest (body) component.  This deliberately preserves
    disconnected shoes and identity accessories that overlap the body's
    vertical span.  After geometry is canonical, the known v01/v13 paint-kit
    props are replaced by bounded clean arms rather than component deletion.
    """
    action_prop_cleaned = character_id in ACTION_PROP_CHARACTERS
    if action_prop_cleaned and (
        direction not in DIRECTIONS or arm_reference is None
    ):
        raise ValueError(
            f"{character_id}: action cleanup requires direction and arm reference"
        )
    clean = hard_alpha(image)
    components = connected_components(opaque_pixels(clean))
    if not components:
        raise ValueError("sprite contains no opaque pixels")
    body = components[0]
    _, body_top, _, body_bottom = bbox(body)
    floor_artifacts = [
        component
        for component in components[1:]
        if min(y for _, y in component) > body_bottom
    ]
    removed_pixels = sum(len(component) for component in floor_artifacts)
    removed = set().union(*floor_artifacts) if floor_artifacts else set()
    kept = opaque_pixels(clean) - removed
    working = image_from_points(clean, kept)

    visible_height = body_bottom - body_top + 1
    scaled = visible_height < MIN_VISIBLE_BODY_HEIGHT
    if scaled:
        left, top, right, bottom = bbox(kept)
        crop = working.crop((left, top, right + 1, bottom + 1))
        scale = TARGET_SHORT_BODY_HEIGHT / visible_height
        resized = crop.resize(
            (
                max(1, round(crop.width * scale)),
                max(1, round(crop.height * scale)),
            ),
            Image.Resampling.NEAREST,
        )
        if resized.width > FRAME_SIZE[0] or resized.height > FRAME_SIZE[1]:
            raise ValueError(
                f"normalised sprite exceeds frame: {resized.size} > {FRAME_SIZE}"
            )
        temporary = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
        temporary.paste(resized, (0, 0), resized)
        resized_body = main_component(temporary)
        _, _, _, body_bottom = bbox(resized_body)
        working = place_inside_frame(
            temporary,
            anchored_translation_x(temporary, resized_body),
            BODY_BASELINE - body_bottom,
        )
    else:
        horizontal_translation = anchored_translation_x(working, body)
        # Action cleanup changes the connected arm silhouette slightly.  Once
        # the source is already inside the validated one-pixel anchor tolerance,
        # keep its integer x coordinate so the fixed cleanup mask is repeatable.
        if (
            action_prop_cleaned
            and abs(centroid(body)[0] - ANCHOR[0]) <= 1.0 + 1e-9
        ):
            horizontal_translation = 0
        working = place_inside_frame(
            working,
            horizontal_translation,
            BODY_BASELINE - body_bottom,
        )

    # Apply clean arms only in canonical geometry.  The untouched head records
    # any final one-pixel recenter, so a later run follows that same x offset.
    if action_prop_cleaned:
        working = remove_action_props(working, direction, arm_reference)
        cleaned_body = main_component(working)
        working = place_inside_frame(
            working,
            anchored_translation_x(working, cleaned_body),
            0,
        )

    audit = validate_source(working)
    audit.update(
        {
            "floorArtifactPixelsRemovedThisRun": removed_pixels,
            "shortBodyScaledThisRun": scaled,
            "actionPropCleaned": action_prop_cleaned,
        }
    )
    return working, audit


def validate_source(image: Image.Image) -> dict[str, object]:
    """Validate the canonical direction PNG used by every runtime motion mode."""
    if image.mode != "RGBA":
        raise ValueError("canonical source image mode must be RGBA")
    if image.size != FRAME_SIZE:
        raise ValueError(f"canonical source expected {FRAME_SIZE}, got {image.size}")
    colors = flattened_pixels(image)
    alpha_values = {pixel[3] for pixel in colors}
    if not alpha_values <= {0, 255}:
        raise ValueError(f"canonical source alpha fringe detected: {alpha_values}")
    if any(pixel[:3] != (0, 0, 0) for pixel in colors if pixel[3] == 0):
        raise ValueError("canonical source transparent RGB fringe detected")

    components = connected_components(opaque_pixels(image))
    if not components:
        raise ValueError("canonical source contains no opaque pixels")
    body = components[0]
    body_box = bbox(body)
    body_center = centroid(body)
    center_x_error = abs(body_center[0] - ANCHOR[0])
    body_height = body_box[3] - body_box[1] + 1
    if body_box[3] != BODY_BASELINE:
        raise ValueError(
            f"visible body bottom {body_box[3]} does not match {BODY_BASELINE}"
        )
    if not MIN_VISIBLE_BODY_HEIGHT <= body_height <= MAX_VISIBLE_BODY_HEIGHT:
        raise ValueError(
            f"visible body height {body_height} outside "
            f"{MIN_VISIBLE_BODY_HEIGHT}..{MAX_VISIBLE_BODY_HEIGHT}"
        )
    if center_x_error > 1.0 + 1e-9:
        raise ValueError(
            f"body center x error {center_x_error:.3f}px exceeds 1px"
        )
    detached_below = [
        component
        for component in components[1:]
        if min(y for _, y in component) > body_box[3]
    ]
    if detached_below:
        raise ValueError("detached floor/action artifact remains below visible body")

    art_box = bbox(opaque_pixels(image))
    edge_padding = min(
        art_box[0],
        art_box[1],
        FRAME_SIZE[0] - 1 - art_box[2],
        FRAME_SIZE[1] - 1 - art_box[3],
    )
    if edge_padding < MIN_EDGE_PADDING:
        raise ValueError(
            f"sprite edge padding {edge_padding}px < {MIN_EDGE_PADDING}px; "
            "possible clipping"
        )
    return {
        "alpha": "binary",
        "anchor": list(ANCHOR),
        "bodyBbox": list(body_box),
        "bodyCenter": rounded_pair(body_center),
        "bodyCenterXErrorPx": round(center_x_error, 3),
        "bodyBottom": body_box[3],
        "visibleBodyHeight": body_height,
        "artBbox": list(art_box),
        "edgePaddingPx": edge_padding,
        "detachedBelowBodyCount": 0,
        "clippingValidation": "pass",
        "actionArtifactValidation": "pass",
    }


def pose_dx(y: int, top: int, bottom: int, phase: int) -> int:
    """Integer-only S-curve: shoulders and hips counter-shift by one pixel."""
    height = max(1, bottom - top + 1)
    relative = (y - top) / height
    if 0.42 <= relative < 0.63:
        return phase
    if 0.68 <= relative < 0.84:
        return -phase
    return 0


def contiguous_runs(values: Iterable[int]) -> list[list[int]]:
    runs: list[list[int]] = []
    for value in sorted(values):
        if not runs or value > runs[-1][-1] + 1:
            runs.append([value])
        else:
            runs[-1].append(value)
    return runs


def make_pose(idle: Image.Image, phase: int) -> Image.Image:
    """Create an integer-pixel step with alternating lower-body support."""
    if phase not in (-1, 1):
        raise ValueError("phase must be -1 or 1")
    components = connected_components(opaque_pixels(idle))
    if not components:
        raise ValueError("sprite contains no opaque pixels")
    body = components[0]
    _, top, _, bottom = bbox(body)
    body_center_x = centroid(body)[0]
    leg_region_y = top + round((bottom - top + 1) * LEG_REGION_START)

    source = idle.load()
    output = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
    destination = output.load()
    moved_runs: dict[tuple[int, int], list[int]] = {}

    # Preserve audited detached accessories byte-for-byte. Floor-only debris was
    # already removed from the canonical source by normalize_source().
    for component in components[1:]:
        for x, y in component:
            destination[x, y] = source[x, y]

    # The restrained torso counter-shift keeps the shoulders from looking rigid.
    # Below the leg line, stepL nudges the left support silhouette outward while
    # stepR nudges the right. Both retain the exact y=65 ground contact; unlike
    # the old scanline-only pose, changed pixels now exist in the legs and feet.
    for x, y in sorted(body, key=lambda point: (point[1], point[0])):
        dx = pose_dx(y, top, bottom, phase)
        if y >= leg_region_y:
            is_left = x < body_center_x
            active_support = (phase < 0 and is_left) or (phase > 0 and not is_left)
            # Move the lower leg and upper foot while retaining only the final
            # contact row. This reads as a step without drifting the y=65 anchor.
            dx = (-1 if is_left else 1) if active_support and y < bottom else 0
        target_x = x + dx
        if not 0 <= target_x < FRAME_SIZE[0]:
            raise ValueError(f"pose would leave frame at {(x, y)} -> {target_x}")
        destination[target_x, y] = source[x, y]
        if dx:
            moved_runs.setdefault((y, dx), []).append(x)

    # A one-pixel outward limb deformation would otherwise vacate the inner edge
    # of every moved run, producing a black seam down the trousers. Extend only
    # that original edge pixel; this retains topology without copying the entire
    # old limb or introducing interpolation/new colours.
    for (y, dx), xs in moved_runs.items():
        for run in contiguous_runs(xs):
            edge_x = run[-1] if dx < 0 else run[0]
            destination[edge_x, y] = source[edge_x, y]
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


def maximum_vertical_run(points: Iterable[Pixel]) -> int:
    by_x: dict[int, list[int]] = {}
    for x, y in points:
        by_x.setdefault(x, []).append(y)
    maximum = 0
    for ys in by_x.values():
        current = 0
        previous = -2
        for y in sorted(ys):
            current = current + 1 if y == previous + 1 else 1
            previous = y
            maximum = max(maximum, current)
    return maximum


def topology_audit(idle: Image.Image, frame: Image.Image) -> dict[str, int]:
    """Detect newly cut interior seams and alpha-component fragmentation."""
    idle_opaque = opaque_pixels(idle)
    frame_opaque = opaque_pixels(frame)
    interior_new_transparent: set[Pixel] = set()
    for y in range(FRAME_SIZE[1]):
        row = [x for x, row_y in frame_opaque if row_y == y]
        if len(row) < 2:
            continue
        left, right = min(row), max(row)
        for x in range(left + 1, right):
            point = (x, y)
            if point in idle_opaque and point not in frame_opaque:
                interior_new_transparent.add(point)
    idle_components = len(connected_components(idle_opaque))
    frame_components = len(connected_components(frame_opaque))
    return {
        "interiorNewTransparentPixels": len(interior_new_transparent),
        "maximumNewTransparentVerticalRunPx": maximum_vertical_run(
            interior_new_transparent
        ),
        "connectedComponentIncrease": max(0, frame_components - idle_components),
    }


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

    idle_colors = flattened_pixels(idle)
    frame_colors = flattened_pixels(frame)
    changed_points = [
        (index % FRAME_SIZE[0], index // FRAME_SIZE[0])
        for index, (current, baseline) in enumerate(zip(frame_colors, idle_colors))
        if current != baseline
    ]
    changed_pixels = len(changed_points)
    if frame_name != "idle" and changed_pixels == 0:
        raise ValueError(f"{frame_name}: pose is identical to idle")
    leg_region_y = bbox(idle_body)[1] + round(
        (bbox(idle_body)[3] - bbox(idle_body)[1] + 1) * LEG_REGION_START
    )
    upper_changed = sum(y < leg_region_y for _, y in changed_points)
    lower_changed = sum(y >= leg_region_y for _, y in changed_points)
    if frame_name != "idle" and (upper_changed == 0 or lower_changed == 0):
        raise ValueError(
            f"{frame_name}: gait must change both torso and lower body "
            f"({upper_changed}/{lower_changed})"
        )
    idle_palette = {pixel for pixel in idle_colors if pixel[3]}
    frame_palette = {pixel for pixel in frame_colors if pixel[3]}
    if not frame_palette <= idle_palette:
        raise ValueError(f"{frame_name}: foreign action art/color entered frame")
    topology = topology_audit(idle, frame)
    if any(topology.values()):
        raise ValueError(
            f"{frame_name}: silhouette topology regression {topology}"
        )

    return {
        "alpha": "binary",
        "anchor": list(ANCHOR),
        "bodyCenter": rounded_pair(frame_center),
        "bodyCenterErrorPx": round(center_error, 3),
        "footCenter": rounded_pair(frame_foot),
        "footCenterErrorPx": round(foot_error, 3),
        "footBaselineErrorPx": bottom_error,
        "changedPixelsFromIdle": changed_pixels,
        "upperBodyChangedPixels": upper_changed,
        "lowerBodyChangedPixels": lower_changed,
        "sourceArtPaletteValidation": "pass",
        "topologyValidation": "pass",
        **topology,
    }


def source_file_hashes(
    root: Path, character_ids: Iterable[str]
) -> dict[str, dict[str, str]]:
    return {
        character_id: {
            direction: sha256_file(root / character_id / f"{direction}.png")
            for direction in DIRECTIONS
        }
        for character_id in character_ids
    }


def source_pixel_hashes(
    root: Path, character_ids: Iterable[str]
) -> dict[str, dict[str, str]]:
    return {
        character_id: {
            direction: pixel_sha256_file(
                root / character_id / f"{direction}.png"
            )
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
    """Repair the known legacy swap once, then verify the canonical sources.

    Legacy manifests intentionally use encoded-file hashes so their already
    audited orientation can be identified exactly.  A v3 manifest uses decoded
    RGBA hashes; equivalent PNG encodings must not make direction state
    ambiguous.
    """
    previous_version = (previous or {}).get("version")
    hash_function = (
        source_pixel_hashes
        if previous_version == GENERATOR_VERSION
        else source_file_hashes
    )
    expected_key = (
        "canonicalPixelSha256"
        if previous_version == GENERATOR_VERSION
        else "canonicalSha256"
    )
    before = hash_function(root, character_ids)
    previous_facing = (previous or {}).get("sourceFacing", {})
    expected = (
        previous_facing.get(expected_key, {})
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
        if previous_version == GENERATOR_VERSION:
            if not all_canonical:
                raise ValueError(
                    "v3 canonical source pixel hashes changed; refusing to "
                    "repair or rewrite source artwork"
                )
            return before, "verified-existing"
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
    after = hash_function(root, character_ids)
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
    if previous is None:
        raise ValueError(
            "generator v3 requires an audited v1/v2 walk.json migration source"
        )
    previous_version = previous.get("version")
    if previous_version not in (*LEGACY_GENERATOR_VERSIONS, GENERATOR_VERSION):
        raise ValueError(
            f"unsupported walk.json version {previous_version}; expected audited v1/v2 "
            f"or idempotent v{GENERATOR_VERSION}"
        )
    _pre_normalization_hashes, _repair_status = ensure_canonical_facing(
        root, character_ids, previous
    )

    transform_sources = previous_version != GENERATOR_VERSION
    if not transform_sources:
        previous_generator_hash = previous.get("generatorSha256")
        current_generator_hash = sha256_file(Path(__file__).resolve())
        if previous_generator_hash != current_generator_hash:
            raise ValueError(
                "generator changed without a version bump; refusing to rewrite "
                "v3 artifacts"
            )

    arm_references: dict[str, Image.Image] = {}
    if transform_sources:
        for direction in DIRECTIONS:
            reference_path = root / ACTION_ARM_REFERENCE / f"{direction}.png"
            with Image.open(reference_path) as reference_source:
                arm_references[direction], _ = normalize_source(reference_source)

    source_audits: dict[tuple[str, str], dict[str, object]] = {}
    for character_id in character_ids:
        for direction in DIRECTIONS:
            source_path = root / character_id / f"{direction}.png"
            previous_audit = (
                previous.get("characters", {})
                .get(character_id, {})
                .get("directions", {})
                .get(direction, {})
                .get("sourceValidation", {})
            )
            if transform_sources:
                with Image.open(source_path) as source:
                    normalized, execution_audit = normalize_source(
                        source,
                        character_id=character_id,
                        direction=direction,
                        arm_reference=arm_references.get(direction),
                    )
                floor_artifact_removed_this_run = execution_audit.pop(
                    "floorArtifactPixelsRemovedThisRun"
                )
                short_body_scaled_this_run = execution_audit.pop(
                    "shortBodyScaledThisRun"
                )
                action_prop_cleaned = execution_audit.pop("actionPropCleaned")
                execution_audit.update(
                    {
                        "floorArtifactRemoved": bool(
                            previous_audit.get("floorArtifactRemoved")
                            or floor_artifact_removed_this_run
                        ),
                        "shortBodyScaled": bool(
                            previous_audit.get("shortBodyScaled")
                            or short_body_scaled_this_run
                        ),
                        "actionPropCleaned": action_prop_cleaned,
                    }
                )
                save_png(normalized, source_path)
            else:
                # A same-version build is validation-only for canonical source
                # PNGs.  This is the structural idempotence boundary: cleanup
                # and scaling may only run as an explicit version migration.
                with Image.open(source_path) as source:
                    execution_audit = validate_source(source)
                action_prop_cleaned = character_id in ACTION_PROP_CHARACTERS
                if bool(previous_audit.get("actionPropCleaned")) != action_prop_cleaned:
                    raise ValueError(
                        f"{character_id}/{direction}: action cleanup provenance mismatch"
                    )
                execution_audit.update(
                    {
                        "floorArtifactRemoved": bool(
                            previous_audit.get("floorArtifactRemoved")
                        ),
                        "shortBodyScaled": bool(
                            previous_audit.get("shortBodyScaled")
                        ),
                        "actionPropCleaned": action_prop_cleaned,
                    }
                )
            source_audits[(character_id, direction)] = execution_audit

    # Canonical source hashes describe decoded artwork used by idle,
    # reduced-motion, seated and mounted rendering as well as walk generation.
    canonical_hashes = source_pixel_hashes(root, character_ids)

    characters: dict[str, object] = {}
    artifact_hashes: list[tuple[str, str]] = []
    maximum_center_error = 0.0
    maximum_foot_error = 0.0
    minimum_edge_padding = FRAME_SIZE[0]
    visible_heights: list[int] = []
    maximum_direction_height_variance = 0
    maximum_direction_center_variance = 0.0
    floor_artifact_direction_count = 0
    action_prop_direction_count = 0

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
                idle = source.copy()
            source_validation = validate_source(idle)
            if source_validation != {
                key: value
                for key, value in source_audits[(character_id, direction)].items()
                if key
                not in (
                    "floorArtifactRemoved",
                    "shortBodyScaled",
                    "actionPropCleaned",
                )
            }:
                raise ValueError(
                    f"{character_id}/{direction}: source audit changed after save"
                )
            source_validation.update(
                {
                    "floorArtifactRemoved": source_audits[
                        (character_id, direction)
                    ]["floorArtifactRemoved"],
                    "shortBodyScaled": source_audits[
                        (character_id, direction)
                    ]["shortBodyScaled"],
                    "actionPropCleaned": source_audits[
                        (character_id, direction)
                    ]["actionPropCleaned"],
                }
            )
            minimum_edge_padding = min(
                minimum_edge_padding,
                int(source_validation["edgePaddingPx"]),
            )
            visible_heights.append(int(source_validation["visibleBodyHeight"]))
            floor_artifact_direction_count += int(
                bool(source_validation["floorArtifactRemoved"])
            )
            action_prop_direction_count += int(
                bool(source_validation["actionPropCleaned"])
            )
            frames = {
                "idle": idle,
                "stepL": make_pose(idle, -1),
                "stepR": make_pose(idle, 1),
            }
            if flattened_pixels(frames["stepL"]) == flattened_pixels(frames["stepR"]):
                raise ValueError(
                    f"{character_id}/{direction}: left/right steps are identical"
                )
            frame_entries: dict[str, object] = {}
            for frame_name in FRAMES:
                image = frames[frame_name]
                relative = Path(character_id) / "walk" / direction / f"{frame_name}.png"
                output_path = root / relative
                output_path.parent.mkdir(parents=True, exist_ok=True)
                save_png(image, output_path)
                validation = validate_frame(image, idle, frame_name)
                maximum_center_error = max(
                    maximum_center_error,
                    float(validation["bodyCenterErrorPx"]),
                )
                maximum_foot_error = max(
                    maximum_foot_error,
                    float(validation["footCenterErrorPx"]),
                )
                pixel_hash = image_pixel_sha256(image)
                artifact_hashes.append((relative.as_posix(), pixel_hash))
                sheet.paste(
                    image,
                    (
                        COLUMNS[frame_name] * FRAME_SIZE[0],
                        ROWS[direction] * FRAME_SIZE[1],
                    ),
                )
                frame_entries[frame_name] = {
                    "src": f"/assets/sprites_v2/{relative.as_posix()}",
                    "pixelSha256": pixel_hash,
                    "validation": validation,
                }
            direction_entries[direction] = {
                "row": ROWS[direction],
                "sourceDirection": LEGACY_SOURCE_DIRECTION[direction],
                "facingValidation": {
                    "expected": direction,
                    "status": "pass",
                    "proof": "canonical v3 pixel hash and atlas row verified",
                },
                "sourceValidation": source_validation,
                "frames": frame_entries,
            }

        direction_heights = [
            int(direction_entries[direction]["sourceValidation"]["visibleBodyHeight"])
            for direction in DIRECTIONS
        ]
        direction_centers = [
            float(direction_entries[direction]["sourceValidation"]["bodyCenter"][0])
            for direction in DIRECTIONS
        ]
        height_variance = max(direction_heights) - min(direction_heights)
        center_variance = max(direction_centers) - min(direction_centers)
        if height_variance > 2:
            raise ValueError(
                f"{character_id}: direction body height variance {height_variance}px > 2px"
            )
        if center_variance > 1.0 + 1e-9:
            raise ValueError(
                f"{character_id}: direction center variance {center_variance:.3f}px > 1px"
            )
        maximum_direction_height_variance = max(
            maximum_direction_height_variance, height_variance
        )
        maximum_direction_center_variance = max(
            maximum_direction_center_variance, center_variance
        )

        sheet_relative = Path(character_id) / "walk-sheet.png"
        sheet_path = root / sheet_relative
        save_png(sheet, sheet_path)
        sheet_hash = image_pixel_sha256(sheet)
        artifact_hashes.append((sheet_relative.as_posix(), sheet_hash))
        characters[character_id] = {
            "sheet": f"/assets/sprites_v2/{sheet_relative.as_posix()}",
            "sheetPixelSha256": sheet_hash,
            "anchor": list(ANCHOR),
            "sourceValidation": {
                "status": "pass",
                "directionHeightVariancePx": height_variance,
                "directionCenterVariancePx": round(center_variance, 3),
            },
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
        "generatorSha256": sha256_file(Path(__file__).resolve()),
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
            "canonicalPixelSha256": canonical_hashes,
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
            "hashSemantics": {
                "algorithm": "sha256",
                "artifactContent": PIXEL_HASH_VERSION,
                "buildDigest": "relative-path-null-pixel-sha-newline-v1",
            },
            "pngSerialization": {
                "compressLevel": PNG_COMPRESS_LEVEL,
                "optimize": False,
            },
            "sourceNormalization": {
                "status": "pass",
                "bodyBottom": BODY_BASELINE,
                "visibleBodyHeightRange": [
                    min(visible_heights),
                    max(visible_heights),
                ],
                "requiredVisibleBodyHeightRange": [
                    MIN_VISIBLE_BODY_HEIGHT,
                    MAX_VISIBLE_BODY_HEIGHT,
                ],
                "minimumEdgePaddingPx": minimum_edge_padding,
                "requiredEdgePaddingPx": MIN_EDGE_PADDING,
                "maximumDirectionHeightVariancePx": maximum_direction_height_variance,
                "maximumDirectionCenterVariancePx": round(
                    maximum_direction_center_variance, 3
                ),
                "floorArtifactRemoved": floor_artifact_direction_count > 0,
                "floorArtifactDirectionCount": floor_artifact_direction_count,
                "detachedBelowBodyCount": 0,
                "clippingValidation": "pass",
                "actionArtifactValidation": "pass",
                "actionPropCleaned": action_prop_direction_count > 0,
                "actionPropDirectionCount": action_prop_direction_count,
            },
            "maximumBodyCenterErrorPx": round(maximum_center_error, 3),
            "maximumFootCenterErrorPx": round(maximum_foot_error, 3),
            "maximumAllowedErrorPx": 1,
        },
        "buildPixelSha256": build_digest.hexdigest(),
    }
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def verify(root: Path) -> dict[str, object]:
    manifest_path = root / "walk.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("version") != GENERATOR_VERSION:
        raise ValueError(
            f"walk.json version {manifest.get('version')} is not {GENERATOR_VERSION}"
        )
    if manifest.get("generatorSha256") != sha256_file(Path(__file__).resolve()):
        raise ValueError("generator hash does not match walk.json")
    character_ids = load_roster(root)
    expected_sources = manifest["sourceFacing"]["canonicalPixelSha256"]
    current_sources = source_pixel_hashes(root, character_ids)
    if current_sources != expected_sources:
        raise ValueError("canonical source hashes do not match walk.json")

    arm_references: dict[str, Image.Image] = {}
    for direction in DIRECTIONS:
        reference_path = root / ACTION_ARM_REFERENCE / f"{direction}.png"
        with Image.open(reference_path) as reference_source:
            arm_references[direction], _ = normalize_source(reference_source)

    artifact_hashes: list[tuple[str, str]] = []
    source_heights: list[int] = []
    minimum_edge_padding = FRAME_SIZE[0]
    maximum_direction_height_variance = 0
    maximum_direction_center_variance = 0.0
    floor_artifact_direction_count = 0
    action_prop_direction_count = 0
    for character_id in character_ids:
        character = manifest["characters"][character_id]
        sheet_path = root / character_id / "walk-sheet.png"
        with Image.open(sheet_path) as sheet:
            if sheet.size != tuple(manifest["atlas"]["size"]):
                raise ValueError(f"{character_id}: invalid atlas size {sheet.size}")
            if sheet.mode != "RGBA":
                raise ValueError(f"{character_id}: atlas must be RGBA")
            sheet_rgba = sheet.copy()
        sheet_hash = image_pixel_sha256(sheet_rgba)
        if sheet_hash != character["sheetPixelSha256"]:
            raise ValueError(f"{character_id}: atlas hash mismatch")
        artifact_hashes.append((f"{character_id}/walk-sheet.png", sheet_hash))

        direction_heights: list[int] = []
        direction_centers: list[float] = []
        direction_frames: dict[str, dict[str, Image.Image]] = {}
        for direction in DIRECTIONS:
            source_path = root / character_id / f"{direction}.png"
            with Image.open(source_path) as source_file:
                if source_file.mode != "RGBA":
                    raise ValueError(f"{source_path}: canonical source must be RGBA")
                source = source_file.copy()
            source_validation = validate_source(source)
            expected_source_validation = character["directions"][direction][
                "sourceValidation"
            ]
            action_prop_expected = character_id in ACTION_PROP_CHARACTERS
            if bool(expected_source_validation.get("actionPropCleaned")) != action_prop_expected:
                raise ValueError(
                    f"{character_id}/{direction}: action cleanup metadata mismatch"
                )
            if action_prop_expected:
                reconstructed = remove_action_props(
                    source, direction, arm_references[direction]
                )
                if flattened_pixels(reconstructed) != flattened_pixels(source):
                    raise ValueError(
                        f"{character_id}/{direction}: paint-kit action prop remains"
                    )
            for key, value in source_validation.items():
                if expected_source_validation.get(key) != value:
                    raise ValueError(
                        f"{character_id}/{direction}: source validation mismatch "
                        f"for {key}"
                    )
            source_heights.append(int(source_validation["visibleBodyHeight"]))
            direction_heights.append(int(source_validation["visibleBodyHeight"]))
            direction_centers.append(float(source_validation["bodyCenter"][0]))
            minimum_edge_padding = min(
                minimum_edge_padding, int(source_validation["edgePaddingPx"])
            )
            floor_artifact_direction_count += int(
                bool(expected_source_validation.get("floorArtifactRemoved"))
            )
            action_prop_direction_count += int(
                bool(expected_source_validation.get("actionPropCleaned"))
            )

            idle_path = root / character_id / "walk" / direction / "idle.png"
            with Image.open(idle_path) as idle_file:
                if idle_file.mode != "RGBA":
                    raise ValueError(f"{idle_path}: QA frame must be RGBA")
                idle = idle_file.copy()
            if flattened_pixels(idle) != flattened_pixels(source):
                raise ValueError(
                    f"{character_id}/{direction}: idle frame differs from canonical source"
                )
            direction_frames[direction] = {}
            for frame_name in FRAMES:
                relative = Path(character_id) / "walk" / direction / f"{frame_name}.png"
                frame_path = root / relative
                with Image.open(frame_path) as frame_file:
                    if frame_file.mode != "RGBA":
                        raise ValueError(f"{relative}: QA frame must be RGBA")
                    frame = frame_file.copy()
                entry = character["directions"][direction]["frames"][frame_name]
                pixel_hash = image_pixel_sha256(frame)
                if pixel_hash != entry["pixelSha256"]:
                    raise ValueError(f"{relative}: hash mismatch")
                validation = validate_frame(frame, idle, frame_name)
                if validation != entry["validation"]:
                    raise ValueError(f"{relative}: validation metadata mismatch")
                artifact_hashes.append((relative.as_posix(), pixel_hash))
                direction_frames[direction][frame_name] = frame
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
            if flattened_pixels(direction_frames[direction]["stepL"]) == flattened_pixels(
                direction_frames[direction]["stepR"]
            ):
                raise ValueError(
                    f"{character_id}/{direction}: left/right steps are identical"
                )

        height_variance = max(direction_heights) - min(direction_heights)
        center_variance = max(direction_centers) - min(direction_centers)
        if height_variance > 2 or center_variance > 1.0 + 1e-9:
            raise ValueError(
                f"{character_id}: direction variance failed "
                f"({height_variance}px/{center_variance:.3f}px)"
            )
        expected_character_validation = character["sourceValidation"]
        if expected_character_validation.get("directionHeightVariancePx") != height_variance:
            raise ValueError(f"{character_id}: direction height metadata mismatch")
        if expected_character_validation.get("directionCenterVariancePx") != round(
            center_variance, 3
        ):
            raise ValueError(f"{character_id}: direction center metadata mismatch")
        maximum_direction_height_variance = max(
            maximum_direction_height_variance, height_variance
        )
        maximum_direction_center_variance = max(
            maximum_direction_center_variance, center_variance
        )

    build_digest = hashlib.sha256()
    for relative, file_hash in sorted(artifact_hashes):
        build_digest.update(relative.encode("utf-8"))
        build_digest.update(b"\0")
        build_digest.update(file_hash.encode("ascii"))
        build_digest.update(b"\n")
    if build_digest.hexdigest() != manifest["buildPixelSha256"]:
        raise ValueError("artifact build digest mismatch")
    expected_hash_semantics = {
        "algorithm": "sha256",
        "artifactContent": PIXEL_HASH_VERSION,
        "buildDigest": "relative-path-null-pixel-sha-newline-v1",
    }
    if manifest["validation"].get("hashSemantics") != expected_hash_semantics:
        raise ValueError("artifact hash semantics metadata mismatch")
    expected_png_serialization = {
        "compressLevel": PNG_COMPRESS_LEVEL,
        "optimize": False,
    }
    if manifest["validation"].get("pngSerialization") != expected_png_serialization:
        raise ValueError("PNG serialization metadata mismatch")
    source_summary = manifest["validation"]["sourceNormalization"]
    expected_summary = {
        "status": "pass",
        "bodyBottom": BODY_BASELINE,
        "visibleBodyHeightRange": [min(source_heights), max(source_heights)],
        "requiredVisibleBodyHeightRange": [
            MIN_VISIBLE_BODY_HEIGHT,
            MAX_VISIBLE_BODY_HEIGHT,
        ],
        "minimumEdgePaddingPx": minimum_edge_padding,
        "requiredEdgePaddingPx": MIN_EDGE_PADDING,
        "maximumDirectionHeightVariancePx": maximum_direction_height_variance,
        "maximumDirectionCenterVariancePx": round(
            maximum_direction_center_variance, 3
        ),
        "floorArtifactRemoved": floor_artifact_direction_count > 0,
        "floorArtifactDirectionCount": floor_artifact_direction_count,
        "detachedBelowBodyCount": 0,
        "clippingValidation": "pass",
        "actionArtifactValidation": "pass",
        "actionPropCleaned": action_prop_direction_count > 0,
        "actionPropDirectionCount": action_prop_direction_count,
    }
    for key, value in expected_summary.items():
        if source_summary.get(key) != value:
            raise ValueError(f"source normalisation summary mismatch for {key}")
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
        f"digest={manifest['buildPixelSha256']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
