create table if not exists public.keryx_app_users (
  id uuid primary key,
  email text not null unique,
  role text not null check (role in ('admin', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.keryx_models (
  id text primary key,
  provider text not null,
  display_name text not null,
  supports_images boolean not null default false,
  supports_search boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.keryx_user_model_access (
  user_id uuid not null references public.keryx_app_users(id) on delete cascade,
  model_id text not null references public.keryx_models(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, model_id)
);

create table if not exists public.keryx_invitations (
  id uuid primary key,
  email text not null,
  token_hash text not null unique,
  role text not null check (role in ('admin', 'user')),
  -- Legacy compatibility column. Invitation validity is enforced by single use via used_at.
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  initial_model_access text[] not null default '{}'
);

create table if not exists public.keryx_chats (
  id uuid primary key,
  owner_id uuid not null references public.keryx_app_users(id) on delete cascade,
  title text,
  visibility text not null check (visibility in ('private', 'public')) default 'private',
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);

create index if not exists idx_keryx_chats_owner_created_at
  on public.keryx_chats(owner_id, created_at desc);

alter table public.keryx_app_users enable row level security;
alter table public.keryx_models enable row level security;
alter table public.keryx_user_model_access enable row level security;
alter table public.keryx_invitations enable row level security;
alter table public.keryx_chats enable row level security;
