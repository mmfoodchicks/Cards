# How CardHawk decides something is a deal

```
listing  →  parse  →  benchmark  →  landed cost  →  score  →  label
```

Each stage can bail out. That is the point: the failure mode of a deal finder is
not missing a bargain, it is telling you something is a bargain when it is not.

---

## 1. Parsing: what is this, actually?

Card listings are keyword soup:

```
2023 Pokemon Scarlet & Violet 151 ETB Elite Trainer Box SEALED IN HAND FAST SHIP!! sv3.5
```

The parser (`src/parse/`) pulls out category, set, product type, year, grading,
quantity, parallels, print language, condition, and anything suggesting the item
is not what it appears to be. It then builds a **product key** — the identity
two listings must share before comparing their prices is meaningful.

```
sealed|pokemon|2023|pokemon-151|elite-trainer-box|std|en
single|football|2024|panini-prizm|caleb-williams|301|bgs-9.5|rookie+silver-prizm|slab|en
```

Everything in that key is there because leaving it out creates fake deals:

| Segment | Why |
|---|---|
| Grade | A PSA 10 and a raw copy are different instruments, often 20x apart. |
| Parallels | A silver prizm rookie is not a base card. |
| Language | A Japanese booster box is a different product at a different price. |
| Configuration | Bowman hobby box $239.99 vs Bowman HTA jumbo $499.99. |
| Condition | A played vintage card at 40% of near-mint money is not a discount. |

**If the identity is too thin, the key is `null`** and the listing is shown but
not scored. A repack with no set name cannot be priced, so it is not.

The parser also flags things that are not the product: empty boxes, wrappers,
proxies, reprints, code cards, break slots, repacks, "you pick" listings. Those
can never be labelled a deal regardless of price.

## 2. The benchmark: what should it cost?

Two paths, and the app always tells you which it used.

### Sealed product → MSRP

From `catalog/msrp.json` — 88 SKUs plus era-wide fallbacks, editable in the UI.

Card MSRPs are messier than they sound, so every entry carries a confidence:

- **high** — a published manufacturer or distributor price. Magic, Lorcana, One
  Piece and Yu-Gi-Oh! publish these openly.
- **medium** — a sell-sheet SRP that hobby shops and distributors see, not
  consumers. Every Panini and Topps hobby-box figure is this. Boxes routinely
  trade well above or below it.
- **low** — a typical shelf price where no MSRP was ever published, which is
  most retail blaster/mega/hanger SKUs. Treat it as a guide.

Notes worth knowing:

- **The Pokémon Company publishes no consumer price list.** The widely-reported
  figures — $4.49/pack, $49.99 ETB, $26.94 bundle — come from converging hobby
  reporting and Pokémon Center's own prices. Booster-box MSRPs are pack price ×
  36 arithmetic, not published numbers, and are marked accordingly.
- **US retailers now routinely price Pokémon above MSRP.** Target lists the Mega
  Evolution ETB at $54.99 against a $49.99 MSRP. So for Pokémon, "under MSRP" is
  a genuinely meaningful and rare signal — a listing at shelf price is already
  over.
- **In 2023–24 sealed boxes often sold below MSRP; in 2025–26 they trade above
  it.** CardHawk shows market value next to MSRP and warns you when the two
  diverge, because "under MSRP but still over market" is a real situation.

**Disambiguation.** One set ships several SKUs that share a product type. The
resolver decides on variant wording in the title — "HTA jumbo", "collector
booster", "no huddle" — and a variant marker always outranks a generic alias.
When the title names no variant, the plain configuration wins, because a seller
with an HTA jumbo box would certainly have said so. When it still cannot tell,
**it returns nothing and says why**:

> 7 different Pokemon 30th Celebration SKUs share this product type ($179.99,
> $39.99, $29.99, $21.99, $31.99, $14.99, $9.99) and the title does not say
> which. Refusing to guess, since the wrong one would invent a discount.

### Singles → market value

There is no MSRP for a single card, and deriving one from box price ÷ cards per
box is meaningless. So singles use, in order of preference:

1. **A price provider** — pokemontcg.io (free, Pokémon) or PriceCharting (paid,
   everything). A real valuation beats anything inferred.
2. **Inferred sales** — listings we were tracking that vanished before their end
   date. Strong evidence of a sale, short of proof, so weighted at 0.8.
3. **The low end of asking prices** — see below.
4. **Nothing.** The listing shows as *Not scored* with an explanation.

### Where market values come from

The constraint that shapes this: eBay's sold-comp API is restricted to approved
partners and scraping the completed-listings pages violates both their User
Agreement and `robots.txt`. So CardHawk cannot simply look up what things sold
for.

**Asking prices are biased high.** Treating the median ask as market value would
make every listing look fairly priced and hide the real bargains. Instead
CardHawk uses the **25th percentile** of live asks: buyers work the cheapest
listings first, so the bottom of the ask distribution tracks achievable price
far better than the middle does.

The estimate is built like this:

- **Log space.** Ask distributions have a floor at zero and a long right tail.
  In log space the tail is roughly symmetric, so median-based statistics behave,
  and a fixed offset means a fixed *percentage* — which is what a discount is.
- **Outlier rejection** by modified z-score with a MAD cutoff of 3.0, using the
  1.4826 consistency constant. Symmetric, so it does not silently discard the
  underpriced tail we are hunting.
- **Time decay** with a 14-day half-life over a 45-day window.
- **Per-listing cap** of 4 observations, at most one per week. A listing that
  sits unsold for two months is one opinion repeated, not sixty data points.
- **Per-seller cap** of 3. A shop with twenty identical listings is one opinion
  about price, and without the cap it would define the market.
- **Minimums** — 6 asks, 5 inferred sales, or 3 reported sales. Below that,
  nothing is returned.

## 3. Landed cost

A $40 box with $18 shipping is not cheaper than a $52 box shipped free, and a
"lot of 6" at $180 is not more expensive than a single at $34. Everything is
compared as **landed cost per unit**: price + shipping + estimated tax, divided
by quantity.

When a source does not disclose shipping, that is recorded as *unknown*, not
free — the card says so, and confidence drops.

## 4. Scoring

`discount = (benchmark − landed unit price) / benchmark`

Then the ladder from the [README](../README.md#what-the-labels-mean).

**Auctions.** An auction at $1 with six days left and no bids is not 99% off —
nobody has competed for that price yet. Those are held as *Not scored* with a
note, and become scoreable within 6 hours of closing or once they have 5+ bids.
They still appear under "Auctions ending" so you can watch them.

**Confidence** is the product of four independent penalties:

```
trust      × how good this kind of benchmark is (MSRP 1.0, comps 0.95,
                                                 inferred 0.8, asks 0.7)
sample     × n / (n + 5)
agreement  × 1 / (1 + 2 × dispersion)
freshness  × halves every 21 days
```

further reduced by unknown shipping, repack wording, and thin seller feedback.
Below 0.30, a "steal" is demoted to "good deal" with a note — the app does not
shout about things it is not sure of.

**Ranking** is `discount × confidence × log₁₀(1 + total saving in dollars)`. The
logarithm means a $90 saving beats a $1.20 saving without letting expensive
items monopolise the feed.

## 5. Why "too good to be true" exists

Any real deal finder will surface listings at 80% off. Almost none of them are
deals. They are:

- an empty Elite Trainer Box someone is selling as a display piece
- a pre-order listed at a placeholder price
- a counterfeit or a proxy
- a multi-variation listing quoting its cheapest variation
- a title the parser read wrong

CardHawk labels these rather than hiding them, so you can see what it caught and
judge for yourself. That band starts at 60% under MSRP and 70% under market.

---

## Things that will still fool it

Worth knowing:

- **A set the catalog does not know.** New releases need a catalog entry before
  they can be priced against MSRP. Add one in the MSRP tab.
- **Graded slabs of anything but Pokémon**, without a PriceCharting token.
  Nothing free prices sports slabs well.
- **Listings whose title omits what they are.** "Rare Charizard!! Must see" has
  nothing to parse.
- **A genuinely wrong MSRP.** Some of the catalog is sell-sheet or shelf pricing
  because nothing better was ever published. Check the confidence pill, and
  correct anything you know better.
- **Condition damage described only in the body text.** CardHawk reads titles,
  not descriptions or photos. Always look at the listing before buying.
