from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

import gen_walk_frames as sprites


def rgba_frame() -> Image.Image:
    return Image.new("RGBA", sprites.FRAME_SIZE, (0, 0, 0, 0))


class SourceNormalizationTests(unittest.TestCase):
    def test_removes_floor_only_component_scales_short_body_and_grounds_it(self):
        image = rgba_frame()
        draw = ImageDraw.Draw(image)
        draw.rectangle((14, 4, 33, 55), fill=(42, 88, 132, 255))
        draw.rectangle((17, 61, 29, 65), fill=(226, 96, 42, 255))

        normalized, audit = sprites.normalize_source(image)

        self.assertEqual(audit["floorArtifactPixelsRemovedThisRun"], 65)
        self.assertTrue(audit["shortBodyScaledThisRun"])
        self.assertEqual(audit["bodyBottom"], sprites.BODY_BASELINE)
        self.assertEqual(
            audit["visibleBodyHeight"], sprites.TARGET_SHORT_BODY_HEIGHT
        )
        self.assertEqual(audit["detachedBelowBodyCount"], 0)
        self.assertGreaterEqual(audit["edgePaddingPx"], sprites.MIN_EDGE_PADDING)
        self.assertNotIn(
            (226, 96, 42, 255),
            {pixel for pixel in sprites.flattened_pixels(normalized) if pixel[3]},
        )

    def test_preserves_detached_accessory_that_overlaps_body_height(self):
        image = rgba_frame()
        draw = ImageDraw.Draw(image)
        draw.rectangle((15, 5, 32, 65), fill=(62, 122, 184, 255))
        draw.rectangle((36, 52, 39, 61), fill=(241, 190, 72, 255))

        normalized, audit = sprites.normalize_source(image)

        self.assertEqual(audit["floorArtifactPixelsRemovedThisRun"], 0)
        accessory_pixels = sum(
            pixel == (241, 190, 72, 255)
            for pixel in sprites.flattened_pixels(normalized)
        )
        self.assertEqual(accessory_pixels, 40)
        self.assertEqual(audit["actionArtifactValidation"], "pass")

    def test_normalization_is_pixel_idempotent(self):
        image = rgba_frame()
        draw = ImageDraw.Draw(image)
        draw.rectangle((13, 7, 34, 64), fill=(88, 156, 112, 255))

        first, first_audit = sprites.normalize_source(image)
        second, second_audit = sprites.normalize_source(first)

        self.assertEqual(
            sprites.flattened_pixels(first), sprites.flattened_pixels(second)
        )
        self.assertTrue(first_audit["shortBodyScaledThisRun"])
        self.assertFalse(second_audit["shortBodyScaledThisRun"])

    def test_action_cleanup_removes_props_and_reuses_target_palette(self):
        target = rgba_frame()
        target_draw = ImageDraw.Draw(target)
        target_draw.rectangle((7, 10, 42, 30), fill=(240, 190, 136, 255))
        target_draw.rectangle((18, 35, 30, 55), fill=(202, 140, 30, 255))
        target_draw.rectangle((18, 35, 30, 39), fill=(222, 212, 190, 255))
        target_draw.rectangle((5, 40, 14, 52), fill=(255, 0, 220, 255))
        target_draw.rectangle((34, 40, 43, 52), fill=(255, 0, 220, 255))
        target_draw.rectangle((18, 60, 22, 65), fill=(96, 76, 130, 255))
        target_draw.rectangle((26, 60, 30, 65), fill=(96, 76, 130, 255))

        reference = rgba_frame()
        reference_draw = ImageDraw.Draw(reference)
        reference_draw.rectangle((12, 35, 15, 50), fill=(80, 150, 220, 255))
        reference_draw.rectangle((33, 35, 35, 50), fill=(80, 150, 220, 255))
        reference_draw.rectangle((12, 51, 15, 55), fill=(205, 145, 98, 255))
        reference_draw.rectangle((33, 51, 35, 55), fill=(205, 145, 98, 255))

        cleaned = sprites.remove_action_props(target, "down", reference)
        cleaned_pixels = cleaned.load()
        self.assertEqual(cleaned_pixels[5, 45], (0, 0, 0, 0))
        self.assertEqual(cleaned_pixels[24, 45], (202, 140, 30, 255))
        self.assertEqual(cleaned_pixels[20, 62], (96, 76, 130, 255))
        self.assertEqual(cleaned_pixels[12, 40][3], 255)
        self.assertGreater(cleaned_pixels[12, 40][0], cleaned_pixels[12, 40][1])
        self.assertGreater(cleaned_pixels[12, 40][1], cleaned_pixels[12, 40][2])
        self.assertEqual(
            sprites.flattened_pixels(cleaned),
            sprites.flattened_pixels(
                sprites.remove_action_props(cleaned, "down", reference)
            ),
        )

    def test_profile_cleanup_keeps_only_the_visible_relaxed_arm(self):
        target = rgba_frame()
        target_draw = ImageDraw.Draw(target)
        target_draw.rectangle((7, 10, 42, 30), fill=(240, 190, 136, 255))
        target_draw.rectangle((21, 31, 32, 56), fill=(202, 140, 30, 255))
        target_draw.rectangle((5, 37, 20, 52), fill=(255, 0, 220, 255))
        target_draw.rectangle((33, 37, 43, 52), fill=(255, 0, 220, 255))

        reference = rgba_frame()
        reference_draw = ImageDraw.Draw(reference)
        reference_draw.rectangle((33, 37, 38, 50), fill=(80, 150, 220, 255))
        reference_draw.rectangle((33, 51, 38, 55), fill=(205, 145, 98, 255))

        cleaned = sprites.remove_action_props(target, "left", reference)
        pixels = cleaned.load()
        self.assertEqual(pixels[18, 45], (0, 0, 0, 0))
        self.assertEqual(pixels[25, 45], (202, 140, 30, 255))
        self.assertEqual(pixels[35, 45][3], 255)
        self.assertEqual(
            sprites.flattened_pixels(cleaned),
            sprites.flattened_pixels(
                sprites.remove_action_props(cleaned, "left", reference)
            ),
        )


class GaitTests(unittest.TestCase):
    def setUp(self):
        self.idle = rgba_frame()
        draw = ImageDraw.Draw(self.idle)
        draw.rectangle((14, 5, 33, 46), fill=(50, 90, 150, 255))
        draw.rectangle((15, 47, 22, 65), fill=(40, 72, 120, 255))
        draw.rectangle((25, 47, 32, 65), fill=(40, 72, 120, 255))
        sprites.validate_source(self.idle)

    def test_steps_alternate_lower_body_without_losing_ground_contact(self):
        left = sprites.make_pose(self.idle, -1)
        right = sprites.make_pose(self.idle, 1)
        left_audit = sprites.validate_frame(left, self.idle, "stepL")
        right_audit = sprites.validate_frame(right, self.idle, "stepR")

        self.assertNotEqual(
            sprites.flattened_pixels(left), sprites.flattened_pixels(right)
        )
        for audit in (left_audit, right_audit):
            self.assertGreater(audit["upperBodyChangedPixels"], 0)
            self.assertGreater(audit["lowerBodyChangedPixels"], 0)
            self.assertEqual(audit["footBaselineErrorPx"], 0)
            self.assertLessEqual(audit["footCenterErrorPx"], 1)
            self.assertEqual(audit["sourceArtPaletteValidation"], "pass")
            self.assertEqual(audit["topologyValidation"], "pass")
            self.assertEqual(audit["interiorNewTransparentPixels"], 0)
            self.assertEqual(audit["maximumNewTransparentVerticalRunPx"], 0)
            self.assertEqual(audit["connectedComponentIncrease"], 0)

    def test_topology_audit_detects_a_new_vertical_interior_seam(self):
        torn = self.idle.copy()
        torn_pixels = torn.load()
        for y in range(20, 36):
            torn_pixels[24, y] = (0, 0, 0, 0)

        audit = sprites.topology_audit(self.idle, torn)

        self.assertEqual(audit["interiorNewTransparentPixels"], 16)
        self.assertEqual(audit["maximumNewTransparentVerticalRunPx"], 16)


class DeterminismTests(unittest.TestCase):
    def test_pixel_hash_ignores_png_compression_but_file_hash_does_not(self):
        image = rgba_frame()
        draw = ImageDraw.Draw(image)
        draw.rectangle((9, 7, 37, 65), fill=(35, 126, 201, 255))
        draw.ellipse((14, 14, 32, 33), fill=(238, 190, 142, 255))

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fast = root / "fast.png"
            compact = root / "compact.png"
            image.save(fast, format="PNG", optimize=False, compress_level=0)
            image.save(compact, format="PNG", optimize=False, compress_level=9)

            self.assertNotEqual(
                sprites.sha256_file(fast), sprites.sha256_file(compact)
            )
            self.assertEqual(
                sprites.pixel_sha256_file(fast),
                sprites.pixel_sha256_file(compact),
            )

    def test_save_png_is_byte_deterministic_for_equal_pixels(self):
        image = rgba_frame()
        ImageDraw.Draw(image).rectangle(
            (11, 4, 36, 65), fill=(96, 164, 112, 255)
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = root / "first.png"
            second = root / "second.png"
            sprites.save_png(image, first)
            sprites.save_png(image.copy(), second)
            self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_v3_facing_gate_rejects_pixel_drift_without_repairing_files(self):
        image = rgba_frame()
        ImageDraw.Draw(image).rectangle(
            (13, 5, 34, 65), fill=(84, 126, 202, 255)
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            character_root = root / "sample"
            character_root.mkdir()
            for direction in sprites.DIRECTIONS:
                sprites.save_png(image, character_root / f"{direction}.png")
            expected = sprites.source_pixel_hashes(root, ["sample"])
            previous = {
                "version": sprites.GENERATOR_VERSION,
                "sourceFacing": {"canonicalPixelSha256": expected},
            }
            current, status = sprites.ensure_canonical_facing(
                root, ["sample"], previous
            )
            self.assertEqual(current, expected)
            self.assertEqual(status, "verified-existing")

            changed_path = character_root / "left.png"
            changed = image.copy()
            changed.putpixel((13, 5), (236, 92, 72, 255))
            sprites.save_png(changed, changed_path)
            before = changed_path.read_bytes()
            with self.assertRaisesRegex(ValueError, "pixel hashes changed"):
                sprites.ensure_canonical_facing(root, ["sample"], previous)
            self.assertEqual(changed_path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
