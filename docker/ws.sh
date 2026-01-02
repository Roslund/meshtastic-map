#!/bin/sh

echo "Starting websocket publisher"
exec node src/ws.js ${WS_OPTS}

