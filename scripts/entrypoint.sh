#!/bin/sh
set -e

echo "Deploying slash commands..."
node src/deploy-commands.js

echo "Starting bot..."
exec node src/index.js
