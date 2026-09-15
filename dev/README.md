# Dev tools

## Running the tests

```
npm install
npm test
```

This runs the whole app (login, groups, messaging, invites, and 1:1 video
calling) against Firebase's local emulators — no real accounts or messages
are touched. First run downloads the emulator jars and can take a minute;
after that it's under a minute.

Requires a Java runtime (for the Firestore emulator). If your machine
doesn't already have Java 21+, `playwright.config.js` automatically falls
back to a portable JDK expected at
`~/.local/share/chat-club-jdk/jdk-21.0.12.1+1-jre` — if that folder doesn't
exist, download one (no admin rights needed) from
https://adoptium.net/temurin/releases/ and extract it there.

## Deploying Firestore rules

`firestore.rules` here is the source of truth for what's live on the
`school-chat-9e4d8` Firebase project. After editing it:

```
firebase login   # first time only
firebase deploy --only firestore:rules --project school-chat-9e4d8
```

(run from this `dev/` folder)
