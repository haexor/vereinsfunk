begin;

-- Betreiberregel: was auf VEREINSEBENE definiert wird, ist vereins- und abteilungsweit sichtbar;
-- was auf ABTEILUNGSEBENE definiert wird, ist nur darunter sichtbar. content_style_profiles_select
-- (2026081003) erfuellt die erste Haelfte, nicht die zweite: der Abteilungszweig prueft
-- authz.is_department_member, und das kennt nur eine department_memberships-Zeile ODER eine
-- Organisationsrolle. Wer ausschliesslich ueber team_memberships an einer Mannschaft DIESER
-- Abteilung haengt, sieht das Abteilungs-Stilprofil deshalb nicht.
--
-- Damit war content_style_profiles der einzige Ausreisser: brand_assets_select und die drei
-- Tabellen, die dessen Vorlage kopieren (image_style_presets, photo_layout_presets,
-- content_signature_blocks), nutzen im Abteilungszweig authz.participates_in_department, das die
-- Mannschaften der Abteilung mitzaehlt. Auch die API meint es laengst so:
-- isStyleProfileUsableInScope (apps/api/src/services/textGenerationSessions.ts) laesst ein
-- Abteilungsprofil im Mannschafts-Scope zu (profile.department_id === departmentId trifft dort),
-- GET /v1/content-style-profiles bietet es also an -- nur die Zeile selbst blieb per RLS verborgen.
--
-- Bewusst ADDITIV statt die brand_assets-Vorlage 1:1 zu uebernehmen: dort lautet der
-- Abteilungszweig "participates_in_department ODER has_department_permission(..., 'department.manage')".
-- Das waere hier eine Verschaerfung, denn is_department_member zaehlt heute JEDE Organisationsrolle
-- mit (auch social_manager, organization_viewer), has_department_permission(..., 'department.manage')
-- dagegen nur organization_owner/organization_admin. Mit dem zusaetzlichen ODER-Zweig verliert
-- niemand Sicht, und die Regel gilt.
alter policy content_style_profiles_select on public.content_style_profiles using (
  (team_id is not null and authz.has_team_membership(team_id))
  or (team_id is null and department_id is not null and (
    authz.is_department_member(department_id)
    or authz.participates_in_department(department_id)
  ))
  or (department_id is null and authz.is_any_member_of_organization(organization_id))
);

commit;
