#!/bin/sh
# Kills anything left over from a previous test run on the ports the test
# suite needs (8080 Firestore emulator, 9099 Auth emulator, 8934 static
# server). A crashed or interrupted `npm test` can leave these bound, which
# then makes the *next* run fail to start with a confusing error.
for port in 8080 9099 8934; do
  pid=$(lsof -ti ":$port" 2>/dev/null)
  if [ -n "$pid" ]; then
    kill -9 $pid 2>/dev/null
  fi
done
exit 0
