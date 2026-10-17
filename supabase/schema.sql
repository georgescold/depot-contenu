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

-- ---------- Fichiers -------------------------------------------------
-- Les fichiers sont stockés chez Backblaze B2 (voir src/lib/b2.ts), pas dans Supabase Storage.
-- assets.storage_path = clé de l'objet dans le bucket B2.

-- =====================================================================
-- Durcissement (revue de sécurité du 2026-10-17)
-- =====================================================================

-- ---------- Rôles : le premier compte est « owner » -------------------
alter table public.team_members add column if not exists role text not null default 'member';
do $$ begin
  alter table public.team_members add constraint team_members_role_check check (role in ('owner','member'));
exception when duplicate_object then null; end $$;

-- ---------- Drapeau « installation faite » (ne repasse jamais à faux) -
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default 'true'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant all on public.app_settings to service_role;

-- Création du premier compte, atomique (verrou) et une seule fois dans la vie du projet.
create or replace function public.claim_first_member(p_user_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  lock table public.team_members in exclusive mode;
  if exists (select 1 from public.app_settings where key = 'setup_done')
     or exists (select 1 from public.team_members) then
    raise exception 'setup_already_done' using errcode = 'P0001';
  end if;
  insert into public.team_members (user_id, email, role) values (p_user_id, p_email, 'owner');
  insert into public.app_settings (key) values ('setup_done') on conflict (key) do nothing;
end;
$$;

-- Retrait d'un membre : jamais le dernier, et ses clés API sont révoquées.
create or replace function public.remove_team_member(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  lock table public.team_members in exclusive mode;
  if not exists (select 1 from public.team_members where user_id = p_user_id) then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.team_members where user_id <> p_user_id) = 0 then
    raise exception 'last_member' using errcode = 'P0001';
  end if;
  update public.api_keys set revoked_at = now() where created_by = p_user_id and revoked_at is null;
  delete from public.team_members where user_id = p_user_id;
end;
$$;

revoke all on function public.claim_first_member(uuid, text) from public, anon, authenticated;
revoke all on function public.remove_team_member(uuid) from public, anon, authenticated;
grant execute on function public.claim_first_member(uuid, text) to service_role;
grant execute on function public.remove_team_member(uuid) to service_role;

-- Les membres existants avant l'ajout des rôles : le plus ancien devient owner.
update public.team_members set role = 'owner'
where user_id = (select user_id from public.team_members order by created_at limit 1)
  and not exists (select 1 from public.team_members where role = 'owner');
insert into public.app_settings (key)
select 'setup_done' where exists (select 1 from public.team_members)
on conflict (key) do nothing;

-- ---------- Pas de doublons de dossiers frères ni de comptes ----------
create unique index if not exists folders_unique_sibling_name
  on public.folders (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create unique index if not exists accounts_unique_handle
  on public.accounts (folder_id, platform, lower(btrim(handle)));

-- ---------- Pas de cycle dans l'arborescence --------------------------
create or replace function public.folders_prevent_cycle()
returns trigger language plpgsql set search_path = '' as $$
declare cur uuid := new.parent_id; depth int := 0;
begin
  while cur is not null loop
    if cur = new.id then
      raise exception 'Un dossier ne peut pas être rangé dans lui-même ou dans un de ses sous-dossiers.';
    end if;
    select parent_id into cur from public.folders where id = cur;
    depth := depth + 1;
    if depth > 100 then raise exception 'Arborescence trop profonde.'; end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists folders_no_cycle on public.folders;
create trigger folders_no_cycle before insert or update of parent_id on public.folders
  for each row execute function public.folders_prevent_cycle();

-- ---------- Clés API : une clé révoquée le reste, hash et auteur figés -
create or replace function public.api_keys_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    new.revoked_at := null;
    new.last_used_at := null;
    return new;
  end if;
  if old.revoked_at is not null and new.revoked_at is null then
    raise exception 'Une clé révoquée ne peut pas être réactivée.';
  end if;
  new.key_hash := old.key_hash;
  new.prefix := old.prefix;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;
drop trigger if exists api_keys_guard on public.api_keys;
create trigger api_keys_guard before insert or update on public.api_keys
  for each row execute function public.api_keys_guard();

-- =====================================================================
-- Archivage après publication : on libère le stockage, on garde l'historique
-- =====================================================================
alter table public.assets   add column if not exists archived_at timestamptz;
alter table public.contents add column if not exists keep_files boolean not null default false;
alter table public.contents add column if not exists files_archived_at timestamptz;

-- Délai (en jours) entre la dernière publication et la suppression des fichiers ; null = jamais.
insert into public.app_settings (key, value) values ('archive_after_days', '3'::jsonb)
on conflict (key) do nothing;
