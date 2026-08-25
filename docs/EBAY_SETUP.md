# Getting eBay API credentials

Free, about five minutes. You need two strings: an **App ID (Client ID)** and a
**Cert ID (Client Secret)**.

## Steps

1. Go to <https://developer.ebay.com/> and click **Register**. A normal eBay
   account works; you are signing it up for the developer programme.
2. Accept the API License Agreement.
3. Open **Application Keys** (under your account menu, sometimes shown as "User
   Keys" or "Application Keysets").
4. You will see two keysets: **Sandbox** and **Production**. You want
   **Production**. Sandbox has no real card listings in it — see the warning
   below.
5. Copy the **App ID (Client ID)** and the **Cert ID (Client Secret)** from the
   Production keyset.
6. Put them in `.env`:

   ```env
   EBAY_CLIENT_ID=YourApp-cardhawk-PRD-1a2b3c4d5-6e7f8a9b
   EBAY_CLIENT_SECRET=PRD-a1b2c3d4e5f6-7a8b-9c0d-1e2f-3a4b
   EBAY_ENV=production
   EBAY_SHIP_TO_ZIP=90210
   ```

7. Restart CardHawk. **Setup** should now show eBay as *Ready*.

Set `EBAY_SHIP_TO_ZIP` to your own postcode. eBay's calculated-shipping
estimates are guesses without a buyer location, and CardHawk ranks on landed
cost, so a wrong shipping figure means a wrong ranking.

## Do not use Sandbox

Sandbox returns `{"total": 0}` for essentially every card search — it cannot see
production listings and is meant for testing selling flows. Use Production keys
from the start. Searching is read-only and costs you quota, not money.

## Your daily quota

A free keyset gets **5,000 Browse API calls per day**, shared across everything
the app does. That is one call every ~17 seconds if you spread it evenly.

CardHawk budgets for you:

- It requests the maximum 200 results per call, so it is not wasting four calls
  where one would do.
- A local token-bucket limiter stops a bug from draining the day's quota in
  minutes.
- `MAX_API_CALLS_PER_DAY` (default 4500) leaves headroom.
- **Setup** shows what you have spent today.

Each watch costs roughly one call per category it sweeps, per run. Ten watches
sweeping two categories every 30 minutes is `10 × 2 × 48 = 960` calls a day —
comfortable. Thirty watches every 10 minutes is not. If you run out, the quota
resets at midnight UTC.

To raise the limit, eBay runs a free
[Application Growth Check](https://developer.ebay.com/grow/application-growth-check).
They want a working application they can actually test, and it takes weeks.

## Affiliate links (optional)

If you have an eBay Partner Network account, set `EBAY_EPN_CAMPAIGN_ID` to your
10-digit campaign ID and CardHawk will use affiliate links for listings. Without
it you get plain links, which work exactly the same.

## What you cannot get

**Sold and completed listings.** The only eBay API that returns them is
**Marketplace Insights**, which is a Limited Release: your keyset has to be
explicitly granted the scope by an eBay business unit, and solo developers are
routinely declined. eBay's own docs say approval is judged on your business
model with no guarantee. Assume you will not get it.

Scraping the sold-listings pages instead is not an option either. eBay's User
Agreement prohibits using "any robot, spider, scraper, data mining tools […] or
any automated means" without written permission, and `robots.txt` separately
disallows `/sch/` for all crawlers. It is also a good way to get your account and
keyset terminated.

CardHawk works around this legitimately — see
[DATA_SOURCES.md](DATA_SOURCES.md) and
[HOW_IT_WORKS.md](HOW_IT_WORKS.md#where-market-values-come-from).

## Troubleshooting

| Symptom | Cause |
|---|---|
| `invalid_client` at token time | Sandbox keys with `EBAY_ENV=production`, or vice versa. They are different credentials. |
| `invalid_scope` at token time | The keyset was never granted that scope. Restricted APIs need eBay's approval. |
| Searches return nothing | Almost always `EBAY_ENV=sandbox`. |
| No auctions in results | CardHawk asks for them explicitly; if you have edited the filter, note that eBay's search returns **only** fixed-price listings unless `buyingOptions` includes `AUCTION`. |
| HTTP 429 | Daily quota exhausted. It resets at midnight UTC; there is no way to hurry it. |
