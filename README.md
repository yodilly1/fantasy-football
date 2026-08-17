# Ugh Who Cares · League HQ

A dependency-free league web app for the 12-team Sleeper keeper-auction league.

Live app: https://ugh-who-cares.pages.dev/

## What it does

- Email-only league entry with one locked team assignment per account.
- Commissioner dashboard showing connected and missing managers.
- Draft availability from direct Google Calendar free/busy access, Outlook `.ics` import, or manual windows.
- Multi-day manual availability and up to 24 two-hour draft-window suggestions weighted for Eastern and Israel-friendly hours.
- Manager identity and replacement workflow separate from immutable Sleeper history.
- In-app user guide for onboarding, scheduling, keepers, money, voting, and Sleeper data.
- Sleeper-powered keeper calculator using 2020–2026 drafts, rosters, and transactions.
- Maximum two keepers, two-year player clock, and trade clock resets.
- Final keeper submission lock, with commissioner-only reopening.
- $200 auction budget with the workbook's keeper taxes, positional floors, waiver price, and ADP-exception range.
- Rule proposals and one vote per manager.
- Automatic email alerts to every connected manager when a proposal opens.
- NIS obligations with either NIS or USD settlement and a recorded exchange rate.
- Sleeper record book from 2020 onward and 2026 rollover team directory.
- Durable Supabase snapshots of imported Sleeper season data; the API remains read-only.

## Currency model

- Buy-ins, weekly prizes, and payouts are denominated in NIS.
- Managers may settle in NIS or the USD equivalent.
- Each USD settlement records the amount, NIS-per-USD rate, and credited NIS value.
- The payment form suggests the current Bank of Israel representative USD/ILS rate while allowing the league's agreed rate to be recorded.
- Auction and keeper values are fantasy dollars and never mix with the money ledger.

## Keeper model

- A team may keep at most two players.
- A player may be kept for two additional seasons by the same team.
- A trade starts a new clock for the acquiring team.
- Auction/prior keeper: last cost + $5.
- RB floor: $13; WR floor: $14; no floor for QB/TE/K/DEF.
- Waiver/free agent: flat $5.
- RB/WR ADP exception: the greater of last cost + $8 or floor + $8 when the workbook's median test applies.
- Non-keepers return to the auction pool; keeper costs come out of the $200 budget.

## Stack and cost

- Frontend and hosting: Cloudflare Pages static assets (free tier).
- Database and lightweight authentication: Supabase (free tier).
- League history: Sleeper's public API, imported to `data/league-history.json` from 2020 onward.
- Google availability: Google Identity Services with the narrow `calendar.freebusy` scope; no event names or refresh tokens are stored. Because this is a private league tool, Google may display an unverified-app warning during connection; users should confirm they trust the league app before continuing.
- Vote email delivery: Supabase Edge Functions plus Brevo's free transactional-email tier.
- Outlook availability: local `.ics` import, with a direct Microsoft connection available as a future enhancement.

Google Calendar uses the free `UWC League HQ` Google Cloud project. Standard league-scale usage remains within the free API tier.

## Files

- `index.html` — semantic application shell.
- `styles.css` — responsive interface system.
- `league-app.js` — onboarding, scheduling, keepers, voting, money, and history workflows.
- `league-settings.js` — public Supabase configuration and Google OAuth Client ID; no private credentials.
- `data/league-history.json` — imported Sleeper history.
- `supabase/migrations/` — schema, policies, and server-validated workflows.
- `scripts/sleeper_import.py` — Sleeper history refresh.
- `scripts/bootstrap_live.mjs` — commissioner-only roster bootstrap.

Never put the Supabase service-role key in a browser-deployed file.
