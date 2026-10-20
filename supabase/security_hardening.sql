-- Apply after cloud_setup.sql, while participant collection is stopped.
begin;
update storage.buckets set public = false where id = 'revisit';

create table if not exists public.study_researchers (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.withdrawal_participant_access (
  participant_id text primary key references public.withdrawal_participants(participant_id),
  user_id uuid not null references auth.users(id) on delete cascade
);
alter table public.study_researchers enable row level security;
alter table public.withdrawal_participant_access enable row level security;
revoke all on public.study_researchers, public.withdrawal_participant_access from anon, authenticated;
grant select on public.study_researchers to authenticated;
grant all on public.study_researchers, public.withdrawal_participant_access to service_role;
drop policy if exists researcher_self on public.study_researchers;
create policy researcher_self on public.study_researchers for select to authenticated using (user_id = auth.uid());

create or replace function public.is_study_researcher() returns boolean
language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.study_researchers where user_id = auth.uid()) $$;

create or replace function public.owns_study_participant(participant text) returns boolean
language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.withdrawal_participant_access where participant_id = participant and user_id = auth.uid()) $$;

revoke all on function public.is_study_researcher(), public.owns_study_participant(text) from public;
grant execute on function public.is_study_researcher(), public.owns_study_participant(text) to authenticated;

drop policy if exists allow_revisit_read_write on public.revisit;
revoke all on public.revisit from anon, authenticated;
grant select, insert, update, delete on public.revisit to authenticated;
drop policy if exists secured_revisit_admin on public.revisit;
create policy secured_revisit_admin on public.revisit for all to authenticated
using (public.is_study_researcher()) with check (public.is_study_researcher());
drop policy if exists secured_revisit_read on public.revisit;
create policy secured_revisit_read on public.revisit for select to authenticated using (
  "studyId" ~ '^(prod-|dev-)HAIC_part_[1-4]$' and (
    "docId" = 'metadata' or
    ("docId" like 'sequenceAssignment_%' and public.owns_study_participant(substr("docId", 20)))
  )
);
drop policy if exists secured_revisit_insert on public.revisit;
create policy secured_revisit_insert on public.revisit for insert to authenticated with check (
  "studyId" ~ '^(prod-|dev-)HAIC_part_[1-4]$' and
  "docId" like 'sequenceAssignment_%' and
  public.owns_study_participant(substr("docId", 20)) and data->>'participantId' = substr("docId", 20)
);
drop policy if exists secured_revisit_update on public.revisit;
create policy secured_revisit_update on public.revisit for update to authenticated
using ("studyId" ~ '^(prod-|dev-)HAIC_part_[1-4]$' and "docId" like 'sequenceAssignment_%' and public.owns_study_participant(substr("docId", 20)))
with check ("studyId" ~ '^(prod-|dev-)HAIC_part_[1-4]$' and "docId" like 'sequenceAssignment_%' and public.owns_study_participant(substr("docId", 20)) and data->>'participantId' = substr("docId", 20));

drop policy if exists allow_revisit_storage_select on storage.objects;
drop policy if exists allow_revisit_storage_insert on storage.objects;
drop policy if exists allow_revisit_storage_update on storage.objects;
drop policy if exists allow_revisit_storage_delete on storage.objects;

create or replace function public.owns_study_object(object_name text) returns boolean
language sql stable security definer set search_path = public
as $$ select object_name ~ '^(prod-|dev-)HAIC_part_[1-4]/participants/[A-Za-z0-9_-]+_participantData$'
  and public.owns_study_participant(regexp_replace(split_part(object_name, '/', 3), '_participantData$', '')) $$;
revoke all on function public.owns_study_object(text) from public;
grant execute on function public.owns_study_object(text) to authenticated;

drop policy if exists secured_storage_admin on storage.objects;
create policy secured_storage_admin on storage.objects for all to authenticated
using (bucket_id = 'revisit' and public.is_study_researcher())
with check (bucket_id = 'revisit' and public.is_study_researcher());
drop policy if exists secured_storage_read on storage.objects;
create policy secured_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'revisit' and (public.owns_study_object(name) or name ~ '^(prod-|dev-)HAIC_part_[1-4]/configs/[a-f0-9]{64}_config$')
);
drop policy if exists secured_storage_insert on storage.objects;
create policy secured_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'revisit' and public.owns_study_object(name));
drop policy if exists secured_storage_update on storage.objects;
create policy secured_storage_update on storage.objects for update to authenticated
using (bucket_id = 'revisit' and public.owns_study_object(name))
with check (bucket_id = 'revisit' and public.owns_study_object(name));

update public.revisit set data = coalesce(data, '{}'::jsonb) ||
  '{"studyNavigatorEnabled": false, "analyticsInterfacePubliclyAccessible": false}'::jsonb
where "docId" = 'metadata' and "studyId" ~ '^(prod-|dev-)HAIC_part_[1-4]$';

-- Recover a lock timestamp for already-credited ordinary participants.
update public.withdrawal_participants p
set next_session_available_at = (
  select coalesce(max((s->>'creditedAt')::timestamptz), p.updated_at) + interval '24 hours'
  from jsonb_array_elements(p.completed_sessions) s
  where s->>'creditedAt' is not null
)
where current_session > 1 and completed_at is null and next_session_available_at is null
  and participant_id not like 'debug-%';
commit;
