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

The app is a dependency-free browser client in `index.html`. It supports a useful local setup mode immediately: draft availability blocks, proposal drafts, votes, keeper choices, and NIS/USD payment drafts persist in the browser. Availability is normalized to UTC for cross-time-zone matching. The public Supabase anon key is configured, and authenticated shared mode supports availability, proposals, votes, obligations, payments, atomic keeper selection/budget updates, and commissioner-triggered rollover import after migrations `0006`–`0009` are applied.

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
2. Apply migrations `0006_authenticated_workflows.sql`, `0007_seed_2026_league_and_invites.sql`, `0008_atomic_keeper_selection.sql`, and `0009_rollover_snapshot_import.sql` in the Supabase SQL editor.
3. Configure Supabase Auth email provider / redirect URL for the Cloudflare deployment.
4. Sign in as the commissioner, open the Money ledger or dashboard invite action, and copy each unredeemed manager token privately to the matching manager.
