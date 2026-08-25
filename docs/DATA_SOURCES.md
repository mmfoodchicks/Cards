# Where the data comes from

CardHawk needs two different kinds of data:

- **Listings** — what is for sale right now, and for how much.
- **Values** — what those things are actually worth.

They come from different places, and the second is the hard one.

---

## Listings

### eBay Browse API — wired up, free, start here

The only high-volume source of active listings that is unambiguously sanctioned.
Free developer account, 5,000 calls/day. Setup in
[EBAY_SETUP.md](EBAY_SETUP.md).

Covers auctions as well as fixed-price listings, which matters: auctions are
where most genuine underpricing lives, and eBay's search hides them by default
unless you ask for them explicitly.

### Demo source — always available

Generates a realistic market from the MSRP catalog so the app is worth looking
at before you sign up for anything. Deterministic, so it doubles as test data.

### Adding your own

Implement `SourceAdapter` in `src/sources/` and register it. Parsing, scoring
and storage are shared. Before you do, check the table below — several obvious
candidates are closed or prohibited, and it is worth not wasting the afternoon.

| Marketplace | Status |
|---|---|
| **eBay** | Open. Free Browse API. Implemented. |
| **Sportlots** | Crawlable — permissive `robots.txt`, plain server-rendered HTML, published sitemaps with `lastmod`. Genuinely the one non-eBay marketplace worth the effort. Read their site terms first, rate-limit hard, send a real User-Agent. |
| **TCGplayer** | Closed. Not accepting new public API applicants since the eBay acquisition. Use pokemontcg.io / Scryfall for the same price data. |
| **Cardmarket** | Closed. Their own help page says they are not accepting API applications. |
| **Whatnot** | Closed. Seller-only API, not accepting applicants, Cloudflare-challenged. |
| **Mercari** | Blocked. `robots.txt` returns Forbidden to non-browsers, no third-party API. |
| **Facebook Marketplace** | Prohibited. Automated collection banned without written permission; no marketplace API exists. |
| **Craigslist** | Prohibited. ToS bans scrapers "or any automated or manual equivalent", with a stated damages clause, and they have won scraping litigation. |
| **OfferUp** | Blocked. `/search` and every filter parameter disallowed in `robots.txt`. |
| **StockX** | Impractical. Manual approval, discretionary review, and developers report the market-data endpoint returning nulls. |
| **Amazon PA-API** | Deprecated, and gated on affiliate sales you do not have yet. |
| **Target / Walmart / Blowout / Dave & Adam's** | Retail only, no secondary market, all behind bot protection with `/search` disallowed. Blowout's `robots.txt` says outright that it blocks bots scraping historical pricing. |
| **Fanatics Collect, Goldin, Heritage, Alt, PWCC** | Partner-gated or no self-serve API. |

---

## Values

Sealed product is compared against MSRP from `catalog/msrp.json`. Singles have
no MSRP, so they need a real price source.

### pokemontcg.io — wired up, free, no signup

Returns TCGplayer market/low/mid/high prices per printing variant, updated
daily. No account needed; a free API key only raises the rate limit.

Covers **raw** Pokémon singles. CardHawk deliberately does not price graded
slabs from it: grade drives most of a slab's value and this source does not
model it, so a PSA 10 is left unpriced rather than priced as a raw copy.

Set `POKEMONTCG_API_KEY` if you have one. Note the API returns intermittent 500s
on queries that succeed on retry — CardHawk retries with backoff.

### PriceCharting — wired up, paid ($49/month)

The widest single-vendor coverage: sports cards, every major TCG, graded slabs
and sealed product in one API, with prices as integer pennies and per-grade
tiers. Set `PRICECHARTING_TOKEN`.

Worth it once you care about sports singles, which nothing free covers well.
Limitation: current values only, no history. Their API is capped at about one
call per second, so CardHawk spaces lookups out and caches for three days.

### Other options worth knowing about

- **Scryfall** — free, no auth, definitive for Magic. Bulk downloads available.
- **TCGdex** — free, community-funded, models Pokémon printing variants well.
- **JustTCG** — cheap tiers, but the free tier is non-commercial only.
- **The Card API** — advertises free completed-sales data across eBay,
  TCGplayer, Goldin and others with resolved Best Offer amounts. If it delivers
  what it describes it is the closest substitute for eBay Marketplace Insights.
  Not wired up here because it has not been verified in practice — implement it
  as a `CompProvider` if you want it.
- **Card Ladder / Market Movers** — no self-serve API, but excellent ~$15/month
  tools for sanity-checking what CardHawk tells you. Subscribe as a user.
- **130point** — free in a browser for spot-checking comps. No API, and scraping
  it means piggybacking on eBay access that is theirs and not yours.

---

## What CardHawk does when it has nothing

It builds its own comps, two ways.

1. **The low end of asking prices.** Buyers work the cheapest listings first, so
   the bottom quartile of live asks tracks achievable price far better than the
   middle does. Needs at least six observations.
2. **Listings that vanish.** A fixed-price listing that stops appearing while
   its end date is still in the future has almost certainly sold. That is
   recorded as a separate, weaker observation kind — strong evidence of a sale,
   short of proof.

Both improve the longer you run it, which is why the price-observation log is
append-only from the first scan. It cannot be reconstructed after the fact.

## Data retention

Cached listing rows expire after 30 days. eBay's API License Agreement permits
only "limited intermediate copies" of their data, to be deleted when no longer
needed. The derived price observations are kept — those are measurements
CardHawk made, not a copy of anyone's catalog, and they are what makes the
market baselines improve over time.
