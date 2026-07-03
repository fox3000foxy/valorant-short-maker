#!/usr/bin/env bash
set -euo pipefail

REPO="fox3000foxy/valorant-short-maker"
RELEASE_TAG="binaries"
BASE_URL="https://github.com/${REPO}/releases/download/${RELEASE_TAG}"

echo "==> Downloading ffmpeg binaries..."

mkdir -p bin/ffmpeg bin/ffmpeg-drawtext

download_binary() {
	local url="$1"
	local dest="$2"

	if [ -f "$dest" ]; then
		echo "  skip (already present): $dest"
		return
	fi

	echo "  downloading: $dest"
	curl -fL --retry 3 -o "$dest" "$url"
	chmod +x "$dest"
}

download_binary "${BASE_URL}/ffmpeg"            "bin/ffmpeg/ffmpeg"
download_binary "${BASE_URL}/ffprobe"           "bin/ffmpeg/ffprobe"
download_binary "${BASE_URL}/ffmpeg-drawtext"   "bin/ffmpeg-drawtext/ffmpeg"
download_binary "${BASE_URL}/ffprobe-drawtext"  "bin/ffmpeg-drawtext/ffprobe"

echo "==> ffmpeg binaries ready."

echo "==> Setting up Python venv..."

python3 -m venv .venv --without-pip
source .venv/bin/activate
curl -fL https://bootstrap.pypa.io/get-pip.py -o get-pip.py
python get-pip.py
pip install piper-tts Pillow

echo "==> Installing upload dependencies..."
pip install "instagrapi[video]" google-api-python-client google-auth-oauthlib
pip install --no-deps "moviepy==2.2.1"

deactivate
rm -f get-pip.py

echo "==> Install complete."