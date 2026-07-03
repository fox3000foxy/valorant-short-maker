"""
IG uploader — instagrapi
Reads credentials from environment variables (.env or shell).

Usage:
  python uploader.py --video <path> --caption <caption>
"""

import argparse
import os
import sys
from pathlib import Path

from instagrapi import Client

SESSION_FILE = Path(__file__).parent / "ig_session.json"


def load_dotenv():
    """Load .env from project root (two levels up from uploaders/instagram/)."""
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip())


def challenge_handler(username, choice):
    return input(f"Code sent via {choice}, enter: ")


def login():
    cl = Client()
    cl.challenge_code_handler = challenge_handler

    session_id = os.environ.get("INSTAGRAM_SESSION_ID", "").strip()
    username = os.environ.get("INSTAGRAM_USERNAME", "").strip()
    password = os.environ.get("INSTAGRAM_PASSWORD", "").strip()

    if session_id:
        print("  Logging in via session ID...")
        cl.login_by_sessionid(session_id)
        cl.dump_settings(SESSION_FILE)
        print("  Session saved.")
        return cl

    if SESSION_FILE.exists():
        print("  Loading saved session...")
        cl.load_settings(SESSION_FILE)
        try:
            cl.get_timeline_feed()
            print("  Session valid.")
        except Exception:
            print("  Session expired, logging in with password...")
            if not username or not password:
                print("ERROR: INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD required")
                sys.exit(1)
            cl.login(username, password)
            cl.dump_settings(SESSION_FILE)
    else:
        if not username or not password:
            print("ERROR: INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD required")
            sys.exit(1)
        print("  Logging in with password...")
        cl.login(username, password)
        cl.dump_settings(SESSION_FILE)

    return cl


def upload_reel(video_path: str, caption: str):
    print(f"  Uploading to Instagram: {video_path}")
    cl = login()
    media = cl.clip_upload(video_path, caption)
    print(f"  Instagram OK, media id: {media.pk}")
    return str(media.pk)


if __name__ == "__main__":
    load_dotenv()
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True)
    p.add_argument("--caption", default="#valorant #gaming")
    args = p.parse_args()
    upload_reel(args.video, args.caption)
