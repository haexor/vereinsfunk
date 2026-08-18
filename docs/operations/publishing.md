# Publishing-Betrieb

## Sicherheitsmodell

Vereinsfunk besitzt eine Meta-Entwickler-App als OAuth-Client, aber keine Social-Media-Konten
der Vereine. Ein berechtigter Vereinsadministrator verbindet jeweils sein eigenes Instagram-
Professional-Konto, seine Facebook-Seite oder künftig eine LinkedIn-Unternehmensseite. Die
Zugriffstokens bleiben verschlüsselt in Supabase; Client-Secret und Tokens erreichen weder den
Browser noch Workflow-Payloads.

Es gibt zwei unabhängige Schutzschichten:

1. `PUBLISHING_MODE=disabled` im Deployment verhindert OAuth-Start und jedes Einplanen bzw.
   Ausführen einer Veröffentlichung. Das ist der produktionssichere Standard.
2. Bei `PUBLISHING_MODE=live` ist der Schalter **Plattform-Administration → Einstellungen →
   Veröffentlichungen** der sofort wirksame, globale Not-Aus. Er wird in Supabase gespeichert;
   fehlende oder `false` gesetzte Konfiguration blockiert fail-closed mit `publishing_disabled`.

Das Deaktivieren löscht keine Kanäle und ändert keine bereits wartenden Veröffentlichungen. Es
verhindert nur neue Sendevorgänge, bis ein Plattform-Admin bewusst wieder aktiviert.

## Meta aktivieren

1. In Meta for Developers eine Vereinsfunk-App anlegen und die beiden exakten Callback-URLs
   registrieren:

   - `https://vereinsfunk-api.haex.space/v1/channels/connect/instagram/callback`
   - `https://vereinsfunk-api.haex.space/v1/channels/connect/facebook/callback`

2. In `inventory/haex.space.yml` setzen:

   ```yaml
   vereinsfunk:
     publishing:
       mode: live
       providers: meta
   ```

3. Rolle ausrollen, API-Gesundheit prüfen und unter **Plattform-Administration → Einstellungen →
   Social-Media-Provider** Client-ID, Secret und Graph-Version hinterlegen. Das Secret wird dabei
   mit dem serverseitigen `SECRET_BOX_KEYS`-Schlüsselring verschlüsselt und nie wieder angezeigt.
4. Den Meta-Sandbox-/App-Review-Nachweis in
   `docs/evidence/meta-publishing-spike.md` aktualisieren.
5. Erst anschließend den globalen Publishing-Schalter in der Plattform-Administration aktivieren.

Die Container starten ohne Provider-Credentials; ein nicht konfigurierter Provider verweigert
OAuth und Publishing fail-closed. So lassen sich Credentials ohne erneutes Deployment rotieren.

## Weitere Provider

Die Ansible-Rolle reicht auch `TWITTER_*` und `LINKEDIN_*` ausschließlich an den API-Container
weiter. Das ist Vorbereitung für die spätere Implementierung. Aktuell sind echte Twitter/X- und
LinkedIn-Adapter nicht implementiert; `PUBLISHING_MODE=live` verweigert diese Provider daher beim
Start. Die entsprechenden Credentials oder ein `providers: meta,linkedin`-Eintrag dürfen erst mit
einem getesteten Adapter-Release aktiviert werden.
