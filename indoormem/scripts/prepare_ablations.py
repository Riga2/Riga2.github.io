#!/usr/bin/env python3
"""Refresh original ablation videos, first-frame posters, and page cache keys.

All topics: python3 scripts/prepare_ablations.py
Selected topics: python3 scripts/prepare_ablations.py layout semantic
Audio is removed in place without re-encoding the video, using the same
validated processing helper as Comparisons. The topic order stays unchanged.
"""

import argparse
import json
import re
import subprocess

from prepare_comparisons import ROOT, refresh


def update_dimensions(html, asset, width, height):
    def update_tag(match):
        tag = match.group(0)
        source = re.search(r'\bsrc="([^"]+)"', tag)
        if not source or source.group(1).split("?")[0] != asset:
            return tag
        for name, value in (("width", width), ("height", height)):
            tag = re.sub(rf'\b{name}="[^"]*"', f'{name}="{value}"', tag)
        return tag

    return re.sub(r'<(?:video|img)\b[^>]*>', update_tag, html)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("topics", nargs="*", help="memory, layout, semantic; defaults to all three")
    args = parser.parse_args()
    topics = args.topics or ["memory", "layout", "semantic"]
    if set(topics) - {"memory", "layout", "semantic"}:
        parser.error("Supported topics: memory, layout, semantic")

    page = ROOT / "index.html"
    html = page.read_text()
    for topic in dict.fromkeys(topics):
        source = ROOT / "ablations" / f"{topic}_ablation.mp4"
        if not source.is_file():
            parser.error(f"Missing video: {source}")
        video, poster, version = refresh(source)
        probe = json.loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "json", str(source),
        ]))
        width, height = (probe["streams"][0][name] for name in ("width", "height"))
        for asset in (video, poster):
            pattern = r'([\w-]+=")' + re.escape(asset) + r'(?:\?[^"\s]*)?(\")'
            html, count = re.subn(pattern, lambda match: f'{match[1]}{asset}?v={version}{match[2]}', html)
            if count == 0:
                raise RuntimeError(f"No existing page reference found for {asset}")
            html = update_dimensions(html, asset, width, height)
        print(f"Updated {topic}: {width}×{height}, no audio, first-frame poster, cache version {version}", flush=True)

    page.write_text(html)


if __name__ == "__main__":
    main()
