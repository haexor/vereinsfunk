begin;

-- Unvollständige Texte sind keine Post-Versionen. Diese Tabelle hält ausschließlich den
-- persönlichen Bearbeitungsstand, bis daraus ein Beitrag zur Prüfung eingereicht wird.
create table public.text_workshop_drafts (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid not null,
  team_id uuid,
  post_id uuid,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, department_id) references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id) references public.teams(organization_id, department_id, id) on delete cascade,
  foreign key (organization_id, post_id) references public.posts(organization_id, id) on delete set null (post_id),
  check (team_id is null or department_id is not null)
);
create index text_workshop_drafts_owner_scope_idx on public.text_workshop_drafts (organization_id, department_id, created_by, updated_at desc);
create index text_workshop_drafts_post_idx on public.text_workshop_drafts (organization_id, post_id) where post_id is not null;

alter table public.text_workshop_drafts enable row level security;
alter table public.text_workshop_drafts force row level security;
create policy text_workshop_drafts_select_own on public.text_workshop_drafts for select to authenticated using (created_by = auth.uid());
grant select on public.text_workshop_drafts to authenticated;
grant all privileges on public.text_workshop_drafts to service_role;
create trigger set_text_workshop_drafts_updated_at before update on public.text_workshop_drafts for each row execute function public.set_updated_at();

-- Keep this lifecycle rule in the source of truth rather than the browser: a successful route
-- without approval stages changes the post directly to approved, while a regular route becomes
-- awaiting_approval. Both must remove the linked workshop draft exactly once.
create or replace function public.remove_text_workshop_drafts_after_submission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status in ('awaiting_approval', 'approved', 'published') and old.status is distinct from new.status then
    delete from public.text_workshop_drafts where organization_id = new.organization_id and post_id = new.id;
  end if;
  return new;
end;
$$;
create trigger posts_remove_text_workshop_drafts_after_submission
  after update of status on public.posts for each row execute function public.remove_text_workshop_drafts_after_submission();

commit;
