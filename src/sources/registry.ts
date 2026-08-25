/** Adapter registry. Adding a marketplace means adding one line here. */

import { EbayBrowseAdapter } from './ebayBrowse.js';
import { FixtureAdapter } from './fixture.js';
import type { SourceAdapter } from './types.js';

const adapters: SourceAdapter[] = [new EbayBrowseAdapter(), new FixtureAdapter()];

export function allSources(): SourceAdapter[] {
  return adapters;
}

export function getSource(id: string): SourceAdapter | null {
  return adapters.find((a) => a.id === id) ?? null;
}

/** Sources that can actually run right now. */
export function configuredSources(): SourceAdapter[] {
  return adapters.filter((a) => a.isConfigured());
}

/**
 * What to search when the user has not chosen. Falls back to demo data so a
 * fresh install shows something rather than an empty screen.
 */
export function defaultSourceIds(): string[] {
  const live = adapters.filter((a) => a.isConfigured() && a.id !== 'demo');
  return live.length > 0 ? live.map((a) => a.id) : ['demo'];
}
