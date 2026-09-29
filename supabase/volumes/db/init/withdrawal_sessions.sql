create table if not exists public.withdrawal_participants (
  participant_id text primary key,
  condition text not null check (condition in ('control', 'advisor', 'judge')),
  current_session integer not null default 1 check (current_session between 1 and 4),
  next_session_available_at timestamptz,
  completed_at timestamptz,
  completed_sessions jsonb not null default '[]'::jsonb,
  credited_parts jsonb not null default '[]'::jsonb,
  game_state jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.withdrawal_participants
  add column if not exists completed_sessions jsonb not null default '[]'::jsonb;

alter table public.withdrawal_participants
  add column if not exists credited_parts jsonb not null default '[]'::jsonb;

alter table public.withdrawal_participants enable row level security;

revoke all on table public.withdrawal_participants from anon, authenticated;
grant all on table public.withdrawal_participants to service_role;

comment on table public.withdrawal_participants is
  'Server-managed longitudinal state for the four-session AI withdrawal experiment.';

create table if not exists public.withdrawal_events (
  id bigint generated always as identity primary key,
  participant_id text not null references public.withdrawal_participants(participant_id),
  session_number integer not null check (session_number between 1 and 4),
  round_number integer check (round_number between 1 and 4),
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  client_timestamp timestamptz,
  server_timestamp timestamptz not null default now()
);

create index if not exists withdrawal_events_participant_idx
  on public.withdrawal_events (participant_id, session_number, server_timestamp);

alter table public.withdrawal_events enable row level security;
revoke all on table public.withdrawal_events from anon, authenticated;
grant all on table public.withdrawal_events to service_role;
grant usage, select on sequence public.withdrawal_events_id_seq to service_role;
