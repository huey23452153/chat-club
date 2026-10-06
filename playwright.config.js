// @ts-check
const os = require('os');
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

// The Firestore emulator needs a Java runtime. If the machine doesn't have
// one on PATH already, fall back to a known install location: the portable
// JDK on the Mac (see dev/README.md for how it got there), or Temurin's
// default install folder on Windows.
const fs = require('fs');
function findJavaHome() {
  const macPortable = path.join(os.homedir(), '.local/share/chat-club-jdk/jdk-21.0.12.1+1-jre/Contents/Home');
  if (fs.existsSync(macPortable)) return macPortable;
  const winAdoptium = 'C:\\Program Files\\Eclipse Adoptium';
  if (process.platform === 'win32' && fs.existsSync(winAdoptium)) {
    const jre = fs.readdirSync(winAdoptium).sort().reverse().find((d) => /^(jre|jdk)-2\d/.test(d));
    if (jre) return path.join(winAdoptium, jre);
  }
  return null;
}
const javaHome = findJavaHome();
const env = { ...process.env };
if (javaHome) {
  env.JAVA_HOME = javaHome;
  env.PATH = `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH}`;
}

module.exports = defineConfig({
  testDir: './tests',
  // Every test signs up its own uniquely-named account and uses its own
  // browser context/pages, so tests don't step on each other and can safely
  // run at the same time against the one shared emulator instance.
  fullyParallel: true,
  // 4 workers made a couple of Firestore-listener-timing assertions flaky
  // under the shared emulator's load; 2 is still a solid speedup over
  // running serially without adding contention-driven flakes.
  workers: 2,
  retries: 1, // absorb rare, genuine timing flakes without masking real bugs
  timeout: 30000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8934',
    trace: 'retain-on-failure',
    // fake camera/mic streams so real automated tests can exercise video
    // calling without needing actual hardware or OS permission prompts
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Playwright's bundled Chromium won't launch on the Windows PC
        // ("side-by-side configuration is incorrect"), so use the
        // preinstalled Microsoft Edge there — same Chromium engine.
        ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      },
    },
  ],
  webServer: [
    {
      command: 'firebase emulators:start --project school-chat-9e4d8 --config dev/firebase.json',
      // Auth's port comes up a few seconds after Firestore's — waiting on it
      // (rather than Firestore's 8080) avoids a startup race where the first
      // test can hit the Auth emulator before it's actually ready.
      port: 9099,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      env,
    },
    {
      command: 'node dev/static-server.js 8934',
      port: 8934,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
