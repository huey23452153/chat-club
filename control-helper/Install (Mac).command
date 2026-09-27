#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is needed first. Get it from https://nodejs.org/ then run this again."
  open "https://nodejs.org/"
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
node install.js "$@"
read -n 1 -s -r -p "Press any key to close."
