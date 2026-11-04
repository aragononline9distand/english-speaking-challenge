-- SKR Brain Challenge: safer Supabase starter schema
-- Run in a new Supabase project. Review policies before production.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'teacher' check (role in ('teacher','admin')),
  created_at timestamptz not null default now()
);
create table if not exists public.subjects (
  id text primary key,
  title text not null,
  icon text not null default '🧠',
  active boolean not null default true
);
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  subject_id text not null references public.subjects(id),
  difficulty text not null check (difficulty in ('ง่าย','กลาง','ยาก')),
  prompt text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_index smallint not null check (correct_index between 0 and 3),
  explanation text not null default '',
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  player_name text not null check (length(trim(player_name)) between 1 and 24),
  subject_id text not null references public.subjects(id),
  score integer not null check (score >= 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  question_count integer not null default 0 check (question_count >= 0),
  created_at timestamptz not null default now()
);

insert into public.subjects(id,title,icon) values
('math','คณิตศาสตร์','🔢'),('science','วิทยาศาสตร์','🔬'),
('english','ภาษาอังกฤษ','🔤'),('thai','ภาษาไทย','📚'),
('social','สังคมศึกษา','🌏'),('logic','ฝึกสมองและตรรกะ','🧩'),
('digital','เทคโนโลยี','💻'),('life','ทักษะชีวิต','💡')
on conflict (id) do nothing;

-- Security-definer helper avoids recursive profiles RLS policies.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('teacher','admin')
  );
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.questions enable row level security;
alter table public.attempts enable row level security;

drop policy if exists "public read active subjects" on public.subjects;
drop policy if exists "staff manage subjects" on public.subjects;
drop policy if exists "public read active questions" on public.questions;
drop policy if exists "staff manage questions" on public.questions;
drop policy if exists "public read leaderboard" on public.attempts;
drop policy if exists "public submit attempts" on public.attempts;
drop policy if exists "staff read profiles" on public.profiles;

create policy "public read active subjects" on public.subjects
for select using (active = true);
create policy "staff manage subjects" on public.subjects
for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Do not expose answer keys to anonymous students. Staff can read/manage full rows.
create policy "staff read questions" on public.questions
for select to authenticated using (public.is_staff());
create policy "staff manage questions" on public.questions
for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Student-safe question view deliberately omits correct_index and explanation.
create or replace view public.student_questions
with (security_invoker = true) as
select id, subject_id, difficulty, prompt, options
from public.questions
where active = true;

create policy "public read leaderboard" on public.attempts
for select using (true);
create policy "public submit attempts" on public.attempts
for insert with check (
  length(trim(player_name)) between 1 and 24
  and score between 0 and 100000
  and correct_count between 0 and question_count
  and question_count between 0 and 100
);

create policy "staff read profiles" on public.profiles
for select to authenticated using (public.is_staff());

-- IMPORTANT:
-- 1) Create the first teacher/admin profile securely from Supabase SQL Editor
--    after creating that user in Authentication. Never expose service_role keys.
-- 2) Do not treat public client-submitted attempts as verified scores. A production
--    release should score attempts server-side (Edge Function/RPC) and rate-limit
--    submissions. Public insert policy here is only a development scaffold.
-- 3) Student clients should read public.student_questions, never questions.
