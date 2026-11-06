-- Additive only: retain all existing SONA participants, gameplay and submissions.
alter table public.withdrawal_participants
  add column if not exists recruitment jsonb;

comment on column public.withdrawal_participants.recruitment is
  'Recruitment platform, fixed cohort, and Prolific study/submission IDs per wave.';

notify pgrst, 'reload schema';
