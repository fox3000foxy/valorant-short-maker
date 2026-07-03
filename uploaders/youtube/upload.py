"""
YT uploader — official Data API v3
Reads credentials from environment variables (.env or shell).

Usage:
  python upload.py --video <path> --title <title> [--description <desc>] [--tags <tags>] [--privacy <status>]
"""

import argparse
import json
import os
import pickle
import sys
import tempfile
from pathlib import Path

from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
TOKEN_FILE = Path(__file__).parent / "token.pickle"


def load_dotenv():
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip())


def ensure_client_secret():
    """Create client_secret.json on the fly from env vars if the file doesn't exist."""
    cs_path = Path(__file__).parent / "client_secret.json"
    if cs_path.exists():
        return str(cs_path)

    client_id = os.environ.get("YT_CLIENT_ID", "").strip()
    client_secret = os.environ.get("YT_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        print("ERROR: YT_CLIENT_ID and YT_CLIENT_SECRET must be set in .env")
        sys.exit(1)

    data = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "project_id": "valorant-short-uploader",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "redirect_uris": ["http://localhost"],
        }
    }
    cs_path.write_text(json.dumps(data, indent=2))
    print(f"  Generated client_secret.json from env vars")
    return str(cs_path)


def get_service():
    creds = None
    token_path = TOKEN_FILE

    if token_path.exists():
        with token_path.open("rb") as f:
            creds = pickle.load(f)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            print("  Refreshing YouTube token...")
            creds.refresh(Request())
        else:
            print("  Starting YouTube OAuth flow (needs browser)...")
            client_secret_path = ensure_client_secret()
            flow = InstalledAppFlow.from_client_secrets_file(client_secret_path, SCOPES)
            creds = flow.run_local_server(port=8787, open_browser=False)
        with token_path.open("wb") as f:
            pickle.dump(creds, f)

    return build("youtube", "v3", credentials=creds)


def upload(video_path: str, title: str, description: str, tags: list[str], privacy: str):
    print(f"  Uploading to YouTube: {video_path}")
    yt = get_service()
    body = {
        "snippet": {
            "title": title,
            "description": description,
            "tags": tags or [],
            "categoryId": "20",
        },
        "status": {"privacyStatus": privacy},
    }
    media = MediaFileUpload(video_path, chunksize=-1, resumable=True)
    req = yt.videos().insert(part="snippet,status", body=body, media_body=media)

    response = None
    while response is None:
        status, response = req.next_chunk()
        if status:
            print(f"  YouTube upload {int(status.progress() * 100)}%")

    print(f"  YouTube OK, video id: {response['id']}")
    return response["id"]


if __name__ == "__main__":
    load_dotenv()
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--description", default="")
    p.add_argument("--tags", nargs="*", default=[])
    p.add_argument("--privacy", default="private", choices=["public", "unlisted", "private"])
    args = p.parse_args()

    upload(args.video, args.title, args.description, args.tags, args.privacy)
