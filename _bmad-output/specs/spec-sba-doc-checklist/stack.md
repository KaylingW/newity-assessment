# Stack

You chose this stack.

- **Framework:** Next.js with TypeScript. One app serves both the UI and the server-side data access.
- **Store:** SQLite, as a single local file. On first run it is seeded from the bundled CSV, and the seed is idempotent.
- **Run:** a single install and a single start command, documented in the README. A reviewer must get it running in under 5 minutes. No external services and no database server.
- **As-of date:** one config value that defaults to `2026-02-15`. Read it in one place, and derive every expiry and stall calculation from it.
