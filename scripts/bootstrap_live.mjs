import fs from 'node:fs/promises';
import vm from 'node:vm';

const configSource = await fs.readFile(new URL('../config.js', import.meta.url), 'utf8');
const sandbox = {window: {}};
vm.runInNewContext(configSource, sandbox);
const {url, anonKey} = sandbox.window.UWC_SUPABASE;
const history = JSON.parse(await fs.readFile(new URL('../data/league-history.json', import.meta.url), 'utf8'));
const email = (process.env.UWC_ADMIN_EMAIL || 'clarityce@gmail.com').toLowerCase();
const password = `UWC-2026-${Buffer.from(email).toString('base64').replace(/[^a-z0-9]/gi, '').slice(0, 48)}-league`;

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: {apikey: anonKey, 'Content-Type': 'application/json'},
  body: JSON.stringify({email, password}),
});
const auth = await authResponse.json();
if (!authResponse.ok || !auth.access_token) throw new Error(auth.error_description || 'Commissioner login failed');

const headers = {apikey: anonKey, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json'};
const rest = async (path, options = {}) => {
  const response = await fetch(`${url}/rest/v1/${path}`, {...options, headers: {...headers, ...(options.headers || {})}});
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message || `Request failed (${response.status})`);
  return body;
};

await rest('rpc/bootstrap_commissioner', {method: 'POST', body: '{}'});
const [season] = await rest('seasons?year=eq.2026&select=id');
if (!season) throw new Error('2026 season not found');

const current = history.seasons.find((entry) => entry.year === 2026);
const prior = history.seasons.find((entry) => entry.year === 2025);
const draftTime = Number(prior?.drafts?.[0]?.start_time || 0);
const pickMap = new Map((prior?.draft_picks || []).map((pick) => [String(pick.player_id), pick]));
const transactions = (prior?.transactions || []).filter((tx) => tx.status === 'complete').sort((a, b) => Number(a.created || 0) - Number(b.created || 0));

function consecutiveKeeperYears(playerId, rosterId) {
  let years = 0;
  for (const year of [2025, 2024]) {
    const source = history.seasons.find((entry) => entry.year === year);
    const pick = source?.draft_picks?.find((entry) => String(entry.player_id) === String(playerId) && String(entry.roster_id) === String(rosterId));
    if (!pick?.is_keeper) break;
    years += 1;
  }
  return years;
}

const snapshot = {
  teams: current.teams.map((team) => ({
    team_name: team.team_name.trim(),
    players: team.players.map((player) => {
      const pick = pickMap.get(String(player.id));
      const additions = transactions.filter((tx) => tx.adds && String(tx.adds[player.id]) === String(team.roster_id));
      const latest = additions.at(-1);
      const resetClock = latest && Number(latest.created || 0) > draftTime && ['trade', 'waiver', 'free_agent'].includes(latest.type);
      return {
        id: String(player.id),
        name: player.name,
        position: player.position,
        team: player.team,
        auction_cost_usd: Number(pick?.metadata?.amount) || null,
        keeper_years_used: resetClock ? 0 : consecutiveKeeperYears(player.id, team.roster_id),
      };
    }),
  })),
};

const result = await rest('rpc/import_rollover_snapshot', {
  method: 'POST',
  body: JSON.stringify({target_season: season.id, snapshot}),
});

const ownership = await rest(`player_ownership_history?season_id=eq.${season.id}&select=id`);
const players = await rest('players?select=id');
console.log(JSON.stringify({result, players: players.length, ownership: ownership.length}));
