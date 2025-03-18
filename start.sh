#!/bin/bash
. /root/.nvm/nvm.sh
mkdir $LOG_PATH && mkdir $SECRETKEY_PATH && mkdir $DATABASE_PATH && mkdir $BLOB_STORAGE_PATH
cd /app/.runtime/unstructured-api && source .venv/bin/activate && make run-web-app &
sleep 10
cd /app
uv run --project ./.runtime manusmcp &
uv run --project ./.runtime litellm --config ./.runtime/litellm.yml &
bunx flowise@latest start