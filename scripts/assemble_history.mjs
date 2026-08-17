import fs from 'node:fs/promises';
import path from 'node:path';

const root = new URL('../work/sleeper-snapshots-2020-full/', import.meta.url);
const output = new URL('../data/league-history.json', import.meta.url);
const players = JSON.parse(await fs.readFile(new URL('players-nfl.json', root), 'utf8'));
const years = (await fs.readdir(root, {withFileTypes: true}))
  .filter((entry) => entry.isDirectory() && /^20\d\d$/.test(entry.name))
  .map((entry) => Number(entry.name)).sort((a, b) => a - b);

async function readJson(url, fallback) {
  try { return JSON.parse(await fs.readFile(url, 'utf8')); } catch { return fallback; }
}

async function readArrays(dir) {
  const entries = await fs.readdir(dir, {withFileTypes: true});
  const values = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.json'))) {
    const payload = await readJson(new URL(entry.name, dir), []);
    if (Array.isArray(payload)) values.push(...payload);
  }
  return values;
}

const seasons = [];
for (const year of years) {
  const dir = new URL(`${year}/`, root);
  const league = await readJson(new URL('league.json', dir), {});
  const users = await readJson(new URL('users.json', dir), []);
  const rosters = await readJson(new URL('rosters.json', dir), []);
  const drafts = await readJson(new URL('drafts.json', dir), []);
  const draftPicks = await readArrays(new URL('drafts/', dir));
  const transactions = [...new Map((await readArrays(new URL('transactions/', dir))).map((row) => [row.transaction_id, row])).values()];
  const matchupEntries = (await fs.readdir(new URL('matchups/', dir), {withFileTypes: true})).filter((entry) => entry.name.endsWith('.json'));
  const matchups = {};
  for (const entry of matchupEntries) {
    const match = entry.name.match(/week-(\d+)\.json/);
    if (match) matchups[match[1]] = await readJson(new URL(`matchups/${entry.name}`, dir), []);
  }
  const usersById = new Map(users.map((user) => [String(user.user_id), user]));
  const info = (id) => {
    const player = players[String(id)] || {};
    return {id: String(id), name: player.full_name || [player.first_name, player.last_name].filter(Boolean).join(' ') || String(id), position: player.position || null, team: player.team || null};
  };
  const teams = rosters.map((roster) => {
    const owner = usersById.get(String(roster.owner_id)) || {};
    const settings = roster.settings || {};
    const teamName = owner.metadata?.team_name || owner.display_name || `Roster ${roster.roster_id}`;
    const rosterPicks = draftPicks.filter((pick) => String(pick.roster_id) === String(roster.roster_id));
    return {
      roster_id: roster.roster_id,
      owner_id: roster.owner_id,
      display_name: owner.display_name || teamName,
      team_name: teamName,
      wins: settings.wins || 0,
      losses: settings.losses || 0,
      points: Number(settings.fpts || 0),
      points_against: Number(settings.fpts_against || 0),
      potential_points: Number(settings.potential_points || 0),
      keepers: rosterPicks.filter((pick) => pick.is_keeper).map((pick) => String(pick.player_id)),
      players: (roster.players || []).map(info),
    };
  });
  seasons.push({
    year,
    league_id: String(league.league_id),
    status: league.status,
    settings: league.settings || {},
    scoring_settings: league.scoring_settings || {},
    winner_roster_id: league.metadata?.latest_league_winner_roster_id || null,
    teams,
    matchups,
    transactions,
    drafts,
    draft_picks: draftPicks,
  });
}

await fs.writeFile(output, JSON.stringify({source: 'Sleeper', captured_at: new Date().toISOString().slice(0, 10), seasons}, null, 2) + '\n');
console.log(JSON.stringify({years, seasons: seasons.length, transactions: seasons.reduce((sum, season) => sum + season.transactions.length, 0), draftPicks: seasons.reduce((sum, season) => sum + season.draft_picks.length, 0)}));
