/**
 * Alert delivery.
 *
 * Two channels, both optional and both chosen because they need no account and
 * no inbound port: ntfy (push to a phone by subscribing to a topic name) and a
 * generic webhook (Discord, Slack, Home Assistant, n8n...).
 */

import { config } from '../config.js';
import { getListing, markAlertNotified, pendingAlerts } from '../db/repos.js';
import type { Db } from '../db/index.js';
import { formatCents } from '../pricing/landedCost.js';
import { LABEL_META } from '../pricing/score.js';
import type { DealLabel } from '../types.js';
import { logger } from '../util/logger.js';

const log = logger('notify');

export function notificationsConfigured(): boolean {
  return config.alerts.ntfyTopic !== '' || config.alerts.webhookUrl !== '';
}

export interface DeliveryResult {
  sent: number;
  failed: number;
}

/** Sends every alert that has not gone out yet. */
export async function deliverPendingAlerts(db?: Db): Promise<DeliveryResult> {
  if (!notificationsConfigured()) return { sent: 0, failed: 0 };

  const alerts = pendingAlerts(db);
  let sent = 0;
  let failed = 0;

  for (const alert of alerts) {
    const listing = getListing(alert.listing_id, db);
    if (!listing) {
      // The listing is gone; nothing useful to send.
      markAlertNotified(alert.id, db);
      continue;
    }

    const discount = alert.discount_pct != null ? `${Math.round(alert.discount_pct * 100)}% under` : 'below';
    const benchmark = listing.benchmark_kind === 'msrp' ? 'MSRP' : 'market';
    const title = `${LABEL_META[alert.label as DealLabel]?.title ?? 'Deal'}: ${discount} ${benchmark}`;
    const body =
      `${listing.title}\n` +
      `${formatCents(listing.unit_cents)} landed` +
      (listing.benchmark_cents ? ` vs ${formatCents(listing.benchmark_cents)} ${benchmark}` : '') +
      (listing.under_msrp === 1 ? '\nUNDER MSRP' : '');

    const ok = await Promise.all([
      sendNtfy(title, body, listing.url),
      sendWebhook({ title, body, listing }),
    ]);

    if (ok.some(Boolean) || !notificationsConfigured()) {
      markAlertNotified(alert.id, db);
      sent++;
    } else {
      failed++;
    }
  }

  if (sent > 0) log.info(`Delivered ${sent} alerts.`);
  return { sent, failed };
}

async function sendNtfy(title: string, body: string, url: string): Promise<boolean> {
  if (!config.alerts.ntfyTopic) return false;
  try {
    const res = await fetch(`${config.alerts.ntfyServer.replace(/\/$/, '')}/${config.alerts.ntfyTopic}`, {
      method: 'POST',
      headers: {
        Title: title,
        // Tapping the notification opens the listing.
        Click: url,
        Tags: 'moneybag',
      },
      body,
    });
    return res.ok;
  } catch (err) {
    log.warn('ntfy delivery failed', err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function sendWebhook(payload: unknown): Promise<boolean> {
  if (!config.alerts.webhookUrl) return false;
  try {
    const res = await fetch(config.alerts.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    log.warn('Webhook delivery failed', err instanceof Error ? err.message : String(err));
    return false;
  }
}
