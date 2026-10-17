-- =====================================================================
-- Dépôt contenu : schéma Supabase
-- Idempotent : on peut le relancer sans casser les données existantes.
-- Hiérarchie : dossiers imbriqués (projet > sous-projet > angle > ...)
--              -> contenus -> fichiers + publications (1 par compte)
-- =====================================================================

-- ---------- Équipe ----------------------------------------------------
create table if not exists public.team_members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.team_members where user_id = auth.uid());
$$;

revoke all on function public.is_team_member() from public, anon;
grant execute on function public.is_team_member() to authenticated, service_role;

-- ---------- Dossiers (projets, sous-projets, angles...) ---------------
create table if not exists public.folders (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.folders(id) on delete restrict,
  name        text not null,
  color       text not null default '#6366f1',
  description text not null default '',
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists folders_parent_idx on public.folders(parent_id);

-- ---------- Comptes de publication (rattachés à un dossier) -----------
create table if not exists public.accounts (
  id         uuid primary key default gen_random_uuid(),
  folder_id  uuid not null references public.folders(id) on delete cascade,
  platform   text not null check (platform in
               ('youtube','instagram','tiktok','facebook','linkedin','x','threads','pinterest','snapchat','other')),
  handle     text not null default '',
  url        text not null default '',
  position   int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists accounts_folder_idx on public.accounts(folder_id);

-- ---------- Contenus --------------------------------------------------
create table if not exists public.contents (
  id         uuid primary key default gen_random_uuid(),
  folder_id  uuid not null references public.folders(id) on delete restrict,
  title      text not null default 'Sans titre',
  format     text not null default 'video' check (format in
               ('video','short','carousel','photo','story','other')),
  notes      text not null default '',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contents_folder_idx  on public.contents(folder_id);
create index if not exists contents_created_idx on public.contents(created_at desc);

-- ---------- Publications : 1 contenu x 1 compte = 1 date + 1 texte ----
create table if not exists public.publications (
  id             uuid primary key default gen_random_uuid(),
  content_id     uuid not null references public.contents(id) on delete cascade,
  account_id     uuid not null references public.accounts(id) on delete cascade,
  scheduled_date date,
  scheduled_time time,
  title          text not null default '',
  description    text not null default '',
  posted         boolean not null default false,
  posted_at      timestamptz,
  post_url       text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (content_id, account_id)
);
create index if not exists publications_date_idx    on public.publications(scheduled_date);
create index if not exists publications_account_idx on public.publications(account_id);

-- ---------- Fichiers (vidéo, miniature, photos/slides, autres) --------
create table if not exists public.assets (
  id           uuid primary key default gen_random_uuid(),
  content_id   uuid not null references public.contents(id) on delete cascade,
  kind         text not null default 'other' check (kind in ('video','thumbnail','photo','other')),
  position     int  not null default 0,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text not null default '',
  size_bytes   bigint not null default 0,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists assets_content_idx on public.assets(content_id, kind, position);

-- ---------- Clés API (on ne stocke que le hash SHA-256) ---------------
create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  prefix       text not null,
  key_hash     text not null unique,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

-- ---------- Triggers --------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_posted_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.posted and new.posted_at is null then
    new.posted_at = now();
  elsif not new.posted then
    new.posted_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists contents_updated_at on public.contents;
create trigger contents_updated_at before update on public.contents
  for each row execute function public.set_updated_at();

drop trigger if exists publications_updated_at on public.publications;
create trigger publications_updated_at before update on public.publications
  for each row execute function public.set_updated_at();

drop trigger if exists publications_posted_at on public.publications;
create trigger publications_posted_at before insert or update of posted on public.publications
  for each row execute function public.set_posted_at();

-- ---------- Droits + RLS : seuls les membres de l'équipe ont accès ----
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on
  public.folders, public.accounts, public.contents, public.publications, public.assets, public.api_keys
  to authenticated;
grant select on public.team_members to authenticated;
grant all on
  public.team_members, public.folders, public.accounts, public.contents, public.publications, public.assets, public.api_keys
  to service_role;
revoke all on
  public.team_members, public.folders, public.accounts, public.contents, public.publications, public.assets, public.api_keys
  from anon;

alter table public.team_members enable row level security;
alter table public.folders      enable row level security;
alter table public.accounts     enable row level security;
alter table public.contents     enable row level security;
alter table public.publications enable row level security;
alter table public.assets       enable row level security;
alter table public.api_keys     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['folders','accounts','contents','publications','assets','api_keys'] loop
    execute format('drop policy if exists team_all on public.%I', t);
    execute format(
      'create policy team_all on public.%I for all to authenticated
         using (public.is_team_member()) with check (public.is_team_member())', t);
  end loop;
end $$;

drop policy if exists team_read on public.team_members;
create policy team_read on public.team_members for select to authenticated
  using (public.is_team_member());

-- ---------- Stockage des fichiers (bucket privé) ----------------------
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists media_team_select on storage.objects;
create policy media_team_select on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.is_team_member());

drop policy if exists media_team_insert on storage.objects;
create policy media_team_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_team_member());

drop policy if exists media_team_update on storage.objects;
create policy media_team_update on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_team_member())
  with check (bucket_id = 'media' and public.is_team_member());

drop policy if exists media_team_delete on storage.objects;
create policy media_team_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_team_member());
