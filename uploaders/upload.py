#!/usr/bin/env python3
"""
Unified uploader — Instagram + YouTube.
Reads credentials from .env (project root) or environment variables.

Usage:
  python uploaders/upload.py --video <path> --title <title> [--description <desc>] [--tags <tags>] [--privacy <status>] [--ig-only | --yt-only]
"""

import argparse
import subprocess
import sys
from pathlib import Path


def main():
    p = argparse.ArgumentParser(description="Upload video to Instagram and/or YouTube")
    p.add_argument("--video", required=True, help="Path to video file")
    p.add_argument("--title", default="Valorant Short", help="Video title (YouTube)")
    p.add_argument("--description", default="#valorant #gaming #shorts", help="Video description")
    p.add_argument("--tags", nargs="*", default=["valorant", "gaming", "shorts"], help="YouTube tags")
    p.add_argument("--privacy", default="public", choices=["public", "unlisted", "private"], help="YouTube privacy")
    p.add_argument("--caption", default="#valorant #gaming", help="Instagram caption")
    p.add_argument("--ig-only", action="store_true", help="Only upload to Instagram")
    p.add_argument("--yt-only", action="store_true", help="Only upload to YouTube")
    args = p.parse_args()

    video = Path(args.video)
    if not video.exists():
        print(f"ERROR: video not found: {video}")
        sys.exit(1)

    upload_dir = Path(__file__).parent

    success = True

    if not args.yt_only:
        print("\n=== Instagram upload ===")
        ig_script = upload_dir / "instagram" / "uploader.py"
        r = subprocess.run(
            [sys.executable, str(ig_script), "--video", str(video), "--caption", args.caption],
            capture_output=False,
        )
        if r.returncode != 0:
            print("  Instagram upload FAILED")
            success = False
        else:
            print("  Instagram upload done\n")

    if not args.ig_only:
        print("\n=== YouTube upload ===")
        yt_script = upload_dir / "youtube" / "upload.py"
        cmd = [
            sys.executable, str(yt_script),
            "--video", str(video),
            "--title", args.title,
            "--description", args.description,
            "--privacy", args.privacy,
        ]
        if args.tags:
            cmd += ["--tags"] + args.tags
        r = subprocess.run(cmd, capture_output=False)
        if r.returncode != 0:
            print("  YouTube upload FAILED")
            success = False
        else:
            print("  YouTube upload done\n")

    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
