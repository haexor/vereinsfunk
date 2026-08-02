-- SQL privileges and RLS are both required: privileges allow the operation class,
-- while row policies decide which tenant rows are visible or mutable.
grant select on table
  public.profiles,
  public.organizations,
  public.departments,
  public.teams,
  public.organization_memberships,
  public.department_memberships,
  public.team_memberships,
  public.invitations,
  public.organization_brand_profiles,
  public.submissions,
  public.posts,
  public.post_versions,
  public.approval_requests,
  public.approval_decisions,
  public.audit_events
to authenticated;

grant update on table public.profiles, public.organization_brand_profiles, public.submissions
to authenticated;

grant insert on table public.submissions, public.approval_decisions
to authenticated;

grant all privileges on all tables in schema public to service_role;
