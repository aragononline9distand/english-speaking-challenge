-- SKR Brain Challenge: initial Supabase schema
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

-- Nickname-only students are represented by public display names, not auth accounts.
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

alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.questions enable row level security;
alter table public.attempts enable row level security;

-- Public can read active subjects and questions. Only authenticated staff can mutate them.
create policy "public read active subjects" on public.subjects for select using (active = true);
create policy "public read active questions" on public.questions for select using (active = true);
create policy "staff manage questions" on public.questions for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('teacher','admin')))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('teacher','admin')));
create policy "staff manage subjects" on public.subjects for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('teacher','admin')))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('teacher','admin')));

-- Leaderboard is public. Nickname-only attempts can be submitted by anonymous visitors.
create policy "public read leaderboard" on public.attempts for select using (true);
create policy "public submit attempts" on public.attempts for insert with check (
  length(trim(player_name)) between 1 and 24 and score between 0 and 100000
);
create policy "staff read profiles" on public.profiles for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('teacher','admin')));
