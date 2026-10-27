-- Apply once before deploying the submission-integrity update.
-- Does not replace existing policies or modify existing participant answers.
create table if not exists public.withdrawal_submissions (
  participant_id text not null references public.withdrawal_participants(participant_id),
  part_number integer not null check (part_number between 1 and 4),
  data jsonb not null,
  sha256 text not null,
  submitted_at timestamptz not null default now(),
  primary key (participant_id, part_number)
);
alter table public.withdrawal_submissions enable row level security;
revoke all on public.withdrawal_submissions from anon, authenticated;
grant select, insert on public.withdrawal_submissions to service_role;
revoke update, delete, truncate on public.withdrawal_submissions from service_role;

create or replace function public.prevent_submission_changes()
returns trigger language plpgsql as $$
begin
  raise exception 'Submitted questionnaires are immutable';
end;
$$;
drop trigger if exists immutable_submission on public.withdrawal_submissions;
create trigger immutable_submission before update or delete
on public.withdrawal_submissions for each row
execute function public.prevent_submission_changes();
drop trigger if exists immutable_submission_truncate on public.withdrawal_submissions;
create trigger immutable_submission_truncate before truncate
on public.withdrawal_submissions for each statement
execute function public.prevent_submission_changes();

-- Protect the original working files too, including writes from an older tab.
create or replace function public.protect_completed_questionnaire_files()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_path text;
  new_path text;
  path text;
  matches text[];
begin
  if TG_OP <> 'INSERT' and OLD.bucket_id = 'revisit' then old_path := OLD.name; end if;
  if TG_OP <> 'DELETE' and NEW.bucket_id = 'revisit' then new_path := NEW.name; end if;
  foreach path in array array[old_path, new_path] loop
    matches := regexp_match(path, '^(prod-|dev-)HAIC_part_([1-4])/participants/(.+)_participantData$');
    if matches is not null and (
      exists (select 1 from public.withdrawal_submissions
              where participant_id = matches[3] and part_number = matches[2]::integer)
      or exists (select 1 from public.withdrawal_participants
                 where participant_id = matches[3] and credited_parts @> to_jsonb(matches[2]::integer))
    ) then
      raise exception 'This session has already been submitted; questionnaire writes are locked'
        using errcode = '42501';
    end if;
  end loop;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
drop trigger if exists completed_questionnaire_guard on storage.objects;
create trigger completed_questionnaire_guard before insert or update or delete
on storage.objects for each row
execute function public.protect_completed_questionnaire_files();

notify pgrst, 'reload schema';
