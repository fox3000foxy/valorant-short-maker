#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

source .venv/bin/activate
set -a; source .env; set +a

exec bun src/workflow.ts --upload 2>>cron-errors.log
