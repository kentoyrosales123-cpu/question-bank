import argparse
import random
from dataclasses import dataclass

import cv2
import numpy as np


CHOICES = ["A", "B", "C", "D"]
ROWS_PER_BLOCK = 25
MAX_BLOCKS = 4
SCAN = {
    "number_column": 0.18,
    "header_row": 0.12,
}


@dataclass
class DetectionResult:
    answers: list[str]
    accuracy: float
    detected: int


def draw_sheet(item_count: int, answers: list[str], variant: str) -> np.ndarray:
    width, height = 1200, 1600
    image = np.full((height, width, 3), 255, dtype=np.uint8)

    bounds = {
        "x": int(width * 0.06),
        "y": int(height * 0.08),
        "width": int(width * 0.88),
        "height": int(height * 0.78),
    }
    marker_size = 34
    marker_points = [
        (bounds["x"], bounds["y"]),
        (bounds["x"] + bounds["width"], bounds["y"]),
        (bounds["x"], bounds["y"] + bounds["height"]),
        (bounds["x"] + bounds["width"], bounds["y"] + bounds["height"]),
    ]

    for x, y in marker_points:
        cv2.rectangle(
            image,
            (int(x - marker_size / 2), int(y - marker_size / 2)),
            (int(x + marker_size / 2), int(y + marker_size / 2)),
            (0, 0, 0),
            -1,
        )

    block_count = min(MAX_BLOCKS, max(1, int(np.ceil(item_count / ROWS_PER_BLOCK))))
    answer_y = bounds["y"] + bounds["height"] * SCAN["header_row"]
    answer_height = bounds["height"] * (1 - SCAN["header_row"])
    row_height = answer_height / ROWS_PER_BLOCK
    block_width = bounds["width"] / block_count

    for block_index in range(block_count):
        block_x = bounds["x"] + block_width * block_index
        answer_x = block_x + block_width * SCAN["number_column"]
        answer_width = block_width * (1 - SCAN["number_column"])
        column_width = answer_width / len(CHOICES)

        for line_index in range(ROWS_PER_BLOCK + 1):
            y = int(answer_y + row_height * line_index)
            cv2.line(
                image,
                (int(block_x), y),
                (int(block_x + block_width), y),
                (0, 0, 0),
                2,
            )

        x_positions = [
            block_x,
            answer_x,
            answer_x + column_width,
            answer_x + column_width * 2,
            answer_x + column_width * 3,
            answer_x + column_width * 4,
        ]

        for x in x_positions:
            cv2.line(
                image,
                (int(x), int(answer_y)),
                (int(x), int(answer_y + answer_height)),
                (0, 0, 0),
                2,
            )

        for row_index in range(ROWS_PER_BLOCK):
            item_index = block_index * ROWS_PER_BLOCK + row_index
            if item_index >= item_count:
                continue

            y = answer_y + row_height * (row_index + 0.5)
            for label_index, label in enumerate(CHOICES):
                x = answer_x + column_width * (label_index + 0.5)
                radius = int(max(5, min(row_height, column_width) * 0.22))
                cv2.circle(image, (int(x), int(y)), radius, (70, 70, 70), 2)

                if answers[item_index] == label:
                    cv2.circle(image, (int(x), int(y)), radius - 2, (20, 20, 20), -1)

    if variant in {"perspective", "noisy_shadow"}:
        src = np.float32(
            [
                [0, 0],
                [width - 1, 0],
                [0, height - 1],
                [width - 1, height - 1],
            ]
        )
        dst = np.float32(
            [
                [34, 52],
                [width - 62, 18],
                [18, height - 38],
                [width - 28, height - 68],
            ]
        )
        matrix = cv2.getPerspectiveTransform(src, dst)
        image = cv2.warpPerspective(
            image,
            matrix,
            (width, height),
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(255, 255, 255),
        )

    if variant == "noisy_shadow":
        shadow = np.linspace(0.72, 1.0, width, dtype=np.float32)
        image = np.clip(image.astype(np.float32) * shadow[np.newaxis, :, np.newaxis], 0, 255)
        noise = np.random.default_rng(7).normal(0, 5, image.shape)
        image = np.clip(image + noise, 0, 255).astype(np.uint8)

    return image


def detect_markers(image: np.ndarray) -> dict | None:
    height, width = image.shape[:2]
    manual = {
        "x": width * 0.06,
        "y": height * 0.08,
        "width": width * 0.88,
        "height": height * 0.78,
    }
    padding = int(min(manual["width"], manual["height"]) * 0.04)
    crop_x = max(0, int(manual["x"] - padding))
    crop_y = max(0, int(manual["y"] - padding))
    crop_width = min(width - crop_x, int(manual["width"] + padding * 2))
    crop_height = min(height - crop_y, int(manual["height"] + padding * 2))
    crop = image[crop_y : crop_y + crop_height, crop_x : crop_x + crop_width]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 60, 255, cv2.THRESH_BINARY_INV)
    dense_bounds = detect_dense_corner_markers(thresh, crop_x, crop_y)

    if dense_bounds:
        return dense_bounds

    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []

    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = cv2.contourArea(contour)
        aspect = w / max(1, h)
        fill = area / max(1, w * h)

        if 10 <= w <= 120 and 10 <= h <= 120 and 0.65 < aspect < 1.45 and fill > 0.5:
            candidates.append(
                {
                    "x": crop_x + x + w / 2,
                    "y": crop_y + y + h / 2,
                }
            )

    if len(candidates) < 4:
        return None

    top_left = min(candidates, key=lambda point: point["x"] + point["y"])
    top_right = min(candidates, key=lambda point: width - point["x"] + point["y"])
    bottom_left = min(candidates, key=lambda point: point["x"] + height - point["y"])
    bottom_right = min(
        candidates,
        key=lambda point: width - point["x"] + height - point["y"],
    )

    return {
        "x": min(top_left["x"], bottom_left["x"]),
        "y": min(top_left["y"], top_right["y"]),
        "width": max(top_right["x"], bottom_right["x"]) - min(top_left["x"], bottom_left["x"]),
        "height": max(bottom_left["y"], bottom_right["y"]) - min(top_left["y"], top_right["y"]),
    }


def detect_dense_corner_markers(thresh: np.ndarray, offset_x: int, offset_y: int) -> dict | None:
    height, width = thresh.shape[:2]
    marker_window = max(12, int(round(min(width, height) * 0.025)))
    corner_width = int(round(width * 0.28))
    corner_height = int(round(height * 0.28))
    regions = [
        (0, 0, corner_width, corner_height),
        (width - corner_width, 0, corner_width, corner_height),
        (0, height - corner_height, corner_width, corner_height),
        (width - corner_width, height - corner_height, corner_width, corner_height),
    ]
    points = [find_darkest_patch(thresh, region, marker_window) for region in regions]

    if any(point is None or point["ratio"] < 0.55 for point in points):
        return None

    return {
        "x": offset_x + min(points[0]["x"], points[2]["x"]),
        "y": offset_y + min(points[0]["y"], points[1]["y"]),
        "width": max(1, max(points[1]["x"], points[3]["x"]) - min(points[0]["x"], points[2]["x"])),
        "height": max(1, max(points[2]["y"], points[3]["y"]) - min(points[0]["y"], points[1]["y"])),
        "points": {
            "top_left": {"x": offset_x + points[0]["x"], "y": offset_y + points[0]["y"]},
            "top_right": {"x": offset_x + points[1]["x"], "y": offset_y + points[1]["y"]},
            "bottom_left": {"x": offset_x + points[2]["x"], "y": offset_y + points[2]["y"]},
            "bottom_right": {"x": offset_x + points[3]["x"], "y": offset_y + points[3]["y"]},
        },
    }


def find_darkest_patch(thresh: np.ndarray, region: tuple[int, int, int, int], marker_window: int) -> dict | None:
    x, y, width, height = region
    roi = thresh[y : y + height, x : x + width]

    if roi.size == 0 or roi.shape[0] < marker_window or roi.shape[1] < marker_window:
        return None

    density = cv2.boxFilter(
        (roi > 0).astype(np.float32),
        ddepth=-1,
        ksize=(marker_window, marker_window),
        normalize=True,
    )
    _, best_ratio, _, best_location = cv2.minMaxLoc(density)
    best_x, best_y = best_location

    return {
        "x": x + best_x,
        "y": y + best_y,
        "ratio": best_ratio,
    }


def sample_bubble(gray: np.ndarray, x: float, y: float, radius: float) -> dict:
    start_x = max(0, int(round(x - radius)))
    start_y = max(0, int(round(y - radius)))
    size = max(2, int(round(radius * 2)))
    roi = gray[start_y : start_y + size, start_x : start_x + size]

    if roi.size == 0:
        return {"darkness": 0, "dark_ratio": 0}

    mask = np.zeros(roi.shape, dtype=np.uint8)
    cv2.circle(
        mask,
        (roi.shape[1] // 2, roi.shape[0] // 2),
        max(1, min(roi.shape[:2]) // 2),
        255,
        -1,
    )
    _, thresh = cv2.threshold(roi, 165, 255, cv2.THRESH_BINARY_INV)
    masked = cv2.bitwise_and(thresh, mask)
    mask_pixels = max(1, cv2.countNonZero(mask))

    return {
        "darkness": float(cv2.mean(thresh, mask=mask)[0] / 255 * 100),
        "dark_ratio": cv2.countNonZero(masked) / mask_pixels,
    }


def scan_sheet(image: np.ndarray, expected_answers: list[str]) -> DetectionResult:
    item_count = len(expected_answers)
    bounds = detect_markers(image)

    if bounds is None:
        raise RuntimeError("Could not detect corner markers.")

    if "points" in bounds:
        image, bounds = warp_to_marker_bounds(image, bounds)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    block_count = min(MAX_BLOCKS, max(1, int(np.ceil(item_count / ROWS_PER_BLOCK))))
    answer_y = bounds["y"] + bounds["height"] * SCAN["header_row"]
    answer_height = bounds["height"] * (1 - SCAN["header_row"])
    row_height = answer_height / ROWS_PER_BLOCK
    block_width = bounds["width"] / block_count
    detected_answers = []

    for item_index in range(item_count):
        block_index = item_index // ROWS_PER_BLOCK
        row_index = item_index % ROWS_PER_BLOCK
        block_x = bounds["x"] + block_width * block_index
        y = answer_y + row_height * (row_index + 0.5)
        answer_x = block_x + block_width * SCAN["number_column"]
        answer_width = block_width * (1 - SCAN["number_column"])
        column_width = answer_width / len(CHOICES)
        radius = max(4, min(row_height, column_width) * 0.24)
        scores = []

        for label_index, label in enumerate(CHOICES):
            x = answer_x + column_width * (label_index + 0.5)
            scores.append({"label": label, **sample_bubble(gray, x, y, radius)})

        scores.sort(key=lambda item: item["darkness"], reverse=True)
        confidence = scores[0]["darkness"] - scores[1]["darkness"]
        row_average = sum(item["darkness"] for item in scores) / len(scores)
        row_spread = float(np.std([item["darkness"] for item in scores]))
        row_dark_ratio = sum(item["dark_ratio"] for item in scores) / len(scores)
        relative_lift = scores[0]["darkness"] - row_average
        dark_ratio_lift = scores[0]["dark_ratio"] - row_dark_ratio
        duplicate_mark = (
            scores[1]["dark_ratio"] > 0.18
            and scores[1]["darkness"] > row_average + 12
            and confidence < max(14, row_spread * 0.7)
        )
        answer = (
            scores[0]["label"]
            if not duplicate_mark
            and scores[0]["darkness"] > 38
            and scores[0]["dark_ratio"] > 0.12
            and confidence >= max(12, row_spread * 0.7)
            and relative_lift >= max(12, row_spread * 0.8)
            and dark_ratio_lift > 0.04
            else ""
        )

        detected_answers.append(answer)

    matches = sum(1 for expected, actual in zip(expected_answers, detected_answers) if expected == actual)

    return DetectionResult(
        answers=detected_answers,
        accuracy=matches / item_count,
        detected=sum(1 for answer in detected_answers if answer),
    )


def warp_to_marker_bounds(image: np.ndarray, bounds: dict) -> tuple[np.ndarray, dict]:
    points = bounds["points"]
    top_left = points["top_left"]
    top_right = points["top_right"]
    bottom_left = points["bottom_left"]
    bottom_right = points["bottom_right"]
    target_width = max(
        1,
        int(
            round(
                max(
                    np.hypot(top_right["x"] - top_left["x"], top_right["y"] - top_left["y"]),
                    np.hypot(bottom_right["x"] - bottom_left["x"], bottom_right["y"] - bottom_left["y"]),
                )
            )
        ),
    )
    target_height = max(
        1,
        int(
            round(
                max(
                    np.hypot(bottom_left["x"] - top_left["x"], bottom_left["y"] - top_left["y"]),
                    np.hypot(bottom_right["x"] - top_right["x"], bottom_right["y"] - top_right["y"]),
                )
            )
        ),
    )
    src = np.float32(
        [
            [top_left["x"], top_left["y"]],
            [top_right["x"], top_right["y"]],
            [bottom_left["x"], bottom_left["y"]],
            [bottom_right["x"], bottom_right["y"]],
        ]
    )
    dst = np.float32(
        [
            [0, 0],
            [target_width, 0],
            [0, target_height],
            [target_width, target_height],
        ]
    )
    transform = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(
        image,
        transform,
        (target_width, target_height),
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(255, 255, 255),
    )

    return warped, {"x": 0, "y": 0, "width": target_width, "height": target_height}


def main() -> None:
    parser = argparse.ArgumentParser(description="OpenCV OMR scanner accuracy smoke test.")
    parser.add_argument("--items", type=int, default=100)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed)
    expected = [random.choice(CHOICES) for _ in range(args.items)]
    variants = ["clean", "perspective", "noisy_shadow"]
    failures = []

    for variant in variants:
        image = draw_sheet(args.items, expected, variant)
        result = scan_sheet(image, expected)
        percent = result.accuracy * 100
        print(
            f"{variant}: accuracy={percent:.2f}% detected={result.detected}/{args.items}"
        )

        if result.accuracy < 0.98:
            failures.append((variant, percent))

    if failures:
        details = ", ".join(f"{variant} {percent:.2f}%" for variant, percent in failures)
        raise SystemExit(f"Accuracy below threshold: {details}")


if __name__ == "__main__":
    main()
