#!/bin/sh
# Clone sibling repos as local build contexts
set -e
ORG=duganbrettc

if [ ! -d db ]; then
  git clone "https://github.com/${ORG}/cascade-xclone-v34o4-db.git" db
fi
if [ ! -d api ]; then
  git clone "https://github.com/${ORG}/cascade-xclone-v34o4-api.git" api
fi
if [ ! -d web ]; then
  git clone "https://github.com/${ORG}/cascade-xclone-v34o4-web.git" web
fi

echo "Setup complete. Run: HOST_PORT=<port> docker compose up -d"
