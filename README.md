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
- The new season begins from the prior season’s rollover roster; non-keepers return to the auction pool.
- Each team starts with a $200 auction budget and keeper costs are deducted before the auction begins.

## Current status

The app is a dependency-free browser client in `index.html`. It supports a useful local setup mode immediately: draft availability blocks, proposal drafts, votes, keeper choices, and NIS/USD payment drafts persist in the browser. The public Supabase anon key is now configured, and the app has shared-sync code for authenticated availability, proposals, and votes. Migrations `0006`/`0007` still need to be applied before the shared mode can be verified.

`config.js` must contain only the public anon key. Never put the Supabase service-role key in a browser-deployed file.

## Planned backend tables

`seasons`, `managers`, `teams`, `team_memberships`, `players`, `player_ownership_history`, `keeper_rules`, `keeper_selections`, `availability_blocks`, `draft_options`, `proposals`, `votes`, `league_obligations`, `settlements`, `awards`, and `season_records`.

## Accounts already available

- GitHub repository: `yodilly1/fantasy-football`
- Supabase project: `uiyxlvwkuhidylbenjzc`
- Cloudflare Worker: `fantasy-football`

Google Cloud is only needed when Google Calendar free/busy OAuth is activated.

## Human setup needed before shared launch

1. Add the Supabase public anon key to `config.js`.
2. Apply migrations `0006_authenticated_workflows.sql` and `0007_seed_2026_league_and_invites.sql` in the Supabase SQL editor.
3. Configure Supabase Auth email provider / redirect URL for the Cloudflare deployment.
4. Generate manager invite tokens for the twelve managers and distribute each privately.
