# Ugh Who Cares — League HQ

Single-site league command center for the 12-team keeper auction league.

## Currency model

- Auction and keeper values are USD fantasy dollars.
- League obligations are canonical NIS.
- A manager may settle an obligation in NIS or USD.
- Every settlement records the currency, amount, exchange rate, timestamp, and credited NIS value.
- No automatic conversion is applied to auction values.

## Keeper model

- A player may be kept for a maximum of two seasons by the current team.
- A traded player receives a new keeper clock with the acquiring team.
- The system preserves prior ownership history while evaluating the current team’s clock.
- Keeper pricing remains separate from league-money settlement.

## Current status

The initial UI prototype is in `index.html`. It is intentionally dependency-free so it can deploy to the existing Cloudflare Worker/Pages setup while the Supabase schema and authentication are wired in.

## Planned backend tables

`seasons`, `managers`, `teams`, `team_memberships`, `players`, `player_ownership_history`, `keeper_rules`, `keeper_selections`, `availability_blocks`, `draft_options`, `proposals`, `votes`, `league_obligations`, `settlements`, `awards`, and `season_records`.

## Accounts already available

- GitHub repository: `yodilly1/fantasy-football`
- Supabase project: `uiyxlvwkuhidylbenjzc`
- Cloudflare Worker: `fantasy-football`

Google Cloud is only needed when Google Calendar free/busy OAuth is activated.
