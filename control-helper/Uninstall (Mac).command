#!/bin/bash
cd "$(dirname "$0")"
node install.js --uninstall
read -n 1 -s -r -p "Press any key to close."
