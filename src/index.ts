/**
 * CardLedger server.
 *
 * Runs entirely on your own machine. Financial records for a business belong on
 * hardware you control, not on someone else's server, and nothing here calls
 * out to a third party.
 */

import express from 'express';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { getProfile } from './db/repos.js';
import { api, apiErrorHandler } from './routes/api.js';
import { runBackup } from './scripts/backup.js';
import { figureHealth } from './tax/registry.js';
import { fromRoot } from './util/paths.js';
import { logger } from './util/logger.js';

const log = logger('server');

function start(): void {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

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
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(fromRoot('web', 'dist', 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.type('text/plain').send(
        'CardLedger API is running, but the interface has not been built yet.\n\n' +
          'Run `npm run build:web` and restart, or use `npm run dev` for the development server.\n',
      );
    });
  }

  getDb();
  if (config.backupOnStart && config.databasePath !== ':memory:') {
    try {
      const path = runBackup();
      if (path) log.info(`Backed up to ${path}`);
    } catch (err) {
      log.warn('Backup on startup failed', err instanceof Error ? err.message : String(err));
    }
  }

  const server = app.listen(config.port, config.host, () => {
    log.info(`CardLedger is running at http://localhost:${config.port}`);
    for (const address of lanAddresses()) {
      log.info(`On your phone, same wifi: http://${address}:${config.port}`);
    }

    const profile = getProfile();
    if (!profile.businessName) {
      log.info('No business details set yet — open Settings first so the tax figures apply to the right person.');
    }

    const health = figureHealth(config.taxYear);
    if (health && health.needsAttention.length > 0) {
      log.warn(
        `${health.needsAttention.length} tax figure(s) for ${config.taxYear} still need checking against their ` +
          'source. The app will say so rather than computing from them.',
      );
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error(
        `Port ${config.port} is already in use. Another copy is probably running — stop it, or set PORT in .env.`,
      );
      process.exit(1);
    }
    log.error('Server error', err.message);
    process.exit(1);
  });

  const shutdown = (signal: string): void => {
    log.info(`${signal} received, shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

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
