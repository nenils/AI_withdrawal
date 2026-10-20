// Run with PGLITE_MODULE pointing to an isolated @electric-sql/pglite installation.
// Example: PGLITE_MODULE=file:///tmp/withdrawal-rls-verification/node_modules/@electric-sql/pglite/dist/index.js node tests/verify_security_policies.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets(id text primary key, name text, public boolean);
    create table storage.objects(id text primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema auth, storage to anon, authenticated;
    grant all on storage.objects to anon, authenticated;
  `);
  await db.exec(fs.readFileSync('supabase/cloud_setup.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/security_hardening.sql', 'utf8'));
  await db.exec(`
    insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003');
    insert into public.study_researchers values ('00000000-0000-0000-0000-000000000003');
    insert into public.withdrawal_participants(participant_id, condition) values ('p1', 'advisor'), ('p2', 'judge');
    insert into public.withdrawal_participant_access values ('p1', '00000000-0000-0000-0000-000000000001'), ('p2', '00000000-0000-0000-0000-000000000002');
    insert into public.revisit("studyId", "docId", data) values
      ('prod-HAIC_part_1', 'sequenceAssignment_p1', '{"participantId":"p1"}'),
      ('prod-HAIC_part_1', 'sequenceAssignment_p2', '{"participantId":"p2"}'),
      ('prod-HAIC_part_1', 'metadata', '{"studyNavigatorEnabled":false}');
    insert into storage.objects values ('own', 'revisit', 'prod-HAIC_part_1/participants/p1_participantData'),
      ('other', 'revisit', 'prod-HAIC_part_1/participants/p2_participantData');
    set role authenticated;
    select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  `);
  assert.deepEqual((await db.query('select id from storage.objects')).rows.map((row) => row.id), ['own']);
  assert.equal((await db.query(`select * from public.revisit where "docId" like 'sequenceAssignment_%'`)).rows.length, 1);
  assert.equal((await db.query(`update storage.objects set name = name where id = 'other' returning id`)).rows.length, 0);
  assert.equal((await db.query(`delete from storage.objects where id = 'own' returning id`)).rows.length, 0);
  await assert.rejects(db.exec(`insert into storage.objects values ('attack','revisit','prod-HAIC_part_1/participants/p2_participantData')`), /row-level security/);
  await assert.rejects(db.exec(`insert into public.revisit("studyId", "docId", data) values ('prod-HAIC_part_1','currentConfigHash','{}')`), /row-level security/);
  await assert.rejects(db.exec(`select * from public.withdrawal_participant_access`), /permission denied/);
  await db.exec(`reset role; set role anon;`);
  assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
  await assert.rejects(db.exec('select * from public.revisit'), /permission denied/);
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);`);
  assert.equal((await db.query('select * from storage.objects')).rows.length, 2);
  assert.equal((await db.query('select * from public.revisit')).rows.length, 3);
  console.log('PASS: participant isolation, denied cross-user writes/deletes, denied public reads, and researcher access');
} finally { await db.close(); }
