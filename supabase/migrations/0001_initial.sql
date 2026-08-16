create extension if not exists pgcrypto;

create type public.season_status as enum ('setup', 'active', 'complete');
create type public.proposal_status as enum ('draft', 'open', 'passed', 'failed', 'withdrawn');
create type public.vote_choice as enum ('yes', 'no', 'abstain');
create type public.payment_currency as enum ('NIS', 'USD');
create type public.obligation_kind as enum ('buy_in', 'weekly_high_score', 'prize', 'side_pot', 'other');
create type public.settlement_status as enum ('pending', 'submitted', 'confirmed', 'rejected');

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  year int not null unique,
  name text not null,
  status public.season_status not null default 'setup',
  canonical_currency public.payment_currency not null default 'NIS',
  buy_in_nis numeric(12,2),
  weekly_high_score_nis numeric(12,2),
  usd_nis_rate numeric(12,6),
  usd_rate_locked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.managers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null,
  sleeper_username text,
  timezone text,
  preferred_payment_currency public.payment_currency,
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  sleeper_team_id text,
  created_at timestamptz not null default now()
);

create table public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  manager_id uuid not null references public.managers(id) on delete cascade,
  is_commissioner boolean not null default false,
  unique (season_id, team_id),
  unique (season_id, manager_id)
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  sleeper_player_id text unique,
  name text not null,
  position text,
  nfl_team text,
  created_at timestamptz not null default now()
);

-- Each acquisition starts a keeper clock. A trade creates a new row with a new current team.
create table public.player_ownership_history (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  acquired_from_team_id uuid references public.teams(id) on delete set null,
  acquisition_type text not null check (acquisition_type in ('auction', 'waiver', 'free_agent', 'trade', 'rollover')),
  acquisition_season int not null,
  auction_cost_usd numeric(12,2),
  keeper_clock_start_season int not null,
  keeper_years_used int not null default 0 check (keeper_years_used between 0 and 2),
  traded_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.keeper_rules (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  max_keepers int not null default 2,
  max_keeper_years int not null default 2,
  keeper_tax_usd numeric(12,2) not null default 5,
  rb_floor_usd numeric(12,2),
  wr_floor_usd numeric(12,2),
  non_rb_wr_minimum_applies boolean not null default false,
  trade_resets_clock boolean not null default true,
  effective_from_season int not null,
  notes text,
  unique (season_id)
);

create table public.keeper_selections (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  ownership_history_id uuid not null references public.player_ownership_history(id) on delete restrict,
  base_cost_usd numeric(12,2) not null,
  final_cost_usd numeric(12,2) not null,
  keeper_year_number int not null check (keeper_year_number between 1 and 2),
  eligible boolean not null default true,
  eligibility_reason text,
  created_at timestamptz not null default now(),
  unique (season_id, team_id, player_id)
);

create table public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  manager_id uuid not null references public.managers(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source text not null default 'manual' check (source in ('manual', 'google_freebusy')),
  availability text not null default 'open' check (availability in ('open', 'possible', 'unavailable')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.draft_options (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  available_manager_count int not null default 0,
  possible_manager_count int not null default 0,
  score numeric(12,4) not null default 0,
  selected boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  author_manager_id uuid references public.managers(id) on delete set null,
  title text not null,
  description text not null,
  category text not null check (category in ('finance', 'keeper', 'scoring', 'draft', 'punishment', 'other')),
  current_value text,
  proposed_value text,
  effective_season int,
  required_yes_votes int not null default 7,
  deadline timestamptz,
  status public.proposal_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  manager_id uuid not null references public.managers(id) on delete cascade,
  choice public.vote_choice not null,
  comment text,
  created_at timestamptz not null default now(),
  unique (proposal_id, manager_id)
);

create table public.league_obligations (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  manager_id uuid not null references public.managers(id) on delete cascade,
  kind public.obligation_kind not null,
  description text not null,
  amount_nis numeric(12,2) not null,
  due_at timestamptz,
  recipient_manager_id uuid references public.managers(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.league_obligations(id) on delete cascade,
  payer_manager_id uuid not null references public.managers(id) on delete cascade,
  recipient_manager_id uuid not null references public.managers(id) on delete cascade,
  payment_currency public.payment_currency not null,
  payment_amount numeric(12,2) not null,
  exchange_rate_nis_per_usd numeric(12,6),
  credited_nis numeric(12,2) not null,
  status public.settlement_status not null default 'pending',
  paid_at timestamptz,
  confirmed_at timestamptz,
  confirmation_note text,
  created_at timestamptz not null default now(),
  check ((payment_currency = 'NIS' and exchange_rate_nis_per_usd is null) or payment_currency = 'USD')
);

create table public.awards (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  manager_id uuid references public.managers(id) on delete set null,
  award_type text not null,
  week int,
  title text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.season_records (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  manager_id uuid references public.managers(id) on delete set null,
  record_type text not null,
  value numeric(12,2),
  value_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index on public.team_memberships (season_id);
create index on public.player_ownership_history (season_id, player_id, team_id);
create index on public.keeper_selections (season_id, team_id);
create index on public.availability_blocks (season_id, manager_id, starts_at);
create index on public.votes (proposal_id);
create index on public.league_obligations (season_id, manager_id);
create index on public.settlements (obligation_id, status);
