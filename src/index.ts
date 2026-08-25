/**
 * CardHawk server.
 *
 * Serves the JSON API and, in production, the built web UI from the same
 * origin and the same port — so the whole thing is one `npm start` on a PC and
 * one URL on a phone, with no CORS setup and no second process.
 */

import express from 'express';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { listWatches } from './db/repos.js';
import { startScheduler, stopScheduler } from './pipeline/scheduler.js';
import { api, apiErrorHandler } from './routes/api.js';
import { defaultSourceIds } from './sources/registry.js';
import { seedDefaultWatches } from './scripts/seedWatches.js';
import { fromRoot } from './util/paths.js';
import { logger } from './util/logger.js';

const log = logger('server');

function start(): void {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // The dev server runs the UI on another port; allow it to call this one.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use('/api', api);
  app.use('/api', apiErrorHandler);

  const webDist = fromRoot('web', 'dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    // Client-side routing: anything that is not an API call gets the app shell.
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(fromRoot('web', 'dist', 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('text/plain')
        .send(
          'CardHawk API is running, but the web UI has not been built yet.\n\n' +
            'Run `npm run build:web` and restart, or use `npm run dev` for the ' +
            'development server on http://localhost:5173.\n',
        );
    });
  }

  getDb();
  const seeded = seedDefaultWatches();
  if (seeded > 0) log.info(`Seeded ${seeded} starter watches.`);

  const server = app.listen(config.port, config.host, () => {
    log.info(`Listening on http://localhost:${config.port}`);
    for (const address of lanAddresses()) {
      log.info(`On your phone (same wifi): http://${address}:${config.port}`);
    }
    const watches = listWatches();
    log.info(`${watches.length} watches, sources: ${defaultSourceIds().join(', ')}`);
    startScheduler();
  });

  const shutdown = (signal: string): void => {
    log.info(`${signal} received, shutting down.`);
    stopScheduler();
    server.close(() => process.exit(0));
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/** Non-loopback IPv4 addresses, so the log can print a URL a phone can open. */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}

start();
