import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const history = JSON.parse(await fs.readFile(new URL('../data/league-history.json', import.meta.url), 'utf8'));
const seasons = new Map(history.seasons.map((season) => [Number(season.year), season]));

assert.deepEqual([...seasons.keys()].sort(), [2020, 2021, 2022, 2023, 2024, 2025, 2026], 'Expected the 2020–2026 Sleeper chain');
for (const year of [2020, 2021, 2022, 2023, 2024, 2025, 2026]) {
  const season = seasons.get(year);
  assert.equal(season.teams.length, 12, `${year} must contain 12 teams`);
  assert.equal(new Set(season.teams.map((team) => String(team.roster_id))).size, 12, `${year} roster IDs must be unique`);
}

for (const year of [2020, 2021, 2022, 2023, 2024, 2025]) assert.equal(seasons.get(year).draft_picks.length, 180, `${year} auction must contain 180 picks`);
assert.equal(seasons.get(2026).settings.max_keepers, 2, 'Sleeper keeper limit must be two');
assert.equal(seasons.get(2026).drafts[0].settings.budget, 200, 'Auction budget must be $200');
assert.equal(Number(seasons.get(2026).scoring_settings.rec), 0.5, 'League must remain half-PPR');

const currentPlayers = seasons.get(2026).teams.flatMap((team) => team.players.map((player) => ({...player, rosterId: team.roster_id})));
assert.ok(currentPlayers.length >= 180, '2026 rollover rosters are unexpectedly sparse');
assert.equal(new Set(currentPlayers.map((player) => String(player.id))).size, currentPlayers.length, 'A 2026 player appears on more than one roster');

const priorDraftTime = Number(seasons.get(2025).drafts[0].start_time || 0);
const priorTransactions = seasons.get(2025).transactions.filter((transaction) => transaction.status === 'complete');
let tradeResets = 0;
let twoYearLocks = 0;
for (const player of currentPlayers) {
  const additions = priorTransactions
    .filter((transaction) => transaction.adds && String(transaction.adds[player.id]) === String(player.rosterId))
    .sort((a, b) => Number(a.created || 0) - Number(b.created || 0));
  const latest = additions.at(-1);
  if (latest?.type === 'trade' && Number(latest.created || 0) > priorDraftTime) tradeResets += 1;

  let years = 0;
  for (const year of [2025, 2024]) {
    const pick = seasons.get(year).draft_picks.find((entry) => String(entry.player_id) === String(player.id) && String(entry.roster_id) === String(player.rosterId));
    if (!pick?.is_keeper) break;
    years += 1;
  }
  assert.ok(years >= 0 && years <= 2, `Invalid keeper clock for ${player.name}`);
  if (years === 2) twoYearLocks += 1;
}

console.log(JSON.stringify({
  capturedAt: history.captured_at,
  seasons: [...seasons.keys()],
  teams: seasons.get(2026).teams.length,
  rolloverPlayers: currentPlayers.length,
  priorDraftPicks: seasons.get(2025).draft_picks.length,
  priorTransactions: seasons.get(2025).transactions.length,
  tradeResets,
  twoYearLocks,
  result: 'release data validated',
}, null, 2));
