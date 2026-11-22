#!/usr/bin/env python3
"""Measure full-video floorplan bounds for Showcases and multi-floorplan pairs.

Run: python3 scripts/prepare_floorplans.py
Requires ffmpeg / ffprobe. Original videos are not changed. All frames are
examined so the fixed crop includes the entire animation without jitter.
"""

import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "index.html"


def measure(path):
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "json", str(path),
    ]))
    width, height = (probe["streams"][0][key] for key in ("width", "height"))
    result = subprocess.run([
        "ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
        "-vf", "format=gray,negate,bbox=min_val=20",
        "-an", "-f", "null", "-",
    ], check=True, capture_output=True, text=True)
    boxes = [tuple(map(int, match)) for match in re.findall(
        r"x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)", result.stderr,
    )]
    boxes = [box for box in boxes if box[1] >= box[0] and box[3] >= box[2]]
    if not boxes:
        return [width, height, 0, 0, width, height]
    padding = max(4, round(min(width, height) * 0.0125))
    left = max(0, min(box[0] for box in boxes) - padding)
    right = min(width, max(box[1] for box in boxes) + 1 + padding)
    top = max(0, min(box[2] for box in boxes) - padding)
    bottom = min(height, max(box[3] for box in boxes) + 1 + padding)
    return [width, height, left, top, right - left, bottom - top]


def main():
    html = PAGE.read_text()

    def update_button(match):
        button = match.group(0)
        source = re.search(r'data-floorplan="([^"]+)"', button)
        if not source:
            return button
        path = ROOT / source.group(1)
        crop = measure(path)
        attribute = 'data-floorplan-crop="' + ",".join(map(str, crop)) + '"'
        if 'data-floorplan-crop="' in button:
            button = re.sub(r'data-floorplan-crop="[^"]*"', attribute, button)
        else:
            button = button.replace(source.group(0), source.group(0) + " " + attribute)

        prefix = re.search(r'data-poster-prefix="([^"]+)"', button)
        if prefix:
            poster = ROOT / (prefix.group(1) + "-floorplan.jpg")
            poster.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(path), "-frames:v", "1", "-vf",
                "scale=640:480:force_original_aspect_ratio=decrease",
                "-q:v", "3", str(poster),
            ], check=True)
        print(f"{path.parent.name}: {crop[0]}×{crop[1]} → {crop[4]}×{crop[5]} at ({crop[2]}, {crop[3]})", flush=True)
        return button

    html = re.sub(r'<button\b[^>]*\bdata-scene="[^"]+"[^>]*>', update_button, html)
    html = re.sub(r'<div\b[^>]*\bdata-floorplan-pair\b[^>]*>', update_button, html)
    PAGE.write_text(html)


if __name__ == "__main__":
    main()
