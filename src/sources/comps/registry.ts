/** Comp provider registry. */

import { PokemonTcgApiProvider } from './pokemonTcgApi.js';
import { PriceChartingProvider } from './priceCharting.js';
import type { CompProvider } from './types.js';

// Order matters: the first provider that can price an item wins, so the
// broadest paid source is tried before the free single-hobby one only when it
// is actually configured.
const providers: CompProvider[] = [new PriceChartingProvider(), new PokemonTcgApiProvider()];

export function allCompProviders(): CompProvider[] {
  return providers;
}

export function configuredCompProviders(): CompProvider[] {
  return providers.filter((p) => p.isConfigured());
}
