// Kills anything left over from a previous test run on the ports the test
// suite needs (8080 Firestore emulator, 9099 Auth emulator, 8934 static
// server). A crashed or interrupted `npm test` can leave these bound, which
// then makes the *next* run fail to start with a confusing error.
// Works on both macOS/Linux (lsof) and Windows (netstat + taskkill).
const { execSync } = require('child_process');

const PORTS = [8080, 9099, 8934];

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return ''; // no matches / command missing — nothing to kill
  }
}

function pidsOnPort(port) {
  if (process.platform === 'win32') {
    // lines look like: "  TCP    0.0.0.0:8080   0.0.0.0:0   LISTENING   1234"
    return run('netstat -ano -p tcp')
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((cols) => cols[1] && cols[1].endsWith(`:${port}`) && cols[3] === 'LISTENING')
      .map((cols) => cols[4]);
  }
  return run(`lsof -ti :${port}`).split('\n').filter(Boolean);
}

for (const port of PORTS) {
  for (const pid of new Set(pidsOnPort(port))) {
    if (!pid || pid === '0') continue;
    run(process.platform === 'win32' ? `taskkill /F /T /PID ${pid}` : `kill -9 ${pid}`);
  }
}
