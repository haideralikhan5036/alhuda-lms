/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — UNIFIED CLOUDFLARE WORKER + STATIC ASSETS
 * File: cloudflare/worker.js
 * Purpose: Works directly with `npx wrangler deploy` on Cloudflare Workers & Pages.
 *          Handles /api/db (Cloudflare D1), /api/storage (Cloudflare R2),
 *          and serves all static portal HTML/JS/CSS files via env.ASSETS.
 * ============================================================================
 */

import { onRequest as handleDbRequest } from '../functions/api/db.js';
import { onRequest as handleStorageRequest } from '../functions/api/storage.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Database API (/api/db) -> Cloudflare D1
    if (url.pathname === '/api/db' || url.pathname.startsWith('/api/db/')) {
      return handleDbRequest({ request, env, ctx });
    }

    // 2. File Storage API (/api/storage) -> Cloudflare R2
    if (url.pathname === '/api/storage' || url.pathname.startsWith('/api/storage/')) {
      return handleStorageRequest({ request, env, ctx });
    }

    // 3. All Portal Pages & Static Assets (index.html, teacher.html, manager.html, parent.html, js/*)
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Al-Huda LMS Worker is running.', { status: 200 });
  }
};
