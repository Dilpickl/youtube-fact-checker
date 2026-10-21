# Schoolwork assistant

Tells you what to do right now. Assignments come in from screenshots of any
course site, and the app picks one task, says why, and when to start it. See
`PLAN.md` for the full plan.

## Setup

Needs [Node.js](https://nodejs.org/) 24 or newer (it runs TypeScript directly).

```bash
npm install
```

Create a `.env` file in the project folder (Git ignores it) with your keys:

```
TYPESAFE_API_KEY=...
ANTHROPIC_API_KEY=...
```

## Run the website

```bash
npm start
```

Then open http://localhost:3000. Saved assignments live in `data/assignments.db`
(Git ignores it).

## Import a screenshot from the command line

```bash
npm run import -- test/fixtures/connect-capitolo5.png
```

Prints each assignment found, with its due date and whether it's still open.
Rows marked `CHECK THIS` are ones the two models didn't agree on.

## Develop

```bash
npm test           # unit tests (no API calls)
npm run typecheck  # TypeScript checks
npm run format     # format with Prettier
```

The earlier TikTok fact-checker extension is in Git history at commit
`f1b634d`.
