(() => {
  'use strict';

  const config = window.UWC_SUPABASE || {};
  const SESSION_KEY = 'uwc-supabase-session';
  const IDENTITY_KEY = 'uwc-email-identity';
  const LOCAL_KEEPERS_KEY = 'uwc-keeper-draft';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  const app = {
    session: readJson(SESSION_KEY),
    email: localStorage.getItem(IDENTITY_KEY) || '',
    seasonId: null,
    managerId: null,
    teamId: null,
    team: null,
    manager: null,
    isCommissioner: false,
    managers: [],
    memberships: [],
    blocks: [],
    proposals: [],
    votes: [],
    keeperSelections: [],
    allKeeperSelections: [],
    teamBudget: null,
    allTeamBudgets: [],
    obligations: [],
    settlements: [],
    draftOptions: [],
    ownership: [],
    history: null,
    roster: [],
    selectedKeepers: [],
    calendarProvider: 'Google Calendar',
    activeView: 'dashboard',
  };

  const viewCopy = {
    dashboard: ['2026 setup', 'League dashboard'], draft: ['Draft coordination', 'Draft time'],
    keepers: ['2026 roster', 'Keeper calculator'], votes: ['League decisions', 'Votes'],
    money: ['NIS ledger', 'League money'], rules: ['Constitution', 'League rules'],
    history: ['Sleeper history', 'Record book'], teams: ['2026 rollover', 'League teams'], help: ['Quick start', 'How it works'],
  };

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  }

  function keeperStorageKey() { return `${LOCAL_KEEPERS_KEY}:${app.teamId || 'unassigned'}`; }

  function saveSession(session, email = app.email) {
    app.session = session;
    app.email = email;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(IDENTITY_KEY, email);
  }

  function clearSession() {
    app.session = null;
    app.email = '';
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(IDENTITY_KEY);
  }

  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('is-visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('is-visible'), 3500);
  }

  async function refreshSession() {
    if (!app.session?.refresh_token || !config.url || !config.anonKey) return false;
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: {'apikey': config.anonKey, 'Content-Type': 'application/json'},
      body: JSON.stringify({refresh_token: app.session.refresh_token}),
    });
    if (!response.ok) return false;
    const body = await response.json();
    if (!body.access_token) return false;
    saveSession({access_token: body.access_token, refresh_token: body.refresh_token || app.session.refresh_token});
    return true;
  }

  async function api(path, options = {}, retry = true) {
    if (!config.url || !config.anonKey) throw new Error('Supabase is not configured.');
    const response = await fetch(`${config.url}/rest/v1/${path}`, {
      ...options,
      headers: {
        'apikey': config.anonKey,
        'Authorization': `Bearer ${app.session?.access_token || config.anonKey}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (response.status === 401 && retry && await refreshSession()) return api(path, options, false);
    const text = await response.text();
    const body = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!response.ok) throw new Error(body?.message || body?.hint || body?.details || `Request failed (${response.status}).`);
    return body;
  }

  async function invokeFunction(name, payload, retry = true) {
    const response = await fetch(`${config.url}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'apikey': config.anonKey,
        'Authorization': `Bearer ${app.session?.access_token || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (response.status === 401 && retry && await refreshSession()) return invokeFunction(name, payload, false);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || body.message || `Notification failed (${response.status}).`);
    return body;
  }

  function accountPassword(email) {
    const encoded = btoa(email.toLowerCase()).replace(/[^a-z0-9]/gi, '').slice(0, 48);
    return `UWC-2026-${encoded}-league`;
  }

  async function authRequest(path, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${config.url}/auth/v1/${path}`, {
        method: 'POST',
        headers: {'apikey': config.anonKey, 'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      return {response, body};
    } catch (reason) {
      if (reason.name === 'AbortError') throw new Error('The league server took too long to respond. Please try again.');
      throw new Error('Could not reach the league server. Check your connection and try again.');
    } finally {
      clearTimeout(timeout);
    }
  }

  async function enterLeague(email) {
    const normalized = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error('Enter a valid email address.');
    if (!config.url || !config.anonKey) throw new Error('The league database is not configured.');
    const password = accountPassword(normalized);

    let result = await authRequest('token?grant_type=password', {email: normalized, password});
    if (!result.response.ok || !result.body.access_token) result = await authRequest('signup', {email: normalized, password});
    if (!result.response.ok || !result.body.access_token) {
      const raw = result.body.error_description || result.body.msg || result.body.message || '';
      if (/invalid login|already|registered/i.test(raw) || result.response.ok) {
        throw new Error('This email belongs to an older league account. The commissioner must release its old sign-in once; no email verification is required.');
      }
      throw new Error(raw || 'Could not open this league account.');
    }
    saveSession({access_token: result.body.access_token, refresh_token: result.body.refresh_token || null}, normalized);
  }

  async function loadHistory() {
    for (const path of ['data/league-history.json', 'league-history.json']) {
      try { const response = await fetch(path); if (response.ok) { app.history = await response.json(); return; } } catch {}
    }
    throw new Error('Sleeper history could not be loaded.');
  }

  async function hydrateMember() {
    const seasons = await api('seasons?year=eq.2026&select=*');
    app.seasonId = seasons?.[0]?.id || null;
    if (!app.seasonId) throw new Error('The 2026 season has not been created.');
    await api('rpc/bootstrap_commissioner', {method: 'POST', body: '{}'}).catch(() => null);
    app.managerId = await api('rpc/current_manager_id', {method: 'POST', body: '{}'});
    if (!app.managerId) return false;

    const [managerRows, memberships, managers, allMemberships, blocks, proposals, votes, keeperSelections, obligations, settlements, draftOptions, teamBudgets] = await Promise.all([
      api(`managers?id=eq.${app.managerId}&select=id,display_name,timezone,preferred_payment_currency`),
      api(`team_memberships?season_id=eq.${app.seasonId}&manager_id=eq.${app.managerId}&select=team_id,is_commissioner,teams(id,display_name,sleeper_team_id)`),
      api('managers?select=id,display_name,auth_user_id,timezone,preferred_payment_currency&order=display_name'),
      api(`team_memberships?season_id=eq.${app.seasonId}&select=team_id,manager_id,is_commissioner,teams(id,display_name,sleeper_team_id),managers(id,display_name,auth_user_id,sleeper_username)`),
      api(`availability_blocks?season_id=eq.${app.seasonId}&select=*,managers(display_name)&order=starts_at`),
      api(`proposals?season_id=eq.${app.seasonId}&select=*&order=created_at.desc`),
      api('votes?select=proposal_id,manager_id,choice,comment'),
      api(`keeper_selections?season_id=eq.${app.seasonId}&select=*,players(id,name,position,nfl_team)`),
      api(`league_obligations?season_id=eq.${app.seasonId}&select=*&order=created_at.desc`),
      api('settlements?select=*&order=created_at.desc'),
      api(`draft_options?season_id=eq.${app.seasonId}&select=*&order=score.desc`),
      api(`season_team_budgets?season_id=eq.${app.seasonId}&select=*`),
    ]);

    app.manager = managerRows?.[0] || null;
    app.teamId = memberships?.[0]?.team_id || null;
    app.team = memberships?.[0]?.teams || null;
    app.isCommissioner = Boolean(memberships?.[0]?.is_commissioner);
    app.managers = managers || [];
    app.memberships = allMemberships || [];
    app.blocks = blocks || [];
    app.proposals = proposals || [];
    app.votes = votes || [];
    app.allKeeperSelections = keeperSelections || [];
    app.keeperSelections = app.allKeeperSelections.filter((row) => row.team_id === app.teamId);
    app.obligations = obligations || [];
    app.settlements = settlements || [];
    app.draftOptions = draftOptions || [];
    app.allTeamBudgets = teamBudgets || [];
    app.teamBudget = app.allTeamBudgets.find((row) => row.team_id === app.teamId) || null;
    app.ownership = app.teamId ? await api(`player_ownership_history?season_id=eq.${app.seasonId}&team_id=eq.${app.teamId}&select=*,players(id,name,position,nfl_team)`) : [];

    if (app.keeperSelections.length) {
      app.selectedKeepers = app.keeperSelections.map((row) => ({
        id: row.players?.id, name: row.players?.name, position: row.players?.position,
        lastCost: Number(row.base_cost_usd) - 5, baseCost: Number(row.base_cost_usd), finalCost: Number(row.final_cost_usd),
        yearsUsed: Math.max(0, Number(row.keeper_year_number) - 1), remote: true,
      }));
      localStorage.setItem(keeperStorageKey(), JSON.stringify(app.selectedKeepers));
    } else app.selectedKeepers = readJson(keeperStorageKey()) || [];
    return true;
  }

  async function showTeamGate() {
    $('#auth-gate').hidden = true;
    $('#app-shell').hidden = true;
    $('#team-gate').hidden = false;
    const choices = $('#team-choices');
    choices.innerHTML = '<div class="empty-state">Loading available teams…</div>';
    try {
      const teams = await api('rpc/available_league_teams', {method: 'POST', body: '{}'});
      choices.innerHTML = teams?.length ? teams.map((team) => `<button class="team-choice" data-claim-team="${team.team_id}"><span><b>${escapeHtml(team.manager_name || 'Manager')}</b><small>${escapeHtml(team.team_name || 'Team')}${team.sleeper_username ? ` · Sleeper: ${escapeHtml(team.sleeper_username)}` : ''}</small></span><span>Choose →</span></button>`).join('') : '<div class="empty-state">All twelve teams are claimed. Ask the commissioner to release the correct team.</div>';
    } catch {
      choices.innerHTML = '<div class="empty-state">Team selection is being upgraded. Ask the commissioner to finish database migration 0014.</div>';
    }
  }

  async function claimTeam(teamId, button) {
    const error = $('#team-error');
    error.textContent = '';
    button.disabled = true;
    try {
      await api('rpc/claim_manager_for_team', {method: 'POST', body: JSON.stringify({target_team: teamId})});
      if (!await hydrateMember()) throw new Error('Team assignment did not finish.');
      $('#team-gate').hidden = true;
      showApp();
      toast('Team connected. Welcome to the league.');
    } catch (reason) {
      error.textContent = reason.message || 'That team was just claimed.';
      button.disabled = false;
    }
  }

  function showApp() {
    $('#auth-gate').hidden = true;
    $('#team-gate').hidden = true;
    $('#app-shell').hidden = false;
    $('#identity-name').textContent = app.manager?.display_name || 'League member';
    $('#identity-team').textContent = app.team?.display_name || 'Team not assigned';
    $$('.admin-only').forEach((node) => { node.hidden = !app.isCommissioner; });
    renderAll();
  }

  function showAuth() {
    $('#app-shell').hidden = true;
    $('#team-gate').hidden = true;
    $('#auth-gate').hidden = false;
    $('#email-input').focus();
  }

  function switchView(view) {
    if (!viewCopy[view]) return;
    app.activeView = view;
    $$('.view').forEach((section) => { section.hidden = section.id !== `view-${view}`; section.classList.toggle('is-active', !section.hidden); });
    $$('.nav-item').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
    $('#page-eyebrow').textContent = viewCopy[view][0];
    $('#page-title').textContent = viewCopy[view][1];
    document.body.classList.remove('nav-open');
    if (view === 'keepers') loadKeeperRoster();
  }

  function formatInZone(iso, zone, includeWeekday = true) {
    return new Intl.DateTimeFormat('en-US', {timeZone: zone, ...(includeWeekday ? {weekday: 'short'} : {}), month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}).format(new Date(iso));
  }

  function managerName(id) { return app.managers.find((manager) => manager.id === id)?.display_name || 'Manager'; }

  function editManagerModal(teamId) {
    if (!app.isCommissioner) return;
    const membership = app.memberships.find((row) => row.team_id === teamId);
    const manager = membership?.managers || app.managers.find((row) => row.id === membership?.manager_id);
    if (!membership || !manager) return;
    openModal({title: 'Update manager identity', copy: `This changes the league display name for ${membership.teams?.display_name || 'this team'}. Sleeper history stays unchanged.`, submitLabel: 'Save manager', body: `<div class="form-grid"><div class="field full"><label>Manager name</label><input id="manager-display-name" value="${escapeHtml(manager.display_name)}" required></div><div class="field full"><label>Sleeper username (optional)</label><input id="manager-sleeper-username" value="${escapeHtml(manager.sleeper_username || '')}" placeholder="Sleeper username"></div></div>`, onSubmit: async (modal) => {
      const displayName = $('#manager-display-name', modal).value.trim(), sleeperUsername = $('#manager-sleeper-username', modal).value.trim();
      if (!displayName) throw new Error('Enter the manager name.');
      await api('rpc/admin_update_manager_identity', {method: 'POST', body: JSON.stringify({target_team: teamId, new_display_name: displayName, new_sleeper_username: sleeperUsername || null})});
      await refreshData(); toast('Manager identity updated.'); return true;
    }});
  }

  function renderDashboard() {
    const connected = app.managers.filter((manager) => manager.auth_user_id).length;
    const availableManagers = new Set(app.blocks.filter((block) => block.availability !== 'unavailable').map((block) => block.manager_id)).size;
    const keeperTeams = app.allTeamBudgets.filter((budget) => budget.status === 'keepers_locked').length;
    const openProposals = app.proposals.filter((proposal) => proposal.status === 'open').length;
    $('#dashboard-metrics').innerHTML = [
      ['Managers connected', `${connected} / 12`, connected === 12 ? 'Everyone is in' : `${12 - connected} still missing`],
      ['Availability received', `${availableManagers} / 12`, availableManagers === 12 ? 'Ready to select' : 'Waiting on open times'],
      ['Teams with keepers', `${keeperTeams} / 12`, `${app.allKeeperSelections.length} player selections`],
      ['Open votes', String(openProposals), openProposals ? 'League decisions pending' : 'No decision pending'],
    ].map(([label, value, note]) => `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');

    const confirmed = app.draftOptions.find((option) => option.selected);
    const steps = [
      {name: 'Connect managers', detail: `${connected} of 12 accounts`, done: connected === 12},
      {name: 'Collect draft availability', detail: `${availableManagers} of 12 managers`, done: availableManagers === 12},
      {name: 'Confirm draft time', detail: confirmed ? formatInZone(confirmed.starts_at, 'America/New_York') : 'No time selected', done: Boolean(confirmed)},
      {name: 'Lock keepers', detail: `${keeperTeams} of 12 teams`, done: keeperTeams === 12},
      {name: 'Open auction pool', detail: 'After all keeper decisions', done: false},
    ];
    $('#season-runway').innerHTML = steps.map((step) => `<div class="runway-step ${step.done ? 'done' : ''}"><span class="runway-dot">${step.done ? '✓' : '·'}</span><span><b>${step.name}</b><small>${step.detail}</small></span><span class="status ${step.done ? 'success' : ''}">${step.done ? 'Done' : 'Next'}</span></div>`).join('');
    const doneCount = steps.filter((step) => step.done).length;
    $('#setup-status').textContent = `${doneCount} / ${steps.length}`;
    $('#setup-status').className = `status ${doneCount === steps.length ? 'success' : 'warning'}`;

    const next = app.proposals.find((proposal) => proposal.status === 'open');
    $('#next-decision').innerHTML = next ? `<div class="data-row"><div><span class="status">${escapeHtml(next.category)}</span><b style="margin-top:10px">${escapeHtml(next.title)}</b><small>${escapeHtml(next.proposed_value || next.description)}</small></div><button class="button secondary" data-go="votes">Vote</button></div>` : `<div class="data-row"><div><b>Set the draft date</b><small>${availableManagers} managers have added availability.</small></div><button class="button secondary" data-go="draft">Review times</button></div>`;
    renderAdminCoverage();
  }

  function renderAdminCoverage() {
    const panel = $('#admin-coverage');
    if (!app.isCommissioner) { panel.hidden = true; return; }
    panel.hidden = false;
    const rows = app.memberships.map((membership) => ({
      teamId: membership.team_id, team: membership.teams?.display_name || 'Team', manager: membership.managers?.display_name || 'Manager', claimed: Boolean(membership.managers?.auth_user_id), locked: app.allTeamBudgets.find((budget) => budget.team_id === membership.team_id)?.status === 'keepers_locked',
    })).sort((a, b) => Number(a.claimed) - Number(b.claimed) || a.team.localeCompare(b.team));
    panel.innerHTML = `<div class="panel-head"><div><span class="kicker">Commissioner</span><h3>Manager coverage</h3><p>Names are local league identities; Sleeper data remains historical and read-only.</p></div><button class="button secondary" data-action="copy-invite">Copy league link</button></div><div class="rows">${rows.map((row) => `<div class="data-row"><div><b>${escapeHtml(row.manager)}</b><small>${escapeHtml(row.team)}</small></div><div class="row-actions"><button class="button secondary" data-edit-manager="${row.teamId}">Edit</button>${row.locked ? '<span class="status success">Keepers locked</span>' : ''}<span class="status ${row.claimed ? 'success' : 'warning'}">${row.claimed ? 'Connected' : 'Missing'}</span>${row.locked ? `<button class="button secondary" data-reopen-team="${row.teamId}">Reopen keepers</button>` : ''}${row.claimed && row.teamId !== app.teamId ? `<button class="button danger" data-release-team="${row.teamId}">Release</button>` : ''}</div></div>`).join('')}</div>`;
  }

  function normalizeBlock(row) {
    return {...row, utcStart: row.starts_at, utcEnd: row.ends_at, status: row.availability, managerId: row.manager_id, managerName: row.managers?.display_name || managerName(row.manager_id)};
  }

  function rankedWindows() {
    const blocks = app.blocks.map(normalizeBlock).filter((block) => block.status === 'open' || block.status === 'possible');
    const candidates = new Map();
    const hourInZone = (iso, zone) => {
      const parts = new Intl.DateTimeFormat('en-US', {timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(iso)).reduce((out, part) => (out[part.type] = part.value, out), {});
      return Number(parts.hour) + Number(parts.minute || 0) / 60;
    };
    const comfort = (hour, zone) => {
      if (zone === 'Asia/Jerusalem') {
        if (hour >= 18 && hour < 24) return 30;
        if (hour >= 0 && hour < 1.5) return 22;
        if (hour >= 16 && hour < 18) return 16;
        if (hour >= 8 && hour < 16) return 8;
        return -18;
      }
      if (hour >= 12 && hour < 21.5) return 24;
      if (hour >= 9 && hour < 12) return 12;
      if (hour >= 21.5 && hour < 23) return 2;
      return -14;
    };
    for (const block of blocks) {
      const start = new Date(block.utcStart).getTime();
      const end = new Date(block.utcEnd).getTime();
      for (let time = start; time + 7200000 <= end; time += 1800000) {
        const key = new Date(time).toISOString();
        const covering = blocks.filter((other) => new Date(other.utcStart).getTime() <= time && new Date(other.utcEnd).getTime() >= time + 7200000);
        const managerStatus = new Map();
        covering.forEach((other) => { if (other.status === 'open' || !managerStatus.has(other.managerId)) managerStatus.set(other.managerId, other.status); });
        const open = [...managerStatus.values()].filter((status) => status === 'open').length;
        const possible = managerStatus.size - open;
        const endKey = new Date(time + 7200000).toISOString();
        const israelComfort = comfort(hourInZone(key, 'Asia/Jerusalem'), 'Asia/Jerusalem');
        const easternComfort = comfort(hourInZone(key, 'America/New_York'), 'America/New_York');
        candidates.set(key, {start: key, end: endKey, open, possible, count: managerStatus.size, israelComfort, easternComfort, score: open * 100 + possible * 25 + israelComfort + easternComfort});
      }
    }
    return [...candidates.values()].sort((a, b) => b.score - a.score || new Date(a.start) - new Date(b.start)).slice(0, 24);
  }

  function renderDraft() {
    const own = app.blocks.filter((block) => block.manager_id === app.managerId);
    $('#availability-list').innerHTML = own.length ? own.map((block) => `<div class="data-row"><div><b>${formatInZone(block.starts_at, Intl.DateTimeFormat().resolvedOptions().timeZone)}</b><small>${formatInZone(block.starts_at, 'America/New_York')} Eastern · ${formatInZone(block.starts_at, 'Asia/Jerusalem')} Israel</small></div><div class="row-actions"><span class="status ${block.availability === 'open' ? 'success' : ''}">${escapeHtml(block.availability)}</span><button class="icon-button" aria-label="Delete availability" data-delete-block="${block.id}">×</button></div></div>`).join('') : '<div class="empty-state">No availability saved yet.</div>';
    const managers = new Set(app.blocks.map((block) => block.manager_id)).size;
    $('#availability-progress').textContent = `${managers} / 12`;
    const windows = rankedWindows();
    $('#draft-window-list').innerHTML = windows.length ? windows.map((window, index) => `<div class="data-row"><div><b>${formatInZone(window.start, 'America/New_York')} Eastern</b><small>${formatInZone(window.start, 'Asia/Jerusalem')} Israel · ${window.open} open${window.possible ? ` · ${window.possible} possible` : ''} · ${window.israelComfort >= 22 ? 'Israel-friendly' : window.israelComfort < 0 ? 'late in Israel' : 'reasonable in Israel'}</small></div><div class="row-actions"><span class="status ${window.count >= 10 ? 'success' : 'warning'}">${window.count} / 12</span>${app.isCommissioner ? `<button class="button secondary" data-select-draft="${index}">Select</button>` : ''}</div></div>`).join('') : '<div class="empty-state">Add open times to rank two-hour windows.</div>';
    const confirmed = app.draftOptions.find((option) => option.selected);
    const card = $('#confirmed-draft');
    card.hidden = !confirmed;
    if (confirmed) card.innerHTML = `<div class="panel-head" style="margin:0"><div><span class="kicker" style="color:#b8cad8">Confirmed draft time</span><h3 style="font-size:20px;margin-top:8px">${formatInZone(confirmed.starts_at, 'America/New_York')} Eastern</h3><p>${formatInZone(confirmed.starts_at, 'Asia/Jerusalem')} Israel · two-hour auction window</p></div><span class="status success">Selected</span></div>`;
  }

  function zonedDateToUtc(date, time, zone) {
    const [year, month, day] = date.split('-').map(Number); const [hour, minute] = time.split(':').map(Number);
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    const parts = new Intl.DateTimeFormat('en-US', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(guess)).reduce((out, part) => (out[part.type] = part.value, out), {});
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    return new Date(guess - (represented - guess)).toISOString();
  }

  function openModal({title, copy = '', body, submitLabel = 'Save', onSubmit}) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="modal-close" aria-label="Close">×</button></div>${copy ? `<p class="modal-copy">${copy}</p>` : ''}<form class="modal-form">${body}<p class="modal-error" role="alert"></p><div class="modal-actions"><button class="button secondary" type="button" data-modal-cancel>Cancel</button><button class="button primary" type="submit">${escapeHtml(submitLabel)}</button></div></form></div></div>`;
    const close = () => { root.innerHTML = ''; };
    $('.modal-close', root).onclick = close; $('[data-modal-cancel]', root).onclick = close;
    $('.modal-form', root).onsubmit = async (event) => {
      event.preventDefault(); const button = $('button[type="submit"]', root); const error = $('.modal-error', root);
      error.textContent = ''; button.disabled = true; const old = button.textContent; button.textContent = 'Working…';
      try { if (await onSubmit($('.modal', root))) close(); } catch (reason) { error.textContent = reason.message || 'Something went wrong.'; }
      finally { if (document.body.contains(button)) { button.disabled = false; button.textContent = old; } }
    };
  }

  function manualAvailabilityModal() {
    const today = new Date().toISOString().slice(0, 10); const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zones = [...new Set([localZone, 'America/New_York', 'Asia/Jerusalem', 'America/Los_Angeles'])];
    const days = [['0', 'Sun'], ['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat']];
    openModal({title: 'Add availability across days', copy: 'Choose a date range and the days that work. Enter the time in your own timezone; League HQ stores UTC and shows both Eastern and Israel time.', submitLabel: 'Save availability', body: `<div class="form-grid"><div class="field"><label>First date</label><input id="availability-first" type="date" value="${today}" required></div><div class="field"><label>Last date</label><input id="availability-last" type="date" value="${today}" required></div><div class="field full"><label>Days included</label><div class="day-picker">${days.map(([value, label]) => `<label class="day-option"><input type="checkbox" name="availability-day" value="${value}" checked><span>${label}</span></label>`).join('')}</div></div><div class="field"><label>Timezone</label><select id="availability-zone">${zones.map((zone) => `<option ${zone === localZone ? 'selected' : ''}>${zone}</option>`).join('')}</select></div><div class="field"><label>From</label><input id="availability-start" type="time" value="19:00" required></div><div class="field"><label>Until</label><input id="availability-end" type="time" value="23:00" required></div><div class="field full"><label>Availability</label><select id="availability-status"><option value="open">Open</option><option value="possible">Possible</option><option value="unavailable">Unavailable</option></select></div></div>`, onSubmit: async (modal) => {
      const first = $('#availability-first', modal).value, last = $('#availability-last', modal).value, zone = $('#availability-zone', modal).value, start = $('#availability-start', modal).value, end = $('#availability-end', modal).value, availability = $('#availability-status', modal).value, selectedDays = $$('input[name="availability-day"]:checked', modal).map((input) => Number(input.value));
      if (!first || !last || !start || !end || !selectedDays.length) throw new Error('Choose dates, hours, and at least one day.');
      if (new Date(last) < new Date(first)) throw new Error('The last date must be after the first date.');
      const rows = [];
      for (let day = new Date(`${first}T12:00:00`); day <= new Date(`${last}T12:00:00`); day.setDate(day.getDate() + 1)) {
        if (!selectedDays.includes(day.getDay())) continue;
        const date = day.toISOString().slice(0, 10), startsAt = zonedDateToUtc(date, start, zone);
        let endsAt = zonedDateToUtc(date, end, zone);
        if (new Date(endsAt) <= new Date(startsAt)) { const next = new Date(day); next.setDate(next.getDate() + 1); endsAt = zonedDateToUtc(next.toISOString().slice(0, 10), end, zone); }
        rows.push({season_id: app.seasonId, manager_id: app.managerId, starts_at: startsAt, ends_at: endsAt, source: 'manual', availability});
      }
      if (!rows.length) throw new Error('No selected weekdays fall inside that date range.');
      await api('availability_blocks', {method: 'POST', headers: {Prefer: 'return=minimal'}, body: JSON.stringify(rows)});
      await refreshData(); toast(`${rows.length} availability windows saved.`); return true;
    }});
  }

  function parseIcsDate(line) {
    const [head, raw = ''] = line.split(':'); const value = raw.trim(); if (!value.includes('T')) return null;
    const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/); if (!match) return null;
    const [, y, mo, d, h, mi, s, z] = match; if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)));
    const tzid = head.match(/TZID=([^;:]+)/)?.[1];
    return new Date(tzid ? zonedDateToUtc(`${y}-${mo}-${d}`, `${h}:${mi}`, tzid) : `${y}-${mo}-${d}T${h}:${mi}:${s || '00'}`);
  }

  function parseIcs(text) {
    const unfolded = text.replace(/\r?\n[ \t]/g, ''); const events = [];
    for (const chunk of unfolded.split('BEGIN:VEVENT').slice(1)) {
      const lines = chunk.split(/\r?\n/); const startLine = lines.find((line) => line.startsWith('DTSTART')); const endLine = lines.find((line) => line.startsWith('DTEND'));
      const start = startLine ? parseIcsDate(startLine) : null, end = endLine ? parseIcsDate(endLine) : null;
      if (start && end && end > start) events.push({start, end});
    }
    return events;
  }

  function requestGoogleAccessToken() {
    if (!config.googleClientId) throw new Error('Google Calendar is not configured yet.');
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) throw new Error('Google Calendar is still loading. Wait a moment and try again.');
    return new Promise((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: config.googleClientId,
        scope: 'https://www.googleapis.com/auth/calendar.freebusy',
        callback: (response) => response.error ? reject(new Error(response.error_description || 'Google authorization was not completed.')) : resolve(response.access_token),
        error_callback: (reason) => reject(new Error(reason?.type === 'popup_closed' ? 'Google connection was cancelled.' : 'Google could not open the calendar connection.')),
      });
      client.requestAccessToken({prompt: 'consent'});
    });
  }

  async function googleBusyEvents({first, last, startTime, endTime, zone}) {
    const accessToken = await requestGoogleAccessToken();
    const timeMin = zonedDateToUtc(first, startTime, zone);
    const timeMax = zonedDateToUtc(last, endTime, zone);
    const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({timeMin, timeMax, timeZone: zone, items: [{id: 'primary'}]}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || 'Google Calendar could not return availability.');
    return (body.calendars?.primary?.busy || []).map((event) => ({start: new Date(event.start), end: new Date(event.end)}));
  }

  function calendarRows({events, first, last, startTime, endTime, zone, source}) {
    const date = (value) => value.toISOString().slice(0, 10); const rows = [];
    for (let day = new Date(`${first}T12:00:00`); day <= new Date(`${last}T12:00:00`) && rows.length < 100; day.setDate(day.getDate() + 1)) {
      const dayString = date(day), windowStart = new Date(zonedDateToUtc(dayString, startTime, zone)), windowEnd = new Date(zonedDateToUtc(dayString, endTime, zone));
      if (windowEnd <= windowStart) continue;
      const busy = events.filter((event) => event.end > windowStart && event.start < windowEnd).sort((a, b) => a.start - b.start);
      let cursor = windowStart;
      for (const event of busy) {
        const gapEnd = event.start < windowEnd ? event.start : windowEnd;
        if (gapEnd - cursor >= 7200000) rows.push({season_id: app.seasonId, manager_id: app.managerId, starts_at: cursor.toISOString(), ends_at: gapEnd.toISOString(), source, availability: 'open'});
        if (event.end > cursor) cursor = event.end; if (cursor >= windowEnd) break;
      }
      if (windowEnd - cursor >= 7200000) rows.push({season_id: app.seasonId, manager_id: app.managerId, starts_at: cursor.toISOString(), ends_at: windowEnd.toISOString(), source, availability: 'open'});
    }
    return rows;
  }

  function calendarWindowModal({provider, loadEvents}) {
    const from = new Date(); const to = new Date(from.getTime() + 21 * 86400000); const date = (value) => value.toISOString().slice(0, 10); const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    openModal({title: `Connect ${provider}`, copy: 'Choose the date range and hours you would normally be willing to draft. We read busy times only and save the open gaps. Existing Google imports are replaced when you sync again.', submitLabel: `Connect ${provider}`, body: `<div class="form-grid"><div class="field"><label>First date</label><input id="calendar-from" type="date" value="${date(from)}"></div><div class="field"><label>Last date</label><input id="calendar-to" type="date" value="${date(to)}"></div><div class="field"><label>Daily start</label><input id="calendar-start" type="time" value="18:00"></div><div class="field"><label>Daily end</label><input id="calendar-end" type="time" value="23:00"></div><div class="field full"><label>Timezone</label><select id="calendar-zone"><option ${localZone === 'America/New_York' ? 'selected' : ''}>America/New_York</option><option ${localZone === 'Asia/Jerusalem' ? 'selected' : ''}>Asia/Jerusalem</option><option ${localZone === 'America/Los_Angeles' ? 'selected' : ''}>America/Los_Angeles</option></select></div></div>`, onSubmit: async (modal) => {
      const options = {first: $('#calendar-from', modal).value, last: $('#calendar-to', modal).value, startTime: $('#calendar-start', modal).value, endTime: $('#calendar-end', modal).value, zone: $('#calendar-zone', modal).value};
      if (!options.first || !options.last || !options.startTime || !options.endTime) throw new Error('Complete the date range and daily hours.');
      if (new Date(options.last) < new Date(options.first)) throw new Error('The last date must be after the first date.');
      const events = await loadEvents(options); const rows = calendarRows({...options, events, source: 'google_freebusy'});
      if (!rows.length) throw new Error('No two-hour open windows were found in that range.');
      await api(`availability_blocks?season_id=eq.${app.seasonId}&manager_id=eq.${app.managerId}&source=eq.google_freebusy`, {method: 'DELETE'});
      await api('availability_blocks', {method: 'POST', headers: {Prefer: 'return=minimal'}, body: JSON.stringify(rows)});
      await refreshData(); toast(`${rows.length} Google Calendar openings saved.`); return true;
    }});
  }

  function calendarImportModal(provider, events) {
    const from = new Date(); const to = new Date(from.getTime() + 21 * 86400000); const date = (value) => value.toISOString().slice(0, 10); const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    openModal({title: `Import ${provider}`, copy: `${events.length} busy event${events.length === 1 ? '' : 's'} found. Choose the draft-date range and the hours you would normally be willing to draft. League HQ saves the open gaps.`, submitLabel: 'Import open times', body: `<div class="form-grid"><div class="field"><label>First date</label><input id="calendar-from" type="date" value="${date(from)}"></div><div class="field"><label>Last date</label><input id="calendar-to" type="date" value="${date(to)}"></div><div class="field"><label>Daily start</label><input id="calendar-start" type="time" value="18:00"></div><div class="field"><label>Daily end</label><input id="calendar-end" type="time" value="23:00"></div><div class="field full"><label>Timezone</label><select id="calendar-zone"><option ${localZone === 'America/New_York' ? 'selected' : ''}>America/New_York</option><option ${localZone === 'Asia/Jerusalem' ? 'selected' : ''}>Asia/Jerusalem</option><option ${localZone === 'America/Los_Angeles' ? 'selected' : ''}>America/Los_Angeles</option></select></div></div>`, onSubmit: async (modal) => {
      const first = $('#calendar-from', modal).value, last = $('#calendar-to', modal).value, startTime = $('#calendar-start', modal).value, endTime = $('#calendar-end', modal).value, zone = $('#calendar-zone', modal).value;
      if (!first || !last || !startTime || !endTime) throw new Error('Complete the date range and daily hours.');
      const rows = [];
      for (let day = new Date(`${first}T12:00:00`); day <= new Date(`${last}T12:00:00`) && rows.length < 100; day.setDate(day.getDate() + 1)) {
        const dayString = date(day), windowStart = new Date(zonedDateToUtc(dayString, startTime, zone)), windowEnd = new Date(zonedDateToUtc(dayString, endTime, zone));
        if (windowEnd <= windowStart) continue;
        const busy = events.filter((event) => event.end > windowStart && event.start < windowEnd).sort((a, b) => a.start - b.start);
        let cursor = windowStart;
        for (const event of busy) {
          const gapEnd = event.start < windowEnd ? event.start : windowEnd;
          if (gapEnd - cursor >= 7200000) rows.push({season_id: app.seasonId, manager_id: app.managerId, starts_at: cursor.toISOString(), ends_at: gapEnd.toISOString(), source: 'google_freebusy', availability: 'open'});
          if (event.end > cursor) cursor = event.end; if (cursor >= windowEnd) break;
        }
        if (windowEnd - cursor >= 7200000) rows.push({season_id: app.seasonId, manager_id: app.managerId, starts_at: cursor.toISOString(), ends_at: windowEnd.toISOString(), source: 'google_freebusy', availability: 'open'});
      }
      if (!rows.length) throw new Error('No two-hour open windows were found in that range.');
      await api('availability_blocks', {method: 'POST', headers: {Prefer: 'return=minimal'}, body: JSON.stringify(rows)});
      await refreshData(); toast(`${rows.length} open windows imported.`); return true;
    }});
  }

  function keeperCost({acquisition, position, lastCost}) {
    if (acquisition === 'free_agent') return {base: 5, final: 5, potential: 5};
    const floor = position === 'RB' ? 13 : position === 'WR' ? 14 : 0;
    const median = position === 'RB' ? 27 : position === 'WR' ? 28 : 0;
    const base = Number(lastCost || 0) + 5, final = Math.max(base, floor);
    const potential = median && base < median ? Math.max(Number(lastCost || 0) + 8, floor + 8) : final;
    return {base, final, potential};
  }

  function consecutiveKeeperYears(playerId, rosterId) {
    let years = 0;
    for (const year of [2025, 2024]) {
      const season = app.history?.seasons?.find((entry) => entry.year === year);
      const pick = season?.draft_picks?.find((entry) => String(entry.player_id) === String(playerId) && String(entry.roster_id) === String(rosterId));
      if (!pick?.is_keeper) break;
      years += 1;
    }
    return years;
  }

  async function loadKeeperRoster() {
    const body = $('#keeper-roster-body'); if (!body || !app.history || !app.team) return;
    try {
      const current = app.history.seasons.find((season) => season.year === 2026), prior = app.history.seasons.find((season) => season.year === 2025);
      const roster = current?.teams?.find((team) => String(team.roster_id) === String(app.team.sleeper_team_id));
      if (!roster) throw new Error('Current roster not found.');
      const pickMap = new Map((prior?.draft_picks || []).map((pick) => [String(pick.player_id), pick]));
      const draftTime = Number(prior?.drafts?.[0]?.start_time || 0);
      const transactions = (prior?.transactions || []).filter((tx) => tx.status === 'complete').sort((a, b) => Number(a.created || 0) - Number(b.created || 0));
      app.roster = roster.players.map((player) => {
        const pick = pickMap.get(String(player.id));
        const additions = transactions.filter((tx) => tx.adds && String(tx.adds[player.id]) === String(roster.roster_id));
        const latest = additions.at(-1), postDraft = latest && Number(latest.created || 0) > draftTime;
        const acquisition = postDraft && latest.type === 'trade' ? 'trade' : postDraft && ['waiver', 'free_agent'].includes(latest.type) ? 'free_agent' : pick?.is_keeper ? 'keeper' : 'auction';
        const yearsUsed = acquisition === 'trade' || acquisition === 'free_agent' ? 0 : consecutiveKeeperYears(player.id, roster.roster_id);
        const lastCost = acquisition === 'free_agent' ? 0 : Number(pick?.metadata?.amount || 0);
        return {...player, acquisition, yearsUsed, lastCost, eligible: yearsUsed < 2, ...keeperCost({acquisition, position: player.position, lastCost})};
      }).sort((a, b) => ['QB','RB','WR','TE','K','DEF'].indexOf(a.position) - ['QB','RB','WR','TE','K','DEF'].indexOf(b.position) || a.name.localeCompare(b.name));
      renderKeepers();
    } catch (reason) {
      body.innerHTML = `<tr><td colspan="6"><div class="empty-state">${escapeHtml(reason.message)}</div></td></tr>`;
    }
  }

  function renderKeepers() {
    const search = ($('#roster-search')?.value || '').trim().toLowerCase();
    const selectedIds = new Set(app.selectedKeepers.map((player) => String(player.id)));
    const roster = app.roster.filter((player) => !search || player.name.toLowerCase().includes(search) || String(player.position).toLowerCase().includes(search));
    $('#keeper-roster-body').innerHTML = roster.length ? roster.map((player) => {
      const selected = selectedIds.has(String(player.id));
      const source = player.acquisition === 'free_agent' ? 'Waiver / free agent' : player.acquisition === 'trade' ? 'Trade · clock reset' : player.acquisition === 'keeper' ? '2025 keeper' : '2025 auction';
      const costNote = player.potential > player.final ? `Standard $${player.final}; ADP exception could be $${player.potential}` : player.acquisition === 'free_agent' ? 'Flat waiver price' : '$5 tax and position floor applied';
      const locked = app.teamBudget?.status === 'keepers_locked';
      return `<tr class="${selected ? 'is-selected' : ''}"><td><div class="player"><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.position || '—')} · ${escapeHtml(player.team || 'FA')}</small></div></td><td><b>${source}</b></td><td class="money">${player.acquisition === 'free_agent' ? '—' : `$${player.lastCost}`}</td><td><span class="eligibility ${player.eligible ? '' : 'blocked'}">${player.eligible ? `${player.yearsUsed} of 2 used` : 'Two-year limit reached'}</span></td><td><span class="money">$${player.final}</span><div class="rule-note">${costNote}</div></td><td><button class="button ${selected ? 'secondary' : 'primary'}" data-keeper-player="${player.id}" ${locked || (!player.eligible && !selected) ? 'disabled' : ''}>${selected ? 'Remove' : 'Select'}</button></td></tr>`;
    }).join('') : '<tr><td colspan="6"><div class="empty-state">No players match that search.</div></td></tr>';
    const spend = app.selectedKeepers.reduce((total, player) => total + Number(player.finalCost ?? player.final ?? 0), 0);
    $('#keeper-budget').innerHTML = `<div><span>Selected</span><strong>${app.selectedKeepers.length} / 2</strong></div><div><span>Keeper spend</span><strong>$${spend}</strong></div><div><span>Auction budget left</span><strong>$${200 - spend}</strong></div>`;
    const lockButton = $('#keeper-lock-button');
    if (lockButton) { const locked = app.teamBudget?.status === 'keepers_locked'; lockButton.textContent = locked ? 'Keepers locked ✓' : 'Lock keeper choices'; lockButton.disabled = locked; }
  }

  async function toggleKeeper(playerId) {
    const player = app.roster.find((entry) => String(entry.id) === String(playerId)); if (!player) return;
    const index = app.selectedKeepers.findIndex((entry) => String(entry.id) === String(playerId));
    if (index >= 0) app.selectedKeepers.splice(index, 1);
    else {
      if (app.selectedKeepers.length >= 2) return toast('You can select at most two keepers.');
      if (!player.eligible) return toast(`${player.name} has used the full two-year keeper clock.`);
      app.selectedKeepers.push({id: player.id, name: player.name, position: player.position, acquisition: player.acquisition, yearsUsed: player.yearsUsed, lastCost: player.lastCost, baseCost: player.base, finalCost: player.final});
    }
    localStorage.setItem(keeperStorageKey(), JSON.stringify(app.selectedKeepers)); renderKeepers();
    await saveKeepers();
  }

  async function saveKeepers() {
    if (!app.teamId || !app.ownership.length) { toast('Keeper draft saved here. The commissioner still needs to sync roster ownership.'); return; }
    try {
      const selections = app.selectedKeepers.map((keeper) => {
        const ownership = app.ownership.find((row) => String(row.players?.id) === String(keeper.id) || row.players?.name === keeper.name);
        if (!ownership) throw new Error(`${keeper.name} is missing from the roster sync.`);
        return {ownership_history_id: ownership.id, last_cost_usd: keeper.lastCost, acquisition_type: keeper.acquisition === 'free_agent' ? 'free_agent' : 'auction', adp_usd: null, base_cost_usd: keeper.baseCost, final_cost_usd: keeper.finalCost, keeper_year_number: Math.min(2, Number(keeper.yearsUsed) + 1), eligibility_reason: keeper.acquisition === 'trade' ? 'Trade reset the keeper clock' : 'Validated from Sleeper draft and transaction history'};
      });
      await api('rpc/save_keeper_selections', {method: 'POST', body: JSON.stringify({target_season: app.seasonId, target_team: app.teamId, selections})});
      await refreshData(); toast('Keeper choices saved to the league.');
    } catch (reason) { toast(reason.message || 'Keeper choices could not be synced.'); }
  }

  async function lockKeepers() {
    if (app.teamBudget?.status === 'keepers_locked') return;
    const names = app.selectedKeepers.length ? app.selectedKeepers.map((keeper) => keeper.name).join(' and ') : 'no players';
    if (!confirm(`Lock ${names} as your final keeper decision? Only the commissioner can reopen it.`)) return;
    try { await api('rpc/lock_keeper_selections', {method: 'POST', body: JSON.stringify({target_season: app.seasonId, target_team: app.teamId})}); await refreshData(); toast('Keeper decision locked.'); }
    catch (reason) { toast(reason.message || 'Keeper decision could not be locked.'); }
  }

  function renderVotes() {
    const root = $('#proposal-list');
    if (!app.proposals.length) { root.innerHTML = '<article class="panel"><div class="empty-state">No league proposals yet.</div></article>'; return; }
    root.innerHTML = app.proposals.map((proposal) => {
      const votes = app.votes.filter((vote) => vote.proposal_id === proposal.id), yes = votes.filter((vote) => vote.choice === 'yes').length, no = votes.filter((vote) => vote.choice === 'no').length, mine = votes.find((vote) => vote.manager_id === app.managerId)?.choice;
      const emailStatus = proposal.alert_sent_at ? `Email sent to ${proposal.alert_recipient_count || 0}` : proposal.alert_error ? 'Email needs retry' : 'Email pending';
      return `<article class="panel proposal-card"><div class="proposal-meta"><span class="status">${escapeHtml(proposal.category)}</span><span class="status ${['open', 'passed'].includes(proposal.status) ? 'success' : ''}">${escapeHtml(proposal.status)}</span><span class="status ${proposal.alert_error ? 'warning' : ''}">${escapeHtml(emailStatus)}</span></div><h3>${escapeHtml(proposal.title)}</h3><p>${escapeHtml(proposal.description || proposal.proposed_value || '')}</p>${proposal.proposed_value ? `<p style="margin-top:8px"><b>${escapeHtml(proposal.current_value || 'Current')}</b> → <b>${escapeHtml(proposal.proposed_value)}</b></p>` : ''}<div class="vote-tally"><div class="vote-count"><span>Yes · ${proposal.required_yes_votes || 7} needed</span><strong>${yes}</strong></div><div class="vote-count"><span>No</span><strong>${no}</strong></div></div>${proposal.status === 'open' ? `<div class="proposal-actions"><button class="button ${mine === 'yes' ? 'primary' : 'secondary'}" data-vote="${proposal.id}" data-choice="yes">Vote yes</button><button class="button ${mine === 'no' ? 'primary' : 'secondary'}" data-vote="${proposal.id}" data-choice="no">Vote no</button></div>` : ''}${proposal.alert_error && proposal.author_manager_id === app.managerId ? `<button class="text-button proposal-retry" data-retry-alert="${proposal.id}">Retry email alert</button>` : ''}</article>`;
    }).join('');
  }

  function proposalModal() {
    openModal({title: 'New league proposal', copy: 'A standard rule change passes with seven yes votes.', submitLabel: 'Open voting', body: `<div class="form-grid"><div class="field full"><label>Title</label><input id="proposal-title" placeholder="Increase the buy-in" required></div><div class="field"><label>Category</label><select id="proposal-category"><option value="finance">Finance</option><option value="keeper">Keeper</option><option value="scoring">Scoring</option><option value="draft">Draft</option><option value="punishment">Punishment</option><option value="other">Other</option></select></div><div class="field"><label>Effective season</label><input id="proposal-season" type="number" value="2027"></div><div class="field"><label>Current value</label><input id="proposal-current" placeholder="₪350"></div><div class="field"><label>Proposed value</label><input id="proposal-value" placeholder="₪400"></div><div class="field full"><label>Reason</label><textarea id="proposal-description" placeholder="Explain why the league should make this change"></textarea></div></div>`, onSubmit: async (modal) => {
      const title = $('#proposal-title', modal).value.trim(), description = $('#proposal-description', modal).value.trim(); if (!title) throw new Error('Add a proposal title.');
      const created = await api('proposals', {method: 'POST', headers: {Prefer: 'return=representation'}, body: JSON.stringify({season_id: app.seasonId, author_manager_id: app.managerId, title, description: description || title, category: $('#proposal-category', modal).value, current_value: $('#proposal-current', modal).value.trim() || null, proposed_value: $('#proposal-value', modal).value.trim() || null, effective_season: Number($('#proposal-season', modal).value) || 2027, required_yes_votes: 7, status: 'open'})});
      let notice = 'Proposal opened for voting.';
      try { const alert = await invokeFunction('send-proposal-alert', {proposalId: created?.[0]?.id}); notice = `Proposal opened · ${alert.sent} email alert${alert.sent === 1 ? '' : 's'} sent.`; }
      catch { notice = 'Proposal opened. Email delivery needs a retry.'; }
      await refreshData(); toast(notice); return true;
    }});
  }

  async function castVote(proposalId, choice) {
    await api('votes?on_conflict=proposal_id,manager_id', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'}, body: JSON.stringify({proposal_id: proposalId, manager_id: app.managerId, choice})});
    await refreshData(); toast('Vote recorded.');
  }

  function renderMoney() {
    const obligations = app.isCommissioner ? app.obligations : app.obligations.filter((row) => row.manager_id === app.managerId);
    const ledger = $('#money-ledger');
    if (!obligations.length) { ledger.innerHTML = '<div class="empty-state">No 2026 obligations have been opened yet.</div>'; return; }
    ledger.innerHTML = obligations.map((obligation) => {
      const settlement = app.settlements.find((row) => row.obligation_id === obligation.id && row.payer_manager_id === obligation.manager_id);
      const status = settlement?.status || 'unpaid';
      return `<div class="data-row"><div><b>${escapeHtml(managerName(obligation.manager_id))} · ${escapeHtml(obligation.description)}</b><small>Due ${obligation.due_at ? new Date(obligation.due_at).toLocaleDateString() : 'before draft'}${settlement ? ` · ${settlement.payment_currency} ${settlement.payment_amount}${settlement.payment_method ? ` via ${escapeHtml(settlement.payment_method)}` : ''} credited as ₪${Number(settlement.credited_nis).toFixed(2)}${settlement.payment_reference ? ` · ref ${escapeHtml(settlement.payment_reference)}` : ''}` : ''}</small></div><div class="row-actions"><span class="money">₪${Number(obligation.amount_nis).toFixed(0)}</span><span class="status ${status === 'confirmed' ? 'success' : status === 'rejected' ? 'danger' : 'warning'}">${status}</span>${app.isCommissioner && status === 'submitted' ? `<button class="button secondary" data-settlement="${settlement.id}" data-status="confirmed">Confirm</button>` : ''}</div></div>`;
    }).join('');
  }

  async function recordPaymentModal() {
    const mine = app.obligations.filter((row) => row.manager_id === app.managerId);
    if (!mine.length) return toast('The commissioner has not opened your 2026 obligation yet.');
    let market = null;
    try { market = await invokeFunction('exchange-rate', {}); } catch { /* manual entry remains available */ }
    const rateCopy = market?.rate ? `Bank of Israel representative rate: ${Number(market.rate).toFixed(4)} NIS/USD, updated ${new Date(market.lastUpdated).toLocaleDateString()}. You may replace it with the rate the league agreed to use.` : 'Enter the NIS-per-USD rate the league agreed to use.';
    openModal({title: 'Record payment', copy: `The obligation remains in NIS. ${rateCopy}`, submitLabel: 'Submit payment', body: `<div class="form-grid"><div class="field full"><label>Obligation</label><select id="payment-obligation">${mine.map((row) => `<option value="${row.id}">${escapeHtml(row.description)} · ₪${Number(row.amount_nis).toFixed(0)}</option>`).join('')}</select></div><div class="field"><label>Currency paid</label><select id="payment-currency"><option>NIS</option><option>USD</option></select></div><div class="field"><label>Amount paid</label><input id="payment-amount" type="number" min="0" step=".01" required></div><div class="field"><label>Payment method</label><select id="payment-method"><option value="Bank transfer">Bank transfer</option><option value="Bit">Bit</option><option value="PayBox">PayBox</option><option value="Cash">Cash</option><option value="Other">Other</option></select></div><div class="field"><label>Reference (optional)</label><input id="payment-reference" placeholder="Transfer note or last four"></div><div class="field full"><label>NIS per USD</label><input id="payment-rate" type="number" min="0" step=".0001" value="${market?.rate || ''}" placeholder="e.g. 2.9540"></div></div>`, onSubmit: async (modal) => {
      const obligation = mine.find((row) => row.id === $('#payment-obligation', modal).value), currency = $('#payment-currency', modal).value, amount = Number($('#payment-amount', modal).value), rate = Number($('#payment-rate', modal).value);
      if (!obligation || !amount) throw new Error('Choose an obligation and enter the amount paid.'); if (currency === 'USD' && !rate) throw new Error('Enter the NIS-per-USD rate.');
      const existing = app.settlements.find((row) => row.obligation_id === obligation.id && row.payer_manager_id === app.managerId);
      if (existing) throw new Error('A payment is already recorded for this obligation. Ask the commissioner before changing it.');
      await api('rpc/submit_settlement', {method: 'POST', body: JSON.stringify({target_obligation: obligation.id, paid_currency: currency, paid_amount: amount, nis_per_usd: currency === 'USD' ? rate : null, paid_method: $('#payment-method', modal).value, paid_reference: $('#payment-reference', modal).value.trim() || null})});
      await refreshData(); toast('Payment submitted for commissioner confirmation.'); return true;
    }});
  }

  function openObligationsModal() {
    const defaultRecipient = app.managerId;
    openModal({title: 'Open 2026 buy-ins', copy: 'Creates one canonical NIS obligation for every manager. Do this once after the buy-in vote is final.', submitLabel: 'Open 12 obligations', body: `<div class="form-grid"><div class="field"><label>Amount per manager</label><input id="obligation-amount" type="number" value="350"></div><div class="field"><label>Due date</label><input id="obligation-due" type="date"></div><div class="field full"><label>Recipient</label><select id="obligation-recipient">${app.managers.map((manager) => `<option value="${manager.id}" ${manager.id === defaultRecipient ? 'selected' : ''}>${escapeHtml(manager.display_name)}</option>`).join('')}</select></div></div>`, onSubmit: async (modal) => {
      if (app.obligations.some((row) => row.kind === 'buy_in')) throw new Error('Buy-in obligations already exist for 2026.');
      const amount = Number($('#obligation-amount', modal).value), due = $('#obligation-due', modal).value, recipient = $('#obligation-recipient', modal).value; if (!amount || !recipient) throw new Error('Enter an amount and recipient.');
      const rows = app.managers.map((manager) => ({season_id: app.seasonId, manager_id: manager.id, kind: 'buy_in', description: '2026 league buy-in', amount_nis: amount, due_at: due ? new Date(`${due}T23:59:59Z`).toISOString() : null, recipient_manager_id: recipient}));
      await api('league_obligations', {method: 'POST', headers: {Prefer: 'return=minimal'}, body: JSON.stringify(rows)}); await refreshData(); toast('Buy-in obligations opened.'); return true;
    }});
  }

  function renderRules() {
    const current = app.history?.seasons?.find((season) => season.year === 2026);
    const settings = current?.settings || {};
    const scoring = current?.scoring_settings || {};
    const rules = [
      ['Keeper limit', 'Maximum two keepers. There are no positional limits.', ['A player can be kept for two additional seasons by the same team.', 'A traded player starts a new keeper clock with the acquiring team.']],
      ['Keeper prices', 'Auction players and prior keepers cost last year’s price plus $5.', ['RB floor: $13', 'WR floor: $14', 'QB, TE, K, and DEF have no floor.', 'Waiver and free-agent keepers cost a flat $5.']],
      ['ADP exception', 'For RB/WR only, if market ADP is above the positional median while the base price is below it, use the greater of last cost + $8 or floor + $8.', ['RB median: $27', 'WR median: $28']],
      ['Auction', 'Each team starts with a $200 fantasy-dollar budget. Keeper costs are deducted before the auction.', ['All non-keepers return to the draft pool.', 'Auction dollars never mix with league payments.']],
      ['League money', 'Buy-ins, weekly prizes, and payouts are denominated in NIS.', ['Current buy-in: ₪350', 'Weekly high score: ₪45 including playoffs', 'USD settlement is allowed at a recorded exchange rate.']],
      ['2025 payout baseline', 'The historical workbook records the prior distribution.', ['First: ₪2,100', 'Second: ₪980', 'Third: ₪350']],
      ['League format', `${settings.num_teams || 12} teams; ${settings.playoff_teams || 6} reach the playoffs starting in Week ${settings.playoff_week_start || 15}.`, [`Trade deadline: Week ${settings.trade_deadline || 12}`, `FAAB waiver budget: $${settings.waiver_budget || 100}`, 'Two IR slots', 'Draft-pick trading is enabled.']],
      ['Starting lineup', 'Fifteen active roster spots plus two IR slots.', ['1 QB', '2 RB', '2 WR', '1 TE', '1 FLEX', '1 K', '1 DEF', '6 bench']],
      ['Core scoring', 'Sleeper scoring is the source of truth.', [`Half-PPR: ${Number(scoring.rec ?? .5)} per reception`, `Passing TD: ${Number(scoring.pass_td ?? 4)} points`, 'Rushing / receiving TD: 6 points', '1 point per 25 passing yards', '1 point per 10 rushing or receiving yards', 'Turnover lost: −2 points']],
    ];
    $('#rule-grid').innerHTML = rules.map(([title, description, list]) => `<article class="panel rule-card"><span class="kicker">Rule</span><h3>${title}</h3><p>${description}</p><ul class="rule-list">${list.map((item) => `<li>${item}</li>`).join('')}</ul></article>`).join('');
  }

  function championFor(season) { const winner = season.teams?.find((team) => String(team.roster_id) === String(season.winner_roster_id)); return winner?.team_name || 'Not recorded'; }

  function renderHistory() {
    const seasons = app.history?.seasons || []; const completed = seasons.filter((season) => season.year < 2026); const transactions = seasons.reduce((sum, season) => sum + (season.transactions?.length || 0), 0); const picks = seasons.reduce((sum, season) => sum + (season.draft_picks?.length || 0), 0);
    $('#history-metrics').innerHTML = [['Seasons imported', seasons.length, '2024–2026'], ['Draft picks', picks, 'Auction history'], ['Transactions', transactions, 'Waivers and trades'], ['2025 champion', completed.length ? championFor(completed.sort((a,b) => b.year-a.year)[0]) : '—', 'Sleeper result']].map(([label, value, note]) => `<article class="metric"><span>${label}</span><strong>${escapeHtml(value)}</strong><small>${note}</small></article>`).join('');
    $('#season-history').innerHTML = seasons.slice().sort((a, b) => b.year - a.year).map((season) => { const top = [...(season.teams || [])].sort((a,b) => Number(b.wins || 0) - Number(a.wins || 0) || Number(b.points || 0) - Number(a.points || 0))[0]; return `<div class="data-row"><div><b>${season.year} · ${championFor(season)}</b><small>${season.year === 2026 ? 'Rollover season in setup' : `${top?.team_name || 'Top team'} · ${top?.wins || 0}–${top?.losses || 0}`} · ${season.transactions?.length || 0} transactions</small></div><span class="status ${season.year < 2026 ? 'success' : 'warning'}">${season.year < 2026 ? 'Complete' : 'Setup'}</span></div>`; }).join('');
  }

  function renderTeams() {
    const current = app.history?.seasons?.find((season) => season.year === 2026), prior = app.history?.seasons?.find((season) => season.year === 2025);
    const priorByRoster = new Map((prior?.teams || []).map((team) => [String(team.roster_id), team]));
    $('#team-grid').innerHTML = (current?.teams || []).map((team) => { const old = priorByRoster.get(String(team.roster_id)); return `<article class="panel team-card"><span class="kicker">${escapeHtml(team.display_name || 'Manager')}</span><h3>${escapeHtml(team.team_name)}</h3><p>${team.players?.length || 0} players on the 2026 rollover roster</p><div class="team-stats"><span><b>${old?.wins || 0}–${old?.losses || 0}</b>2025 record</span><span><b>${Number(old?.points || 0).toFixed(1)}</b>points</span></div></article>`; }).join('');
  }

  function renderHelp() {
    const cards = [
      ['Start here', 'Sign in with your email, then choose the manager identity and team you control. Team assignments are locked; ask Lee before claiming the wrong entry.', ['If you are replacing someone, wait for the commissioner to update the manager identity.', 'Your availability, keepers, votes, and payments stay in the league database.']],
      ['Draft time', 'Open Draft time and add as many windows as possible across multiple days.', ['Google Calendar reads busy/free time only.', 'Outlook can be imported from an .ics file.', 'Manual entry supports a date range, selected weekdays, timezone, and Open / Possible / Unavailable.']],
      ['Keepers', 'Review every roster player, calculated keeper cost, and keeper clock before locking your choices.', ['Select no more than two players.', 'A player can be kept for two additional seasons.', 'A trade starts a new keeper clock for the acquiring team.']],
      ['Money and votes', 'Money is tracked in shekels; auction values are separate fantasy dollars.', ['Record NIS payments or the USD equivalent with the agreed exchange rate.', 'Vote on buy-ins, payouts, scoring, keeper, draft, or other rule changes.', 'Seven yes votes passes a standard proposal.']],
      ['Sleeper data', 'League HQ imports Sleeper rosters, standings, drafts, transactions, matchups, and history for reference.', ['Sleeper remains the official source for lineups, trades, waivers, and draft results.', 'The Sleeper API is read-only, so League HQ does not write changes back to Sleeper.']],
      ['During the season', 'Use the record book and teams directory to review history, rosters, standings, draft prices, and league records.', ['If data looks wrong, tell Lee and identify the season, team, or player.', 'Do not create a second account or claim another manager’s team.']],
    ];
    $('#help-grid').innerHTML = cards.map(([title, description, list]) => `<article class="panel rule-card"><span class="kicker">Guide</span><h3>${title}</h3><p>${description}</p><ul class="rule-list">${list.map((item) => `<li>${item}</li>`).join('')}</ul></article>`).join('');
  }

  function renderAll() { renderDashboard(); renderDraft(); renderKeepers(); renderVotes(); renderMoney(); renderRules(); renderHistory(); renderTeams(); renderHelp(); }

  async function refreshData() { if (await hydrateMember()) showApp(); }

  async function selectDraftWindow(index) {
    const window = rankedWindows()[index]; if (!window) return;
    try { await api('rpc/select_draft_time', {method: 'POST', body: JSON.stringify({target_season: app.seasonId, draft_start: window.start, draft_end: window.end, available_count: window.open, possible_count: window.possible})}); await refreshData(); toast('Draft time selected.'); }
    catch (reason) { toast(reason.message || 'Draft time could not be selected.'); }
  }

  async function importRosters() {
    if (!app.isCommissioner || !app.history) return;
    try {
      const current = app.history.seasons.find((season) => season.year === 2026), prior = app.history.seasons.find((season) => season.year === 2025), pickMap = new Map((prior?.draft_picks || []).map((pick) => [String(pick.player_id), Number(pick.metadata?.amount) || null]));
      const snapshot = {teams: current.teams.map((team) => ({team_name: team.team_name.trim(), players: team.players.map((player) => ({id: String(player.id), name: player.name, position: player.position, team: player.team, auction_cost_usd: pickMap.get(String(player.id)) ?? null, keeper_years_used: consecutiveKeeperYears(player.id, team.roster_id)}))}))};
      const result = await api('rpc/import_rollover_snapshot', {method: 'POST', body: JSON.stringify({target_season: app.seasonId, snapshot})}); await refreshData(); toast(`Rosters synced · ${result?.ownership_rows_added || 0} ownership rows added.`);
    } catch (reason) { toast(reason.message || 'Roster sync failed.'); }
  }

  async function releaseTeam(teamId) {
    if (!confirm('Release this team from its current email? The manager will need to enter their email and claim it again.')) return;
    try { await api('rpc/admin_release_team', {method: 'POST', body: JSON.stringify({target_team: teamId})}); await refreshData(); toast('Team released.'); }
    catch (reason) { toast(reason.message || 'Team could not be released.'); }
  }

  function loadLocalPreview() {
    const current = app.history?.seasons?.find((season) => season.year === 2026);
    const florida = current?.teams?.find((team) => team.team_name === 'Florida Men') || current?.teams?.[0];
    app.seasonId = 'preview-season'; app.managerId = 'preview-manager'; app.teamId = 'preview-team';
    app.manager = {id: app.managerId, display_name: 'Lee'};
    app.team = {id: app.teamId, display_name: florida?.team_name || 'Florida Men', sleeper_team_id: String(florida?.roster_id || 1)};
    app.isCommissioner = true;
    app.managers = (current?.teams || []).map((team, index) => ({id: index ? `manager-${index}` : app.managerId, display_name: team.display_name || team.team_name, auth_user_id: index < 9 ? `user-${index}` : null}));
    app.memberships = (current?.teams || []).map((team, index) => ({team_id: index ? `team-${index}` : app.teamId, manager_id: index ? `manager-${index}` : app.managerId, teams: {display_name: team.team_name, sleeper_team_id: String(team.roster_id)}, managers: app.managers[index]}));
    const sampleDate = new Date(Date.now() + 5 * 86400000); sampleDate.setUTCHours(23, 0, 0, 0);
    app.blocks = app.managers.slice(0, 7).map((manager, index) => ({id: `block-${index}`, manager_id: manager.id, starts_at: new Date(sampleDate.getTime() + (index % 2) * 1800000).toISOString(), ends_at: new Date(sampleDate.getTime() + 4 * 3600000).toISOString(), availability: index === 6 ? 'possible' : 'open', managers: {display_name: manager.display_name}}));
    app.proposals = [{id: 'proposal-1', title: 'Increase the 2027 buy-in', description: 'Move the annual buy-in from ₪350 to ₪400.', category: 'finance', current_value: '₪350', proposed_value: '₪400', status: 'open'}];
    app.votes = app.managers.slice(0, 6).map((manager, index) => ({proposal_id: 'proposal-1', manager_id: manager.id, choice: index < 5 ? 'yes' : 'no'}));
    app.allKeeperSelections = []; app.keeperSelections = []; app.obligations = []; app.settlements = []; app.draftOptions = []; app.email = 'clarityce@gmail.com';
  }

  async function initialize() {
    renderRules();
    await loadHistory().catch((reason) => toast(reason.message));
    if (['127.0.0.1', 'localhost'].includes(location.hostname) && new URLSearchParams(location.search).has('preview')) {
      loadLocalPreview(); showApp(); return;
    }
    if (!app.session?.access_token || !app.email) return showAuth();
    try {
      if (!await hydrateMember()) return showTeamGate();
      showApp();
    } catch {
      if (await refreshSession()) {
        try { if (!await hydrateMember()) return showTeamGate(); showApp(); return; } catch {}
      }
      clearSession(); showAuth();
    }
  }

  $('#email-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget, input = $('#email-input'), error = $('#email-error'), button = $('#email-form button[type="submit"]'); error.textContent = ''; button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Entering league'; form.classList.add('is-submitting');
    try { await enterLeague(input.value); if (!await hydrateMember()) await showTeamGate(); else showApp(); }
    catch (reason) { error.textContent = reason.message || 'Could not enter the league.'; input.setAttribute('aria-invalid', 'true'); input.focus(); }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = 'Continue'; form.classList.remove('is-submitting'); }
  });

  $('#email-input').addEventListener('input', (event) => {
    event.currentTarget.removeAttribute('aria-invalid');
    $('#email-error').textContent = '';
  });

  document.addEventListener('click', async (event) => {
    const viewButton = event.target.closest('[data-view],[data-go]'); if (viewButton) return switchView(viewButton.dataset.view || viewButton.dataset.go);
    const teamButton = event.target.closest('[data-claim-team]'); if (teamButton) return claimTeam(teamButton.dataset.claimTeam, teamButton);
    const keeperButton = event.target.closest('[data-keeper-player]'); if (keeperButton) return toggleKeeper(keeperButton.dataset.keeperPlayer);
    const voteButton = event.target.closest('[data-vote]'); if (voteButton) return castVote(voteButton.dataset.vote, voteButton.dataset.choice).catch((reason) => toast(reason.message));
    const deleteBlock = event.target.closest('[data-delete-block]'); if (deleteBlock) { try { await api(`availability_blocks?id=eq.${deleteBlock.dataset.deleteBlock}`, {method: 'DELETE'}); await refreshData(); toast('Availability removed.'); } catch (reason) { toast(reason.message); } return; }
    const selectDraft = event.target.closest('[data-select-draft]'); if (selectDraft) return selectDraftWindow(Number(selectDraft.dataset.selectDraft));
    const release = event.target.closest('[data-release-team]'); if (release) return releaseTeam(release.dataset.releaseTeam);
    const editManager = event.target.closest('[data-edit-manager]'); if (editManager) return editManagerModal(editManager.dataset.editManager);
    const reopen = event.target.closest('[data-reopen-team]'); if (reopen) { try { await api('rpc/reopen_keeper_selections', {method: 'POST', body: JSON.stringify({target_season: app.seasonId, target_team: reopen.dataset.reopenTeam})}); await refreshData(); toast('Keeper choices reopened.'); } catch (reason) { toast(reason.message || 'Keeper choices could not be reopened.'); } return; }
    const settlement = event.target.closest('[data-settlement]'); if (settlement) { try { await api(`settlements?id=eq.${settlement.dataset.settlement}`, {method: 'PATCH', body: JSON.stringify({status: settlement.dataset.status, confirmed_at: new Date().toISOString()})}); await refreshData(); toast('Payment confirmed.'); } catch (reason) { toast(reason.message); } return; }
    const retryAlert = event.target.closest('[data-retry-alert]'); if (retryAlert) { try { const result = await invokeFunction('send-proposal-alert', {proposalId: retryAlert.dataset.retryAlert}); await refreshData(); toast(`${result.sent} email alert${result.sent === 1 ? '' : 's'} sent.`); } catch (reason) { toast(reason.message || 'Email alert could not be sent.'); } return; }
    const calendar = event.target.closest('[data-calendar]'); if (calendar) { app.calendarProvider = calendar.dataset.calendar; $('#calendar-file').click(); return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'manual-availability') manualAvailabilityModal();
    if (action === 'google-calendar') calendarWindowModal({provider: 'Google Calendar', loadEvents: googleBusyEvents});
    if (action === 'new-proposal') proposalModal();
    if (action === 'record-payment') recordPaymentModal();
    if (action === 'open-obligations') openObligationsModal();
    if (action === 'sync-rosters') importRosters();
    if (action === 'lock-keepers') lockKeepers();
    if (action === 'copy-invite') navigator.clipboard?.writeText(location.origin + location.pathname).then(() => toast('League link copied.'));
  });

  $('#calendar-file').addEventListener('change', async (event) => { const file = event.target.files?.[0]; if (!file) return; calendarImportModal(app.calendarProvider, parseIcs(await file.text())); event.target.value = ''; });
  $('#roster-search').addEventListener('input', renderKeepers);
  $('#mobile-menu').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#team-sign-out').addEventListener('click', () => { clearSession(); location.reload(); });
  $('#identity-button').addEventListener('click', () => openModal({title: 'League account', copy: `Signed in as ${escapeHtml(app.email)} for ${escapeHtml(app.team?.display_name || 'your team')}.`, submitLabel: 'Sign out', body: '<p class="modal-copy">Your team assignment, votes, availability, and keeper choices stay in the league database.</p>', onSubmit: async () => { clearSession(); location.reload(); return true; }}));

  initialize();
})();
