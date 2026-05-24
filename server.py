from __future__ import annotations

import io
import json
from pathlib import Path
try:
    import cv2  # pyright: ignore[reportMissingImports]
except Exception:  # pragma: no cover - optional OpenCV path
    cv2 = None

import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from PIL import Image


APP_DIR = Path(__file__).resolve().parent

LOGICAL_COLORS = {
    "t": (107, 224, 190),
    "r": (223, 88, 88),
    "p": (167, 115, 203),
    "d": (90, 92, 117),
    "g": (88, 177, 90),
    "b": (79, 143, 232),
}

BOARD_ROWS = 20
BOARD_COLS = 14

# Normalized crop coordinates for the fixed screenshot layout.
BOARD_BOX = (0.12, 0.19, 0.88, 0.76)
PALETTE_POINTS = [0.17, 0.31, 0.44, 0.57, 0.70]
PALETTE_Y = 0.82


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024


def hex_to_rgb(hex_value: str) -> tuple[int, int, int]:
    hex_value = hex_value.lstrip("#")
    return tuple(int(hex_value[index : index + 2], 16) for index in (0, 2, 4))


def closest_color_key(rgb: tuple[int, int, int]) -> str:
    best_key = "t"
    best_distance = float("inf")
    for key, sample_rgb in LOGICAL_COLORS.items():
        distance = sum((component - sample_component) ** 2 for component, sample_component in zip(rgb, sample_rgb))
        if distance < best_distance:
            best_distance = distance
            best_key = key
    return best_key


def crop_box(image: Image.Image, box: tuple[float, float, float, float]) -> Image.Image:
    width, height = image.size
    left = int(width * box[0])
    top = int(height * box[1])
    right = int(width * box[2])
    bottom = int(height * box[3])
    return image.crop((left, top, right, bottom))


def bbox_to_normalized(bbox: tuple[int, int, int, int], image: Image.Image) -> tuple[float, float, float, float]:
    left, top, right, bottom = bbox
    w, h = image.size
    return (left / w, top / h, right / w, bottom / h)


def normalized_to_bbox(norm: tuple[float, float, float, float], image: Image.Image) -> tuple[int, int, int, int]:
    w, h = image.size
    left = int(max(0, min(w - 1, round(norm[0] * w))))
    top = int(max(0, min(h - 1, round(norm[1] * h))))
    right = int(max(0, min(w, round(norm[2] * w))))
    bottom = int(max(0, min(h, round(norm[3] * h))))
    return (left, top, right, bottom)


def detect_board_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    """Detect the inner bounding box of the board using the black rounded border.

    Returns pixel coordinates (left, top, right, bottom) of the inner area.
    Falls back to None when detection fails.
    """
    if cv2 is None:
        return None

    # Convert to OpenCV BGR
    arr = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(arr, cv2.COLOR_BGR2GRAY)
    # Find edges to locate border
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)
    edged = cv2.Canny(blurred, 30, 120)

    # Dilate to close thin gaps
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    closed = cv2.morphologyEx(edged, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    # Choose largest contour by area
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 1000:
            continue

        # Approximate polygon and bounding rect
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        x, y, w, h = cv2.boundingRect(approx)

        # Estimate border thickness by scanning inward from edges looking for dark pixels
        sub = gray[y : y + h, x : x + w]
        # approximate border thickness as small fraction of min dimension
        border_px = max(4, int(min(w, h) * 0.03))

        # Shrink bbox by border_px to get inner area
        left = x + border_px
        top = y + border_px
        right = x + w - border_px
        bottom = y + h - border_px

        # sanity check
        ih, iw = image.height, image.width
        if left >= right or top >= bottom:
            continue

        # return inner rect
        return (int(left), int(top), int(right), int(bottom))

    return None


def sample_pixel(image: Image.Image, x_ratio: float, y_ratio: float) -> tuple[int, int, int]:
    width, height = image.size
    x = min(width - 1, max(0, int(width * x_ratio)))
    y = min(height - 1, max(0, int(height * y_ratio)))
    return image.getpixel((x, y))[:3]


def parse_palette(image: Image.Image) -> tuple[list[str], list[tuple[int, int, int]]]:
    width, height = image.size

    # First try to segment the bottom palette strip into saturated components.
    bottom_top = int(height * 0.76)
    bottom_bottom = int(height * 0.93)
    strip = image.crop((0, bottom_top, width, bottom_bottom)).convert("RGB")
    arr = np.array(strip)

    if arr.size > 0:
        hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV) if cv2 is not None else None
        if hsv is not None:
            # Exclude white/gray UI chrome by requiring saturation and avoiding near-white value.
            mask = ((hsv[:, :, 1] > 45) & (hsv[:, :, 2] < 245)).astype(np.uint8) * 255
            kernel = np.ones((3, 3), np.uint8)
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            candidates: list[tuple[int, int, int, int, tuple[int, int, int]]] = []
            for cnt in contours:
                area = cv2.contourArea(cnt)
                if area < 80:
                    continue
                x, y, w, h = cv2.boundingRect(cnt)
                pad_x = max(1, int(w * 0.15))
                pad_y = max(1, int(h * 0.15))
                sample = strip.crop((
                    max(0, x + pad_x),
                    max(0, y + pad_y),
                    min(strip.width, x + w - pad_x),
                    min(strip.height, y + h - pad_y),
                )).convert("RGB")
                sample_arr = np.array(sample)
                if sample_arr.size == 0:
                    continue
                med_r = int(np.median(sample_arr[:, :, 0]))
                med_g = int(np.median(sample_arr[:, :, 1]))
                med_b = int(np.median(sample_arr[:, :, 2]))
                candidates.append((x, y, w, h, (med_r, med_g, med_b)))

            if len(candidates) >= 4:
                candidates.sort(key=lambda item: item[0])
                rgbs = [item[4] for item in candidates[:5]]
                keys = [closest_color_key(rgb) for rgb in rgbs]
                return keys, rgbs

    # Fallback: sample the original palette points, but reject near-white values.
    sampled_rgbs: list[tuple[int, int, int]] = []
    box_half = max(2, int(min(width, height) * 0.02))

    for x_ratio in PALETTE_POINTS:
        cx = int(width * x_ratio)
        cy = int(height * PALETTE_Y)
        left = max(0, cx - box_half)
        right = min(width, cx + box_half)
        top = max(0, cy - box_half)
        bottom = min(height, cy + box_half)
        region = image.crop((left, top, right, bottom)).convert("RGB")
        arr = np.array(region)
        if arr.size == 0:
            continue
        med_r = int(np.median(arr[:, :, 0]))
        med_g = int(np.median(arr[:, :, 1]))
        med_b = int(np.median(arr[:, :, 2]))
        if med_r > 240 and med_g > 240 and med_b > 240:
            continue
        sampled_rgbs.append((med_r, med_g, med_b))

    def sq_dist(a, b):
        return sum((aa - bb) ** 2 for aa, bb in zip(a, b))

    deduped_rgbs: list[tuple[int, int, int]] = []
    for rgb in sampled_rgbs:
        if not deduped_rgbs:
            deduped_rgbs.append(rgb)
            continue
        if all(sq_dist(rgb, existing) > 60 * 60 for existing in deduped_rgbs):
            deduped_rgbs.append(rgb)

    keys: list[str] = [closest_color_key(rgb) for rgb in deduped_rgbs]
    return keys, deduped_rgbs


def parse_board(
    image: Image.Image,
    palette_keys: list[str],
    palette_rgbs: list[tuple[int, int, int]] | None = None,
    bbox: tuple[int, int, int, int] | None = None,
) -> list[list[str]]:
    if bbox is not None:
        crop = image.crop(bbox).convert("RGB")
    else:
        # attempt to detect board bbox automatically
        detected = detect_board_bbox(image)
        if detected:
            crop = image.crop(detected).convert("RGB")
        else:
            crop = crop_box(image, BOARD_BOX).convert("RGB")
    width, height = crop.size
    board: list[list[str]] = []

    # Use provided palette rgb samples when available (from parse_palette)
    if palette_rgbs:
        palette_rgb = palette_rgbs
        palette_keys_used = palette_keys
    else:
        palette_rgb = [LOGICAL_COLORS[key] for key in palette_keys]
        palette_keys_used = palette_keys
    if not palette_rgb:
        palette_rgb = [LOGICAL_COLORS[key] for key in LOGICAL_COLORS]
        palette_keys_used = list(LOGICAL_COLORS.keys())

    for row in range(BOARD_ROWS):
        row_values: list[str] = []
        for col in range(BOARD_COLS):
            x = min(width - 1, max(0, int((col + 0.5) * width / BOARD_COLS)))
            y = min(height - 1, max(0, int((row + 0.5) * height / BOARD_ROWS)))
            rgb = crop.getpixel((x, y))[:3]

            # Match sampled cell color to nearest palette sample color first
            best_index = 0
            best_distance = float("inf")
            for i, sample_rgb in enumerate(palette_rgb):
                distance = sum((component - sample_component) ** 2 for component, sample_component in zip(rgb, sample_rgb))
                if distance < best_distance:
                    best_distance = distance
                    best_index = i
            best_key = palette_keys_used[best_index]

            row_values.append(best_key)
        board.append(row_values)

    return board


@app.route("/")
def index() -> object:
    return send_from_directory(APP_DIR, "page.html")


@app.route("/style.css")
def styles() -> object:
    return send_from_directory(APP_DIR, "style.css")


@app.route("/logic.js")
def script() -> object:
    return send_from_directory(APP_DIR, "logic.js")


@app.post("/api/analyze")
def analyze_image() -> object:
    if "image" not in request.files:
        return jsonify({"error": "No image uploaded."}), 400

    file = request.files["image"]
    if not file.filename:
        return jsonify({"error": "Empty file name."}), 400

    try:
        image = Image.open(io.BytesIO(file.read())).convert("RGB")
    except Exception:
        return jsonify({"error": "Could not read the uploaded image."}), 400

    # Replace dark background color (#141b23) with white to avoid confusing
    # the palette/board detector, but preserve true black borders (#000000).
    try:
        arr = np.array(image)
        # RGB for background and black
        bg_rgb = np.array((20, 27, 35))
        black_rgb = np.array((0, 0, 0))
        # squared thresholds
        bg_thresh_sq = 60 * 60
        black_thresh_sq = 30 * 30

        diff_bg = np.sum((arr - bg_rgb) ** 2, axis=2)
        diff_black = np.sum((arr - black_rgb) ** 2, axis=2)
        mask = (diff_bg <= bg_thresh_sq) & (diff_black > black_thresh_sq)
        arr[mask] = np.array((255, 255, 255), dtype=np.uint8)
        image = Image.fromarray(arr)
    except Exception:
        # non-fatal; continue with original image if numpy processing fails
        pass

    # try to detect the exact board area using the black border
    detected_bbox = detect_board_bbox(image)

    # Allow client to override the bbox by sending a JSON field 'bbox'
    # as normalized coords [left, top, right, bottom]. If provided, use it.
    override_bbox = None
    if "bbox" in request.form:
        try:
            norm = json.loads(request.form.get("bbox"))
            if isinstance(norm, (list, tuple)) and len(norm) == 4:
                override_bbox = normalized_to_bbox(tuple(norm), image)
        except Exception:
            override_bbox = None

    palette_keys, palette_rgbs = parse_palette(image)
    use_bbox = override_bbox if override_bbox is not None else detected_bbox
    board = parse_board(image, palette_keys, palette_rgbs, bbox=use_bbox)
    return jsonify(
        {
            "rows": BOARD_ROWS,
            "cols": BOARD_COLS,
            "paletteKeys": palette_keys,
            "board": board,
        }
    )


@app.post("/api/analyze/preview")
def analyze_preview() -> object:
    """Return detection results (bbox, normalized bbox, palette samples) without parsing the full board.

    The frontend can use this to present the detected crop and let the user edit before running full analysis.
    """
    if "image" not in request.files:
        return jsonify({"error": "No image uploaded."}), 400

    file = request.files["image"]
    if not file.filename:
        return jsonify({"error": "Empty file name."}), 400

    try:
        image = Image.open(io.BytesIO(file.read())).convert("RGB")
    except Exception:
        return jsonify({"error": "Could not read the uploaded image."}), 400

    # same background replacement as in analyze
    try:
        arr = np.array(image)
        bg_rgb = np.array((20, 27, 35))
        black_rgb = np.array((0, 0, 0))
        bg_thresh_sq = 60 * 60
        black_thresh_sq = 30 * 30
        diff_bg = np.sum((arr - bg_rgb) ** 2, axis=2)
        diff_black = np.sum((arr - black_rgb) ** 2, axis=2)
        mask = (diff_bg <= bg_thresh_sq) & (diff_black > black_thresh_sq)
        arr[mask] = np.array((255, 255, 255), dtype=np.uint8)
        image = Image.fromarray(arr)
    except Exception:
        pass

    detected_bbox = detect_board_bbox(image)
    palette_keys, palette_rgbs = parse_palette(image)
    norm_bbox = bbox_to_normalized(detected_bbox, image) if detected_bbox else None

    # Convert palette_rgbs to simple lists for JSON
    palette_rgb_list = [list(map(int, rgb)) for rgb in (palette_rgbs or [])]

    return jsonify(
        {
            "rows": BOARD_ROWS,
            "cols": BOARD_COLS,
            "paletteKeys": palette_keys,
            "paletteRGBs": palette_rgb_list,
            "paletteLabels": palette_keys,
            "bbox": detected_bbox,
            "normBBox": norm_bbox,
        }
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)