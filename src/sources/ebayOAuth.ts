/**
 * eBay application-token minting (OAuth2 client credentials).
 *
 * There is no refresh token in this grant — you re-POST to mint a new one. The
 * token lives exactly 2 hours, so it is cached and renewed a few minutes early
 * rather than in reaction to a 401, and concurrent callers share one in-flight
 * mint instead of racing.
 */

import { config } from '../config.js';
import { logger } from '../util/logger.js';

const log = logger('ebay-oauth');

/** Browse item_summary/search needs only the public-data scope. */
export const BROWSE_SCOPE = 'https://api.ebay.com/oauth/api_scope';

const HOSTS = {
  production: 'https://api.ebay.com',
  sandbox: 'https://api.sandbox.ebay.com',
} as const;

export function ebayApiHost(): string {
  return HOSTS[config.ebay.env] ?? HOSTS.production;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

let cached: CachedToken | null = null;
let inFlight: Promise<string> | null = null;

/** Renew this many seconds before the token actually expires. */
const RENEW_MARGIN_SECONDS = 300;

export class EbayAuthError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'EbayAuthError';
  }
}

export async function getAppToken(scope: string = BROWSE_SCOPE): Promise<string> {
  if (cached && Date.now() < cached.expiresAtMs) return cached.accessToken;
  if (inFlight) return inFlight;

  inFlight = mintToken(scope).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function mintToken(scope: string): Promise<string> {
  const { clientId, clientSecret } = config.ebay;
  if (!clientId || !clientSecret) {
    throw new EbayAuthError(
      'eBay credentials are not set. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to your .env — see docs/EBAY_SETUP.md.',
    );
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope });

  const res = await fetch(`${ebayApiHost()}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    // invalid_scope here means the keyset was never granted that scope, which
    // is the fastest way to discover you do not have Marketplace Insights.
    throw new EbayAuthError(
      `eBay token request failed (${res.status}). ${summarizeAuthError(text, res.status)}`,
      res.status,
    );
  }

  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new EbayAuthError('eBay returned a token response that was not JSON.');
  }
  if (!parsed.access_token) throw new EbayAuthError('eBay token response contained no access_token.');

  const ttl = typeof parsed.expires_in === 'number' ? parsed.expires_in : 7200;
  cached = {
    accessToken: parsed.access_token,
    expiresAtMs: Date.now() + Math.max(60, ttl - RENEW_MARGIN_SECONDS) * 1000,
  };
  log.info(`Minted application token, valid ${ttl}s.`);
  return cached.accessToken;
}

function summarizeAuthError(body: string, status: number): string {
  if (body.includes('invalid_scope')) {
    return 'The keyset is not granted this OAuth scope. Restricted APIs such as Marketplace Insights must be approved by eBay first.';
  }
  if (body.includes('invalid_client') || status === 401) {
    return 'Credentials rejected. Check that you are using the PRODUCTION keyset with EBAY_ENV=production (sandbox and production keys are different).';
  }
  return body.slice(0, 300);
}

/** Drops the cached token. Used by tests and after a credential change. */
export function resetTokenCache(): void {
  cached = null;
  inFlight = null;
}
