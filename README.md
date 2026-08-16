# Ugh Who Cares · League HQ

A dependency-free league web app for the 12-team Sleeper keeper-auction league.

## What it does

- Email-only league entry with one locked team assignment per account.
- Commissioner dashboard showing connected and missing managers.
- Draft availability from direct Google Calendar free/busy access, Outlook `.ics` import, or manual windows.
- Two-hour draft-window ranking in Eastern and Israel time.
- Sleeper-powered keeper calculator using 2024–2026 drafts, rosters, and transactions.
- Maximum two keepers, two-year player clock, and trade clock resets.
- $200 auction budget with the workbook's keeper taxes, positional floors, waiver price, and ADP-exception range.
- Rule proposals and one vote per manager.
- NIS obligations with either NIS or USD settlement and a recorded exchange rate.
- Sleeper record book and 2026 rollover team directory.

## Currency model

- Buy-ins, weekly prizes, and payouts are denominated in NIS.
- Managers may settle in NIS or the USD equivalent.
- Each USD settlement records the amount, NIS-per-USD rate, and credited NIS value.
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

- Frontend and hosting: Cloudflare Workers static assets (free tier).
- Database and lightweight authentication: Supabase (free tier).
- League history: Sleeper's public API, imported to `data/league-history.json`.
- Google availability: Google Identity Services with the narrow `calendar.freebusy` scope; no event names or refresh tokens are stored.
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
