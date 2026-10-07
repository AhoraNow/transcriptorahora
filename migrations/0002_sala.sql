create table if not exists scribe_secret (
  id smallint primary key,
  api_key text not null,
  updated_by text not null,
  updated_at timestamptz not null default now()
);

create table if not exists transcripts (
  id text primary key,
  user_id text not null,
  title text not null,
  duration_sec double precision not null default 0,
  words_json text not null,
  names_json text not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists transcripts_user_idx on transcripts (user_id, created_at desc);
