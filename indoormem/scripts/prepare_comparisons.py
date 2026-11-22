#!/usr/bin/env python3
"""Remove audio in place, refresh first-frame posters, and update page cache keys.

Run: python3 scripts/prepare_comparisons.py
One case: python3 scripts/prepare_comparisons.py gen2_003_comp
Requires ffmpeg and ffprobe. Existing case order and encoded video are preserved.
Audio tracks are removed directly from comparisons/*.mp4 after validation.
"""

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def stream_types(path):
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", str(path),
    ]))
    return [stream["codec_type"] for stream in probe["streams"]]


def video_checksum(path):
    return subprocess.check_output([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
        "-map", "0:v:0", "-c:v", "copy", "-f", "hash", "-hash", "sha256", "-",
    ], text=True).strip()


def refresh(source):
    poster = source.parent / "previews" / f"{source.stem}.jpg"
    poster.parent.mkdir(exist_ok=True)

    with tempfile.TemporaryDirectory(prefix=".refresh-", dir=source.parent) as directory:
        staged_video = Path(directory) / source.name
        staged_poster = Path(directory) / poster.name
        if stream_types(source) != ["video"]:
            subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
                "-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart", str(staged_video),
            ], check=True)
            if stream_types(staged_video) != ["video"]:
                raise RuntimeError(f"Expected one video stream and no audio: {source}")
            if video_checksum(source) != video_checksum(staged_video):
                raise RuntimeError(f"Encoded video changed unexpectedly: {source}")
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
            "-frames:v", "1", "-q:v", "2", str(staged_poster),
        ], check=True)
        if staged_video.exists():
            staged_video.replace(source)
        staged_poster.replace(poster)

    version = hashlib.sha256(source.read_bytes()).hexdigest()[:12]
    return source.relative_to(ROOT).as_posix(), poster.relative_to(ROOT).as_posix(), version


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case", nargs="?", help="Optional source stem, e.g. gen2_003_comp")
    args = parser.parse_args()
    sources = sorted((ROOT / "comparisons").glob("*.mp4"))
    if args.case:
        sources = [source for source in sources if source.stem == args.case]
    if not sources:
        parser.error("No matching comparison videos found.")

    page = ROOT / "index.html"
    html = page.read_text()
    for source in sources:
        video, poster, version = refresh(source)
        for asset in (video, poster):
            # Migrate older pages that pointed at silent/ copies as well.
            paths = [asset]
            if asset == video:
                paths.append(f"comparisons/silent/{source.name}")
            pattern = r'([\w-]+=")(?:' + "|".join(map(re.escape, paths)) + r')(?:\?[^"\s]*)?(\")'
            html, count = re.subn(pattern, lambda match: f'{match[1]}{asset}?v={version}{match[2]}', html)
            if count == 0:
                raise RuntimeError(f"No existing page reference found for {asset}")
        print(f"Updated {source.stem}: original file without audio, first-frame poster, cache version {version}", flush=True)
    page.write_text(html)


if __name__ == "__main__":
    main()
