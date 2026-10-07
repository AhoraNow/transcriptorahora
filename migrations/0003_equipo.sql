create table if not exists team_member (
  email text primary key,
  created_at timestamptz not null default now()
);
