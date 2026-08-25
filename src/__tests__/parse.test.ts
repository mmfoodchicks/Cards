import { describe, expect, it } from 'vitest';
import { parseTitle } from '../parse/titleParser.js';

describe('title parsing', () => {
  it('identifies sealed Pokemon product', () => {
    const p = parseTitle('2023 Pokemon Scarlet & Violet 151 Elite Trainer Box ETB Factory Sealed IN HAND');
    expect(p.category).toBe('pokemon');
    expect(p.productType).toBe('elite-trainer-box');
    expect(p.sealed).toBe(true);
    expect(p.setSlug).toBe('pokemon-151');
    expect(p.year).toBe(2023);
    expect(p.productKey).toBe('sealed|pokemon|2023|pokemon-151|elite-trainer-box|std|en');
  });

  it('reads a graded slab as a single, not sealed product', () => {
    const p = parseTitle('PSA 10 GEM MT 2023 Pokemon 151 Charizard ex 199/165 Special Illustration Rare');
    expect(p.sealed).toBe(false);
    expect(p.productType).toBe('single');
    expect(p.graded).toBe(true);
    expect(p.grader).toBe('PSA');
    expect(p.grade).toBe(10);
    expect(p.subject).toBe('charizard');
    expect(p.cardNumber).toBe('199/165');
  });

  it('finds a grade even when another grader alias appears first', () => {
    // "Beckett Graded" matches before "BGS 9.5", and stopping at the first
    // matching alias used to lose the grade entirely.
    const p = parseTitle('Beckett Graded BGS 9.5 Gem Mint Luka Doncic Prizm Silver RC');
    expect(p.grader).toBe('BGS');
    expect(p.grade).toBe(9.5);
  });

  it('reads PSA/DNA slabs', () => {
    const p = parseTitle('PSA/DNA Authenticated Mickey Mantle 1956 Topps PSA 4');
    expect(p.grader).toBe('PSA');
    expect(p.grade).toBe(4);
  });

  describe('quantity', () => {
    it('recovers an explicit lot count', () => {
      expect(parseTitle('Lot of 5 Pokemon Surging Sparks Booster Packs Sealed').quantity).toBe(5);
    });

    it('reads an x-prefixed multiple', () => {
      expect(parseTitle('2024 Panini Prizm Football Blaster Box x2 Sealed').quantity).toBe(2);
    });

    it('does not mistake a set name for a quantity', () => {
      // "Pokemon 151 ETB" once parsed as a lot of 151 elite trainer boxes.
      expect(parseTitle('Pokemon 151 ETB Factory Sealed').quantity).toBe(1);
    });

    it('does not mistake packs-per-box for a quantity', () => {
      expect(parseTitle('2025 Pokemon Destined Rivals Booster Box 36 Packs Per Box Sealed').quantity).toBe(1);
      expect(parseTitle('Topps Series 1 Hobby Box 24 packs/box 14 cards per pack').quantity).toBe(1);
    });

    it('counts a box lot', () => {
      expect(parseTitle('3 Box Lot 2025 Bowman Chrome Hobby').quantity).toBe(3);
    });

    it('flags mixed contents as uncomparable even with a count', () => {
      const p = parseTitle('Lot of 12 Pokemon Booster Packs Assorted Sets');
      expect(p.quantity).toBe(12);
      expect(p.mixedLot).toBe(true);
    });
  });

  describe('red flags', () => {
    it('catches an empty box', () => {
      const p = parseTitle('Pokemon 151 ETB EMPTY BOX ONLY no cards read description');
      expect(p.redFlags).toContain('empty box');
      expect(p.redFlags).toContain('no cards');
    });

    it('catches counterfeits and customs', () => {
      const p = parseTitle('Charizard ORICA custom art proxy card not authentic');
      expect(p.redFlags).toContain('proxy');
      expect(p.parseConfidence).toBeLessThan(0.4);
    });

    it('catches break slots, which are a chance and not a product', () => {
      const p = parseTitle('Pokemon 151 ETB - PYT Group Break Spot Random Team');
      expect(p.redFlags).toContain('group break');
    });
  });

  describe('product keys', () => {
    it('separates configurations that share a product type', () => {
      const plain = parseTitle('2025 Bowman Baseball Hobby Box').productKey;
      const jumbo = parseTitle('2025 Bowman Baseball HTA Jumbo Hobby Box').productKey;
      expect(plain).not.toBe(jumbo);
    });

    it('separates print languages', () => {
      const jp = parseTitle('Pokemon 151 Japanese Booster Box Sealed').productKey;
      const en = parseTitle('Pokemon 151 Booster Box Sealed English').productKey;
      expect(jp).not.toBe(en);
      expect(jp).toContain('|jp');
    });

    it('separates condition tiers for raw singles', () => {
      const nm = parseTitle('Charizard ex 199/165 Pokemon 151 NM').productKey;
      const hp = parseTitle('Charizard ex 199/165 Pokemon 151 heavily played').productKey;
      expect(nm).not.toBe(hp);
    });

    it('separates a slab from a raw copy of the same card', () => {
      const raw = parseTitle('Charizard ex 199/165 Pokemon 151').productKey;
      const slab = parseTitle('PSA 10 Charizard ex 199/165 Pokemon 151').productKey;
      expect(raw).not.toBe(slab);
    });

    it('refuses a key when the product cannot be identified', () => {
      expect(parseTitle('Mystery Repack Hot Pack chase card!!').productKey).toBeNull();
    });
  });

  describe('category detection', () => {
    it('lets the sport name beat a multi-sport product line', () => {
      // Topps Chrome ships for several sports, so "basketball" has to win.
      expect(parseTitle('2025-26 Topps Chrome Updates Basketball Hobby Box').category).toBe('basketball');
      expect(parseTitle('2024 Topps Chrome Baseball Hobby Box').category).toBe('baseball');
    });

    it('uses player names as evidence', () => {
      expect(parseTitle('Shohei Ohtani 2018 Topps Chrome Rookie RC PSA 9').category).toBe('baseball');
    });
  });

  it('prefers a sub-set over the era it belongs to', () => {
    // "Mega Evolution: Perfect Order" contains the words "Mega Evolution".
    const p = parseTitle('2026 Pokemon Mega Evolution Perfect Order Elite Trainer Box');
    expect(p.setSlug).toBe('me-perfect-order');
  });
});
