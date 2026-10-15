// Demo mode's part of the API (server/demo.ts ↔ web/src/lib/demo/). A normal deployment never sends these.

/**
 * The project's home, linked from the demo ("Get it for your Immich"). A placeholder until the repository
 * is public: set it here, or per deployment with REPO_URL.
 */
export const REPO_URL = 'https://github.com/OWNER/immich-retrace';

/** ViewerConfig.demo (GET /api/config) when DEMO=1. */
export interface DemoConfig {
  /** The trip a visit without a link opens: an album id, or a part of its name (case and accents ignored). */
  trip: string;
  /** The project's home (REPO_URL). */
  repoUrl: string;
}

/** GET /api/demo/credits/:id: who made a demo asset, its licence, and what the demo changed. */
export interface DemoCredit {
  /** Commons file title without the "File:" prefix. */
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  /** The file's page on Wikimedia Commons. */
  commonsUrl: string;
  modifications: string;
}
