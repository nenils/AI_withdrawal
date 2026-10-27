import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema storage;
  create table storage.objects (bucket_id text, name text, metadata jsonb);
  create table public.withdrawal_participants (participant_id text primary key, credited_parts jsonb default '[]');
  insert into public.withdrawal_participants values ('p1','[]'), ('legacy','[2]'), ('active','[]');
`);
const migration = fs.readFileSync(new URL('../supabase/submission_integrity.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration);
await db.exec(`
  insert into storage.objects values ('revisit','prod-HAIC_part_1/participants/p1_participantData','{}');
  insert into public.withdrawal_submissions(participant_id,part_number,data,sha256)
    values ('p1',1,'{"answers":{"original":1}}','hash');
`);

async function blocked(sql, pattern) {
  await assert.rejects(db.exec(sql), pattern);
}
await blocked("update public.withdrawal_submissions set data='{}'", /immutable/);
await blocked("delete from public.withdrawal_submissions", /immutable/);
await blocked("truncate public.withdrawal_submissions", /immutable/);
await blocked("update storage.objects set metadata='{}' where name like '%p1_%'", /locked/);
await blocked("delete from storage.objects where name like '%p1_%'", /locked/);
await blocked("update storage.objects set name='renamed' where name like '%p1_%'", /locked/);
await blocked("insert into storage.objects values ('revisit','prod-HAIC_part_2/participants/legacy_participantData','{}')", /locked/);
await db.exec("insert into storage.objects values ('revisit','prod-HAIC_part_2/participants/active_participantData','{}')");
await db.exec("update storage.objects set metadata='{\"saved\":true}' where name like '%active_%'");
await db.exec("insert into storage.objects values ('revisit','prod-HAIC_part_1/configs/example_config','{}')");
await db.exec("set role service_role");
await blocked("update public.withdrawal_submissions set data='{}'", /permission denied/);
await db.exec("insert into public.withdrawal_submissions(participant_id,part_number,data,sha256) values ('active',2,'{}','hash')");
await db.exec("reset role");
await db.close();
console.log('Submission immutability, stale-tab storage protection, legacy credit locks, and active-session writes verified.');
