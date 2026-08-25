import { describe, expect, it } from 'vitest';
import { loadCatalog, resolveMsrp } from '../catalog/msrpCatalog.js';
import { parseTitle } from '../parse/titleParser.js';
import { SET_VOCAB } from '../parse/vocab.js';

const catalog = loadCatalog();

function lookup(title: string) {
  return resolveMsrp(parseTitle(title), title, catalog);
}

describe('catalog integrity', () => {
  it('has entries', () => {
    expect(catalog.entries.length).toBeGreaterThan(50);
  });

  it('references only sets the parser can recognise', () => {
    // An entry whose set the parser cannot detect can never be matched, so it
    // would sit in the catalog looking useful and never fire.
    const known = new Set(SET_VOCAB.map((s) => s.slug));
    const orphans = [...new Set(catalog.entries.map((e) => e.setSlug))].filter((slug) => !known.has(slug));
    expect(orphans).toEqual([]);
  });

  it('has a positive price and a source on every entry', () => {
    for (const entry of catalog.entries) {
      expect(entry.msrpCents, entry.id).toBeGreaterThan(0);
      expect(entry.source, entry.id).toMatch(/^https?:\/\//);
    }
  });

  it('has unique ids', () => {
    const ids = catalog.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('MSRP resolution', () => {
  it('prices a straightforward sealed listing', () => {
    const result = lookup('2025 Bowman Baseball Hobby Box Factory Sealed');
    expect(result.match?.msrpCents).toBe(23999);
  });

  it('picks the jumbo configuration when the title says so', () => {
    const result = lookup('2025 Bowman Baseball HTA Jumbo Hobby Box Factory Sealed');
    expect(result.match?.msrpCents).toBe(49999);
  });

  it('does not let a generic alias outrank a variant marker', () => {
    // The standard Prizm box carries the alias "prizm hobby box", which appears
    // inside a No Huddle title too. Scoring on matched length alone picked the
    // $974.95 box and reported a $500 No Huddle box as half price.
    const result = lookup('2025 Panini Prizm Football Hobby Box No Huddle Sealed');
    expect(result.match?.msrpCents).toBe(47495);
  });

  it('tells apart play and collector booster boxes', () => {
    expect(lookup('MTG Lorwyn Eclipsed Collector Booster Box Sealed').match?.msrpCents).toBe(32388);
    expect(lookup('MTG Lorwyn Eclipsed Play Booster Box Sealed').match?.msrpCents).toBe(16470);
  });

  it('refuses to guess between SKUs the title does not distinguish', () => {
    const result = lookup('Pokemon 30th Celebration Collection Box sealed');
    expect(result.match).toBeNull();
    expect(result.reason).toMatch(/does not say which/i);
  });

  it('falls back to an era-wide price for an unidentified set', () => {
    const result = lookup('Pokemon Booster Pack Sealed 2026');
    expect(result.match?.quality).toBe('era-default');
    // An era default is a weaker claim than a per-SKU figure.
    expect(result.match?.confidence).not.toBe('high');
  });

  it('never invents an MSRP for a single card', () => {
    const result = lookup('PSA 10 Charizard ex 199/165 Pokemon 151');
    expect(result.match).toBeNull();
    expect(result.reason).toMatch(/singles have no msrp/i);
  });

  it('does not price a football box off a basketball SKU', () => {
    // Prizm runs across several sports under one set slug.
    const football = lookup('2025 Panini Prizm Football Hobby Box');
    expect(football.match?.msrpCents).toBe(97495);
  });
});
