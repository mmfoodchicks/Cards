/**
 * Starter watches.
 *
 * A brand-new install with an empty feed is impossible to evaluate, so a few
 * sensible watches are created on first run. They are only seeded when the
 * table is empty, so deleting them makes them stay deleted.
 */

import { createWatch, listWatches } from '../db/repos.js';
import { defaultSourceIds } from '../sources/registry.js';
import type { Category, ProductType } from '../types.js';

interface StarterWatch {
  name: string;
  query: string;
  category: Category | null;
  productType: ProductType | null;
  sealedOnly: boolean;
  minDiscountPct: number;
  intervalMinutes: number;
}

const STARTERS: StarterWatch[] = [
  {
    name: 'Pokemon sealed under MSRP',
    query: 'pokemon elite trainer box booster box sealed',
    category: 'pokemon',
    productType: null,
    sealedOnly: true,
    minDiscountPct: 0.05,
    intervalMinutes: 30,
  },
  {
    name: 'Baseball hobby boxes',
    query: 'topps bowman baseball hobby box sealed',
    category: 'baseball',
    productType: null,
    sealedOnly: true,
    minDiscountPct: 0.1,
    intervalMinutes: 60,
  },
  {
    name: 'Football sealed wax',
    query: 'panini prizm donruss football sealed box',
    category: 'football',
    productType: null,
    sealedOnly: true,
    minDiscountPct: 0.1,
    intervalMinutes: 60,
  },
];

export function seedDefaultWatches(): number {
  if (listWatches().length > 0) return 0;
  const sources = defaultSourceIds();
  for (const starter of STARTERS) {
    createWatch({
      name: starter.name,
      query: starter.query,
      sources,
      category: starter.category,
      productType: starter.productType,
      minPriceCents: null,
      maxPriceCents: null,
      minDiscountPct: starter.minDiscountPct,
      sealedOnly: starter.sealedOnly,
      gradedOnly: false,
      excludeLots: true,
      enabled: true,
      intervalMinutes: starter.intervalMinutes,
    });
  }
  return STARTERS.length;
}
