// @ts-check
const os = require('os');
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

// The Firestore emulator needs a Java runtime. If the machine doesn't have
// one on PATH already, fall back to the portable JDK installed alongside
// this project (see dev/README.md for how it got there).
const portableJdkHome = path.join(os.homedir(), '.local/share/chat-club-jdk/jdk-21.0.12.1+1-jre/Contents/Home');
const env = { ...process.env };
if (require('fs').existsSync(portableJdkHome)) {
  env.JAVA_HOME = portableJdkHome;
  env.PATH = `${path.join(portableJdkHome, 'bin')}:${process.env.PATH}`;
}

module.exports = defineConfig({
  testDir: './tests',
  // Every test signs up its own uniquely-named account and uses its own
  // browser context/pages, so tests don't step on each other and can safely
  // run at the same time against the one shared emulator instance.
  fullyParallel: true,
  workers: 4,
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
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
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
      command: 'python3 -m http.server 8934',
      port: 8934,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
