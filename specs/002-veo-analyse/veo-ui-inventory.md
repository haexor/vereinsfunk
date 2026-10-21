# Veo web app (app.veo.co): inventory of team and player analytics views

Built from the minified, publicly served JS bundles in `veo-web/js/` (local download, not committed) (498 chunks; Sentry release `24036065aa956fbea06e2fa6f1562f61f8a28baa`). The bundles were only read, never executed. Every claim names the chunk it comes from. English UI labels are the gettext keys exactly as they appear in the code; for `context||text` keys, the text after `||` is what the user sees. The German translations are in `i18n-9b9vMhPw.js`. Nothing here has been checked against a live API, so response shapes are inferred from the fields the code reads.

## How to read this

| Part | Scope | Main chunks |
|---|---|---|
| 1a | Team, one match: the "Analytics" side panel on `/matches/:slug/`, match momentum, events | `detail-B56tzMIL.js`, `analysis-B7oi1Haw.js`, `analysisSlice-CRlRsXf0.js`, panel chunks, `worker-CgfQocFn.js` |
| 1b | Team, across matches: Analytics Studio "Team stats" (`/clubs/:club_slug/analytics-studio/#team-stats`) | `view-BYcaVA08.js`, `team-stats-gKfAgKCX.js`, `pitch-analytics-CquIUgYq.js`, `worker-lkm0OaJA.js` |
| 2 | Player, per match and across matches: Studio "Player stats", Player Stats Overview, player focus card, recent form, Player Moments / Spotlight, Veo Vision overlay, heat map rendering | `player-stats-FQG92yUp.js`, `context-card-Jk_Nkykh.js`, `player-moments-*.js`, `follow-player-tracks-CTSaUSZ3.js`, `use-draw-on-pitch-matrix-buffers-C4kiYcT5.js`, `worker-lkm0OaJA.js` |
| 3 | Match Report (`/matches/:slug/report/`) | `report-BVrpWDhT.js`, `report-gate-DAHFb1FG.js`, `matchReportSlice-dbGYMyIg.js`, `src-DxLvMDc4.js` |
| 4 | Consolidated endpoint table, request bodies, response models and enums | `src-CpmFfToj.js`, `singleton-BGuIWsNG.js`, `app-http-client-BS7D_lFb.js`, workers, `settings-*.js` |
| 5 | Open questions that need a live API call (merged; detailed lists are at the end of each part) | – |

## Findings that affect the whole rebuild

1. **Most data fetching runs in web workers, and the workers ship unminified.** Analytics Studio (team and player tabs) and the match report's player table fetch and aggregate in `worker-lkm0OaJA.js`, started by `studio-worker-D7X77VUn.js`. The match page's key-metrics carousel and recent form use `worker-CgfQocFn.js`. Readable copies of the app code are in `extract/` (local extracts, not committed) (`worker-app.js`, `studio-worker-app.js`, `analysis-worker-app.js`, `team-stats.js`); parts 1b and 2 cite line numbers in `extract/worker-app.js`.
2. **Three families of data sources:**
   - `/api/app/...`: the Django app API. `analysis/stats/`, `analysis/player-heatmaps/`, `analysis/player-event-maps/` and `analysis/leaderboards/` all take a `type` field that picks the mode (`team_match`, `cross_match`, `match_all_players`, `match_player`, `cross_match_all_players`, `cross_match_user`, `cross_match_jersey`). Event maps also take a `map_kind` (`SHOTMAP`, `TACKLE_MAP`, `INTERCEPTION_MAP`, `BALL_RECOVERY_MAP`, `DUEL_MAP`, `FOUL_MAP`, `PASS_MAP`).
   - `/api/mes/v2/...`: the match event service. It provides the team heat map image, events, team event stats, momentum, passing network, physical metrics, player tracking and player moments.
   - RAS on CloudFront (`https://dt3kfuz4eo879.cloudfront.net/recordings/{id}/analytics|match-details|shot-details`): the legacy analytics v1/v1.1 source for passes, possession and shots. It is fetched with `credentials:"omit"`.
3. **About 15 MES v2 player/cross-match endpoints in the generated client have no caller** in any shipped chunk. Among them are `v2GenerateMatchPlayerHeatmap(s)`, `v2GetCrossMatchPlayerHeatmap(s)`, `v2GetCrossMatchPlayerEvent(s)`, `v2GetPlayerStats`, `own-player-stats`, `speed-zone-distribution` and the cross-match `-/physical-metrics`. The web UI uses the `/api/app/analysis/*` equivalents instead. The `/player` profile route is a remote federated module (`https://d2gxpydnmytzsp.cloudfront.net/apps/player-offering/remoteEntry.js`, via `_federation_PlayerOffering_Module-BCuwBr56.js`, behind feature flag `player_offering`). It was not downloaded, so it is not covered; it probably uses those endpoints.
4. **Heat maps come in two formats:**
   - **Team heat map:** a server-rendered image. `POST /api/mes/v2/{match}/heatmap` with `{categories:[1]|[3], startTime, endTime}` returns a Blob (`analysisSlice-CRlRsXf0.js`, `heatmap-DP5wKYrX.js`).
   - **Player heat map:** a matrix. `POST /api/app/analysis/player-heatmaps/` returns base64 uint8 values, each divided by 255. Across matches the grid is a fixed 1800 cells (30 × 60). The match report reads `width`/`height` from the response and flips both axes when `direction_of_play` is `rightToLeft`. The client draws it on a canvas: blur, then bilinear upscaling, then a colour ramp (parts 2.8 and 3.6d).
5. **Gating has four layers:**
   - Match permissions (e.g. `analysis.read_match_report(_advanced)`, `teams.read_club_analyticsstudio`, `analysis.read_team__comparisonradial`).
   - `analytics_version`, which the client derives itself (1 / 1.1 / 2) from which keys the RAS status contains (`utils-X7ELx8Cj.js`), plus `has_events_enabled` / `has_analytics_enabled` and `feature-processing-status`.
   - Waffle flags and switches (`player-stats-event`, `interactive_pass_strings`, `*-analytics-2` metric switches, `coach-assist-chat-bot`).
   - Amplitude experiments (`match_report_v1`, `coach-assist-match-report-insights`).
   - Product names in the UI are "Analytics", "Analytics 2", "Player Spotlight", "Match Report" (basic vs advanced) and "Coach Assist".
6. **Coordinates differ per view.** Each period's `own_side` maps the stored L/R data to own/opponent. The legacy shot map uses x in [-1, 1] and y in [0, 1], flipped so every team attacks toward +x. MES events and analysis maps use `x`/`z`, which the report pitch converts with `{x: 1 − z, y: x}` on a 627 × 402 SVG. Pass and possession thirds split at x < 1/3 and x > 2/3. Details are in each part.

# 1. Team views

## 1a. Team views, per match (match detail page `/matches/:slug/`)

Source chunks: `detail-B56tzMIL.js` (match page shell, side panels, multidimensional timeline), `analysis-B7oi1Haw.js` (the "Analytics" side panel), lazy panels `statistics-CCReLb_Z.js`, `shotmap-Dj5DxQoc.js`, `pass-locations-ypUPiHlG.js`, `possession-locations-CJ4BYxkS.js`, `pass-strings-mzj-odD9.js`, `heatmap-DP5wKYrX.js`, shared `locations-map-DpkOCKBe.js`, `team-period-info-McOt95JC.js`, `period-DoWvlsrn.js`, data layer `analysisSlice-CRlRsXf0.js`, `eventsSlice-Cwu7ipgL.js`, `events-C4yabS_5.js`, helpers `utils-X7ELx8Cj.js`, `objects-qR7pcF19.js`, `utils-CUo0J2ML.js`, `settings-DLtzORLW.js`, `settings---F8aIpR.js`, `settings-CwadC6hT.js`, workers `worker-CgfQocFn.js` / `worker-lkm0OaJA.js` (via `studio-worker-D7X77VUn.js`).

### 0. Page structure, routing and gates

#### 0.1 Side-panel tabs (hash routes)
`settings-DLtzORLW.js` (`ma`): `#/analysis/`, `#/create/`, `#/events/`, `#/highlights/`, `#/lineup/`, `#/summary/`, `#/player-moments/`. Panel names: `analysis`, `analysis-match-periods-form`, `analysis-match-stats-edit-rows`, `events-list`, `events-list-filter`, `event-match-periods-form`, `event-form-edit`, `lineup`, `match-summary`, `player-moments`, … (`settings-DLtzORLW.js` `s`).
Mobile nav icons (`detail-B56tzMIL.js` `eR`): analysis = `bar-chart-2`, player moments = `jersey`, highlights = `video`, …

Panel → component switch (`detail-B56tzMIL.js` `PR`):
- `analysis` → `analysis-B7oi1Haw.js` if `analysis_aside_is_available`; else if `analysis_button_is_available` → upsell: if feature status unknown (`Tp`) → "unknown-feature-status-teaser" titled "Analytics"; elif flag `player-stats-event` → `promo-DAPmxhTb.js` (Analytics 2 promo); else `teaser-B7TO5vRp.js` (Analytics 2.0 teaser).
- `analysis-match-stats-edit-rows` → `edit-rows-form-DokiFrN7.js` only if analysis available and `can_update_match && !(ras_status event-detection/match-details not completed)`.
- `match-summary` → `match-summary-CHH4_JrB.js` (final score/journal; not analytics).
- `events-list`/`events-list-filter`/`event-form-edit` → `list-BShiMZvQ.js`/`filter-DUlE4LoA.js`/`form-BlxE367n.js` if events enabled.
- `player-moments` → `player-moments-DpNOIBZ0.js` (player scope, see player section) or teasers `teaser-B5QtXQ3_.js` / `promo-xWprlryS.js` ("Player Spotlight").

#### 0.2 Availability function `Tl(match)` (`detail-B56tzMIL.js`)
```js
s = !match.is_loading_feature_processing_status && !match.feature_processing_status   // status unknown
i = feature_processing_status.analytics in ["completed","error","pending","processing"] // settings-DLtzORLW.js `Z`
analysis_aside_is_available  = (has_analytics_enabled || i) && perm("analysis.read_match_analysis")
analysis_button_is_available = aside || (sport==="football" && (analytics==="not-purchased" || s))  // → upsell teaser
events_aside_is_available = Et(match)  // utils-X7ELx8Cj.js, see below
lineup_aside_is_available = perm("matches.read_match__lineup") && sport==="football" && (team || perm("matches.update_match"))
player_moments_aside_is_available = perm("analysis.read_match_playermoments") && sport==="football" && (has_playermoments_enabled || player_spotlight in [completed,error,pending,processing])
player_moments_button_is_available = aside || (football && (player_spotlight==="not-purchased" || s))
```
Events enabled (`utils-X7ELx8Cj.js` `Et`): `perm("matches.read_match_events") && (has_events_enabled || feature_processing_status.ai_detection in [completed,error,pending,processing]) && sport==="football"`.

Match object fields used for gating (`objects-qR7pcF19.js` selectors): `has_analytics_enabled`, `analytics_version`, `has_events_enabled`, `has_playermoments_enabled`, `feature_processing_status.{analytics, ai_detection, player_spotlight}` (values `pending|processing|completed|error|not-purchased`), `is_loading_feature_processing_status`, `periods[]`, `periods_response`, `ras_status`, `team`, `club`, `own_team_home_or_away`, `own_team_color`, `opponent_team_color`, `opponent_team_name`, `opponent_short_name_display`, `team.speed_zones[]` (zone 3 = run, zone 5 = sprint lower bounds km/h), `permissions{}`.
Feature-processing status endpoint: `GET /api/app/matches/{match_identifier}/feature-processing-status/` (`src-CpmFfToj.js` `getProcessingStatus`; also used by `worker-CgfQocFn.js` `Lee`).

#### 0.3 Analytics version (`utils-X7ELx8Cj.js`)
Derived client-side from `ras_status` (RAS = analytics service status JSON):
```js
D = (ras={}) => ras["ball-tracking"]!==undefined && ras["match-details"]!==undefined && ras["shot-details"]!==undefined
      ? (ras["match-report"]!==undefined ? "2" : "1.1") : "1"
```
- Versions ordered `["1","1.1","2"]`. `gt`/`vt` = version ≥ "1.1" → enables shot map (`gt`) and RAS stats/pass location/possession location/pass strings (`vt`).
- Display label `St`: `"1"→"1.0"`, `"1.1"→"2.0"`, `"2"→"2.0"`; with flag `player-stats-event` the raw value is shown (badge `analytics-version-badge-Uxp3VP0C.js`, "--latest" style if latest version).
- `pt(ras,key)` = key present AND `!== "completed"` (= "not ready").
- ras_status fetch (`analysisSlice-CRlRsXf0.js` `fetchRASStatus`): `GET MATCHES.ras_status(match.recordings[0])` → stored as `match.ras_status`, then triggers passes/possession fetch.
- URL builder (`settings-DLtzORLW.js`): `T = VEO_SERVICE_URLS.RAS_URL || API_APP_URL`; `R(id) = T===API_APP ? `${T}/recordings/${id}/analytics` : `${T}/recordings/${id}``; `ras_status = …/recordings/{id}/analytics` (both variants), `match_details = R(id)+"/match-details"`, `shot_details = R(id)+"/shot-details"`. Worker variant (`worker-CgfQocFn.js` `oa.get`): `${RAS_URL}/recordings/{id}/{x}` or `/api/app/recordings/{id}/analytics/{x}`, with `credentials:"omit"` for RAS.
- Keys seen in ras_status: `ball-tracking`, `match-details`, `shot-details`, `match-report`, `player-tracking`, `event-detection`.

#### 0.4 Feature flags/switches referenced (`feature_flags-CEQAkNH2.js`, `feature_switches-BcQAflg5.js`, `switch_gated_groups-Bjk8c6gu.js`, `use-amplitude-experiments-Ca67IrHZ.js`)
- Waffle flags (`globalThis.waffle.FLAGS`): `player-stats-event` (Player Stats Overview card, version label, promo variant), `analytics-reduced-accuracy` (Reduced accuracy box), `include-2-pass-strings`, `interactive-pass-strings` (also adds `&interactiveStrings=true` to match-details), `events-jersey-numbers`, `vwa-new-plural-forms`, `player-offering`, `money-team-analytics-2`, `match-lineup-roster`, `analytics-studio-enable-for-all`.
- Amplitude experiment `match_report_v1` (value "on") → `use-hide-ras-passes-and-possession-stats-Cy_PwqZD.js`: `hide = match_report_v1 && analytics_version === "2"`. When true: RAS stats rows suppressed in Stats, Pass strings panel removed, pointer "Possession, passes, pass strings and more stats are now in the Match Report." + Match Report button shown.
- Waffle switches (`globalThis.waffle.SWITCHES`) gating event types / metric ids (`switch_gated_groups-Bjk8c6gu.js`):
  - `tackles-dribbles-analytics-2`: events `tackle`,`dribble`; metrics `tackles`,`dribbles`
  - `duels-analytics-2`: `duel`; `duels`
  - `interceptions-recoveries-analytics-2`: `interception`,`loose`; `interceptions`,`loose_ball_recoveries`
  - `saves-analytics-2`: `save`; `saves`
  - `player-passes-analytics-studio`: metrics `passes`,`passes_success_rate`,`passes_successful`,`passes_unsuccessful`
  - `player-passes-events-panel`: event `pass`
  `gated-metrics-gn4_9qmN.js` filters metric options by these switches.

#### 0.5 Permissions used (match `permissions` object, `utils-X7ELx8Cj.js` class `I`, prefix "matches")
`analysis.read_match_analysis`, `analysis.read_match_stats`, `analysis.read_match_shotmap`, `analysis.read_match_passlocations`, `analysis.read_match_possessionlocations`, `analysis.read_match_passstrings`, `analysis.read_match_heatmap`, `analysis.read_match_formguide`, `analysis.read_match_playereventstats`, `analysis.read_match_playerphysicalstats`, `analysis.read_match_momentum`, `analysis.read_match_playermoments`, `matches.read_match_events`, `matches.update_match_events`, `matches.update_match`; team: `teams.read_team_analyticsstudio`.

### 1. "Analytics" side panel (`analysis-B7oi1Haw.js`, default export `Qr`)

Header: title "Analytics" + version badge button (aria "About Veo Analytics"); info dialog "Veo Analytics" with sections "AI-generated metrics and statistics" / "Veo AI provides a 2D radar, scoreboard, match stats, shot map, Analytics Studio and more. Less time tagging, more time for coaching.", "Accuracy" / "Our AI-based features are designed to save you time and effort. …", "Troubleshooting" / "If your stats look like they are the wrong way round, please make sure your sides and periods are set up correctly.", button "Learn more". With flag `player-stats-event` a tag "Analytics" + "This match has Analytics %(version)s". Extra header action: "Edit sides and periods" (`inline-message-CXgAuR4J.js`, disabled until periods loaded; tooltip "Only an Admin or Team Editor can edit sides and periods").

Body order:
1. Reduced accuracy box (flag `analytics-reduced-accuracy` AND match-quality selector `matchQualitySlice-CsC3JxwU.js`): title "Reduced accuracy"; cards "What is affected" / "AI event and jersey number detection accuracy is reduced for this match.", "Why is accuracy reduced" / "Reasons include: camera facing sun, camera shaking, low light, and low-contrast kits.", "What can I do" / "To avoid this, follow our camera setup best practices and keep jersey numbers clear and visible."; button "Learn more".
2. Status block `K` (first match wins): loading → nothing; analytics processing → `processing-CVLUrSce.js` ("Veo Analytics is processing...", "Please come back later!"); analytics error → error card ("There was an error processing %(featureName)s."); no team → card "Assign recording to a team" / "To get full access to all features, information for this match is needed." / button "Assign team" (→ `#match-setup/setup/teams`); periods loaded but empty → inline message "no-match-periods" ("No sides and periods", "To get full access to all Veo Analytics features, information for this match is needed.", "Edit sides and periods").
3. Player Stats Overview card (flag `player-stats-event` AND (`read_match_playereventstats` OR `read_match_playerphysicalstats`) AND not processing/loading AND has_analytics_enabled AND team) — see §8.
4. Key metrics + Recent form ("form guide", §9) — only if team has URL, `read_match_formguide`, and same conditions; followed by link "Analytics Studio" (if team permission `teams.read_team_analyticsstudio`) → `/clubs/{club}/analytics-studio/?team={team_slug}`.
5. Accordion (each item collapsible, lazy-loaded; header shows "Processing…" while analytics processing). An item is **disabled** when `!periods.length || analyticsProcessing || !component_dependent_data_supported || !has_analytics_enabled || loadingFeatureStatus`. Opening fires tracking `Analytics Feature Viewed {matchId,target}`. Order & gates:

| # | Header label | Permission | data-support gate | chunk |
|---|---|---|---|---|
| a | "Stats" | `analysis.read_match_stats` | always | `statistics-CCReLb_Z.js` |
| b | "Shot map" | `analysis.read_match_shotmap` | version ≥ 1.1 | `shotmap-Dj5DxQoc.js` |
| c | "Pass location" | `analysis.read_match_passlocations` | version ≥ 1.1 | `pass-locations-ypUPiHlG.js` |
| d | "Possession location" | `analysis.read_match_possessionlocations` | version ≥ 1.1 | `possession-locations-CJ4BYxkS.js` |
| e | "Pass strings" | `analysis.read_match_passstrings` AND NOT hide(match_report_v1 & v2) | version ≥ 1.1 | `pass-strings-mzj-odD9.js` |
| f | "Heat map" | `analysis.read_match_heatmap` | `ras_status["player-tracking"]` present AND `=== "completed"` | `heatmap-DP5wKYrX.js` |

Filter state kept per panel in `analysis-B7oi1Haw.js`: `{stats:{period}, shotmap:{period,team:"own"}, pass_location:{…}, pass_strings:{…}, possession_location:{…}}`; reset to "Full recording" whenever periods are re-saved.

Common filter widgets:
- Period select (`period-DoWvlsrn.js` + `utils-CUo0J2ML.js` `n`): section title "Select period"; options "Full recording" (value `undefined`) + "%(ordinal_number)s period" (1st, 2nd, … — ordinal from `utils-X7ELx8Cj.js` `Qe`), value = `period.public_identifier`.
- Team select (`team-period-info-McOt95JC.js`): two avatars own (team image or club crest, initials = own short name) / opponent (initials only). Values `"own" | "opponent"`. Under the selector a caption "<team short name> → <period label>".
- Short names (`utils-X7ELx8Cj.js`): own = `team.short_name_display || club.short_name || "Own"`; opp = `opponent_short_name_display || "Opp"`.

### 2. Stats (`statistics-CCReLb_Z.js`)

Chart: **mirrored horizontal bar comparison** per stat row (own left/home vs opponent right/away), optional 3-segment stacked bar with "unassigned" middle segment (for Possession minutes). Header: two team badges (`team-info-DYFmlebg.js`, home left), period select, "Edit rows" link (perm `matches.update_match`, → hash `stats/rows/edit/`). Info dialog "How are these stats calculated?" (title "Stats").

Data sources (merged by `stats.ordering`):
1. **Legacy tag stats** (when `!has_events_enabled`): `GET /api/app/matches/{slug}/stats/` (`src-CpmFfToj.js getMatchStats`, optional `?tag=`), response `{ ordering:[slug…], stats:{ [slug]:{ own, opp, byPeriod:{ "1":{own,opp},… }, stat:{slug,name,…} } } }` → transformed to `tags:[{own, opponent, periods:{[period.public_identifier]:{own,opponent}}, tag:{slug,name}}]` (period key `n` ↦ `periods[n-1].public_identifier`) (`analysisSlice-CRlRsXf0.js` `analysis/matchStats`). Edit rows = `POST` same URL with `{table:[slugs]}`; choices from `OPTIONS` → `POST.table.choices[{value,display_name}]` (`edit-rows-form-DokiFrN7.js`). Also `DELETE` exists.
2. **MES event stats** (when `has_events_enabled`): two parallel calls `GET /api/mes/v2/{match.identifier}/teams/Own/stats` and `…/teams/Opponent/stats` (`v2GetTeamStats`), response items `[{eventType,total,byPeriod:{ "<periodNumber>": n }}]`. Merge (`analysisSlice-CRlRsXf0.js` `mt`/`gt`):
   ```js
   stats[eventType] = {own: own.total, opp: opp.total, byPeriod:{p:{own,opp}}}; "MissedShots" goes to computed
   if (computed.MissedShots) { TotalAttempts = {...FootballShot}; FootballShot = {...computed.MissedShots} }
   rows: {own, opponent:opp, periods:{public_id:{own,opponent}}, type, name, tooltip, is_event:true}
   ```
   Row ordering then = `match.info.stats.table` if no legacy ordering. `FootballGoal` row is displayed as type `FootballShotGoal`; `TotalAttempts` row types = `["FootballShot","FootballShotGoal"]` (for clip playlists).
3. **RAS possession/pass stats** (when version ≥ 1.1 and not hidden by match_report_v1+v2): from `passes_and_possession.passes_possession_stats` (§3).

Row slugs & English labels/tooltips (`analysisSlice-CRlRsXf0.js` `P` and `L`):
- RAS: `PassesCompleted` "Passes completed" (Number of passes a team successfully made); `PossessionPercent` "Possession %" (type percent; Total team possession (passing and dribbling) of the ball); `PossessionMinutes` "Possession minutes"; `PossessionWon` "Possession won" (Number of times a team regained possession of the ball in open play).
- MES events: `FootballGoal` "Goal" (Number of goals scored), `FootballFreeKick` "Free kick", `FootballCornerKick` "Corner", `FootballGoalKick` "Goal kick", `FootballKickOff` "Kickoff", `FootballPenaltyKick` "Penalty", `FootballShot` "Shot" (Number of shots taken that did not result in a goal), `FootballThrowIn` "Throw-in", `FootballFoul` "Foul", `TotalAttempts` "Total attempts" (Number of goals and shots), `tackle` "Tackle", `duel` "Duel", `dribble` "Dribble", `interception` "Interception", `loose` "Loose ball recovery", `save` "Save". Rows for switch-gated types hidden unless switch on (`eventsSlice-Cwu7ipgL.js` `pt`).

Calculations (`statistics-CCReLb_Z.js` `Ps`): `total = own + opponent + (unassigned||0)`; bar widths `own/total*100`, `opp/total*100`, unassigned remainder; value label = raw number + "%" if `stats_type==="percent"`; lower value gets class `losing-stat`. Unassigned tooltip: "Out of possession for %(time)s %(unit)s" (minutes) (`utils-CUo0J2ML.js` `r`). Period filter: replaces values by `periods[selected_public_id]` (missing → 0).
Interaction: clicking own/opponent bar (only for tag rows or MES event rows) builds a video playlist `{source:"statistic", team, statistic, items}` from highlights with that tag (filtered by period) or MES events of that type & team & period.
Info dialog texts: "Veo Stats are generated in two ways: automatically through Veo AI and from events created by users." (events) / "...through our AI and from the tags used in user-created clips." (legacy); "Total team possession (passing and dribbling) of the ball, shown as a percentage."; "…shown in minutes. Minutes where the ball is out of possession are also displayed."; "Number of times a team regained possession of the ball in open play."; "Number of passes a team successfully made."; "Veo events" / "Goals, shots, free kicks, corners, penalties and goal kicks are counted and displayed."; "Veo tags"/"Custom tags" texts.
States: loading/saving → 5 skeleton rows; error (`stats==="error"` or `event_stats==="error"` or RAS error) → "Error generating the stats table" + retry; empty ordering → "No rows displayed".

### 3. Passes & possession raw data (RAS `match-details`) — feeds Stats(RAS rows), Pass location, Possession location, Pass strings

Request (`analysisSlice-CRlRsXf0.js` `analysis/fetchPassesAndPossession`), triggered after periods load / ras_status fetch when `periods.length && version ≥ 1.1`:
```
GET {RAS}/recordings/{match.identifier}/match-details?filters={p1.start},{p1.end}&filters={p2.start},{p2.end}[&interactiveStrings=true]
```
(one `filters=` per match period timeframe, in seconds of video; `interactiveStrings` only with flag `interactive-pass-strings`). Stored raw as `passes_and_possession_data`; state `passes_and_possession = "loading"|"error"|{pass_locations, pass_strings, passes_possession_stats, possession_locations}`.

Response consumed: array of per-period objects, matched to a period by exact `start===timeframe[0] && end===timeframe[1]`:
```
{ start, end,
  passLocations:      { L:[{x,…}], R:[{x,…}] },              // x in 0..1 along pitch length
  passStrings:        { L:[[nPasses, count, [{start,end,endLocation}]]], R:[…] },
  possessionLocations:{ L:{defensive,middle,attacking}, R:{…} },  // seconds or counts
  stats: { PossessionSeconds:{L,R}, PassesCompleted:{L,R}, PossessionWon:{L,R} } }
```
Side mapping per period: `own = own_side==="left" ? "L" : "R"`, `opponent = the other` (L/R = half the team defends/starts in).

#### 3.1 Possession/pass stats (`kt`)
```js
PossessionMinutes.unassigned = Σ period durations − Σ(ownSec+oppSec)
PossessionPercent = own/(own+opp)*100 (rounded; tooltip toFixed(2)+"%"); per period the same
PossessionMinutes.own = round(ownSec/60) (tooltip mm:ss via utils `et`)
PassesCompleted, PossessionWon = sums of L/R mapped to own/opp
```
#### 3.2 Pass location thirds (`Et`)
For each pass `{x}`: `x<1/3` → zone of left third, `x>2/3` → right third, else middle. If own_side left: L-team left third = "defensive", right third = "attacking"; R-team inverse. Values = share of passes in zone (0..1) per team overall and per period.
#### 3.3 Possession location (`Mt`)
Sum `possessionLocations[side].{defensive,middle,attacking}` per team; percentages = zone / total; `possession_location_data_available = own.total || opp.total`.
#### 3.4 Pass strings (`Pt`)
Per team list of `[n, count, clips[]]`, clips `{start:max(s-5,0), end:e+5, endLocation, id}`; full-match = merged by n (counts summed, clips concatenated), sorted by n.

### 4. Pass location (`pass-locations-ypUPiHlG.js` → `locations-map-DpkOCKBe.js`)
Chart: **pitch split into three vertical thirds** (colored bars "max/medium/min" by rank + percentage circles "NN%"). Footer labels "Defensive", "Middle", "Attacking". Filters: team (own/opponent), period. Values `Math.round(share*100)`.
Info dialog "How to read Pass location": "Powered by Veo AI, the pass location chart automatically shows where your team's successful passes are happening on the pitch"; "Completed passes only" / "The pass location chart is based on the data from the passes completed stat…".
States: spinner; error "Error generating pass location" + retry (re-fetch match-details).

### 5. Possession location (`possession-locations-CJ4BYxkS.js` → `locations-map-DpkOCKBe.js`)
Same thirds chart from §3.3. Error: "Error generating possession location"; if no data and not error → "Not available for recordings before %(date)s" with date 07-13-2023 (no retry). Info dialog "How to read Possession location": "Veo's AI-generated possession location map automatically shows where teams had possession (passing and dribbling) on the pitch."; "Common patterns" …; "Possession with a purpose" ….

### 6. Pass strings (`pass-strings-mzj-odD9.js`)
Chart: **vertical bar histogram**: x-axis "Connected passes" bins `[2 (only with flag include-2-pass-strings),3,4,5,6,7,8,9,"+10"]` ("+10" = all n≥10), y-axis "Strings" ticks `20,16,12,8,4,0`; bar height = `min(100, count/20*100)%` (fixed max 20). Tooltip "%(number)s connected passes %(count)s times".
Stat tiles: "3 to 5 passes" (Σcount n∈3..5), "6 or more passes" (Σ n≥6), "Longest pass string" (max n or "?"), plus with include-2 flag: "Average pass string" (`Σ(n*count)/Σcount`, 1 decimal) and "Total pass strings" (Σcount). With flag `interactive-pass-strings` tiles and bars are buttons building a playlist from the clips `{start,end}`.
Filters: team, period. Error "Error generating pass strings" + retry. Info "How to read the Pass strings": "Powered by Veo AI, the pass strings chart automatically shows how many continuous passes happened for each team, broken down by the number of passes in the string."; "Pass and move"; "Identify styles of play" (Mostly short strings? … direct style…).
Hidden when match_report_v1 experiment on and version 2.

### 7. Shot map (`shotmap-Dj5DxQoc.js`, data `analysisSlice-CRlRsXf0.js` `analysis/fetchShotmap` + `J` + `wt`)
Chart: **full pitch SVG with shot/goal markers** (viewBox 0 0 234 150 = `settings-DLtzORLW.js` `re={width:234,height:150}`, rendered ×1.05), labels "Left wing"/"Right wing". Markers class by `event_type` "goals"/"shots"; tooltip = match time (`utils` `u` mm:ss, computed from periods; MES events get rich tooltip `content-FSTdnf7Y.js` with delete). Animated appearance (delay 75ms × index).
Data source:
- If events enabled (`Et(match)`): MES events from store (`eventsSlice`) types `FootballShotGoal`/`FootballShot`:
  ```js
  loc = [...pitch_location]           // MES x,z (0..1)
  if (period && ((own_side==="right" && is_own_team) || (own_side==="left" && !is_own_team))) loc=[1-loc[0],1-loc[1]]
  loc[0] = loc[0]*2-1                 // → x ∈ [-1,1], y=loc[1] ∈ [0,1]
  name = FootballShot ? "kick_shot_no_goal" : "kick_shot_goal"; team = is_own_team?"own":"opponent"
  ```
  i.e. every team's shots normalised so the team attacks towards x=+1.
- Else legacy `GET {RAS}/recordings/{match.identifier}/shot-details` → `{shot_details:[{name, timestamp, side, location:[x,y], team?, id?,…}]}`; `team = team || (period.own_side===side ? "own":"opponent")`; `x=min(x,1)`, `y=clamp(y,0,1)`; goal iff `name==="kick_shot_goal"`. Shots outside any period dropped (unless MES).
- Each shot gets clip window `start=max(t-5,0)`, `duration=5+(t-start)`.
- Result `{own:{goals,shots,total}, opponent:{…}, periods:{public_id:{own,opponent}}}`.
Coordinates: x ∈ [-1,1] (0 = halfway, pitch length), y ∈ [0,1] from bottom; svg `x_svg=(x+1)/2*234, y_svg=y*150`. Penalty boxes (svg units): right `x 198.132–234, y 31.4706–118.529`; left `x 0–35.8679`, same y.
Stat buttons: "Goals" n, "Shots" n, "Total attempts" n (click = playlist of those, hover de-emphasises others). Text: "%(rate)s% conversion rate." (`round(goals/total*100)`), "%(percentage)s% inside box conversion rate.", "…% outside box conversion rate.", "…% of total attempts inside box.", "…% of total attempts outside box." (box test above).
Shots without location (NaN x/y): strip "Shots with missing location" or (editor) "Drag shots with missing location onto the shot map".
Editing (MES events + perm `matches.update_match_events`): drag-and-drop; new location saved via event update with `pitch_location=[x/2+0.5, y]` un-flipped (`analysisSlice-CRlRsXf0.js` `ee`); banner "Control your shot map" / "Adjust the position of shots and goals by clicking and dragging them."
Filters: team (own/opp), period. States: spinner; "Error generating shot map" + retry; error shows "?" counts.
Info "How to read the shot map": "Veo's AI-generated shot map automatically shows where shots happened and which were goals, for both teams."; "Present the facts"; "Identify trends"; events: "Control the data" (edit), legacy: "It's a new data model" ("The Shot map data is different to the data used to generate the Veo stats table…").

### 8. Heat map (team) (`heatmap-DP5wKYrX.js`, `analysisSlice-CRlRsXf0.js` `analysis/fetchIntervalHeatmap`)
Chart: **server-rendered PNG/blob image** overlaid by pitch SVG (234×150 ×0.95). Request (debounced 500 ms):
```
POST /api/mes/v2/{match.identifier}/heatmap   body {categories:[1]|[3], startTime, endTime}
```
(`src-CpmFfToj.js` `v2GenerateHeatmap`; categories `[1]` = team on the **left** side in that period, `[3]` = team on the **right**; startTime/endTime in video seconds). Response = image Blob (`size===0` → error) → `URL.createObjectURL`. (Legacy unused alternative `POST /api/app/matches/{id}/analysis/heatmap/ {categories,start_time,end_time}` exists in `src-CpmFfToj.js` `generateHeatmap`.)
Controls: team avatars (left team first; label/avatar derived from period's `own_side`), period dropdown "Select period" (only real periods, "%(ordinal_number)s period", no full-match option), **range slider** "Set heat map interval" (domain = period timeframe, step 60 s, handle tooltip mm:ss), caption "%(start)s to %(end)s" and team name with direction arrow. Switching to a period with different own_side flips side to keep same team.
Default: first period, own team's side, full period interval.
States: spinner; "Error generating heat map" + retry; panel hidden if no period.
Info "How to read the heat map": "Use heat maps to understand your team's positioning over time…", "Select team" ("Heat maps are displaying one team at a time…"), "Set heat map interval", "Read the heat map" ("The redder the heat map gets - the higher the concentration of play is in that area. The heat map is team-based player tracking and does not differentiate between on- and off-ball…").

### 9. Key metrics carousel + Recent form ("form guide") (`analysis-B7oi1Haw.js` `wa/La/Pa/Ta`, worker `worker-CgfQocFn.js`)
Data via web worker commands (`studio-worker-D7X77VUn.js`): 
- `fetch_selected_key_metrics {club_slug, team_slug}` → `GET /api/app/clubs/{club}/teams/{team}/key-metrics/` (204 → default `[possession_percent, goals_scored, shots_on_goal]`).
- `fetch_current_match_data {match, selected_key_metrics}` → per match: `GET /api/app/matches/{id}/feature-processing-status/`, `GET {RAS}/…/analytics` (version), `GET /api/app/matches/{id}/periods/` (if missing), score from `match.info.stats.score|score_aggregated` (fallback `GET /api/app/matches/{id}/`), then `match-details?filters=…` (if any selected metric id contains possession/pass_location/passes/pass_string) and stats: MES `POST /api/app/analysis/stats/ {type:"team_match", team_id, match_ids:[id], group_by:"team_association"}` or legacy `GET /api/app/matches/{id}/stats/?tag=goal&tag=corner&…`.
- `fetch_recent_matches_data` → `GET /api/app/matches/?ordering=-created&team={team}&club={club}&page_size=3&date_end={matchStart−1s ISO}&has_analytics=true&type=league&type=cup&type=tournament&type=friendly&type=showcase&type=none`.
Key metric definitions/labels/units from `settings---F8aIpR.js` (team metric groups Possession/Passes/Events/Combos, e.g. "Possession %", "Passes completed", "3 to 5 passes", "Goals scored", "Shots", "Conversion rate", "Win ratio" …).
Card: title, value (+unit), progression arrow and "Difference of %(count)s compared to last match" / "No difference compared to last match" (value − previous match value); `win_ratio` = `round((#wins in recent + (own>opp?1:0)) / (recent.length+1) * 100)` with caption "Based on this recording and recent form." / "Based on this recording.". Slick carousel with dots/arrows (placeholder 4 dots). Empty: "No key metric added" / "Help your team stay focused on the stats that reflect your playing style. Select key metrics from the Analytics Studio."
"Recent form" list (3 previous matches): thumbnail, title, "home - away" score, date, value of current key metric (win_ratio → W/D/L). Status icons: "No sides and periods" (missing-periods), "Veo Analytics is processing" (processing/pending), "Error loading status", "Has an error", "Using an older Analytics version" (no value & older version). Click opens match in new tab.

### 10. Player Stats Overview (in-match table, team scope) (`analysis-B7oi1Haw.js` + `match-player-stats-provider-CW6BTXEl.js` + `stats-table-ZqGmS2aN.js`)
Card "Player Stats Overview" + tag "New!" + image + button "View table" → modal (lg). Modal header "Player Stats Overview" / "A statistical overview for this match.", button "Edit columns"; column editor "Edit columns" / "Select the stats in the order you want them displayed in the table, from left to right." with groups General/Physical/Events, footer "%(selected)s/%(total)s selected:", "Please select at least 1 column", "Reset", "Apply selection". Columns persisted in localStorage `veo.match-player-stats.columns.{matchId}`.
Default columns: minutes_played, distance_covered, average_speed, top_speed, sprints, high_intensity_runs, TotalEvents, FootballGoal, assists, GoalInvolvements, ConversionRate, MissedShots, TotalShots, tackles, FootballCornerKick, FootballFreeKick, FootballThrowIn, FootballFoul, FootballPenaltyKick, FootballGoalKick (labels/abbrevs in `settings---F8aIpR.js`, e.g. "Minutes tracked"/Min, "Distance tracked"/Dist, "Average speed"/AS, "Top speed"/TS, "Sprints"/Spr, "High-intensity runs"/HIR …).
Data: worker `fetch_player_stats_data {teamId, recordings:[{identifier}], skipRecordingLookup:true}` → `POST /api/app/analysis/stats/ {type:"cross_match", team_id, match_ids:[id], group_by:"player"}` (or with includePeriodStats & 1 match: `{type:"match_all_players", match_id, team_id}`) → `{items, meta:{positions}}` (`worker-lkm0OaJA.js` `Jm`/`wae`), table built by `build-table-data-D2wG9dW9.js` ("single-match", dropNonParticipants).
Cells for event metrics are chips "Watch N goals/shots/…" → navigate to events panel with `?event_type=…&event_player={user_id|jersey}` and play matching events (mapping metric→event types in `stats-table-ZqGmS2aN.js`: FootballGoal→FootballShotGoal, MissedShots→FootballShot, TotalShots→both, tackles→tackle, duels→duel, dribbles→dribble, interceptions→interception, loose_ball_recoveries→loose, saves→save, passes→pass, set pieces 1:1).
States: error "We couldn't load the Player Stats table." + retry; no-data "No player data detected" ("Veo AI did not detect jersey numbers in this recording…", button "Contact support"); banner "No players in the Lineup!" ("To view players, simply add them to the Lineup. Include an AI-detected jersey number for AI stats!"). Buttons "Edit lineup", "All player stats" (→ Analytics Studio `?team=…&recording_id=…#player-stats`). Sortable columns ("Sort by X ascending/descending"), own row highlighted.

### 11. Match momentum (timeline graph) (`detail-B56tzMIL.js` `X_`/`I_`, `analysisSlice-CRlRsXf0.js` `analysis/fetchMatchMomentumData`)
Request: `GET /api/mes/v2/{match.identifier}/match-momentum` → `items` = array of `[timeSeconds, value]` (stored `match.match_momentum`).
Toggle "Match momentum" in the timeline view/filter menu, available iff `perm analysis.read_match_momentum && has_analytics_enabled && (feature_processing_status.analytics === "completed" || processing)` (spinner while processing). 
Chart: **smoothed line/area graph** under the video timeline (height 60 px, d3 curve), y scale symmetric `[-max|v|, +max|v|]`. Sign normalisation: `flip = own_team_at_home ? own_side==="right" : own_side==="left"`; value negated if flip; points outside periods → null (gap). So positive = home team side attacking (left end/right end).
Side info: crest + "Action location %" per side: `home_or_left_side = round(#points>0 / #non-null *100)`, `away_or_right_side` likewise for <0. Without periods: labels "Left end"/"Right end". Hover shows circle on the curve.
Info dialog "Match momentum": "Follow the action" ("…identify and explore situations where you're attacking in the opponent's half or when you are being pushed back into your own half. The more extreme a peak is on the graph, the closer the action is to the end of the field."), "Action location %" ("…how much of the action took place in either side of the field."), "How is it calculated" ("The data is generated by tracking a combination of player positions and running speeds."). Older variant texts "Look for peaks", "Create clips".

### 12. Match events (team events list & timeline strip) (`eventsSlice-Cwu7ipgL.js`, `events-C4yabS_5.js`, `filter-DUlE4LoA.js`, `list-BShiMZvQ.js`)
Fetch: `GET /api/mes/v2/{match.identifier}/match-events?aggregatedDuels=true` (params also `team`, `playerJersey`, `eventTypes`) → `{events:[…]}`; MES event fields consumed: `id, matchId, eventType, team ("Own"|"Opponent"), playerId, playerJersey, videoTimeMs, periodId, periodTimeMs, x, z, outcome, attributes[{label,type,value}] (FootballAssist, CreatedByUser, opponent_event_id, opponent_jersey), editors[{editorId}]`. Normalised to `{type, time=videoTimeMs/1000, pitch_location:[x,z], is_own_team, player_id, player_jersey, assisting_player_id, period:{number,timestamp}, creator_id, display_type}`. Goal + preceding shot (same team, within 10 s) merged into `FootballShotGoal`. Allowed types: FootballGoal, FootballGoalKick, FootballCornerKick, FootballFreeKick, FootballPenaltyKick, FootballShot, FootballKickOff, FootballThrowIn, FootballFoul, FootballOutOfPlay + switch-gated tackle/dribble/duel/interception/loose/save/pass. 404 → empty.
Display names (`settings-CwadC6hT.js`): Goal, Corner, Freekick, Goal kick, Penalty kick, Shot, Kickoff, Throw-in, Foul, Tackle, Duel, Dribble, Interception, Loose ball recovery, Save, Pass.
Filters ("Filter Events" panel): "Event types", "Teams" (Own team/Opponent team), "Players" (lineup players or "Jersey #%(jersey_number)s"), "Created by", "Match periods" (needs sides & periods); counts per option; URL params `event_type`, `event_team`, `event_player`, `event_period`, `event_creator`. List texts: "Events", "Play all"/"Stop all", "Filtered events:", "There are no events on this recording. Add events to manage stats and match data.", "We could not load your events. Please refresh your browser or try again later." CRUD via `v2CreateEvent`/`v2UpdateEvent` (PATCH)/`v2DeleteEvent`; period changes sync via `mesV1Events.userSync`.

### 13. Periods (prerequisite for everything)
`GET /api/app/matches/{slug}/periods/` (sorted by `timeframe[0]`) and `POST` same (`createPeriods`, body array of `{own_side:"left"|"right", timeframe:[startSec,endSec], name?, …}`), response items `{duration, is_confirmed, name, own_side, public_identifier, timeframe:[s,e], user_modified}`. Saving periods clears `heatmap, heatmap_data, shotmap, passes_and_possession` and refetches. `own_side` = side the own team defends/starts on in that period; drives every L/R ↔ own/opponent mapping. Match time (`utils-X7ELx8Cj.js` `Zt`): cumulative in-period seconds, labels "Pre match", "Break", "Post match", "%(ordinal_number)s period".

### 14. Upsell / empty states for whole panel
- `teaser-B7TO5vRp.js` ("Analytics 2.0"): "Level up with Analytics!", "Get Veo Analytics"; feature cards Shot map, Radar, Pass strings, Match statistics, Analytics Studio; testimonials.
- `promo-DAPmxhTb.js` (flag player-stats-event): admin: "Unlock coaching insights for your matches.", bullets "Season charts", "Player heat maps", "Coach Assist AI", CTA "Add Analytics 2 to your plan" (upgradeFlow `veo-analytics-2`, source `analytics-panel` → `/clubs/{club}/plan-and-billing?upgradeFlow=…`); non-admin: "See how you actually play", "Notify the admin about this"; cards "Team & player stats", "Coach Assist", "Veo Vision", "Player Moments", "Scoreboard & radar".

### Open questions (need live API)
1. Exact semantics of `categories` for `POST /api/mes/v2/{match}/heatmap` (only `[1]` left-team and `[3]` right-team are used; what are 0/2/4? ball? both teams?), image size/format (PNG?), colour scale, whether startTime/endTime are video seconds or period-relative.
2. `GET {RAS}/recordings/{id}/match-details` full schema: units of `possessionLocations` values (seconds vs counts), `passLocations` items (only `x` used — are there `y`, `t`, player?), `endLocation` format in passStrings, effect of `interactiveStrings=true`.
3. `shot-details` item schema (`name` values beyond `kick_shot_goal`, `side`, `location` range — assumed x∈[-1,1], y∈[0,1]).
4. MES event `x`/`z` ranges & orientation (assumed 0..1, origin bottom-left of own-left half) and whether backend pre-normalises by period.
5. `match-momentum` items shape (assumed `[seconds, value]`), value range and sign convention before client flip.
6. `teams/{Own|Opponent}/stats` `byPeriod` keys (assumed 1-based period numbers) and the full set of `eventType` keys incl. `MissedShots`.
7. ras_status JSON exact shape/values (status strings per key) and the `match.identifier` vs `recordings[0].identifier` relationship.
8. `POST /api/app/analysis/stats/` response item fields for `team_match`/`cross_match`/`match_all_players`.

## 1b. Team views across matches (season): Analytics Studio "Team stats"

Scope: everything a TEAM sees across several matches. Single-match analytics on the match page (`analysis-B7oi1Haw.js` etc.) are covered elsewhere; they are cross-referenced only where the same code is reused.

All file names are chunks in `veo-web/js/`. The worker-side quotes come from the readable (non-minified) web worker `worker-lkm0OaJA.js`, which does all the Analytics Studio data fetching and aggregation. Its app code starts around byte offset 1.96 M; it was extracted to `extract/worker-app.js`, and line numbers below ("worker L…") refer to that extract.

---

### 0. Where it lives / routing / page shell

| Item | Value | Source |
|---|---|---|
| Route | `/clubs/:club_slug/analytics-studio/` (`analytics_studio`), with the team chosen via `?team=<team_slug>`. Tab is in the hash: `#team-stats` / `#player-stats` | `settings-DLtzORLW.js` (route table), `bootstrap-Mr09pQaM.js` (route → lazy `view-BYcaVA08.js`), `utils-R-UBdmQb.js` (`A={team_stats:"#team-stats",player_stats:"#player-stats"}`) |
| Team route alias | `/clubs/:club_slug/teams/:team_slug/analytics-studio/` renders the team detail page (`detail-DZUR0GJO.js`), which **redirects** to `analytics_studio?team=<team_slug>` | `detail-DZUR0GJO.js` (`case"analytics-studio":o(\`${J(z.analytics_studio,{club_slug:r})+"/"}?team=${n}\`)`) |
| Team detail page itself | Has **no analytics panels**. Its tabs are Recordings / Members / Lineup ("Team default lineup") / Settings. Key metrics are **not** shown there. | `detail-DZUR0GJO.js` (string list) |
| Page title | `[club.title, "Analytics studio", "Team stats"\|"Player stats"].join(" - ")` | `view-BYcaVA08.js` |
| Team picker | Hero banner showing "Team" + team name h1 + dropdown of club teams. Teams the user can't access are disabled. The last team is remembered in localStorage `veo.analytics-studio-team` (per club slug), and `?team=` wins. Club teams are fetched with fields `name,slug,id,image,match_count`; for non-admins, the user's teams use `filter=own`, fields `slug` | `view-BYcaVA08.js` |
| Tabs | "Team stats", "Player stats". The Player stats tab is locked with a lock icon and tooltip "Included in Analytics 2" when flag `player-stats-event` is on and the user lacks full access. Otherwise it is disabled with tooltip "Upgrade to Analytics" | `view-BYcaVA08.js` |
| Section nav (Team tab) | Pills, in this order: "Key metrics" (always), "Shot map", "Passes", "Possession" (only if `can_view_all_analytics_features` AND game maps are available, i.e. loading or `match_count>0`), "Comparison" (only if `can_view_all_analytics_features`). Scroll-spy anchors: `analytics-key-metrics`, `analytics-shot-map`, `analytics-passes`, `analytics-possession`, `analytics-comparison` | `view-BYcaVA08.js` (`Os`), `settings---F8aIpR.js` (`M` ids) |
| Other hero content | Coach note ("Add Coach Note" / "Coach note added"), "Manage team" button (→ team members page), Coach Assist chat button ("Coach Assist", gated by flag `coach-assist-chat-bot` + permission `coach_assist.create_run`) | `view-BYcaVA08.js` |
| No team recordings | If `team.match_count` is 0, the page shows `no-team-recordings-KGSQxSVx.js`: "No recordings for this team yet" / "Record your first match and assign it to this team to see player stats." (with filters: "No recordings found" / "There are no recordings with the selected filters. Change the filters to see player stats.") | `view-BYcaVA08.js`, `no-team-recordings-KGSQxSVx.js` |

#### Permissions and gates (Team tab)

| Gate | Effect | Source |
|---|---|---|
| Club permission `teams.read_club_analyticsstudio` | Without it, the whole page is replaced by a promo: `studio-promo-CP0Gknpg.js` (if flag `player-stats-event`) or the `teaser-*.js` upgrade teaser | `view-BYcaVA08.js` |
| Team permissions are loaded via redux `Mt("analytics_studio_team_permissions",{club_identifier,team_identifier,fields:["permissions","slug"]})`. This is presumably GET `/api/app/clubs/{club}/teams/{team}/?fields=permissions&fields=slug` (verify) | — | `view-BYcaVA08.js` |
| `analysis.read_team__comparisonradial` → `can_view_all_analytics_features` (the "full analytics" / Analytics 2 entitlement) | Without it, only Key metrics are shown (and only metrics from the `events` group). Game maps and the comparison radial are replaced by `locked-preview-D0aNOzrl.js` (flag `player-stats-event`) or `teaser-CfdTMLSA.js`. The "Analytics" filter is disabled with tooltip "Upgrade to Analytics" | `view-BYcaVA08.js`, `team-stats-gKfAgKCX.js` (`Wn`), `analytics-provider-5HbdX-Qm.js` |
| `analysis.update_team__keymetrics` | Shows the "Edit key metrics" button and the "Add a key metric…" tile | `view-BYcaVA08.js`, `team-stats-gKfAgKCX.js` |
| `analysis.update_team__comparisonradial` | Shows "Edit metrics" on the radial; the radial config is persisted | same |
| `analysis.read_team__coachnote` / `analysis.update_team__coachnote` | Coach note visible / editable | `view-BYcaVA08.js` |
| Feature switches (waffle SWITCHES) hide individual metrics: `tackles-dribbles-analytics-2` (tackles, dribbles), `duels-analytics-2` (duels), `interceptions-recoveries-analytics-2` (interceptions, loose_ball_recoveries), `saves-analytics-2` (saves), `player-passes-analytics-studio` (player passes*) | Metric options are filtered out unless the switch is on | `switch_gated_groups-Bjk8c6gu.js`, `gated-metrics-gn4_9qmN.js`, `analytics-provider-5HbdX-Qm.js` |
| Feature flags (waffle FLAGS) used: `player-stats-event`, `analytics-reduced-accuracy`, `analytics-studio-enable-for-all`, `vwa-new-plural-forms`, `team-default-lineup`, `coach-assist-chat-bot` | see the relevant rows | `feature_flags-CEQAkNH2.js` |

Locked preview copy (`locked-preview-D0aNOzrl.js`): badge "Part of Analytics 2". The header is "Level up with Analytics 2" with the paragraphs "Get more from every match with Analytics 2." and "Upgrade to access Shot Maps, Possession Location, and advanced tactical views — plus player-level performance data." Three locked sections, each with a background image `/img/analytics-2-locked-*.webp`:
- "See where this team scores from" — "Shot maps reveal your most dangerous zones and where chances are being wasted."
- "See where you control the game" — "Possession location shows which thirds you dominate — and where you give the ball away."
- "Compare your team's progression over time" — "Asses how your team is performing and progressing over time."

Teaser (`teaser-CfdTMLSA.js`) copy:
- "Level up with Analytics!"
- "Unlock powerful insights to understand your game and instantly spot areas for improvement."
- "With Analytics, you get full Studio access, including advanced data and tools to analyze your team across matches."
- Button "Get Veo Analytics" / "Upgrade now" (Amplitude experiment `analytics-cta-ctr`)
- Feature videos: "Shot maps", "Pass location", "Possession location", then "...and more.", "Learn more"

---

### 1. Filters (shared by Team stats and Player stats)

Provider: `filters-provider-B_R5WMcO.js`. UI: `view-BYcaVA08.js` (`ba`, `ha`, `_e`).

| Filter | UI labels | Values → API query params on `GET /api/app/matches/` | Source |
|---|---|---|---|
| Recordings count | "Last 3 recordings", "Last 5 recordings", "Last 10 recordings" (**default**), "Last 20 recordings"; submenu "Select amount" | `page_size=N` (only the first page is fetched) | `filters-provider-B_R5WMcO.js`, worker L5227 `xr` |
| Date range (alternative to count) | date picker | `date_start=<ISO of day0 00:00 local>`, `date_end=<ISO of day1 with setUTCHours(23,59,59)>`; one date → same day. Paginates via the `Link` header (`rel="next"`) until exhausted | worker L1387 `Cte`, L5227, L1662 `Mo` |
| Explicit recording selection | picker of the team's latest 50 recordings (`GET /api/app/matches/?team=&club=&ordering=-created&page_size=50`). Disables the other filters | `recordings=<identifier>` (repeated). The worker then fetches `GET /api/app/matches/{id}/` per recording instead of the list | `view-BYcaVA08.js` (`va`), worker L1662 |
| Analytics type ("recordings_type") | With flag `player-stats-event`: "All recordings", "Only with Analytics (1 or 2)", "Only with Analytics 2", "Only with Analytics 1", "Without Analytics". Without the flag: "All recordings", "Only with Analytics", "Without Analytics". Submenu "Select" | all → nothing; any → `analytics_version=any`; 2 → `analytics_version=2`; 1 → `analytics_version=1`; none → `has_analytics=false` | `filters-provider-B_R5WMcO.js`, worker L1615–1626 (`va`, `xte`) |
| Default analytics type | full access + flag → "Only with Analytics 2"; full access, no flag → "Only with Analytics"; no full access → "Without Analytics" (forced, and the selector is disabled) | — | `filters-provider-B_R5WMcO.js` (`ge`) |
| Match types | "Match types", "All match types", group "Select multiple"; options come from the server | `type=<value>` (repeated) | `filters-provider-B_R5WMcO.js` |
| Formations | "Formations", "All formations"; grouped by `group.key`. Groups `9-a-side`, `11-a-side`, `other` are expanded by default, the rest are collapsed ("Show all"); "Apply filter" | `own_team_formation=<value>` (repeated) | same |
| Always | — | `ordering=-created&team=<team_slug>&club=<club_slug>` | worker L5227 |
| Player filter (player tab) | — | `has_lineup_player=<…>` | worker L5227 |

- Filter option source: `OPTIONS /api/app/matches/?filters=type&filters=own_team_formation` with headers `Accept-Language`, `veo-agent: veo:svc:web-app`. It reads `filters.type.choices[{value,display_name}]` (excluding `any`, `test`) and `filters.own_team_formation.choices[{value,display_name,group:{key,label}}]` (excluding `any`). On error it falls back to options without groups (`filters-provider-B_R5WMcO.js`).
- Persistence: localStorage `veo.analytics-studio.filters` (keys recordings_count, recordings_dates, formation, match_type, recordings_type). Filters are mirrored into the URL query: `analytics`, `recordings_count`, `recordings_dates_start`, `recordings_dates_end`, `recordings_selection`, `type`, `formation`. A legacy URL param `has_analytics` is also read. The URL param `recording_id` overrides everything, but only on the player tab (`filters-provider-B_R5WMcO.js`).
- Changing the team clears `recordings_selection` and resets to "Last 10" (`filters-provider-B_R5WMcO.js`).

#### Match overview card (above the filters)

Source: `view-BYcaVA08.js` (`ss`, `fs`, `gs`).

- It loads the same filtered match list. If `recordings_selection` is set, it calls `getMatch` per id. Then for every match it calls:
  - `GET /api/app/matches/{id}/lineup/`. It uses `is_complete`; a 404 counts as `false`, other errors as `null`.
  - Only with flag `analytics-reduced-accuracy`: `GET /api/mes/v2/{match_id}/quality`. It uses `jersey.legibility`; "reduced" or "poor" means reduced accuracy.
- Count row:
  - "%(total)s matches filtered"
  - "%(count)s incomplete lineups"
  - "%(count)s reduced accuracy"
  - Loading: "Loading matches..."; empty: "No matches found"; error: "Something went wrong" + "Retry"
  - Toggle: "Show matches" / "Hide matches"
- Each row:
  - meta: "Today" / "Yesterday" / date, joined with " · " to "Analytics 2" or "Analytics 1"
  - label: "vs %(opponent)s", else the title, else the date+time
  - status tag:
    - "Lineup" (x icon), tooltip "The lineup is missing or incomplete. Complete it to attribute 'Starts' to the participating players."
    - "No AI data", tooltip "This recording was processed with Analytics 1. Data only includes goal, shot, free kick, goal kick, penalty kick, corner kick, throw-in and foul events that have been manually assigned to players."
    - "No Analytics", tooltip "This recording was processed without Analytics. …"
  - "Reduced accuracy" tag, tooltip "AI event and jersey number detection accuracy is reduced for this match. Click to learn more."
  - action: "Complete lineup" → `/matches/{slug}/#lineup`; otherwise "Open match"
  - Sort order: incomplete → reduced accuracy → full/unknown → no-AI → no-analytics.
- Footer note:
  - all matches without Analytics 2: "These matches don't have Analytics 2 - some AI stats won't be available."
  - mixed: "Some of these matches don't have Analytics 2 - some AI stats won't be available."
  - plus "Learn more" (help-centre article "What-you-get-with-each-version-of-Veo-Analytics")
- `analytics_version` defaults to "2" if missing in the list response.

---

### 2. Data pipeline (worker): what is fetched per match and how it is aggregated

Trigger: `analytics-provider-5HbdX-Qm.js` posts `{command:"fetchRecordingsData", filter_data:{...active_filters, club_slug, team_slug}, selected_key_metrics}` to the worker `worker-lkm0OaJA.js`, which is started by `studio-worker-D7X77VUn.js`. It refetches whenever filters or selected key metrics change. The response is `{match_count, key_metrics_data:{key_metrics:[{id,value}], matches:[…]}, game_maps_data:{shotmap_data, pass_locations_data, possession_locations_data}}`, or `"error"` on failure (worker L6593–6669).

The worker sends these headers on every call: `Authorization: Bearer <token>` (if set), `x-csrftoken` on POST/PATCH/PUT/DELETE, `Accept-Language`, `veo-agent: veo:svc:web-app`, and `credentials: include`. Base URL: `API_APP_URL`, else `${SERVER_URL}/api/app` (worker L993–1011).

**Step A — match list.** `GET /api/app/matches/?<filters>` (see §1). Results are sorted ascending by `start || created` (worker L1662–1689).

**Step B — enrich each match** (`Wm`, worker L1705–1738):
1. Score:
   - `info.stats.score.{own,opponent}`, else `score_aggregated`.
   - If these aren't integers, it refetches `GET /api/app/matches/{id}/` and reads `info.stats.score`.
   - Result: `match_result` = win/loss/draw (own vs opponent); `home_score`/`away_score` are swapped by `own_team_home_or_away`.
2. Analytics version (`Bte`, worker L1630):
   - `GET /api/app/matches/{id}/feature-processing-status/` → `analytics`.
   - If it isn't "completed", the version is "1.1" and `status` gets the processing status: e.g. `processing`, `pending`, `not-purchased`, `sport-not-eligible`, `veo-cam-only`.
   - If completed: `GET {RAS_URL}/recordings/{id}/analytics` (fallback `/recordings/{id}/analytics/analytics`, `credentials:"omit"`). The JSON keys decide the version:
     - `ball-tracking` + `match-details` + `shot-details` + `match-report` → "2"
     - the first three without `match-report` → "1.1"
     - otherwise → "1"
   - On error: version "1.1", status "fetching-error".
3. Periods: `match.periods` from the list, else `GET /api/app/matches/{id}/periods/`. Each period has `{public_identifier, timeframe:[startSec,endSec], own_side:"left"|"right"}`. If there are no periods and the version is ≥1.1, the status is `missing-periods`.
4. `should_use_mes_events = match.has_events_enabled` (MES = Match Event Service v2).
5. The other fields kept in `match_info`:
   - `club.crest`, `club.short_name`, `opponent_short_name_display`, `opponent_team_name`, `own_team_home_or_away`
   - `permissions`, `privacy`, `slug`, `sport`, `tactics_info`
   - `team.{image,id,short_name_display,name}`
   - `thumbnail`, `title`, `type_name`, `url`, `view_count`
   - `date = start || created`

**Step C — per-match analytics requests** (`$m`, worker L1738–1762). What is requested depends on the selected key metric ids; for the Team stats page `r=true`, so match-details and shot-details are always requested:

| Request | When | Endpoint | Consumed fields |
|---|---|---|---|
| match-details | no `status` AND version ≥1.1 AND periods exist | `GET {RAS_URL}/recordings/{id}/match-details?filters=<t0>,<t1>&filters=…` (one `filters` per period timeframe, comma-joined seconds) | Response is an **array, one entry per period** (same order as the periods). Each entry: `passLocations.{L,R}[{x,…}]`, `passStrings.{L,R}[[length,count],…]`, `possessionLocations.{L,R}.{defensive,middle,attacking}`, `stats.PassesCompleted.{L,R}`, `stats.PossessionSeconds.{L,R}`, `stats.PossessionWon.{L,R}` |
| shot events (MES) | `should_use_mes_events` AND (no status OR status=`not-purchased`) | `GET /api/mes/v2/{matchId}/match-events` (client `mesV2Events.v2GetMatchEvents`, params `team, playerJersey, eventTypes, aggregatedDuels` — the worker passes only the id here) | `events[].{id, matchId, eventType, videoTimeMs, team:"Own"\|"Opponent", x, z, periodId, periodTimeMs, playerId, playerJersey, outcome, attributes, editors}`. Shots: `FootballShot`; a goal is `FootballGoal` merged with the preceding `FootballShot` of the same team within 10 s into `FootballShotGoal`. Location = `[x, z]`, 0..1 |
| shot-details (legacy RAS) | no status AND version ≥1.1 AND not MES | `GET {RAS_URL}/recordings/{id}/shot-details` | `shot_details[].{side, timestamp, name, location:[x,y]}`; `name==="kick_shot_goal"` means a goal |
| event stats (MES) | MES and (no status or `not-purchased`) and `team_id` | `POST /api/app/analysis/stats/` body `{"type":"team_match","team_id":<uuid>,"match_ids":[<id>],"group_by":"team_association"}` | `items[].team_association` ("own"/other), `items[].stats[].{event_type\|computed_type, value, periods:[{period,value}]}`. `computed_type==="MissedShots"` is kept separately |
| event stats (legacy) | no status AND version ≥1.1 AND not MES | `GET /api/app/matches/{id}/stats/?tag=goal&tag=corner&tag=freekick&tag=goal-kick&tag=penalty-kick&tag=shot-on-goal&tag=kickoff` | `stats[<tag>].{own,opp}` |

**Step D — derived per-match metrics** (team side = `own`, opponent side = `opponent`; L/R mapping per period via `own_side`: own = `L` if `own_side==="left"` else `R`):

- From match-details (`Lte`/`mu`, worker L1553–1577), summed over periods:
  - `passes_completed` += `PassesCompleted[side]`
  - `possession_minutes` += `PossessionSeconds[side]/60`
  - `possession_percent` += round(`PossessionSeconds[side]` / (L+R) × 100) / #periods, i.e. the **mean of per-period percentages**
  - `possession_won` += `PossessionWon[side]`
  - `longest_pass_string` = max length over `passStrings[side]`
  - `three_to_five_passes` = Σ counts with length 3–5
  - `six_or_more_passes` = Σ counts with length ≥6
  - Everything is rounded at the end.
  - `unassigned.possession_minutes` += max(0, round((t1−t0)/60) − (L+R seconds)/60), i.e. "out of possession" time.
- Pass location thirds (`Rte`, worker L1460):
  - For each `passLocations[side]` point, `x<1/3` is the "left" third and `x>2/3` the "right" third, else middle.
  - For the own team with `own_side==="left"`: left = defensive, right = attacking. Reversed when own_side is right. The opponent is the mirror.
  - Counts per period and in total, converted to % = round(count/total×100) → `pass_location_in_{defensive,middle,attacking}_third`.
- Possession location thirds (`Mte`, worker L1518): sums `possessionLocations[side].{defensive,middle,attacking}` (already per-team semantics, no x flip) → % → `possession_location_in_*_third`.
- Pass strings (`qte`, worker L1492): merges `[length,count]` pairs across periods per side; also keeps a per-period copy.
- Event stats (`Qte`, worker L1765–1795): maps MES types to metric keys:

  | MES event type | metric key |
  |---|---|
  | FootballGoal / FootballShotGoal | goal |
  | FootballCornerKick | kick_corner |
  | FootballFreeKick | kick_free_kick |
  | FootballGoalKick | kick_goalie |
  | FootballPenaltyKick | kick_penalty |
  | FootballShot | kick_shot |
  | FootballKickOff | kick_start |
  | FootballThrowIn | throw_in |
  | FootballFoul | foul |
  | tackle | tackles |
  | duel | duels |
  | dribble | dribbles |
  | interception | interceptions |
  | loose | loose_ball_recoveries |
  | save | saves |

  Legacy tags map: `goal→goal`, `corner→kick_corner`, `freekick→kick_free_kick`, `goal-kick→kick_goalie`, `penalty-kick→kick_penalty`, `shot-on-goal→kick_shot`, `kickoff→kick_start`.
  - `attacking_events` (own) = Σ own counts of all types except kick_goalie and kick_start; `defensive_events` = Σ opponent counts of the same types.
  - From the shot type:
    - `total_attempts` = shots (own)
    - `shots_on_goal` = MES `computed.MissedShots.own`, legacy `shots − goals` (**note: "shots_on_goal" means *missed* shots, labelled "Shots" = "Number of shots taken that did not result in a goal"**)
    - `shots_conceded` = same for the opponent; `total_attempts_conceded` = opponent shots
    - `shots_to_goal_conversion_rate` = round(goals/shots×100)
- `goals_scored` / `goals_conceded` come from the score (step B), not from events (`Pte`, worker L1393).

**Step E — season aggregation** (`Bm`, worker L5197–5213; `tae` L5214):
- For every metric: sum over matches, then divide.
  - `goals_scored` / `goals_conceded` are divided by **all** matches.
  - Every other metric is divided by the **number of matches that returned match-details or stats data** (`l`).
- Formatting: `.toFixed(0)` for passes_completed, possession_minutes, possession_percent, possession_won, all `*_location_in_*_third`, and shots_to_goal_conversion_rate; `.toFixed(1)` for the rest. These are strings; `""` if the divisor is 0.
- `win_ratio` = (#matches with `match_result==="win"` / #matches × 100).toFixed(0).
- `key_metrics_data.key_metrics = [{id, value}]` (all metrics; the UI picks the selected ones). `key_metrics_data.matches[]` = per-match objects `{match_info, key_metrics:{goals_scored,goals_conceded}, own:{…all per-match metrics}, opponent:{…}, unassigned:{possession_minutes}, shotmap_data, pass_locations_data, possession_locations_data, pass_strings_data}`.
- Game maps:
  - `shotmap_data` = concatenation over matches: `{own:{goal_count, shot_count, events[]}, opponent:{…}}` (`aae`, L5229).
  - `pass_locations_data` / `possession_locations_data` = **mean over matches of the per-match percentages** (each rounded), `{own:{defensive,middle,attacking}, opponent:{…}}` (`uu`, L1283).

---

### 3. Panel: Key metrics (cards + progression bar chart)

UI: `team-stats-gKfAgKCX.js` (`sn`, `js`, `Qa`, `Cs`, `As`, `tn`). Provider: `analytics-provider-5HbdX-Qm.js`. Placeholder: `placeholder-CdYd58p6.js` (4 card skeletons + 7 bar skeletons).

- Header: "Key metrics" with an info tooltip.
  - Summary: "See team progress over time, and understand the connection between decisions taken on the field and statistical outcomes."
  - "Select key metrics": "Events and statistics detected by Veo AI can be enabled as key metrics. Edit the key metrics to help the team stay focused on what matters."
  - "Progression chart": "Select a key metric to change the progression chart. Use filters to refine your search results. Note: the chart is optimized for Analytics 1.1 and up. Some data may not be available for videos using older versions of Analytics." (without the flag: "…optimized for videos processed with Analytics 2.0…")
  - "Match details don't look correct?": "Open the video and check that the teams have been allocated to the correct sides of the field, and the match details are filled out correctly."
  - Button "Edit key metrics" (permission-gated); icon-only below 1023 px.
- Selected metrics:
  - `GET /api/app/clubs/{club}/teams/{team}/key-metrics/`. 200 → `{metrics:[{id}]}`; **204 → default `[possession_percent, goals_scored, shots_on_goal]`**; other → `"error"` (worker L1202–1214).
  - On error the fallback is the default; with flag `analytics-studio-enable-for-all` and no full access it is `[goals_scored, goals_conceded, shots_on_goal, shots_conceded]` (`analytics-provider-5HbdX-Qm.js`, `studio-worker-D7X77VUn.js`).
  - Save: `POST …/key-metrics/` body `{"metrics":[{"id":"…"}]}`; the response is re-read like the GET (worker L1215).
  - (Typed client also exists: `getKeyMetrics` GET with optional `fields`, `createKeyMetrics` POST — `src-CpmFfToj.js`.)
  - Selected ids are filtered by switch gates; without full access, metrics in the groups possession/passes/combos are dropped (`analytics-provider-5HbdX-Qm.js`, `utils-R-UBdmQb.js` `I`).
- Card (`js`): title = metric label, value = aggregated value (or "–" placeholder), unit, and help text:
  - "Average %(metric)s" (for win_ratio, just the label)
  - match_count<1 → "No recordings with Analytics processed yet." (`utils-R-UBdmQb.js` `N`)
  - Clicking a card makes it the active metric. On mobile (≤767 px) the cards become a slick carousel with dots.
- No metrics + no edit rights: "No key metrics have been set by the team's coach." With edit rights and ≤1 metric: tile "Add a key metric to view progression over time."
- Progression chart: **vertical bar chart, one bar per match, chronological ascending**, height 350 px.
  - Title = metric label.
  - Help text (`utils-R-UBdmQb.js` `k`):
    - "%(team)s %(metric)s for the last %(match_count)s recordings"
    - selection variant "…for %(match_count)s selected recordings"
    - date variant "…for %(match_count)s recordings in the period %(date_range)s"
    - single-date variant "…on the date %(date)s"
    - singular forms for 1 recording
  - Bar value = `match.own[metricId]`, else `match[metricId]`.
  - Y axis: 7 "nice" ticks from 0 to ceil(max) (`utils-R-UBdmQb.js` `x`), unit "%" for % metrics. Bar height = value/maxTick×100 %.
  - Bar label: value + unit; date "MMM d" (`Intl.DateTimeFormat` month short, day numeric).
  - **win_ratio special case**: each bar shows the result letter (W/D/L via `pgettext` "w","d","l"), height win=1, draw=0.5, loss=0, axis ticks [win, draw, loss]; class = result.
  - Status icons on a bar (from match status):
    - spinner for `processing`
    - alert-circle for `missing-periods`
    - divide-circle for `sport-not-eligible` / `not-purchased`
    - alert-triangle otherwise
    - divide-circle if a possession-location metric value isn't finite
  - If there are fewer than 3 matches, an extra prompt bar: "Keep recording!" — "Record consistently to automatically get data on team progression over time." "Remember to assign recordings to a team." "Next week?"
  - Empty: image `/img/key-metrics-chart-empty-state.webp`, "No recordings found" plus the same two lines.
  - Clicking a bar opens the **match context card** (§7).
- Error state for the whole Team tab: `error-C8jVsg5w.js`: "Something went wrong", "We couldn't load the Team stats.", "Please retry, refresh the page or reach out to <link>support</link>.", button "Retry".
- Toast errors: "Unfortunately, we were unable to fetch the data. Please try again." (`analytics-provider-5HbdX-Qm.js`).

#### Edit key metrics modal

Source: `modal-GxI9dOyz.js`.

- Title "Edit key metrics"; description "Help your team stay focused on the stats that reflect your playing style. Select up to four key metrics."
- **Max 4**, no minimum. Footer "%(selected)s/4 key metrics selected", buttons "Cancel" / "Apply selection".
- Options are grouped (labels + descriptions in `settings---F8aIpR.js` `p`):

| Group | id | Label | Unit | Description |
|---|---|---|---|---|
| Possession | possession_percent | Possession % | % | Total team possession (passing and dribbling) of the ball |
| | possession_minutes | Possession minutes | minutes | (same) |
| | possession_won | Possession won | | Number of times a team regained possession of the ball in open play |
| | possession_location_in_defensive_third | Possession location % in defensive third | % | |
| | possession_location_in_middle_third | Possession location % in middle third | % | |
| | possession_location_in_attacking_third | Possession location % in attacking third | % | |
| Passes | pass_location_in_defensive_third | Pass location % in defensive third | % | |
| | pass_location_in_middle_third | Pass location % in middle third | % | |
| | pass_location_in_attacking_third | Pass location % in attacking third | % | |
| | passes_completed | Passes completed | | Number of passes a team successfully made |
| | three_to_five_passes | 3 to 5 passes | | Number of pass strings consisting of 3-5 passes |
| | six_or_more_passes | 6 or more passes | | Number of pass strings consisting of 6 or more passes |
| | longest_pass_string | Longest pass string | | The longest detected pass string |
| Events | goals_scored | Goals scored | | Number of goals scored |
| | goals_conceded | Goals conceded | | Number of goals conceded |
| | kick_free_kick | Free kicks | | Number of free kicks taken |
| | shots_on_goal | Shots | | Number of shots taken that did not result in a goal |
| | shots_conceded | Shots conceded | | Number of shots conceded |
| | kick_corner | Corners | | Number of corners taken |
| | kick_goalie | Goal kicks | | Number of goal kicks taken |
| | kick_penalty | Penalty kicks | | Number of penalties taken |
| | throw_in | Throw-ins | | Number of throw-ins taken |
| | foul | Fouls | | Number of fouls committed |
| | tackles* | Tackles | | Number of tackles made |
| | duels* | Duels | | Number of duels |
| | dribbles* | Dribbles | | Number of dribbles |
| | interceptions* | Interceptions | | Number of interceptions |
| | loose_ball_recoveries* | Loose ball recoveries | | Number of loose ball recoveries |
| | saves* | Saves | | Number of saves made |
| Combos | shots_to_goal_conversion_rate | Conversion rate | % | Percentage of total attempts that resulted in a goal |
| | total_attempts | Total attempts | | Number of goals and shots |
| | total_attempts_conceded | Total attempts conceded | | Number of goals and shots conceded |
| | attacking_events | Attacking events | | Number of goals, corners, freekicks, penalties and shots |
| | defensive_events | Defensive events | | Number of goals, corners, freekicks, penalties and shots conceded |
| | win_ratio | Win ratio | % | % of matches won |

(* = waffle-switch gated, see §0.)

Without full access, the Possession, Passes and Combos options are disabled with tooltip "Upgrade to Analytics".

---

### 4. Panel: Shot map (team, across matches)

UI: `team-stats-gKfAgKCX.js` (`fs`, `vs`, `xs`); pitch + events: `shots-without-location-BE-KdR3w.js` (`qe`, `We`, `q`); pitch SVG `icons-Hu5XWWf1.js` (full pitch 685×402 with halfway line + centre circle).

- Section id `analytics-shot-map`, heading "Shot map". Only rendered when `game_maps_data` is loading or `match_count>0`.
- Info card help text (`utils-R-UBdmQb.js` `k`): "%(team)s shot map for the last %(match_count)s recordings" (and the variants above).
- Stat buttons (clickable filters; **default selection = Goals only**):
  - "Goals" (goal_count, dot), "Shots" (shot_count, dot), "Total attempts" (sum)
  - divider, then "Conversion rate" = round(goals/(goals+shots)×100) "%"
- Side toggle: "Attacking" (= own shots) / "Defending" (= opponent shots).
- **Chart type: dot map on a pitch (goal vs shot styling), no heat.**
  - Arrow "Direction of play: left to right" for attacking, "right to left" for defending.
  - Defending events are drawn mirrored (`x→1−x, y→1−y`).
  - Animated fade-in, staggered 0.5 s / n.
- Coordinates (worker `Ite`/`Vte` L1445–1459 for MES, `Nte`/`_te` L1407–1444 for legacy; `Ws` L1320):
  - The MES location `[x,z]` is 0..1. It is flipped (`1−x, 1−y`) when (`own_side==="right"` and own team) or (`own_side==="left"` and opponent) for the period containing the event timestamp. After that, every team attacks toward x=1.
  - Then `x' = min(2x−1, 1)` (range −1..1, 0 = halfway line) and `y' = clamp(y,0,1)`. Placement: `left: x'*100%`, `bottom: y'*100%`. This only makes sense if the event layer covers the attacking half — see open questions.
  - Legacy shot-details: own vs opponent is decided by `shot.side === period.own_side`. The location is taken as is (no flip in `_te`), then `Ws` applies 2x−1.
- Events without coordinates (`isNaN(x|y)`) are listed under "Shots with missing location:" as chips.
- Event click → context card:
  - header "Goal"/"Shot" + time `mm:ss`
  - autoplaying muted mp4 clip from t−5 s to t+5 s (loop). The video URL comes from `GET /api/app/matches/{id}/videos/?render_type=standard&ordering=-width`, first `mime_type==="video/mp4"` → `url` (worker L1762, `fetchRecordingsVideos`).
  - match header: date, "%(count)s views", "Public"/"Private", score "home - away" coloured by result, type name, "Home"/"Away", title, thumbnail, link "Open recording" to `url` at timestamp.
- Empty texts: "No goals or shots detected by Veo AI." / "No goals detected by Veo AI." / "No shots detected by Veo AI."
- Loading: placeholder pitch.

### 5. Panel: Passes — "Pass location" (thirds), across matches

UI: `team-stats-gKfAgKCX.js` (`De`, `hs`, `gs`, `_s`).

- Section id `analytics-passes`, title "Pass location".
- Help text metric word: "pass location by thirds".
- Three stat tiles "Defensive" / "Middle" / "Attacking", each with value "%" (placeholder dash when all are 0).
- **Chart: pitch split into 3 vertical thirds with a % bubble in each.** Ranking classes `max`/`medium`/`min` by value (largest → max), animated.
- Toggle "Own team" / "Opponent".
- Data = mean over matches of the per-match pass-location % (see §2 D/E).
- Empty: "No pass location detected by Veo AI."

### 6. Panel: Possession — "Possession location" (thirds), across matches

Same component as §5 (`team-stats-gKfAgKCX.js` `De`).

- Section id `analytics-possession`, title "Possession location", metric word "possession location by thirds".
- Empty: "No possession location detected by Veo AI."
- Data = mean of the per-match `possessionLocations` %.
- **There is no team heat map or pass-string chart at season level.** Those only appear per match inside the context card (§7).

### 7. Match context card (drill-down from a progression-chart bar)

UI: `team-stats-gKfAgKCX.js` (`Ya`, `Ga`, `Es`, …), wrapper `pitch-analytics-CquIUgYq.js` `fe` (popover; becomes a bottom sheet ≤767 px).

- Header: same match header as §4.
- Then a tab strip "Insights" / "Setup" / "Analytics" and a carousel of cards ("Previous card"/"Next card"), each with a footer action that opens the recording in a new tab.
- Card order (each permission-gated by `match_info.permissions[...]`.permitted):
  1. **Journal** (Insights) — perm `matches.read_match_journal`.
     - Endpoint: `GET /api/app/matches/{id}/journal/` → `journal` (404 → ""). URLs in the text become links.
     - Footer: "Add Journal notes" / "Update Journal" → `{url}?focus=journal#/summary/`.
     - Empty text: "What went right? What went wrong? What is the one thing the team should do next time?" (can update) or "Nothing to see here. Ask your coach to write some notes!"
     - Error: "Journal is unavailable".
  2. **Lineup** (Setup) — perm `matches.read_match__lineup`.
     - Endpoints: `GET /api/app/matches/{id}/lineup/` (uses `formation_name`, response header `x-veo-lineup-positions` URL-decoded → formation positions `{field_position, position_index, position_info:{row,column,number_of_rows,positions_in_row}}`) and `GET /api/app/matches/{id}/lineup/players/` (`items[].{is_starting, jersey_number, player:{name,initials,avatar,id}, position_name, field_position, position_index, is_player_of_the_match, is_team_captain}`).
     - Rendered as a half-pitch SVG (276×208) with avatars, star (POTM), "C" (captain); x from `settings-BNUP5L6i.js` table `{1:[.5],2:[.25,.75],3:[0,.5,1],4:[0,1/3,2/3,1],5:[0,.25,.5,.75,1]}`, y=(row−1)/(rows−1).
     - Labels "Substitutes", "Formation", "No formation"; error "Lineup is unavailable".
     - Footer "Add lineup"/"Update lineup" → `#/lineup/` (perm `matches.update_match__lineup`).
  3. **Tactics** (Setup) — football only.
     - Shows `tactics_info[]` `{group,label,key}`; "No tactics noted for this match."
     - Footer "Add tactics"/"Edit tactics" → `#match-setup/setup/match-tactics` (perm `matches.update_match`).
  4. If the match has a `status`: a single **status card** instead of 5–10 (`Es`):

     | status | title | text | footer |
     |---|---|---|---|
     | `sport-not-eligible` | "No Analytics" | "This sport is not eligible for Veo Analytics." | |
     | `not-purchased` | "No Analytics" | "This recording was not uploaded with a Veo Analytics subscription." | |
     | `veo-cam-only` | "No Analytics" | "This recording was captured using Veo Go, and is not eligible for Veo Analytics." | |
     | `missing-periods` | "No sides and periods" | "To get full access to all Veo Analytics features, information for this match is needed." | "Update sides and periods" → `#match-setup/setup/sides-periods` |
     | `processing` / `pending` | "Processing..." | "We are still processing your Analytics, please check back later!" | "Video status" |
     | `fetching-error` | "Error" | "Something went wrong. Please refresh the page or try again later." | "Refresh page" |
     | other | "Error" | "Unfortunately, there was an error generating the AI analysis for this recording." | |

  5. **Stats table** (perm `analysis.read_match_stats`).
     - **Mirrored horizontal bar comparison (home left / away right)**, `team-stats-gKfAgKCX.js` `ra`/`ia`.
     - Rows = the selected key metrics except win_ratio. Values = `own`/`opponent` of that match; percentage type if unit "%".
     - Bar widths = share of (home+away[+unassigned]); the winning side is highlighted; the active key metric row is highlighted.
     - For possession_minutes an "unassigned" middle bar has tooltip "Out of possession for %(time)s minutes" (`utils-CUo0J2ML.js`).
     - Column headers: team short name / name ("Own"/"Opp" fallbacks), ordered by `own_team_home_or_away`.
     - Footer "View all stats" → `#/analysis/`.
  6. **Pass Strings** (perm `analysis.read_match_passstrings`). **Bar histogram**:
     - X = "Connected passes" buckets 3,4,5,6,7,8,9,"+10" (+10 = Σ counts with length ≥10).
     - Y = "Strings", ticks 20,16,12,8,4,0; bar height = min(100%, count/20); 2 px minimum.
     - Tooltip "%(number)s connected passes: %(count)s times".
     - Side stats:
       - "Average pass string" = Σ(len×count)/Σcount over len>2, 1 decimal
       - "3 to 5 passes"
       - "6 or more passes"
       - "Longest pass string"
       - "Total pass strings" = Σcount over **all** lengths
     - Filters: team (own/opponent avatar buttons) + period select ("Full recording", "%(ordinal_number)s period").
     - Footer "Review pass strings".
  7. **Shotmap** (perm `analysis.read_match_shotmap`).
     - `pitch-analytics-CquIUgYq.js` shotmap on the full pitch SVG 222×142; dots at `left:x*100%`, `bottom:y*100%`; aria "%(type)s at %(time)s seconds".
     - Stats "Goals", "Missed shots", "Total attempts".
     - Empty info "Add locations to shot & goal events to see them here" (when there are shots but none located). Generic empty "No data".
     - Team + period filters; footer "Edit Shot map".
  8. **Possession location map** (perm `analysis.read_match_possessionlocations`): three-thirds % overlay with max/medium/min colouring, pitch with dashed third lines, labels "Defensive" "Middle" "Attacking". Team + period filters.
  9. **Pass location map** (perm `analysis.read_match_passlocations`): same as 8.
  10. **Heat map** (perm `analysis.read_match_heatmap`):
      - Endpoint: `POST /api/mes/v2/{match_id}/heatmap` body `{"categories":[1]|[3],"startTime":<sec>,"endTime":<sec>}` → **image Blob** (PNG/JPEG, shown as `<img>`); size 0 → error ("No heatmap data available") (`team-stats-gKfAgKCX.js` `Ls`, `analysisSlice-CRlRsXf0.js` `Jt`, `src-CpmFfToj.js` `v2GenerateHeatmap`).
      - Categories (`player-tracking-DshOpNPo.js`): `left_goalkeeper:0, left_outfield_player:1, right_goalkeeper:2, right_outfield_player:3, referee:4, ball:6`.
      - Side = own_side of the period for "own", the opposite for "opponent"; left → [1], right → [3] (outfield players only).
      - Direction of play arrow: left-to-right iff (team==="own") == (own_side==="left").
      - Period select **without** the "Full recording" option.
      - "Heat map interval" range slider: step 60 s, domain = period timeframe, start/end labels mm:ss; requests are debounced 500 ms.
      - Errors: "Error generating heat map" + "Retry".
      - Footer "View in recording" → `#/analysis/`.

- Common pitch-analytics strings (`pitch-analytics-CquIUgYq.js`):
  - "No data"
  - "Error generating location map" / "Error generating shot map" / "Error generating map"
  - direction labels "Defensive" (Middle) "Attacking"
  - flipped CSS class when the direction is right-to-left

### 8. Panel: Comparison radial

UI: `team-stats-gKfAgKCX.js` (`ms`, `ls`, `Le`, `rs`, `ds`); data in the worker (`rae`/`lae`/`Sr`/`nae`, L5252–5358).

- Section id `analytics-comparison`, title "Comparison radial". Requires `can_view_all_analytics_features`.
- Info tooltip:
  - Summary: "The Comparison Radial lets you quickly compare metrics between teams in your club."
  - "Choose the metric": "Choose 6 metrics to compare. The radial is optimized for Analytics 1.1 and up…" (or the 2.0 variant)
  - "Choose the teams": "Choose from any team in your club, or assess one team's performance."
  - "Choose the date": "Compare performance across seasons with the date picker."
  - Button "Edit metrics".
- Left info card: title "Team comparison" / "Select to compare" / "Own team comparison" (same slug); help "Compare teams or periods to assess how your team is performing and progressing over time".
- Two team cards (own fixed; comparing team = dropdown of club teams + "None"), each with a **date-range picker**.
  - "Results" row: up to 5 W/D/L dots (4 + "+N"); "No matches found in period"; "Select to compare".
  - Clicking a dot opens the match header card.
  - Error: "We were not able to fetch the data for your recordings." "Please try again." "Retry".
- **Chart: radar/spider SVG** (600×510 viewBox):
  - N axes (6). Radius = 0.375×510. Grid polygons at 25/50/75/100 % with rounded corners (8 px quadratic).
  - Two filled polygons (own, comparing). For each axis the values are normalised to that axis' max of the two: `own/max(own,cmp)*0.9`.
  - Labels per axis: "own · cmp" (value or "-", "%" suffix for % metrics) + the metric label.
  - Animated with d3 transition 200 ms, `linear-yosUWLrc.js` easing.
- Config endpoints:
  - `GET /api/app/clubs/{club}/teams/{team}/comparison-radial/` → `{config:{own_team:{team_slug,date_range:[YYYY-MM-DD,YYYY-MM-DD]}, comparing_team:{…}, key_metrics:[{id}]}}`.
  - `POST` same path, body `{"config":{"own_team":{team_slug,date_range},"comparing_team":{team_slug,date_range},"key_metrics":[{"id":…}]}}` (only if the user has the edit permission).
  - Default when there is no config: own = last 30 days (today−29 … today); comparing team "" with today−59 … today−30; metrics `[goals_scored, shots_on_goal, shots_to_goal_conversion_rate, win_ratio, passes_completed, possession_percent]`. If fewer than 6 valid metrics are configured, this default is used.
- Team options: `GET /api/app/clubs/{club}/teams/?fields=name&fields=slug` (paginated via `Link`), plus `{label:"None", value:""}`.
- Data per side (`Sr`):
  - `GET /api/app/matches/?ordering=-created&team=<slug>&club=<club>&<analytics_version/has_analytics>&date_start=…&date_end=…&own_team_formation=…&type=…`, all pages.
  - The global formation, match_type and analytics filters apply; **recordings_count / selection do not**.
  - Then the same per-match pipeline (§2) with only the requests needed for the 6 metrics (match-details if any id contains possession/pass_location/passes/pass_string; stats if any id is in the event list).
  - Result `{key_metrics:{…aggregated}, recent_matches:[match_info]}`.
- Edit modal: "Edit metrics", "Select 6 metrics to compare on the radial.", **exactly 6** (min = max = 6), same option list as §3 (`modal-GxI9dOyz.js`).
- Error toast: "Unfortunately, we were unable to save your comparison. Please try again." (`analytics-provider-5HbdX-Qm.js`).

### 9. Coach note (team-level text, shown on the Analytics Studio hero)

- `GET /api/app/clubs/{club}/teams/{team}/coach-note/` → `{note,…}` (200 only); `POST` same with `{"note": "<text>"}` (worker L1100–1115).
- Modal "Add coach note" — "What is the main focus for the team this season? Write it here." — "Visible to members of %(team_name)s"; error "Could not save. Please try again." (`view-BYcaVA08.js`).
- Display chunk `coach-note-FkTuueCn.js` (not inspected in detail).

### 10. Cross-reference: Player stats tab (same page, other fork)

The same worker serves the player tab. These are listed only for the endpoint table:

- `POST /api/app/analysis/stats/`:
  - `{"type":"cross_match","team_id","match_ids":[…],"group_by":"player"}` → `items[].{player_id,user_id,first_name,last_name,known_name,avatar,player_profile_id,jersey_number,position,default_jersey_number,default_position,stats:[{type,value}]}`, `meta.positions`
  - `{"type":"match_all_players","match_id","team_id"}` → `items[].{player:{type:"identified"|"jersey_only",…}, stats:[{type,value,periods:[{period,value}]}]}`
  - (worker L6118–6153; stat type → metric id map L5987–6030)
- `POST /api/app/analysis/player-heatmaps/` `{"type":"cross_match_all_players","team_id","match_ids","smoothing":1.5}` → `items[].{player, match_count, matrix:{values:<base64>}}`.
  - **1800 bytes → 30 rows × 60 cols, value/255**, rendered on a 400×200 canvas (`pitch-analytics-CquIUgYq.js` `K`/`Y`, worker L6353–6380).
- `POST /api/app/analysis/leaderboards/` `{"team_id","match_ids","top":5}` → `items[].{stat_type, entries[{rank,player_id,user_id,first_name,last_name,jersey_number,default_jersey_number,position,default_position,player_profile_id,value}]}` (worker L6446).
- `POST /api/app/analysis/player-event-maps/` `{"type":"cross_match_all_players","team_id","match_ids","map_kind":"SHOTMAP"}` → `{direction_of_play:"rightToLeft"|…, items[].{player, events[{event_id,match_id,video_time_ms,x,z,outcome}], unlocated_events[{…,event_type}]}, included:{matches:{id:{kickoff_time,opponent_name,url,own_score,opponent_score}}, positions}}` (worker L6470–6521).
- `GET /api/app/matches/{id}/lineup/players/` per match; `GET /api/app/clubs/{club}/teams/{team}/members/?status=active` (team_role==="player").

---

### 11. Endpoint summary (team season views)

| # | Method | Path | Body / params | Response fields used | Used by |
|---|---|---|---|---|---|
| 1 | OPTIONS | `/api/app/matches/?filters=type&filters=own_team_formation` | — | `filters.type.choices[{value,display_name}]`, `filters.own_team_formation.choices[{value,display_name,group{key,label}}]` | Filters (`filters-provider-B_R5WMcO.js`) |
| 2 | GET | `/api/app/matches/` | `ordering=-created, team, club, page_size \| date_start+date_end \| recordings*, type*, own_team_formation*, analytics_version=any\|1\|2 or has_analytics=false, has_lineup_player`; `Link` pagination | list of matches: `identifier, start, created, title, opponent_team_name, opponent_short_name_display, own_team_home_or_away, info.stats.score{own,opponent}, info.stats.score_aggregated, periods[], permissions{}, privacy, slug, sport, tactics_info[], team{id,name,image,short_name_display}, club{crest,short_name}, thumbnail, type_name, url, view_count, has_events_enabled, analytics_version` | All panels (worker `Mo`, `view-BYcaVA08.js`) |
| 3 | GET | `/api/app/matches/{id}/` | — | same as a list item; `info.stats.score` | score fallback, explicit selection |
| 4 | GET | `/api/app/matches/{id}/feature-processing-status/` | — | `analytics` ("completed"/processing/pending/not-purchased/sport-not-eligible/veo-cam-only/…) | analytics version + status |
| 5 | GET | `{RAS_URL}/recordings/{id}/analytics` | credentials omit | keys `ball-tracking`, `match-details`, `shot-details`, `match-report` | analytics version |
| 6 | GET | `/api/app/matches/{id}/periods/` | — | `[{public_identifier, timeframe:[s,e], own_side}]` | period/side mapping |
| 7 | GET | `{RAS_URL}/recordings/{id}/match-details?filters=t0,t1&…` | one `filters` per period | per-period array: `passLocations{L,R}[{x}]`, `passStrings{L,R}[[len,count]]`, `possessionLocations{L,R}{defensive,middle,attacking}`, `stats{PassesCompleted,PossessionSeconds,PossessionWon}{L,R}` | Key metrics (possession/passes), pass & possession location maps, pass strings |
| 8 | GET | `{RAS_URL}/recordings/{id}/shot-details` | — | `shot_details[{side,timestamp,name,location}]` | Shot map (legacy) |
| 9 | GET | `/api/mes/v2/{matchId}/match-events` | params `team, playerJersey, eventTypes, aggregatedDuels` (optional) | `events[{id,matchId,eventType,videoTimeMs,team,x,z,periodId,periodTimeMs,playerId,playerJersey,outcome,attributes,editors}]` | Shot map (MES) |
| 10 | POST | `/api/app/analysis/stats/` | `{"type":"team_match","team_id","match_ids":[id],"group_by":"team_association"}` | `items[{team_association, stats[{event_type,computed_type,value,periods[{period,value}]}]}]` | Key metrics (events, MES) |
| 11 | GET | `/api/app/matches/{id}/stats/?tag=goal&tag=corner&tag=freekick&tag=goal-kick&tag=penalty-kick&tag=shot-on-goal&tag=kickoff` | — | `stats[tag]{own,opp}` | Key metrics (events, legacy) |
| 12 | GET / POST | `/api/app/clubs/{club}/teams/{team}/key-metrics/` | POST `{"metrics":[{"id"}]}`; GET optional `fields` | `{metrics:[{id}]}`; 204 = defaults | Key metrics |
| 13 | GET / POST | `/api/app/clubs/{club}/teams/{team}/comparison-radial/` | POST `{"config":{own_team,comparing_team,key_metrics}}` | `{config:{…}}` | Comparison radial |
| 14 | GET | `/api/app/clubs/{club}/teams/?fields=name&fields=slug` | Link pagination | `[{name,slug}]` | Comparison radial team select |
| 15 | GET / POST | `/api/app/clubs/{club}/teams/{team}/coach-note/` | POST `{"note"}` | `{note}` | Coach note |
| 16 | GET | `/api/app/matches/{id}/videos/?render_type=standard&ordering=-width` | — | `[{mime_type,url}]` | Shot-map event clip preview |
| 17 | GET | `/api/app/matches/{id}/lineup/` | — | `is_complete`, `formation_name`, header `x-veo-lineup-positions` | Match overview; context card Lineup |
| 18 | GET | `/api/app/matches/{id}/lineup/players/` | `is_starting`, `is_unused_substitute` optional | `items[…]` | Context card Lineup |
| 19 | GET | `/api/app/matches/{id}/journal/` | — | `{journal}` | Context card Journal |
| 20 | GET | `/api/mes/v2/{match_id}/quality` | — | `jersey.legibility` | Match overview reduced accuracy (flag) |
| 21 | POST | `/api/mes/v2/{match_id}/heatmap` | `{"categories":[1\|3],"startTime","endTime"}` (seconds) | **image Blob** | Context card Heat map |
| 22 | GET | `/api/app/clubs/{club}/teams/{team}/?fields=permissions&fields=slug` (inferred from the redux helper) | — | `permissions{…}` | Gating |

---

### 12. Open questions (need a live API call)

1. Exact shape of `match-details` (RAS): is the response a plain array in period order? Are `passLocations` points `{x,y}` in 0..1 with x measured from the left goal line? Are `passStrings` pairs `[length, count]`? Are the units of `PossessionSeconds` truly seconds per side `L`/`R`?
2. Are `match-details` `possessionLocations.{L,R}.{defensive,middle,attacking}` already oriented per team (the code doesn't flip them) or counted in seconds?
3. Exact shape of `shot-details`: are `side` values "left"/"right", is `timestamp` in recording seconds, and is `location` `[x,y]` 0..1 in absolute pitch coordinates (no flip is applied for legacy shots)?
4. Shot map event placement: after `x' = 2x−1`, is the CSS layer `.attacking-events` / `.defending-events` sized to one half of the 685×402 pitch? (CSS wasn't downloaded.) Can x' be negative for shots from the own half?
5. `/api/app/matches/` list response: does it contain `analytics_version`, `has_events_enabled`, `periods` and `info.stats.score` directly (the code relies on all of them), and does `page_size` without pagination return the latest N by `-created`?
6. `/api/mes/v2/{match}/heatmap` image: format (PNG?), pixel size, colour scale, transparency, and whether categories 0/2 (goalkeepers), 4 (referee) or 6 (ball) are allowed. Does it accept multiple categories?
7. `/api/app/analysis/stats/` `team_match`: full list of `event_type` / `computed_type` values (e.g. `MissedShots`, `TotalShots`?), `team_association` values ("own"/"opponent"?), and the `periods[].period` id format (public_identifier or number?).
8. `feature-processing-status` `analytics` value set (completed, processing, pending, not-purchased, sport-not-eligible, veo-cam-only, …?).
9. `comparison-radial` GET on an unconfigured team: 204 or 404? Is `date_range` stored as `YYYY-MM-DD`?
10. `key-metrics` GET: does it ever return a bare array (the code tolerates both `t?.metrics` and an array)?
11. The team permission fetch (`analytics_studio_team_permissions`): exact URL and permission key format (`analysis.read_team__comparisonradial` etc.).
12. `/api/mes/v2/{match}/quality` response: other fields besides `jersey.legibility` ("good"/"reduced"/"poor"?).

# 2. Player views (per match and across matches)

All claims cite the chunk in `veo-web/js/`. The UI strings are the English i18n keys exactly as they appear in the code. Where a key has the form `context||text`, the text after `||` is what the user sees. Gettext context strings are kept in parentheses where they help.

## 2.0 Shared infrastructure for every player view

### 2.0.1 Data access paths

| Path | Where | Notes |
|---|---|---|
| Studio web worker `https://cdn.app.veo.co/assets/worker-lkm0OaJA.js` | Created by `studio-worker-D7X77VUn.js` (`T()`). The main thread sends `{command,...}` messages. | Handlers for `fetchTeamPlayers`, `fetchPlayerStatsData`, `fetchPlayerStatsTableData`, `fetchPlayerStatsLeaderboardData`, `fetchPlayerStatsHeatmapData` and `fetchPlayerStatsShotmapData` are at the end of `worker-lkm0OaJA.js`. The worker code is **unminified/pretty-printed**, which makes it the best source. |
| Worker fetch wrapper `be(path, init)` | `worker-lkm0OaJA.js` | Base URL: `API_APP_URL`, else `${SERVER_URL}/api/app`. Headers: `Content-Type: application/json`, `Accept-Language`, `veo-agent: veo:svc:web-app`, `Authorization: Bearer <token>` when a token is present, and `x-csrftoken` on mutating methods. Sends `credentials:"include"`. |
| Generated client singleton `ee()/de()` | `singleton-BGuIWsNG.js` → `src-CpmFfToj.js` | Namespaces used for players: `teamMetrics.getStats`, `teamPlayerHeatmap.getPlayerHeatmaps`, `teamPlayerEventMap.getPlayerEventMaps`, `mesV2Tracking.v2GetPlayerMoments / v2GetPlayerTracking / v2GetJerseyNumbers` and `mesV2Physical.v2GetPhysicalMetricsByMatch / v2GetPhysicalMetricsDetailsByMatch`. |

### 2.0.2 Endpoints used by player views (verified call sites)

| # | Method + path | Body / params (exact) | Used by |
|---|---|---|---|
| P1 | `POST /api/app/analysis/stats/` | `{type:"cross_match", team_id, match_ids:[...], group_by:"player"}` | Studio player table, player comparison and recent form (worker `Jm`, `worker-lkm0OaJA.js`) |
| P2 | `POST /api/app/analysis/stats/` | `{type:"match_all_players", match_id, team_id}` | Per-match player stats (worker `wae`, only when `includePeriodStats && one match`). Used by the match report (`match-player-stats-provider-CW6BTXEl.js` with `includePeriodStats`). |
| P3 | `POST /api/app/analysis/stats/` (client `teamMetrics.getStats`) | `{type:"cross_match_user", user_id, team_id, match_ids}` **or** `{type:"cross_match_jersey", jersey_number, team_id, match_ids}` | Player focus card Overview, Stats and Physical tabs (`context-card-Jk_Nkykh.js` `Sa`/`Ra`) |
| P4 | `POST /api/app/analysis/player-heatmaps/` | `{type:"cross_match_all_players", team_id, match_ids, smoothing:1.5}` | Studio "Player position heat map" and comparison heat maps (worker `Bae`) |
| P5 | `POST /api/app/analysis/player-heatmaps/` | `{type:"cross_match_user"\|"cross_match_jersey", user_id\|jersey_number, team_id, match_ids, smoothing:1.5}` | Focus card Maps tab in Analytics Studio (`context-card-Jk_Nkykh.js` `g`) |
| P6 | `POST /api/app/analysis/player-heatmaps/` | `{type:"match_player", match_id, team_id, jersey_number, start_time, end_time, smoothing:1.5}` | Focus card Maps tab in match editor, with period + time slider (`context-card-Jk_Nkykh.js` `_t`). Also the report player popover (`report-BVrpWDhT.js` `hp`). |
| P7 | `POST /api/app/analysis/player-heatmaps/` | `{type:"match_all_players", match_id, team_id, start_time, end_time, smoothing}` | Match report "average position / player heat map" (`report-BVrpWDhT.js` `El`). The report is covered in detail in section 3. |
| P8 | `POST /api/app/analysis/player-event-maps/` | `{type:"cross_match_all_players", team_id, match_ids, map_kind:"SHOTMAP"}` | Studio "Player shot map" and comparison shot maps (worker `ooe`) |
| P9 | `POST /api/app/analysis/player-event-maps/` | `{type:"cross_match_user"\|"cross_match_jersey", ..., team_id, match_ids, map_kind:"SHOTMAP"}` | Focus card Maps tab, shot map (`context-card-Jk_Nkykh.js` `O`) |
| P10 | `POST /api/app/analysis/player-event-maps/` | `{type:"match_player", map_kind, jersey_number, match_id, team_id}`; report map kinds: `SHOTMAP, TACKLE_MAP, INTERCEPTION_MAP, BALL_RECOVERY_MAP, DUEL_MAP, FOUL_MAP, PASS_MAP` | Report player popover (`report-BVrpWDhT.js` `vp`, `Ve`) |
| P11 | `POST /api/app/analysis/leaderboards/` | `{team_id, match_ids, top:5}` | Studio Leaderboards (worker `Hae`) |
| P12 | `GET /api/app/clubs/{club}/teams/{team}/members/?status=active` | Paginated through the `Link` header. The client keeps only `team_role==="player"`. | Studio roster (worker `Xte`) |
| P13 | `GET /api/app/matches/?ordering=-created&team=&club=&type=…&own_team_formation=…&recordings=…\|page_size=…\|date range…&date_end=&has_lineup_player=` | Built from the filter state by worker `xr`. Paginated through the `Link` header when `recordings_dates` is set. | Match set behind every Studio player view (worker `Mo`) |
| P14 | `GET /api/app/matches/{id}/` | – | Used when explicit `recordings=` ids are given (worker `Mo`) |
| P15 | `GET /api/app/matches/{id}/lineup/players/` | 404 is treated as `[]` | Matches, starts, captaincies, player-of-the-match counts and the latest jersey/position (worker `wte/vte/zte`) |
| P16 | `GET /api/mes/v2/{match}/player-moments?start=&end=&side=&jersey=` | Sent once per period: `start/end` = the period `timeframe`, `side` = the period `own_side`, `jersey` = the number, or `"goalie"` for jersey `"9999"`. | Player Moments / Player Spotlight (`player-moments-provider-BjFaeazu.js`) |
| P17 | `GET /api/mes/v2/{match}/player-tracking?start=<int s>` | – | Live player positions (Veo Vision overlay, 2D radar) (`playerTrackingSlice-BtWfkb3M.js`) |
| P18 | `GET /api/mes/v2/{match}/player-tracking/jersey-numbers?periods=<start,end>&periods=…` | – | Detected jersey numbers per side, used by the Player Moments picker and the lineup (`lineupSlice-ecpjsJ8u.js`) |
| P19 | `GET /api/mes/v2/{match}/physical-metrics` | – | Per-jersey avg/top speed and sprints in the Veo Vision card (`playerMetricsSlice-6A_Ud2SH.js`) |
| P20 | `GET /api/mes/v2/{match}/physical-metrics-detail` | – | Report sprint key metrics ("Fastest Sprint", sprint clips) (`report-BVrpWDhT.js` `td`) |

**Generated but never called by any shipped chunk.** The method names were searched across all 498 files and occur only in `src-CpmFfToj.js`:
- `v2GenerateMatchPlayerHeatmap` (`POST /api/mes/v2/{match}/players/{jersey}/heatmap`)
- `v2GenerateMatchPlayerHeatmaps`
- `v2GetCrossMatchPlayerHeatmap(s)` (`POST /api/mes/v2/-/players/{jersey}/heatmap`, `/-/player-heatmaps`, with `{height,mappings,matchIds,smoothing,team,width}`)
- `v2GetCrossMatchPlayerEvent(s)`
- `v2GetCrossMatchPlayerStats`
- `v2GetCrossMatchPhysicalMetrics(ByGroupKey)`
- `v2GetPhysicalMetricsByPlayer` / `v2GetPhysicalMetricsDetailsByPlayer` (`/api/mes/v2/teams/{team}/players/{jersey}/physical-metrics(-detail)`)
- `v2GetMatchPlayerStats` (`/own-player-stats`), `v2GetPlayerEventStatsByMatch`, `v2GetPlayerStats` (`/teams/{team}/players/{jersey}/stats`)
- `v2GetTeamPhysicalStats`

The web app uses the `/api/app/analysis/*` facade instead. The mes methods may still be used by the remote Player Offering module (see 2.9) or by mobile apps; this is unverified.

### 2.0.3 Stat type → metric id mapping (response `stats[].type`)

Defined identically in the worker (`Cr`/`Tr`, `worker-lkm0OaJA.js`) and in `build-table-data-D2wG9dW9.js` (`Y`/`j`):

| API `type` | UI metric id | Transform | Bucket |
|---|---|---|---|
| matches_total | matches | – | table |
| starts_total | starts | – | table |
| captaincies_total | captaincies | – | table |
| player_of_the_match_total | player_of_the_match | – | table |
| football_goal_total | FootballGoal | – | table |
| football_assist_total | assists | – | table |
| football_goal_involvement_total | GoalInvolvements | – | table |
| football_shots_total | MissedShots ("Shots" = shots **not** resulting in a goal) | – | table |
| football_attempts_total | TotalShots ("Total attempts" = goals + shots) | – | table |
| football_conversion_rate | ConversionRate | `Math.round(v*100)` (API sends 0..1) | table |
| football_corner_total / free_kick / throw_in / foul / goal_kick / penalty | FootballCornerKick / FootballFreeKick / FootballThrowIn / FootballFoul / FootballGoalKick / FootballPenaltyKick | – | table |
| football_passes_total | passes | – | table |
| football_passes_completed_total | passes_successful | – | table |
| football_passes_unsuccessful_total | passes_unsuccessful | – | table |
| football_passes_success_rate | passes_success_rate | ×100, rounded | table |
| distance_total_meters | distance_covered | metres | extended |
| sprints_total | sprints | – | extended |
| top_speed_kmh | top_speed | km/h | extended |
| average_speed_kmh | average_speed | km/h | extended |
| seconds_played_total | minutes_played | `Math.round(s/60)` | extended |
| high_intensity_runs_total | high_intensity_runs | – | extended |
| football_tackle_total / duel / dribble / interception / loose / save | tackles / duels / dribbles / interceptions / loose_ball_recoveries / saves | – | extended |
| football_possession_won_total | recoveries | – | extended |

Derived values, from `pae` and `bae` in the worker and `S` in `build-table-data-D2wG9dW9.js`:
- `MissedShots = max(TotalShots − FootballGoal, 0)` when absent
- `passes_unsuccessful = max(passes − passes_successful, 0)`
- `passes_success_rate = passes>0 ? round(passes_successful/passes*100) : 0`
- `GoalInvolvements = goals + assists` if absent
- `ConversionRate = round(goals/attempts*100)` if absent
- `TotalEvents = assists + Σ(FootballGoal, MissedShots, FootballCornerKick, FootballFreeKick, FootballGoalKick, FootballPenaltyKick, FootballThrowIn, FootballFoul)`

### 2.0.4 Metric catalogue (labels, abbreviations, units)

Source: `settings---F8aIpR.js` (export `y`, list `c`), duplicated in the worker. Each entry is label (abbreviation) – description.

**Physical**
- `minutes_played`: "Minutes tracked" (Min) – "Total minutes the player was tracked playing" – unit "min"
- `distance_covered`: "Distance tracked" (Dist) – measured `{kind:distance, from:meters}`
- `average_speed`: "Average speed" (AS) – speed from km/h
- `top_speed`: "Top speed" (TS) – speed from km/h
- `high_intensity_runs`: "High-intensity runs" (HIR)
- `sprints`: "Sprints" (Spr)

**Events**
- "Assists" (A)
- "Conversion rate" (CR, %)
- "Passes" (Pas)
- "Passes success rate" (PSR, %)
- "Passes successful" (PS)
- "Passes unsuccessful" (PU)
- "Dribbles" (Drb)
- "Goals" (G)
- "Goal involvements" (GI)
- "Shots" (Sh) – "Number of shots taken that did not result in a goal"
- "Total attempts" (Att)
- "Tackles" (Tkl)
- "Duels" (Dls)
- "Interceptions" (Int)
- "Loose ball recoveries" (LBR)
- "Corners" (CK)
- "Free kicks" (FK)
- "Goal kicks" (GK)
- "Penalty kicks" (PK)
- "Throw-ins" (TI)
- "Fouls" (F)
- "Saves" (Sv)

**General**
- "Matches" (M) – "Number of times in a lineup (as a starter or a substitute)"
- "Starts" (St)
- "Captaincies" (Caps)
- "Player of the match" (POTM)
- "Total events" (Events) – "Number of events assigned to player"

Units, from `settings---F8aIpR.js` `t`: `% / km / km/h / min`.

**Unit conversion.** `use-unit-formatter-CZJsHF_V.js` reads the user preferences `distance_unit` (default `yards`) and `speed_unit` (default `mph`):
- Distance units: meters, yards, feet, kilometers, miles.
- Speed units: kmh, ms, mph, min_per_km, min_per_mile. Pace is shown as `m:ss`.
- Tables and focus cards use `granularity:"coarse"`, so metres become km and yards become miles (`utils-BjP7Do0s.js` `S`).
- Numbers without a measurement are rounded to 1 decimal (`f`), or use `toFixed(decimals)` when given.
- A missing value renders as "placeholder for an unavailable stat||N/A".

### 2.0.5 Feature gates relevant to players

**Waffle flags** (`feature_flags-CEQAkNH2.js`):
- `player-stats-event` (`playerStatsEvent`) switches between the new and old Studio player tab: leaderboards, shot map, heat map, comparison, focus card, and jersey-only rows.
- `player-moments-hide-gk` hides the "Goalkeeper" option in Player Moments.
- `events-jersey-numbers` allows clickable stat chips for players with only a jersey number.
- `player-offering` enables the `/player` route.
- `analytics-reduced-accuracy`.
- `new_plural_forms`.

**Waffle switches** (`switch_gated_groups-Bjk8c6gu.js` + `gated-metrics-gn4_9qmN.js`; a metric is hidden when its switch is off):
- `tackles-dribbles-analytics-2` → tackles, dribbles
- `duels-analytics-2` → duels
- `interceptions-recoveries-analytics-2` → interceptions, loose_ball_recoveries
- `saves-analytics-2` → saves
- `player-passes-analytics-studio` → passes, passes_success_rate, passes_successful, passes_unsuccessful
- `player-passes-events-panel` → event type `pass`

**Permissions** (Django-style, match object):
- `analysis.read_match_playermoments`
- `analysis.read_match_playereventstats`
- `analysis.read_match_playerphysicalstats`
- `analysis.read_match_radar`
- `matches.read_match__lineup`

Sources: `detail-B56tzMIL.js`, `analysis-B7oi1Haw.js`, `controls-AUmZE8DY.js`.

**Product gates:**
- Analytics Studio uses `permissions.can_view_all_analytics_features` / `hasFullAnalyticsStudioAccess`. Without it, the player tab shows a lock icon, the tooltip "Included in Analytics 2" and the promo "Player Stats is a part of Analytics 2" (`view-BYcaVA08.js`, `promo-DmHhhWPi.js`).
- Player Spotlight needs `has_playermoments_enabled` or `feature_processing_status.player_spotlight ∈ {completed,error,pending,processing}`. When it is `"not-purchased"`, a teaser or promo is shown (`detail-B56tzMIL.js` `Tl`, `settings-DLtzORLW.js` `Z`).
- Match-level analytics version: `analytics_version === "2"` ("Analytics 2") decides AI player stats coverage (`build-table-data-D2wG9dW9.js` `G`, `context-card-Jk_Nkykh.js` `Ea`).

### 2.0.6 Player identity rules

Sources: `resolve-player-identity-qhSXUDcJ.js` and the worker `Qm/Xm/ep`.
- **Jersey number:** cross-match prefers `default_jersey_number`, then `jersey_number`. Single-match does the reverse. The values `-1`, `""` and non-numeric count as missing.
- **Position:** cross-match prefers `default_position` over `position`. Single-match does the reverse. The label comes from `meta.positions[code].label` / `.label_full`.
- **Display name:** `known_name`, else `first_name + " " + last_name`, else "Jersey #%(jersey_number)s", else "Unknown player".
- **Player `type`:** `"identified"` (has player_id/user_id) or `"jersey_only"` (AI jersey not linked to a user).
- **Row ids:**
  - heat maps and shot maps (`ep`): `user:{user_id}` or `player:{player_id}`; jersey-only rows use `jersey:{n}`.
  - Studio table (`build-table-data` `I`): `ai-{jersey}` for jersey-only rows.
- **Row filtering** in `build-table-data-D2wG9dW9.js` `O`:
  - Jersey-only rows are kept only when flag `player-stats-event` is on, and a jersey of `-1` is dropped.
  - Rows with no jersey, user, player or name are dropped.
  - `dropNonParticipants` applies when **all** selected recordings have `analytics_version==="2"`. It drops rows with only zero stats (apart from `matches`) and no position.

## 2.1 Analytics Studio → "Player stats" tab (cross-match, team scope)

- **Route:** `/clubs/:club_slug/analytics-studio/?team=<slug>#player-stats`, optionally with `&recording_id=<id>` to restrict to one match (`settings-DLtzORLW.js`, `utils-R-UBdmQb.js`, `analysis-B7oi1Haw.js`).
- **Entry components:** `view-BYcaVA08.js` → lazy `player-stats-FQG92yUp.js`. The provider is `player-stats-provider-iXdESI3v.js` and the data comes from the worker.

**Tab gating** (`view-BYcaVA08.js`):
- The player tab is selectable when `can_view_all_analytics_features || flag player-stats-event`.
- Without full access and with the flag on, the tab shows a lock icon and the tooltip "Included in Analytics 2". The content becomes the promo (`promo-DmHhhWPi.js`), with these strings:
  - Title: "Player Stats is a part of Analytics 2"
  - Admin copy: "Track every player across every match. Leaderboards, shot maps, heatmaps, and side-by-side comparisons."
  - Non-admin copy: "See how you and your teammates perform in every match — leaderboards, shot maps, heatmaps, and side-by-side comparisons."
  - Feature list from `promo-BOFj2rh0.js`: "Leaderboards", "Stats table", "Player shot map", "Heatmaps", "Player comparison", "Upgrade to Analytics 2", "Locked · Analytics 2".
- Without full access and with the flag off, the tab is disabled with the tooltip "Upgrade to Analytics".

**Section nav** (`view-BYcaVA08.js` `Os`): "Leaderboards", "Stats table", "Shot map", "Heat map", "Player comparison". Every item except "Stats table" requires flag `player-stats-event`. The anchor ids are `analytics-leaderboards`, `analytics-stats-table`, `analytics-player-shot-map`, `analytics-position-heatmap` and `analytics-player-comparison` (`settings---F8aIpR.js` `M`).

**Filters.** The shared Studio filter bar is described in the team section, fork B. It feeds worker `xr` with:
- `match_type[]` → `type`
- `formation[]` → `own_team_formation`
- `recordings_selection[]` → `recordings`
- `recordings_count` → `page_size`
- `recordings_dates` → date range
- `recordings_type` → extra params
- `date_end`
- `lineup_player` → `has_lineup_player`

Each of the player sub-views below is computed over the resulting list of match identifiers.

**Load sequence** (`player-stats-provider-iXdESI3v.js`, worker):
1. `fetch_team_players` (P12).
2. `fetch_player_stats_data`: the worker resolves matches (P13/P14), then runs P1. The rows are built with `build-table-data` in mode `"cross-match"`.
3. With flag `player-stats-event` on, three more requests run in parallel: leaderboards (P11), heat maps (P4) and shot maps (P8), using `teamId` and `matchIds`. With the flag off these return `{}` or `[]`.

**Page-level states** (`player-stats-FQG92yUp.js`):
- Promo, as above.
- Error: `error-Bd2rBpWI.js` with "We couldn't load the Player Stats table."
- No recordings: `no-team-recordings-KGSQxSVx.js` (`based_on_filter`).
- Worker error toasts:
  - "Unfortunately, we were unable to fetch the team players. Please try again."
  - "Unfortunately, we were unable to fetch the recordings. Please try again."
  - "Unfortunately, we were unable to fetch the data. Please try again."

### 2.1.1 Leaderboards (flag `player-stats-event`)

- **Chart type:** a grid of cards, one per metric, each a ranked list of the top 5 players.
- **Section header:** title "Leaderboards", button "Edit Metrics".
- **Tooltip** (topic "leaderboards"):
  - Summary: "See how your players rank across the matches in your filters."
  - "Choose what you see" – "Select the leaderboards to display for your team."
  - "Data sources" – "Leaderboard stats come from your match recordings. Veo's AI detects them automatically and matches them to each player by their assigned jersey number. Any event you edit or correct in your matches shows up here too."
  - "Assign jersey numbers" – "Invite players and assign their jersey numbers to track their individual stats in Analytics Studio."
- **Endpoint:** P11. The response is `items[{stat_type, entries[{rank, player_id, user_id, first_name, last_name, jersey_number, default_jersey_number, position, default_position, player_profile_id, value}]}]`. Only stat types in map `ku` are kept (worker): all table and extended stats except passes_total, passes_unsuccessful, passes_success_rate and possession_won. Conversion rate is ×100 and `seconds_played_total` is converted to minutes.
- **Metric selection:**
  - Defaults when `can_view_all_analytics_features` is true: [passes_successful, FootballGoal, highIntensityRuns]. Otherwise: [FootballGoal, MissedShots, highIntensityRuns] (`settings---F8aIpR.js` `P`/`N`).
  - Users can pick from the leaderboard catalogue `A`: Physical secondsPlayed, distance, averageSpeed, topSpeed, highIntensityRuns, sprints; Events passes_successful … saves; General matches, starts, captaincies, POTM.
  - The modal (`modal-GxI9dOyz.js`) says "Choose up to 3 metrics to display as leaderboards." and shows the count "%(selected)s/%(max)s leaderboards selected".
  - The choice is persisted in localStorage `veo.analytics-studio.leaderboard-metrics`.
- **Card contents:**
  - Title is the metric label, with the unit in the header (converted).
  - Rows are sorted by `rank`. Each shows "N.", name, jersey · position and score + unit.
  - The first row is emphasised and its name wraps onto two lines (first name, last name).
  - Clicking a row opens the Player focus card (2.3) with `context:"Analytics Studio"`.
- **Empty card:** image `/img/leaderboards-empty-state.svg` with "No %(title)s detected by Veo AI".
- **Loading:** `placeholder-TYBCI5Q1.js` shows 3 skeleton cards.

### 2.1.2 Player stats table

- **Chart type:** a sortable table built with TanStack Table (`stats-table-ZqGmS2aN.js`, re-exported by `stats-table-TrMZ7qzh.js`). The player column is pinned on the left.
- **Header:** title "Player stats table", button "Edit columns".
- **Tooltip** (topic "player_stats"):
  - Summary: "See individual player stats across the matches in your filters."
  - "Choose what you see" – "Select which data to show in your columns, and sort by any column to compare players and spot trends."
  - "Data sources", when the flag is on: "Player stats come from your match recordings. Veo's AI detects them automatically and matches them to each player by their assigned jersey number. Any event you edit or correct in your matches shows up here too."
  - "Data sources", when the flag is off: "This table gets its data from each of your match recordings. Get stats for your players by adding them to the lineup in your matches and tagging them in the events they were involved in."
  - Third term when the flag is on: "Assign jersey numbers" – "Invite players to your team and assign their jersey numbers to see them appear in Analytics Studio."
  - Third term when the flag is off: "Add players to your team" – "Invite players to your team in order to add them to your lineup and events, and see them in this stats table."
- **Columns:**
  - Default columns: matches, TotalShots, FootballGoal, MissedShots, ConversionRate, TotalEvents, distance_covered, average_speed, sprints, minutes_played, high_intensity_runs (`settings---F8aIpR.js` `R`).
  - Columns are user-configurable from the catalogue in 2.0.4 and stored in localStorage `veo.analytics-studio.table-metrics`.
  - Physical columns are hidden when the flag is off (`player-stats-provider` `ca`), and gated metrics are filtered.
  - The header shows the full label, the abbreviation (`label_abbrev`, used on small screens) and a description tooltip.
- **Sorting:** default `player` ascending. Players with names come first, sorted by name then jersey (`utils-BjP7Do0s.js` `s`). Numeric columns sort descending on the first click, and undefined values go last. The sort icon aria label is "Sort by X descending/ascending".
- **Cells:**
  - With the flag on, the player cell is a `player-card` with avatar or jersey avatar, the name (or "Jersey #%(jersey_number)s") and the subtitle "#jersey · position". Clicking it opens the Player focus card.
  - With the flag off, the cell shows avatar + name.
  - The current user's row is highlighted (`aria-current`).
- **Values:** measurement-converted, coarse distance; "N/A" when undefined.
- **Data:** P1 + P15 (matches, starts, captaincies, POTM from lineups) + P12 (roster).

### 2.1.3 Player shot map (flag `player-stats-event`)

- **Chart type:** a half-pitch shot map with goal and shot markers, beside a ranked player list (`player-stats-FQG92yUp.js` `Tr`). The map component `De` lives in `shots-without-location-BE-KdR3w.js`.
- **Header:** "Player shot map".
- **Tooltip:**
  - Summary: "See where your players took shots and scored goals across the matches in your filters."
  - "Choose what you see" – "Select which players and shot types to show on the map."
  - "Data sources" – "Shot map data comes from your match recordings and shows where each shot happened on the pitch. Any event you edit or correct in your matches shows up here too."
  - "Assign missing locations" – "If a shot or goal lacks a location, open the match event and assign its location to show it on the map."
- **Filter chips:** "Sports: all attempts of scoring a goal||Total attempts" = [goal, shot], "Shots" = [shot], "Goals" = [goal]. A chip is disabled when no player has events of that type.
- **Player list:** players with ≥1 event of the selected types, sorted by count descending, then name. Each row shows the count as its score. Clicking selects a player; by default the first player with events is selected.
- **Endpoint:** P8. The response is `{direction_of_play, items[{player, events[], unlocated_events[]}], included:{matches:{id:{kickoff_time, opponent_name, url, own_score, opponent_score}}, positions}}`.
  - Event fields: `event_id, match_id, video_time_ms, x, z, outcome (1 = goal)` and `event_type` (`FootballGoal` for unlocated events).
- **Coordinates** (worker `eoe`):
  - If `direction_of_play==="rightToLeft"`, then x=1−x and z=1−z.
  - Map x = `min(2x−1, 1)`, which maps full-pitch 0..1 to the attacking half 0..1 (own half → negative); map y = `clamp(z,0,1)`.
  - Rendering: `left: x*100%`, `bottom: y*100%`, flipped for the defending team (`shots-without-location-BE-KdR3w.js`).
  - The map shows the direction of play and a middle line.
- **Interaction:** clicking a marker opens a context card with match info and plays the clip at `time = video_time_ms/1000`. Videos are fetched via `fetchRecordingsVideos`.
- **Unlocated events:** listed separately by the shots-without-location component.
- **Empty and error states:**
  - "Loading shots…"
  - "Unable to load player shots. Please try again."
  - "No player shots available."
  - "Select a player to view their shots"
  - "No goals detected by Veo AI."
  - "No shots detected by Veo AI."
  - "Sports: empty state for total attempts shotmap||No goals or shots detected by Veo AI."

### 2.1.4 Player position heat map (flag `player-stats-event`)

- **Chart type:** a canvas matrix heat map over a pitch, beside a player list.
- **Header:** "Player position heat map".
- **Tooltip:**
  - Summary: "See where your players were most active on the pitch across the matches in your filters."
  - "Data sources" – "Player position data comes from your match recordings, matched to each player by their assigned jersey number. Every match is shown with your team attacking left to right, so they're easier to compare."
- **Endpoint:** P4. The response is `items[{player, match_count, matrix:{values: base64}}]` plus `meta.positions`.
- **Decoding** (worker `Oae`): base64 → Uint8 → `/255`, always **1800 cells**. The pitch component reshapes these into **30 rows × 60 columns**, row-major (`pitch-analytics-CquIUgYq.js` `K`).
- **Coordinates:** no client-side flip; the server normalises to "attacking left to right".
- **Player list:** sorted by name, then jersey. Clicking toggles the selection.
- **Empty and error states:**
  - "Loading heat maps…"
  - "Unable to load player heat maps. Please try again."
  - "No player heat maps available."
  - "Select a player to view their heat map"
  - "Sports: empty state for player position heatmap||No position data detected by Veo AI" when all density values are 0.

### 2.1.5 Player comparison (flag `player-stats-event`)

- **Chart type:** a two-column "A vs B" metric comparison, plus side-by-side mini heat maps and shot maps.
- **Header:** "Player comparison".
- **Tooltip:**
  - Summary: "Select two players to compare side-by-side across the matches in your filters."
  - "Data sources" – "Player comparison stats come from your match recordings. Veo's AI detects them automatically and matches them to each player by their assigned jersey number. Any event you edit or correct in your matches shows up here too."
- **Selectors:** two "Select player" dropdowns separated by "vs". Defaults are the first and second players. Picks are stored per team in localStorage `veo.analytics-studio.comparison-players.{team_slug}` as `{player_a_id, player_b_id}`.
- **Metric groups** (`player-stats-FQG92yUp.js` `He`):
  - "General": Matches, Total events, Player of the match, Captaincies
  - "Physical": Minutes tracked (min), Distance tracked (1 dp), Average speed (1 dp), Top speed (1 dp), High-intensity run, Sprint
  - "Distribution": Passes, Passes success rate (%, 1 dp), Passes successful, Passes unsuccessful
  - "Attacking": Assists, Conversion rate (%), Dribbles, Goals, Goal involvements, Shots, Total attempts
  - "Defending": Tackles, Duels, Interceptions, Loose ball recoveries
  - "Set pieces": Corners, Free kicks, Goal kicks, Penalty kicks, Throw-ins, Fouls
  - "Goalkeeping": Saves
- **Filtering:** groups pass through the switch gating. Rows are kept only if at least one selected player has a value.
- **Value source:** table row first, then `comparison_data` (extended stats).
- **Highlighting:** the larger value is highlighted, for every metric with no "lower is better" exception.
- **"Maps" group:**
  - "Heat map": both densities, with labels "Defensive" / "Attacking".
  - "Shot map": both players' located shots. Empty text: "No goals or shots detected by Veo AI."
- **Loading:** skeleton (`player-stats-FQG92yUp.js` `Ka`).

## 2.2 Per-match player stats ("Player Stats Overview") in the match editor Analytics panel

**Location:** match page `/matches/:slug/#analysis`, a card in the analysis panel (`analysis-B7oi1Haw.js` `Ls`).
- Card title "Player Stats Overview" with tag "New!". Shows image `/img/player-stats-table.png` and the button "I.e. view stats table||View table".
- The button opens a modal titled "Player Stats Overview" – "A statistical overview for this match."
- Gate: `analysis.read_match_playereventstats || analysis.read_match_playerphysicalstats` (`analysis-B7oi1Haw.js`).

**Info dialog:**
- Title "About Player Stats Overview" / "Player Stats Overview".
- Summary: "See individual player data, and understand the connection between decisions taken on the field and statistical outcomes."
- "Data sources" – "This table gets its data from your recordings. Most metrics are detected automatically by AI and assigned to your players. Some metrics are manually inputted by you."
- "Add players to your team" – "…"

**Data:** `match-player-stats-provider-CW6BTXEl.js` sends worker `fetch_player_stats_data` with `{teamId, recordings:[{identifier:matchId}], skipRecordingLookup:true}`. That resolves to P1 with `match_ids:[matchId]`, or to P2 when `includePeriodStats` is set. Rows are built in mode `"single-match"` with `dropNonParticipants:true`.

**Columns:**
- Default columns: minutes_played, distance_covered, average_speed, top_speed, sprints, high_intensity_runs, TotalEvents, FootballGoal, assists, GoalInvolvements, ConversionRate, MissedShots, TotalShots, tackles, FootballCornerKick, FootballFreeKick, FootballThrowIn, FootballFoul, FootballPenaltyKick, FootballGoalKick.
- Selection is persisted per match in `veo.match-player-stats.columns.{matchId}`.
- The column editor offers groups General, Physical and Events. Its strings:
  - "Edit columns"
  - "Select the stats in the order you want them displayed in the table, from left to right."
  - "%(selected)s/%(total)s selected:"
  - "Please select at least 1 column"
  - "Reset"
  - "Apply selection"

**Clickable stat chips** (`stats-table-ZqGmS2aN.js` `We`):
- Count cells for event metrics open the events list, filtered to that player and those event types. Mapping: FootballGoal→FootballShotGoal, MissedShots→FootballShot, TotalShots→both, corners, free kicks, goal kicks, penalties, throw-ins, fouls, tackle, duel, dribble, interception, loose, save, pass.
- Tooltips read "Watch 1 goal" / "Watch %(count)s goals", and so on.
- A chip requires `user_id`, or a jersey number when flag `events-jersey-numbers` is on.

**States:**
- Error: "We couldn't load the Player Stats table."
- No data: "No player data detected" – "Veo AI did not detect jersey numbers in this recording. If you believe this is an error, please contact Support." + "Remember: you can manually create data here by adding players to the lineup and match events." with the button "Contact support".
- Empty lineup banner: "No players in the Lineup!" – "To view players, simply add them to the Lineup. Include an AI-detected jersey number for AI stats!"
- Buttons: "Edit lineup" and "All player stats". The latter deep-links to Studio with `recording_id`.

## 2.3 Player focus card (player context card)

**Component:** `context-card-Jk_Nkykh.js` `Es`. Contexts:
- `"Analytics Studio"`: opened from leaderboards and the stats table, cross-match.
- `"Editor"`: opened from the match Lineup panel, single match (`lineup-DELXq3XS.js`, `hasAnalytics` = `match.has_analytics…` selector `objects-qR7pcF19.js` `he`).
- `"Team Default Lineup"`: shows only "Remove from lineup".

**Header:**
- Data-source label: the filter summary, "1 recording" / "%(count)s recordings" or the date range.
- "Close card".
- Avatar; when `profile_player_id` exists the tooltip is "Open Player Profile", which opens `<app>/player/{profile_player_id}/`.
- Name, or "Unknown player".
- Jersey badge, with the tooltip "No jersey number added in the roster" when missing.
- Position short and full names, with the tooltip "Default lineup position" or "Last position played".

**Tabs:** "Overview", "Stats", "Player physical statistics (sport), e.g. speed||Physical", "Player game maps, e.g. heatmap and shotmap||Maps". Tabs other than Overview are disabled when there is no analytics or no matches.

**Data:**
- Stats come from P3. The client takes `items.find(type==="cross_match_player")` and `meta.stats_availability[]`.
- Stats tab mapping (`ja`):
  - `minutesTracked = minutes(seconds_played_total)`
  - `TotalEvents = goals + shots + corners + free kicks + goal kicks + penalties + throw-ins + fouls + assists`
  - `ConversionRate = round(rate*100)`
  - plus raw values
- Physical tab (`ka`): distance_total_meters, average_speed_kmh, top_speed_kmh, sprints_total. It is null if none of these is present.

**Coverage banners:**
- `stats_availability[].analytics_version` gives `all-analytics-2`, `mixed` or `no-analytics-2`:
  - "No AI data" – "These matches don’t have Analytics 2. You’ll only see stats from events manually assigned to players."
  - "Incomplete data!" – "Your filters include matches with and without Analytics 2. AI-detected player stats only appear for Analytics 2 matches."
- `has_ai_events || has_physical_stats` per match gives `ai-tracked`, `partial` or `manual-only`:
  - "No AI stats!" – "To get AI stats and heat map, assign an AI-tracked jersey number to %(name)s in these matches."
  - "Incomplete data!" – "Some filtered matches are lacking AI stats. Ensure that %(name)s is assigned to an AI-tracked jersey in all of them."
- No user: "Unknown player!" – "Please assign this jersey to a player in the lineup for these matches."
- Editor context:
  - "No jersey added!" – "To get AI stats please assign a tracked jersey number to %(name)s."
  - "This jersey was not detected by Veo AI."

**Loading and error states:**
- "Loading data..." – "This might take a few minutes."
- "Something went wrong" – "Sorry, we couldn’t load the data." with the button "Retry".

**No-analytics teaser:** "Level up with Analytics!" – "Unlock player stats and powerful insights…" with the buttons "Get Veo Analytics" and "Learn more".

**Overview tab:** four big KPI tiles chosen by position code (`oa`):
- Fallback: [Distance tracked, Top speed, Total attempts, Duels].
- GK: goal kicks, saves, succ. passes, recoveries.
- LB/RB: tackles, succ. passes, distance, interceptions.
- CB: interceptions, tackles, succ. passes, duels.
- LWB/RWB: sprints, assists, distance, recoveries.
- DM: recoveries, interceptions, succ. passes, tackles.
- LM/RM: succ. passes, distance, assists, dribbles.
- CM: succ. passes, distance, dribbles, recoveries.
- LW/RW: dribbles, top speed, sprints, goal involvements.
- AM: assists, goal involvements, dribbles, sprints.
- ST: total attempts, goals, assists, conversion rate.

Tiles whose switch is off are removed. "Passes successful" shows "x/passes" as a denominator. Abbreviated labels are "Dist. tracked", "Conv. rate", "Succ. passes" and "Recoveries". An unavailable value shows "N/A" with the tooltip "Data not available".

**Stats tab** (sections, rows):
- "General": Minutes tracked, Total events
- "Attacking": Goals, Assists, Goal involvements, Conversion rate, Shots, Total attempts
- "Defending": Tackles, Duels
- "Distribution": Passes, Dribbles, Interceptions, Loose ball recoveries
- "Set pieces": Corners, Free kicks, Fouls, Penalty kicks, Goal kicks, Throw-ins
- "Goalkeeping": Saves

Gated rows are filtered and zeros are de-emphasised.

**Physical tab:** Distance tracked, Average speed, Top speed, Sprints, with unit conversion.

**Maps tab:**
- Heat map, Analytics Studio context: P5, rendered as "heatmap-canvas". It is skipped when jersey quality is `manual-only`.
- Heat map, Editor context:
  - P6 per match with a period selector (period `public_identifier`) and the "Heat map interval" range slider (step 60 s, domain = period `timeframe`), shown with mm:ss labels. Requests are debounced by 500 ms.
  - Strings: "Heat map requires match periods.", "Heat map not available", "No jersey added!" – "To view the heat map please assign a tracked jersey number to %(name)s."
- Shot map: P9. Events map to `x = 2x−1`, `y = z`, `time = video_time_ms/1000`, `type = outcome===1 ? goal : shot`. Unlocated events are shown as "Shots with missing location:".
  - Metrics below the map: "Goals", "Missed shots", "Total attempts", "Conversion rate" (= round(goals/total*100)).
  - Empty info: "Add locations to shot & goal events to see them here".
- Map errors (`pitch-analytics-CquIUgYq.js`): "Error generating heat map" / "Error generating shot map" with "Retry", and "No data".

## 2.4 Recent form (legacy lineup context menu, only when flag `player-stats-event` is OFF)

**Location:** match Lineup → formation pitch → player context menu (`formation-select-CPqNKjKe.js` lazy `player-recent-form-pz0_roea.js`). With the flag on, the focus card replaces it.

**UI:**
- Title "Recent form", with the tooltip "The last 3 lineups they were included in."
- Link icon to "Analytics studio" (`…/analytics-studio/?team=<slug>#player-stats`), shown only with permission.
- Four KPI tiles (`provider-D_9nyEFR.js` `I`), each with a description tooltip:
  - "Goals" (Goals scored)
  - "Assists"
  - "Attempts" (Number of goals and shots)
  - "Starts"
- States: spinner; "Couldn't load data" with "Retry".

**Data:** worker `fetch_player_stats_table_data` with:
- `filter_data = {date_end: match.start − 1 s, recordings_count:{value:3}, recordings_type: any, match_type: [league, cup, tournament, friendly, showcase, none], club_slug, team_slug, lineup_player:<user_id>}`
- `team_players:[{user_id}]`

That calls P13 (`page_size=3&has_lineup_player=<user>&date_end=…`), then P15 for starts, then P1 for goals, assists and attempts, matched by `user_id`.

## 2.5 Player Moments / "Player Spotlight" (per match)

**Location:** match page panel `#player-moments` (`detail-B56tzMIL.js` `IR` → `player-moments-DpNOIBZ0.js`). The panel nav icon is "jersey".

**Gating** (`detail-B56tzMIL.js` `Tl`):
- Panel available when permission `analysis.read_match_playermoments` holds, the sport is football, and either `has_playermoments_enabled` or `feature_processing_status.player_spotlight` is in [completed, error, pending, processing].
- Otherwise, when `player_spotlight==="not-purchased"` or the status is unknown, the button shows "Get Player Spotlight". It leads to the promo (`promo-xWprlryS.js`) when flag `player-stats-event` is on, else to the teaser (`teaser-B5QtXQ3_.js`).
- Promo copy: "Player Spotlight", "Part of Analytics 2", "Add Analytics 2 to your plan", "Your best moments, found automatically.", "Follow a player", "Full control", "Easy clip creation", "Download & share your moments", and more.
- Processing states: "Player Spotlight is processing...", "There was an error processing Player Spotlight" (`processing-CVLUrSce.js`).

**Header:** "Player Moments" – subtitle "Your moments on the ball, detected by Veo AI".

**Help dialog** (`actions-BOZTxwn4.js`): "How to use Player Moments", "AI jersey tracking", "Accuracy", "Link your players", "Make sure they are your numbers".

**Player picker:**
- Groups:
  - "Goalkeeper" (jersey constant `"9999"`, `settings-DLtzORLW.js` `K`), hidden by flag `player-moments-hide-gk`.
  - Lineup players whose jersey was detected.
  - Detected jersey numbers without a lineup player.
- Detected jerseys come from P18 (`own_side` decides own vs opponent). Only own-team jerseys are listed; negative numbers are dropped.
- Strings: "Watch a different player", "Select a player", "Assign in Lineup", "Clear selection".

**Endpoint:** P16, sent once per period and cached by key. Response: `{moments:[{tracks:[[t_s, x, z, metres_to_ball], …]}], jersey, category}`. The tuple meaning is inferred from use: index 0 is time and index 3 is distance to ball; `follow-player-tracks` uses indices 1 and 2 as world x/z.

**Client-side moment extraction** (`player-moments-provider-BjFaeazu.js` `Ae`):
- A moment is a run of consecutive track samples where `metres_to_ball ∈ range[meters_to_ball_category]`, with ranges `[[0,3],[4,7],[8,10]]` m.
- Each run is padded with surrounding samples within `lead_lag_time` seconds.
- Runs are kept if `end − start` is in the duration range `[[0,4],[5,9],[10,20]]` s by `seconds_on_ball_category`.
- Then:
  - Manual events of that player (events slice, `player_id`) are added as moments of `time ± lead_lag`.
  - All moments are padded by ±`lead_lag_time`, clamped at ≥0.
  - Overlapping moments are merged and their tracks deduplicated.
- The result is pushed into the video playlist with `source:"player-moments"` and `should_keep_default_play_order`.

**Settings popover** (`settings-LewjEyKi.js`), titled "Player Moments Settings":
- "Distance to ball": slider 0–2, "Near"…"Far". Default **1**.
- "Time on ball": slider 0–2, "Short"…"Long". Default **0**.
- "Add time before and after moment": slider 0–10 s. Default **5**.
- "Color" (highlight circle): "Green" / "White" / "Off". Default Green.
- Buttons: "Apply settings", "Reset to default settings".
- Non-default values persist in localStorage `veo.lineup-player-bar-settings`.

**List view:**
- Grouped by period heading. Each row shows the match clock (or period label) and the duration "Ns".
- Actions: "Create clip". This prefills a highlight with comment `@user` or "Jersey # N", privacy `involved_players` and tag "Moment".
- Counters: "<strong>%(moments_count)s</strong> moments" and "<strong>%(moments_duration)s</strong> minutes" (sum of durations).
- "Share link" opens the share modal (`share-player-moments-DJc_4YYI.js`).
  - URL: `?jersey_number=&meters_to_ball_category=&seconds_on_ball_category=&lead_lag_time=&track_animation_state=` + `#player-moments`.
  - Copy: "Moments can only be viewed by team members", "Watch my best moments in %(match_title)s | Veo Player Spotlight".

**Empty and error states:**
- Toast: "No moments detected" – "Please adjust your Player Moments settings and try again."
- "No moments with these settings" – "Adjust settings ⚙ to find more moments".
- "Error generating Player Moments", "No jersey numbers detected", "Moments will load after Sides and Periods are confirmed", "Please confirm Sides and Periods".

**Spotlight circle overlay** (`follow-player-tracks-CTSaUSZ3.js`, mostly the bundled Lottie library):
- For the current video time it interpolates the `[t, x, z]` track linearly.
- It projects world (x,z) to screen UV with the camera alignment `logic2camera / camera2world / field_length / field_width` and per-frame camera directions (frame index = `round(t * 29.97)`) via `use-draw-on-pitch-matrix-buffers-C4kiYcT5.js` `n/r`. The projection drops points behind the camera (`dirCamspace.z < 0.01`) or outside 0..1.
- It draws the Lottie animation `${STATIC_URL}/animations/draw-player-tracks/{green|white}/index.json`.
- Size = `100*(1 − dist_to_near_touchline_centre/max_dist) + 50` px.
- Label: jersey + "F. Lastname".

## 2.6 Veo Vision: interactive player stats overlay on the video (per match)

**Location:** video player controls (`controls-AUmZE8DY.js`) with `player-tracking-provider-DTE00hRL.js`. Gated by permission `analysis.read_match_playerphysicalstats` and by the match having the "player-tracking" RAS status.

**Toggle:** "Video overlay feature that lets users select players in the video to view their stats||Enable Veo Vision". Controller strings:
- "Veo Vision"
- "1 player selected" / "%(count)s players selected"
- "Select all" with "Own team" / "Opponent"
- Key metric selector "Key metric": "Current speed" | "Distance tracked"
- "Deselect all players"

**Data:**
- P17, fetched in 30 s windows. The client refetches when the playhead is within 5 s of the window edge.
- Response: `{ "<seconds>": [[trackId, category, x, y, jerseyNumber, distance, speed], …] }`. Samples are linearly interpolated between keys; a value of `-1` for speed or distance means unknown.
- Categories (`player-tracking-DshOpNPo.js`): left_goalkeeper 0, left_outfield 1, right_goalkeeper 2, right_outfield 3, referee 4, ball 6. They are remapped to own/opponent using the period `own_side`. `unknown_team_player` = 10.
- x and y are 0..1 pitch-normalised. World coordinates = `((x−0.5)*field_length, (y−0.5)*field_width)`.

**Per-player card:**
- "Speed": current speed converted to the user unit with 1 decimal, plus the zone label "Sprint" or "Run".
- "Distance": cumulative distance tracked, coarse unit (km or miles) with 1 decimal.
- Physical rows from P19, items filtered to `drill==="ALL"` and keyed by `jerseyNumber:isOwnTeam`: "Avg. (%(unit)s)" = `averageSpeed`, "Top (%(unit)s)" = `maxSpeed`, "No. of sprints" = `sprints`.

**Speed zones:**
- Team setting `team.speed_zones[{zone, lower_bound_kmh}]` (≥5 zones). Run threshold = zone 3 lower bound; sprint threshold = zone 5 lower bound (`objects-qR7pcF19.js`).
- The team PATCH also carries `hsr_threshold_kmh` and `sprint_threshold_kmh` (`src-CpmFfToj.js`).
- Colours: sprint orange, run green.

**Unidentified players:** "Unidentified", "Select unidentified %(team)s player, track %(trackId)s".

**Related overlay:** the 2D radar (`radar-view-Cz3e8pSO.js`) uses the same tracking data for player trails and "Connect players" (connection distances). It is team-level and summarised here only: "2D Radar", "Show own team", "Show opponent", "Show referees", "Show ball", "Edit player trails", "Connect players", zone overlays "Thirds", "3 lanes", "5 lanes", "18 zones", "Quarters", "Phases", "Advanced".

## 2.7 Match report: player-facing parts (details in section 3)

Source: `report-BVrpWDhT.js`.

**Player stats table** (`Kp`):
- Sortable columns "Player" and "Position", plus the selected metrics, with a period filter (`"full"` or a period id). Per-period values come from P2 `statsByPeriod`.
- Strings: "Per-player statistics for the match", "We couldn't load the player stats." with "Try again", "No player stats for this match.".
- Shown for the own team only.

**Player focus popover** (tabs "Stats", "Physical", "Maps"):
- Stats sections:
  - General: "Minutes tracked" (min), Matches, Starts, Captaincies, Player of the match, Total events
  - Attacking: Goals, Assists, Goal involvements, Conversion rate %, Shots, Total attempts
  - Defending: Tackles, Fouls
  - Distribution: Passes
  - Set pieces: Corners, Free kicks, Throw-ins, "Penalties", Goal kicks
- Physical: Top speed, Average speed, Sprints, High-intensity runs, Distance tracked.
- Maps:
  - "Heat map" (P6 for the period's start/end)
  - "Shot map" (P10, `SHOTMAP`)
  - "Shot stats": Goals / Shots / Total attempts / Conversion rate
- Empty states:
  - "No heat map for this period." / "No heat map for this player."
  - "Add locations to shot and goal events to see them here."
  - "Shot locations aren't available for this match."
  - "No shots in this period." / "No shots for this player."

**Report heat map decoding** (`ps`):
- Matrix `{values, width, height, direction_of_play}`, row-major `height × width`, `/255`.
- When `direction_of_play==="rightToLeft"`, rows **and** columns are reversed.
- Event map coordinates in the report: `x = 1 − z`, `y = x` (vertical pitch orientation).

**Sprint key metrics** (P20): items `{id, metric:"Sprint", teamId, jerseyNumber, timestamp (ms), value}`. These produce "Fastest Sprint" (the max `value`) and the sprint-count clip list, filtered to the own team and the period.

**Speed zones per player:**
- Stacked bars per recording-time bucket of "% of tracked time", with team or per-jersey selection.
- Labels: "Below HSR (< %(hsr)s)", "HSR (%(hsr)s–%(sprint)s)", "Sprint (≥ %(sprint)s)". Thresholds come from the team speed settings in the report payload.
- Colours: belowHsr `#f7f5f0`, hsr `#71cf5a`, sprint `#ec8a3e`. Only HSR and sprint are charted.
- y axis: "% of tracked time"; x axis: "Recording time".

## 2.8 Pitch heat map rendering (to reproduce 1:1)

Sources: `use-section-nav-DfFxQiqS.js` export `o` (`be`) and `pitch-analytics-CquIUgYq.js` `Y`.

**Input:** the matrix reshaped into rows × columns (Studio and focus card: 30 × 60). Canvas size is 400 × 200 px over the SVG pitch (`viewBox 0 0 222 142`, with dashed third lines only for location maps).

**Algorithm:**
1. Apply a separable Gaussian blur with σ = 0.8 cells, kernel radius `ceil(3σ)` and clamped edges.
2. Let `max` be the maximum value. The threshold is `0.05·max`, and the fade band is `0.04·max` above the threshold.
3. Normalisation range: min and max over the values ≥ threshold, or [0,1] when flat. Then `g = clamp((v−min)/(max−min))^0.8`.
4. Bilinear sampling per pixel.
5. Colour = 256-entry LUT interpolated in **OKLCH** between the stops (hue along the shortest arc), with chroma × `chromaBoost`.
6. Alpha = `255 · fade · g^0.1`, where fade is the ramp from the threshold to threshold+band. Pixels below the threshold are transparent.

**Parameters:**
- Studio and focus card stops (OKLCH → hex): `#e5fe8d`, `#dafb54`, `#ffe500`, `#ffcc00`, `#f87612`, `#f5140f`. `chromaBoost = 1.1`.
- Default `chromaBoost` in `be` is 1.6.
- An alternative palette uses CSS variables `--wa-color-green-90, --wa-color-yellow-90, --wa-color-yellow-80, --wa-color-orange-50` (`use-section-nav` `pe`).
- Smoothing sent to the server is **1.5** for all heat map requests (`_e`, worker `Rae`).
- Direction-of-play labels: "Defensive" / "Attacking". The location map adds "Middle".

## 2.9 Player profile page `/player` (remote module, not in the bundle)

- The route `/player` (`settings-DLtzORLW.js` `player_base`) is registered only with flag `player-offering` and titled "Player Profile" (`bootstrap-Mr09pQaM.js`).
- It renders the federated remote `PlayerOffering`, loaded from `https://d2gxpydnmytzsp.cloudfront.net/apps/player-offering/remoteEntry.js` (`_federation_PlayerOffering_Module-BCuwBr56.js`). If that fails it renders null.
- The focus card links to `<app>/player/{profile_player_id}/`.
- **None of its views (player page, cross-match player heat map or event maps via mes v2, player physical trend) can be inventoried from the downloaded chunks.**

## 2.10 Open questions (need a live API call)

1. `POST /api/app/analysis/player-heatmaps/` full response:
   - `matrix.width/height` for each `type`: the cross-match code assumes a fixed 1800 = 60×30, while the report reads `width/height`.
   - Whether `direction_of_play` is always set for single-match.
   - The shape of `average_position` (the report calls `ds(...)` on it).
   - `match_count`.
   - The `meta.positions` code list.
2. Whether the grid orientation is rows = pitch width (30) × columns = pitch length (60), with row 0 at the top or bottom touchline.
3. `POST /api/app/analysis/stats/` with `type:"match_all_players"`: the exact `stats[].periods[]` shape and the `period` key (public_identifier?). Also the `meta.stats_availability[]` fields beyond `analytics_version / has_ai_events / has_physical_stats`.
4. The full list of `stat_type` values returned by `/analysis/leaderboards/` and whether `top` can exceed 5.
5. `GET /api/mes/v2/{match}/player-moments`: confirm the track tuple layout `[t, x, z, metres_to_ball]` and the units (metres, seconds), `category` values, and how `side` interacts with `jersey="goalie"`.
6. `GET /api/mes/v2/{match}/player-tracking?start=`: the window length the server returns (the client assumes about 30 s), the key granularity (fps), and whether distance is cumulative per track.
7. `GET /api/mes/v2/{match}/physical-metrics`: item fields besides `drill`, `teamId`, `jerseyNumber`, `averageSpeed`, `maxSpeed`, `sprints` (likely distance, HSR) and the `drill` values other than `"ALL"`.
8. `physical-metrics-detail`: the `metric` values other than `"Sprint"` and the units of `value` (km/h?).
9. Speed zones: the default `team.speed_zones` values (5 zones, lower_bound_kmh) and the `hsr_threshold_kmh` / `sprint_threshold_kmh` defaults.
10. Whether the remote Player Offering module uses the mes v2 cross-match player endpoints (`/api/mes/v2/-/players/{jersey}/heatmap`, `/-/player-events`, `/teams/{team}/players/{jersey}/physical-metrics(-detail)`). This needs its `remoteEntry.js` downloaded and analysed.
11. `/analysis/player-event-maps/` for map kinds other than SHOTMAP: whether event `outcome` semantics differ per kind (pass success?).

# 3. Match Report (`/matches/:slug/report/`)

All claims cite chunks in `veo-web/js/`. UI strings are the English i18n keys; for keys of the form `context||text`, only the text is shown.

## 3.1 Route, entry points, gating

**Route**
- Constant: `match_report:"/matches/:slug/report/"` (settings-DLtzORLW.js).
- Route element (bootstrap-Mr09pQaM.js): title `"Level Up Your Game | Match Report"`, forced dark theme.
- Until Amplitude Experiments is ready (`isReady`, use-amplitude-experiments-Ca67IrHZ.js `i`), a loader is shown. If the Amplitude flag `match_report_v1` has `variant.value==="on"`: `<ReportGate>` (report-gate-DAHFb1FG.js) wraps `<Report>` (report-BVrpWDhT.js); otherwise redirect to `/matches/:slug/`. Flag key defined in feature_flags-CEQAkNH2.js.

**Entry button** (match-report-button-BYKMYPXB.js)
- Outlined button, icon `bar-chart-2`. Label `"Set up Match Report"` when setup is required, otherwise `"Match Report"`.
- Tracks `match_report_button_clicked {match_id, recording_id, club_id, source, is_setup_required}`.
- Placements: match detail page, sources `editor` / `editor_mobile_menu` (detail-B56tzMIL.js); old analytics panel next to "Possession, passes, pass strings and more stats are now in the Match Report.", source `editor_analytics_panel` (analysis-B7oi1Haw.js); recordings list, source `recordings_overview`, new tab (list-YmkpIuNt.js).

**Availability on the match page** (use-match-report-availability-BDXf-IfB.js)
- Requires: flag `match_report_v1`; `is_accessible`; `processing_status.status` not in `uploading|preparing|processing|aborted`; `feature_processing_status` loaded; error resolution returns `null`.
- `isEligible = canRunSetup || !isSetupRequired`; `isSetupRequired = !match_report.team_assigned || !match_report.sides_confirmed` (report-error-resolution-Bb_8a2Ex.js `p`); `canRunSetup` = permission `matches.update_match`.

**Recordings-list eligibility** (recording-match-report-eligibility-l-IJq-xU.js): recording accessible and not processing; `created >= 2026-08-04Z`; device not `veo-go` (device-ZaYK61Pm.js); `sport==="football"`; match type not `training`/`test`.

**Error resolution** (report-error-resolution-Bb_8a2Ex.js `O(feature_processing_status, match)`), in order:
1. No `analysis.read_match_report` → `forbidden`.
2. No `analysis.read_match_report_advanced` and `created < 2026-10-06` → `basicPlanBeforeCutoff`.
3. Advanced and `created < 2026-08-04` → `analytics2BeforeLaunch`.
4. Sport other than football → `sportNotEligible`.
5. Type training or test → `matchTypeNotEligible`.
6. `match_report.available` and the read permission → eligible.
7. `ai_detection` or `analytics` is `processing`/`pending` (objects-qR7pcF19.js) → `reportProcessing`.
8. Either is `error` → `reportProcessingFailed`.
9. Anything else → `notAvailable`.

HTTP error → error kind (error-kinds-CyRY3PS1.js): `not_found`→`notFound`, `forbidden`→`forbidden`, `unauthorized`→`unauthorized`, `network`→`network`; everything else (`validation`, `conflict`, `payload_too_large`, `rate_limited`, `server`, `unknown`) → `server`.

**Plan gates**
- `isBasicReport = !analysis.read_match_report_advanced`. `canManageSubscription` = `is_club_admin` from `GET /api/app/clubs/{slug}/`.
- Locked state (basic plan): only Overview, without Key match stats. Average position replaced by teaser: "See the full team’s average position", badge "Locked · part of Analytics 2", button "Explore Analytics 2", footnote "*only applies to newly processed recordings". Coach Assist off. Upgrade banner "Get the full Match Report" / "Your base plan shows what happened. %(highlight)s — defending, physical output, and every player’s numbers." (highlight "Analytics 2 unlocks the deeper analysis that explains why"), button "Upgrade to Analytics 2". Below: "The rest of the match report" / "Included with Analytics 2." with 6 locked cards: Coach Assist, Distribution, Attacking, Defending, Physical, Player Stats Table.
- Upgrade URL: club admin `/clubs/{club}/plan-and-billing?upgradeFlow=veo-analytics-2&upgradeFlowSource=match-report`; others `https://www.veo.com/product/match-report` (utils-X7ELx8Cj.js).
- Server sends `attacking`, `defensive`, `passing`, `physical` only when `view==="advanced"`; otherwise client nulls `key_stats.{possession, passes, successful_passes, pass_accuracy}` (use-refetch-report-BJr8ioi7.js).

**Metric switches** (gated-metrics-gn4_9qmN.js + switch_gated_groups-Bjk8c6gu.js) for player-table columns:

| Switch | Columns it unlocks |
|---|---|
| `tackles-dribbles-analytics-2` | tackles, dribbles |
| `duels-analytics-2` | duels |
| `interceptions-recoveries-analytics-2` | interceptions, loose ball recoveries |
| `saves-analytics-2` | saves |
| `player-passes-analytics-studio` | pass columns |
| `player-passes-events-panel` | pass events |

## 3.2 Gate: setup and readiness (report-gate-DAHFb1FG.js)

**Snapshot requests (parallel)**
- `GET /api/app/matches/{slug}/` → `permissions`, `team`, `club{id, slug}`, `identifier`, `slug`, `is_accessible`, `created`, `sport`, `type`.
- `GET /api/app/matches/{slug}/periods/` → `items[{name, own_side, timeframe[start, end], is_confirmed}]`.
- `GET /api/app/matches/{slug}/feature-processing-status/` → `{ai_detection, analytics, player_spotlight, match_report{available, team_assigned, sides_confirmed}}`.
- Only if user can edit and match has no team: `GET /api/app/clubs/{clubId}/teams/?fields=id,name,short_name&page_size=50` (cursor pagination).
- `GET /api/app/clubs/{slug}/` → `is_club_admin`.

**Readiness**: analysis not processed → `analysisPending`; no own team or not every period `is_confirmed` → `setupIncomplete`; else `ready`. While setup is incomplete the report is inert and blurred behind a modal.

**Setup wizard** (permission `matches.update_match`)
- Modal "Set up your Match Report"; header "Step %(step_number)s of %(total_steps)s · Set up your Match Report". Explainer "Match Report Setup" ("Why this setup is needed", "Change later"), link "Open match settings" → `/matches/{slug}/#match-setup/setup/teams|sides-periods`.
- Step "Select team" (only when no own team): "Which team is this recording for? Start here so the report is created for the right team." Auto-filled if only one team.
- Step "On which side did your team start?": subtitle depends on number of periods (e.g. "…sides will switch automatically for the 2nd period. See 1st period kickoff in the video below."). Left/Right half-pitch radio (camera view) with team short names; hint "Select a side for the 1st period". Kick-off clip "1st period kickoff": newest mp4 with fragment `#t={t-5},{t+5}`, `t` = first `FootballKickOff` event in period 1 (`video_time_ms/1000`), fallback `periods[0].start_time`.
- Buttons "Cancel setup", "Continue", "Generate Match Report" ("Generating …"). Error "We couldn’t save your setup. Please try again."
- Save: `PATCH /api/app/matches/{slug}/` `{team}` → list periods sorted by `timeframe[0]` → `POST /api/app/matches/{slug}/periods/` `[{name, own_side, timeframe}]` with `own_side` alternating left/right from the chosen side → refetch report.

**Viewer without setup permission**: dialog "This report isn't ready yet" / "Your team admin or coach still needs to set up this match report. While you wait, check out the recording and see how you played on the pitch." Buttons "Close", "Open Recording".

## 3.3 Data load (matchReportSlice-dbGYMyIg.js; selectors in use-refetch-report-BJr8ioi7.js)

- `GET /api/app/analysis/matches/{match_id}/match-report/` (route slug passed as `match_id`; src-CpmFfToj.js). Errors `{detail:{message}}` with 404/409/502.
- Client requires non-null `match`, `teams`, `periods`, `players`, `events`, `scorers`; otherwise error kind `incomplete`, message `The match report is missing its "<key>" data.`

**Inferred response shape**
```
{ view:"advanced"|<basic>, club:{club_id},
  match:{match_id, slug, title, kick_off, videos:[{mime_type,url,created}]},
  teams:{own_side:"home"|"away", home:{team_id,name,short_name,color,crest_url}, away:{...}},
  score:{full_time:{home,away}},
  periods:[{start_time,end_time,own_side}],                       // seconds; index+1 = period no.
  players:[{user_id,jersey_number,known_name,first_name,last_name,avatar}],
  scorers:{home:[{player_id,player_jersey,period_number,period_time_ms}], away:[...]},
  events:[{id,event_type,team:"Own"|..,period_id,period_time_ms,video_time_ms,player_id,player_jersey,
           attributes:[{label:"FootballAssist",type:"uuid"|..,value}]}],
  lineup:{formation,positions_compact,formation_positions:[{id,field_position,position_index,position_name,
          position_name_full,jersey_number,player{id,avatar,name,initials},is_starting,is_team_captain,
          is_unused_substitute,is_player_of_the_match}]},
  overview:{key_stats:{goals,total_attempts,corners,fouls,free_kicks,possession,passes,successful_passes,pass_accuracy}},
  attacking:{goals,assists,total_shots,shots_inside_box,shots_outside_box,goals_inside_box,goals_outside_box,dribbles,
             conversion_rate_overall,conversion_rate_inside_box,conversion_rate_outside_box},
  defensive:{duels,tackles,recoveries,interceptions},
  passing:{forward_passes,successful_forward_passes,sideways_passes,successful_sideways_passes,backward_passes,
           successful_backward_passes,
           pass_locations:{defensive|middle|attacking:{left|middle|right:{successful_passes}}},
           pass_strings:{full_time:{own:[{length,count}],opponent:[..]}, periods:[{period_number,own,opponent}]}},
  physical:{distance_total_meters,high_intensity_runs_total,sprints_total,top_speed_kmh,
            speed_zones:{status:"available",thresholds:{hsr_kmh,sprint_kmh},
              items:[{start_ms,end_ms,own:{status:"measured",percentages:{below_hsr,hsr,sprint}},opponent:{..},
                      players:[{team:"Own"|"Opponent",jersey_number,distribution:{status,percentages,durations{sprint_ms}}}]}]}}}
StatValue = {full_time:{own,opponent}, periods:[{period_number,own,opponent}], comparison?:{full_time:{difference,match_count}}}
```
Every numeric stat is a StatValue.

**Field usage**
- Own team = home when `own_side==="home"`; team label `short_name`. Team colour must be in palette else default; black shown as `#333333`.
- Match minute = `floor((sum of previous period durations + period_time_ms/1000) / 60) + 1`.
- Key events: only `FootballShot`/`FootballGoal`, sorted by `video_time_ms`, running score "a - b", assist from `FootballAssist` attribute (`type:"uuid"` = player id, else jersey number), avatar fallback to lineup.
- Identity: by `user_id`, then jersey number; jersey `-1`/empty = unknown (resolve-player-identity-qhSXUDcJ.js). Display name: `known_name` → first+last → "Jersey #N" → "Unknown player".

## 3.4 Layout and global controls (report-BVrpWDhT.js)

- Header: title + date, "Open match settings" (editors), "New" chip (tooltip "Match Report is new! We're shipping improvements all the time, make sure you come back."), "Update report" (tooltip "Rebuilds the stats and Coach Assist summaries for everyone on the team."), "Match recording" link.
- Score box: home/away names, "Home"/"Away", colour swatches, crests, "h - a", date; desktop scorer list "Name (12')", >5 scorers → 4 + "+N".
- Section nav (use-section-nav-DfFxQiqS.js): sticky, scroll-spy, "Match report sections", "Jump to section: %(section)s", writes URL hash (`#overview`…), tracks `match_report_section_viewed` (`method` nav_click/scroll/deep_link/initial).

| # | Section id | Label |
|---|---|---|
| 1 | `report-overview` | "Overview" |
| 2 | `report-distribution` | "Distribution" |
| 3 | `report-attacking` | "Attacking" |
| 4 | `report-defending` | "Defending" |
| 5 | `report-physical` | "Physical" |
| 6 | `report-player-stats` | "Player Stats" |

- Global filters (mobile: "Filters" sheet): "Team perspective" (own vs opponent short name, home first, team colours, default own); "Period" ("Select Period"): "Full recording" (`full`), "1st period", "2nd period", … (`period-N`). Window for `full` = first `start_time` … last `end_time`, else that period's range. Period sides passed as `[{periodId, ownSide}]`.
- Order inside sections: heading (Player Stats adds "Edit Columns") → Coach Assist card (sections 1–5) → key-metric cards (2–5) → charts.
- Pitch (src-DxLvMDc4.js): landscape SVG viewBox `0 0 627 402`, always left→right ("Direction of play: left to right"); markers `left = y·100%`, `top = x·100%`; API → screen `{x: 1 − z_api, y: x_api}` (report `ds`, `Ot`), i.e. horizontal = `x_api` (length), vertical = `1 − z_api` (width).
- Zone overlays (`yA`/`U0`): `full` "Without zones", `thirds` "Thirds", `3-lanes` "3 lanes", `9-zones` "9 zones", `phases` "Phases", `quarters` "Quarters", `5-lanes` "5 lanes" (y = 74, 148, 252, 327 of 402), `18-zones` "18 zones" (6×3, column-major numbering), `advanced` "Advanced" (x = 94.4, 313.5, 533.2; y = 76.1, 201, 322.1).

## 3.5 Key-metric cards (src-DxLvMDc4.js `SA`)

- Label, value, optional "/ total", unit. Comparison "Compared to last %(count)s match(es)" Increase/Decrease/No change; tooltip "We compare this match with the average of your last %(count)s matches. Training and test recordings aren't included."; only own team, `full` period, `match_count >= 2`. Values rounded. Possession own = `round(own)`, opponent = `100 − own`.

| Section | Cards (source field; total in brackets) |
|---|---|
| Distribution | Successful passes (`key_stats.successful_passes` / `passes`); Successful forward passes (`passing.successful_forward_passes` / `forward_passes`); Possession (%) |
| Attacking | Goals; Assists; Shots inside box (/ `total_shots`); Dribbles |
| Defending | Duels; Tackles; Loose ball recoveries (`recoveries`); Interceptions |
| Physical | Distance tracked (`distance_total_meters`, unit formatter); High-intensity runs; Sprint count; Top speed (`top_speed_kmh`) |

- Card click → clip popover: passes = `PASS_MAP` events outcome 1; goals/assists from key events; duels/tackles/recoveries/interceptions from event maps; sprint count & top speed from `GET /api/mes/v2/{match_id}/physical-metrics-detail` (items `{metric:"Sprint", teamId, timestamp, value, jerseyNumber}`, 404 = empty; top speed shows only "Fastest Sprint"). Clip t−5…t+5 s; "Previous clip", "Next clip", "Close", "Full recording" → `/matches/{slug}/#t=mm:ss` (t−3).

## 3.6 Overview

**a) Match highlights** — "Match highlights" / "Goals and shots from the match". Video + "Key events" list by period (minute, team, "Goal"/"Shot", score; chips "%(event_type)s by %(name)s", "Assist by %(name)s"; click seeks ±5 s). Empty: "Key events are unavailable without the match video.", "No key events for %(team)s in this recording." / "No key events for %(team)s in the %(period)s.", "Video is unavailable".

**b) Key match stats** (hidden on basic) — "Key match stats" / "Headline numbers for both teams". Two-sided comparison bars, 3 columns:

| Row | Field | Note |
|---|---|---|
| Goals | `goals` | number |
| Total attempts | `total_attempts` | number |
| Corners | `corners` | number |
| Fouls | `fouls` | number |
| Free kicks | `free_kicks` | number |
| Possession | `possession` | % (opp = 100 − own) |
| Total passes | `passes` | number |
| Successful passes | `successful_passes` | number |
| Pass accuracy | `pass_accuracy` | %, each side rounded |

Null rows omitted.

**c) Starting lineup** — "Starting lineup" / "Who was picked to start". Formation pitch, "Substitutes", "Team captains"/"No team captain", "Edit lineup" → `/matches/{slug}/#/lineup/`. Position from `position_info`: `x = 0.5 + (col − 1 − (n − 1)/2) · min(0.269, 0.734/(n − 1))`; `y = 0.064` for row 1 else `0.291 + (row − 2)/(rows − 2) · 0.421`. Empty: "Lineup not set" + "Set lineup"; opponent "Opponent lineup not available".

**d) Average position** (advanced, own team) — "Average position" / "Average pitch position by player". `POST /api/app/analysis/player-heatmaps/` `{type:"match_all_players", match_id, team_id, start_time, end_time, smoothing:1.5}` → items `{type:"match_player", player{type:"identified"|"jersey_only", player_id, user_id, jersey_number, names, avatar}, average_position{x, z}, matrix{values, width, height, direction_of_play}}`. `values` = base64 of `width×height` uint8 row-major, ÷255; `direction_of_play==="rightToLeft"` → flip both axes. Render: canvas 400×200 (use-section-nav `be`), Gaussian blur σ 0.8, bilinear upscale, <5 % of max transparent with 4 % fade, gamma 0.8, palette green-90 → yellow-90 → yellow-80 → orange-50 blended in OKLCH, chroma ×1.6. Empty: "No tracking data for this match."; opponent "Player stats are not available for opponent teams."

## 3.7 Distribution

- **Pass location**: 9-zone circles with %; `pass_locations[third][lane].successful_passes`, share `round(count/total·100)`. Zones: Defensive left/centre/right, Left/Central/Right midfield, Attacking left/centre/right. Tooltip "%(zone)s · %(count)s successful passes (%(share)s%)".
- **Pass direction**: stacked bars Forward/Sideways/Backward, Successful vs Unsuccessful (attempts − successful). forward < 45°, sideways 45–135°, backward > 135°.
- **Pass strings**: bar chart buckets 2…7 and "+8", axes "Connected passes" / "Strings".
- **Passing network** (own team): `POST /api/mes/v2/{match_id}/passing-network` `{periods:[{periodId, ownSide}], team:"Own"}` → `nodes[{jerseyNumber, averageTouchLocation{x, z}}]`, `edges[{fromJersey, toJersey, completedPasses}]`. Edge width 1 (opacity 0.2) … 8. Empty "No passing connections in this period."

## 3.8 Attacking

| Donut | Attempts | Goals | Rate |
|---|---|---|---|
| Overall | `total_shots` | `goals` | `conversion_rate_overall` |
| Inside box | `shots_inside_box` | `goals_inside_box` | `conversion_rate_inside_box` |
| Outside box | `shots_outside_box` | `goals_outside_box` | `conversion_rate_outside_box` |

**Shot map** (own team): `POST /api/app/analysis/player-event-maps/` `{type:"cross_match_all_players", map_kind:"SHOTMAP", match_ids:[id], team_id}` → `items[{player, events[{event_id, event_type, x, z, outcome, video_time_ms, period}], unlocated_events[]}]`, `included.unassigned_events` ("Unassigned"). Filled marker when `outcome==1`. Minute `round(video_time_ms/60000)`. Chips "Total attempts"/"Shots"/"Goals"; list "Shots by player" with "Whole team"; zone overlay; footer "Shots with missing location:". Empty: "We couldn't load the shot map.", "Add locations to shot and goal events to see them here.", "No shots in this period."

## 3.9 Defending: Defensive actions

Five parallel event-map requests (`TACKLE_MAP`, `INTERCEPTION_MAP`, `BALL_RECOVERY_MAP`, `DUEL_MAP`, `FOUL_MAP`).

| Chip | Event type | Marker |
|---|---|---|
| Tackles | `tackle` | diamond |
| Interceptions | `interception` | triangle |
| Loose ball recoveries | `loose` | hexagon |
| Duels | `duel` | square |
| Fouls | `FootballFoul` | outlined square |

Link "Event definitions". Empty: "We couldn't load the defensive actions.", "Add locations to defensive events to see them here.", "No defensive actions in this period."

## 3.10 Physical: Speed zones

"How intensity was distributed across the match". Stacked bar per time bucket; X "Recording time" ("%(start)s – %(end)s min"), Y "% of tracked time". Series Below HSR `#f7f5f0` (hidden once any HSR/sprint data exists), HSR `#71cf5a`, Sprint `#ec8a3e`; thresholds `hsr_kmh`, `sprint_kmh`. Y max `ceil(max(hsr+sprint))` else 100. Buckets included by `start_ms` within period window. Player list sorted by `sprint_ms`. Card hidden when speed zones unavailable.

## 3.11 Player Stats

- Data via worker (studio-worker-D7X77VUn.js → worker-lkm0OaJA.js `wae`): `POST /api/app/analysis/stats/` `{type:"match_all_players", match_id, team_id}` → `{items[{player, stats[{type, value, periods[{period, value}]}]}], meta{positions}}`.
- Stat type → column id (worker `Cr`/`Tr`, build-table-data-D2wG9dW9.js):

| API stat type | Column id |
|---|---|
| `matches_total` | `matches` |
| `starts_total` | `starts` |
| `captaincies_total` | `captaincies` |
| `player_of_the_match_total` | `player_of_the_match` |
| `football_goal_total` | `FootballGoal` |
| `football_assist_total` | `assists` |
| `football_goal_involvement_total` | `GoalInvolvements` |
| `football_shots_total` | `MissedShots` |
| `football_attempts_total` | `TotalShots` |
| `football_conversion_rate` | `ConversionRate` (×100) |
| `football_corner_total` | `FootballCornerKick` |
| `football_free_kick_total` | `FootballFreeKick` |
| `football_throw_in_total` | `FootballThrowIn` |
| `football_foul_total` | `FootballFoul` |
| `football_goal_kick_total` | `FootballGoalKick` |
| `football_penalty_total` | `FootballPenaltyKick` |
| `football_passes_total` | `passes` |
| `football_passes_completed_total` | `passes_successful` |
| `football_passes_unsuccessful_total` | `passes_unsuccessful` |
| `football_passes_success_rate` | `passes_success_rate` (×100) |
| `distance_total_meters` | `distance_covered` |
| `sprints_total` | `sprints` |
| `top_speed_kmh` | `top_speed` |
| `average_speed_kmh` | `average_speed` |
| `seconds_played_total` | `minutes_played` (÷60) |
| `high_intensity_runs_total` | `high_intensity_runs` |
| `football_tackle_total` | `tackles` |
| `football_duel_total` | `duels` |
| `football_dribble_total` | `dribbles` |
| `football_interception_total` | `interceptions` |
| `football_loose_total` | `loose_ball_recoveries` |
| `football_save_total` | `saves` |
| `football_possession_won_total` | `recoveries` |

- Derived: `MissedShots` = attempts − goals; unsuccessful passes and pass success rate; `GoalInvolvements`, `ConversionRate` computed when missing; `TotalEvents` = assists + all event counters; per-period values when a period is selected; players with no stats and no position dropped.
- Table: sticky "Player", "Position", metric columns; default sort player asc. Default columns: minutes_played, distance_covered, average_speed, top_speed, sprints, high_intensity_runs, TotalEvents, FootballGoal, assists, GoalInvolvements, ConversionRate, MissedShots, TotalShots, tackles, FootballCornerKick, FootballFreeKick, FootballThrowIn, FootballFoul, FootballPenaltyKick, FootballGoalKick. Persisted in localStorage `veo.match-player-stats.columns.{matchId}`. "Edit columns" modal: groups General/Physical/Events, manual metrics marked `*`, "%(selected_metrics_count)s/%(max_metrics_count)s columns selected". Clickable cells (clips): shots/goals/missed shots, tackles, interceptions, loose ball recoveries, duels, fouls, passes.
- Player focus card tabs: Stats (General/Attacking/Defending/Distribution/Set pieces); Physical (Top speed, Average speed, Sprints, High-intensity runs, Distance tracked); Maps (heatmap via `player-heatmaps` `type:"match_player"` + `jersey_number`; shot map via `player-event-maps` `type:"match_player"`, `map_kind:"SHOTMAP"`; shot stats).
- States: opponent "Player stats are not available for opponent teams."; "Loading player stats"; "We couldn't load the player stats."; "No player stats for this match."

## 3.12 Coach Assist (AI summaries)

- Gates: Amplitude flag `coach-assist-match-report-insights`; permission `coach_assist.view_match__generation` (generate: `coach_assist.create_match__generation`); not on basic report.
- `GET /api/app/coach-assist/insights/matches/{id}/insights/` → `{insights[{insight{title, type}, latest_run{content (markdown), public_identifier, public_run_identifier, status: in_progress|generated|error}}]}`; `POST …/insights:generate/` (all); `POST …/insights/{insight_id}:generate/` (one); `POST`/`DELETE /api/app/coach-assist/workflows/feedback/insight_run/{id}/` `{value: thumbs_up|thumbs_down}`.
- Insight types = section ids. Auto-generate when none exist. Poll back-off 1,1,2,3,5,8,13,21 s, give up after 60 s. "Dive deeper with Coach Assist" chat (chatbot-BMxFCBiH.js; waffle flag `coach-assist-chat-bot`, permission `coach_assist.create_run`, `/api/app/coach-assist/workflows/runs/`). "Update report": refetch report, clear event-map cache + bump revision (charts remount), regenerate insights; toasts "Report updated"/"Update failed".

## 3.13 Error page (`lm`/`Qp`)

| Kind | Title / message |
|---|---|
| reportProcessing | "Match Report is still processing" |
| notAvailable | "…isn’t available for this recording" |
| sportNotEligible | "…isn’t available for this sport" |
| matchTypeNotEligible | "…isn’t available for training or test recordings" |
| reportProcessingFailed | "Analytics failed for this recording" (+ "Contact support") |
| basicPlanBeforeCutoff | "…basic Match Report for matches recorded from 6 October 2026 onwards…" |
| analytics2BeforeLaunch | "…only covers matches recorded from 4 August 2026 onwards…" |
| not logged in | "Log in to view this Match Report" |
| other | "Match Report isn’t available" / "Something went wrong." |

Buttons "Back to Library", "Open recording", "Contact support", "Log in". Tracked once as `match_report_issue_viewed {category, reason}`.

## 3.14 Endpoints used by the report

| Method | Path | Body / params | Used for |
|---|---|---|---|
| GET | `/api/app/analysis/matches/{id}/match-report/` | – | whole report |
| GET / PATCH | `/api/app/matches/{slug}/` | PATCH `{team}` | gate, setup |
| GET / POST | `/api/app/matches/{slug}/periods/` | POST `[{name, own_side, timeframe}]` | gate, setup |
| GET | `/api/app/matches/{slug}/feature-processing-status/` | – | eligibility, readiness |
| GET | `/api/app/clubs/{club}/teams/` | `fields`, `page_size`, `cursor` | setup team options |
| GET | `/api/app/clubs/{club}/` | – | `is_club_admin` |
| POST | `/api/app/analysis/player-heatmaps/` | `match_all_players`/`match_player`, `start_time`, `end_time`, `smoothing:1.5` | average position, focus card heatmap |
| POST | `/api/app/analysis/player-event-maps/` | `cross_match_all_players`/`match_player` + `map_kind` | shot map, defensive actions, clips, focus card |
| POST | `/api/mes/v2/{id}/passing-network` | `{periods, team:"Own"}` | passing network |
| GET | `/api/mes/v2/{id}/physical-metrics-detail` | – | sprint / top-speed clips |
| POST | `/api/app/analysis/stats/` | `{type:"match_all_players", match_id, team_id}` | player stats table |
| GET / POST | `/api/app/coach-assist/insights/matches/{id}/insights[...]` | generate: `null` | Coach Assist |
| POST / DELETE | `/api/app/coach-assist/workflows/feedback/insight_run/{id}/` | `{value}` | feedback |
| POST / GET | `/api/app/coach-assist/workflows/runs/` | – | chat |

## 3.15 Open questions (need a live API call)
1. Exact `view` value for a basic report and which keys it contains.
2. Values of `events[].team`; does `players[]` contain only the own team?
3. Is `period_id` 1-based; are `periods[].start_time`/`end_time` seconds?
4. Does every stat carry `comparison`; exact meaning of `difference`?
5. `speed_zones` statuses, bucket width, do percentages sum to 100?
6. Heatmap matrix `width`/`height`; is `direction_of_play` always present; `average_position.x`/`z` in 0–1?
7. Event-map `outcome`/`period` values, `x`/`z` range, is `PASS_MAP` paginated?
8. Range of `averageTouchLocation`; format of `ownSide`.
9. `physical-metrics-detail`: `metric` values, `value` unit, `timestamp` origin, `jerseyNumber` type.
10. Shape of `meta.positions` in `analysis/stats`.
11. Does `insight_id` equal insight `type`?
12. Can `match_report` fields in `feature-processing-status` be null?

# 4. Consolidated endpoint inventory (analytics-related)

Source: minified Veo web bundles (build `24036065aa956fbea06e2fa6f1562f61f8a28baa`). Every claim cites the chunk. "Callers" = chunks that reference the client method or URL (found by grepping, excluding the client file itself).

## 4.0 Transport conventions

- **Generated client**: `src-CpmFfToj.js`. It contains one factory function per namespace, `function X(t){return{method(...){...}}}`. The namespaces are wired in `singleton-BGuIWsNG.js` (`oa()` maps names such as `mesV2Tracking:G(a.main)`). The UI gets the singleton through `ya()`, imported as `ee()` or `de()` in the UI chunks.
- **HTTP layer**: `app-http-client-BS7D_lFb.js`.
  - Base URL: `window.VEO_SERVICE_URLS.SERVER_URL`, falling back to `https://app.veo.co/`. Paths are absolute (`/api/app/...`, `/api/mes/...`).
  - Headers:
    - `Authorization: Bearer <token>`: the OIDC access token from `userManager`.
    - `x-csrftoken`: sent on POST/PUT/PATCH/DELETE, read from the `csrftoken` cookie.
    - `Accept-Language`.
    - `veo-agent: veo:svc:web-app`.
    - `Veo-App-Id: hazard`. The worker uses `hazard:veo-web-worker`.
  - Cookies: `credentials:"include"`.
  - Query encoding: arrays become **repeated keys** (`matchIds=a&matchIds=b`), and null or undefined values are dropped (`N()`).
  - Response parsing: `application/json` is parsed as JSON. `text/*` is returned as a string. **Any other content type is returned as a `Blob`** (an empty blob becomes `null`). This is how the heatmap PNG endpoints return images.
  - Retries: GET requests on 429/502/503/504 are retried 3× with exponential backoff and honor `Retry-After`.
  - Errors: thrown as typed errors with `code` (`not_found`, `validation`, `unauthorized`, `forbidden`, …). Callers commonly map `not_found` to an empty result (`playerMetricsSlice-6A_Ud2SH.js`, `matchQualitySlice-CsC3JxwU.js`, `lineupSlice-ecpjsJ8u.js`, `report-BVrpWDhT.js`).
  - List mapper: methods with mapper `(i)=>({items:i})` receive a **bare JSON array** and wrap it as `{items}` client-side (`src-CpmFfToj.js`).
- **Raw-fetch layer inside web workers**. These calls use `fetch` directly, not the generated client.
  - `worker-lkm0OaJA.js` is the **Analytics Studio** worker, loaded by `studio-worker-D7X77VUn.js`.
  - `worker-CgfQocFn.js` is the **match analysis** worker, loaded by `analysis-B7oi1Haw.js`.
  - Both define `be(path, init)` / `xt(...)`, which prefix the path with `API_APP_URL` (default `${SERVER_URL}/api/app`). They send `Content-Type: application/json`, `Accept-Language`, `veo-agent`, Bearer and CSRF headers, and `credentials:"include"`.
  - Pagination follows the RFC-5988 `Link` header (`rel="next"`), parsed by `$r()`.
  - **Most cross-match analytics (player stats, leaderboards, heatmaps, shot maps, key metrics, comparison radial, coach note) is fetched only here.**
- **Legacy settings URL table**: `settings-DLtzORLW.js`.
  - `API_APP = window.VEO_SERVICE_URLS.API_APP_URL || ${SERVER}/api/app`.
  - `RAS = window.VEO_SERVICE_URLS.RAS_URL || API_APP`.
  - `R(id)` is `${RAS}/recordings/{id}` when `RAS_URL` is set (e.g. a CloudFront host). Otherwise it is `${API_APP}/recordings/{id}/analytics`.
  - The workers build `RAS_URL ? ${RAS_URL}/recordings/{id}/{x} : /recordings/{id}/analytics/{x}` and send these requests with `credentials:"omit"` (`worker-lkm0OaJA.js` `ia`).

## 4.1 Endpoint table

### 4.1a Generated client (`src-CpmFfToj.js`, namespaces from `singleton-BGuIWsNG.js`)

| Method | Path | Params / body | Response (as consumed) | Client method | Callers |
|---|---|---|---|---|---|
| GET | `/api/app/matches/{match_identifier}/` | q `fields` | Match object. Fields used for analytics: `identifier`, `slug`, `analytics_version`, `has_events_enabled`, `has_analytics_enabled`, `periods`, `team`, `club`, `permissions[...]`, `own_team_home_or_away`, `own_team_color`, `opponent_team_color`, `info.stats.score{own,opponent}`, `info.stats.score_aggregated`, `info.stats.table` (stats ordering), `recordings[]`, `is_accessible` | `match.getMatch` | `objects-BRIRy_q_.js`, `report-gate-DAHFb1FG.js`, `use-clear-clip-comments-on-unmount-8TJSJmJz.js`, `view-BYcaVA08.js` |
| GET | `/api/app/matches/` | q `filter, club, team, date_start, date_end, status, has_analytics, analytics_version, has_lineup_player, type, own_team_formation, ordering, page_size, page, fields` (+ `recordings` in the worker) | Array of matches plus `Link` header | `match.listMatches` / worker `Mo()` | workers (`worker-lkm0OaJA.js` `Mo`, `worker-CgfQocFn.js`) |
| GET | `/api/app/matches/{id}/feature-processing-status/` | – | `{analytics:"completed"\|…, ai_detection:"completed"\|…, player_spotlight:…}` | `match.getProcessingStatus` | `matches-BsfXt9vI.js`, `report-gate-DAHFb1FG.js`, `use-clear-clip-comments-on-unmount-8TJSJmJz.js`, workers |
| GET | `/api/app/matches/{id}/periods/` | – | Array of periods `{public_identifier, name, timeframe:[startSec,endSec], own_side:"left"\|"right", duration, is_confirmed, user_modified}`, wrapped as `{items}` | `matchPeriod.listPeriods` | `report-gate-DAHFb1FG.js`, `use-clear-clip-comments-on-unmount-8TJSJmJz.js`, `analysisSlice-CRlRsXf0.js` (legacy URL `MATCHES.periods`), workers |
| POST | `/api/app/matches/{id}/periods/` | body = full array of periods `{timeframe, own_side, name?, …}` | Same as the GET array. A `validation` error carries per-period `details[]` | `matchPeriod.createPeriods` | `analysisSlice-CRlRsXf0.js` (`analysis/saveMatchPeriods`), `report-gate-DAHFb1FG.js` |
| GET | `/api/app/matches/{id}/stats/` | q `tag` (repeatable). The worker sends `tag=goal&tag=corner&tag=freekick&tag=goal-kick&tag=penalty-kick&tag=shot-on-goal&tag=kickoff` | `{stats:{<tag>:{own, opp, byPeriod:{"1":{own,opp},…}, stat?:{slug,…}}}, ordering?}`. `analysisSlice` converts it to `tags[]` with per-period values keyed by period `public_identifier` | `match.getMatchStats` | `analysisSlice-CRlRsXf0.js` (`analysis/matchStats`), workers (raw) |
| POST | `/api/app/matches/{id}/stats/` | body = manual stats edit (whole object) | Same as GET | `match.createMatchStats` | `analysisSlice-CRlRsXf0.js`, `edit-rows-form-DokiFrN7.js` (legacy URL) |
| POST | `/api/app/matches/{id}/analysis/heatmap/` | `{categories,start_time,end_time}` | (v1 Blob) | `match.createHeatmap` | **no caller** (superseded by MES v2) |
| GET | `/api/app/analysis/passes-and-possession/` | q `match_id` | ? | `teamMetrics.getMatchPassesAndPossession` | **no caller** |
| POST | `/api/app/analysis/stats/` | body is passed through (`e.body`). See §4.2.1 | `{items:[…], meta:{positions?, stats_availability?}}` | `teamMetrics.getStats` | `context-card-Jk_Nkykh.js`. Raw in `worker-lkm0OaJA.js` and `worker-CgfQocFn.js` |
| GET | `/api/app/clubs/{club}/teams/{team}/key-metrics/` | q `fields` | `{metrics:[{id}]}`. **204 means use defaults** `[possession_percent, goals_scored, shots_on_goal]` | `teamMetrics.getKeyMetrics` | raw in both workers |
| POST | `/api/app/clubs/{club}/teams/{team}/key-metrics/` | `{metrics:[{id}]}` | Same | `teamMetrics.createKeyMetrics` | raw in `worker-lkm0OaJA.js` |
| POST | `/api/app/analysis/player-heatmaps/` | body passed through. See §4.2.2 | `{items:[{type, player, matrix:{values,width,height,direction_of_play}, match_count?, average_position?}], meta:{positions}}` | `teamPlayerHeatmap.getPlayerHeatmaps` | `context-card-Jk_Nkykh.js`, `report-BVrpWDhT.js`. Raw in `worker-lkm0OaJA.js` |
| POST | `/api/app/analysis/player-event-maps/` | body passed through. See §4.2.3 | `{direction_of_play, items:[{player, events[], unlocated_events[]}], included:{matches, positions, unassigned_events}}` | `teamPlayerEventMap.getPlayerEventMaps` | `context-card-Jk_Nkykh.js`, `report-BVrpWDhT.js`. Raw in `worker-lkm0OaJA.js` |
| GET | `/api/app/analysis/matches/{match_id}/match-report/` | – | Report object. Required top-level keys: `match, teams, periods, players, events, scorers` (`matchReportSlice-dbGYMyIg.js` rejects with `INCOMPLETE` if any is missing). Also `speed_zones` and shot blocks (see §4.3.8) | `matchReport.getMatchReport` | `matchReportSlice-dbGYMyIg.js` |
| GET | `/api/app/coach-assist/insights/matches/{match_id}/insights/` | – | Insight set `{insights:[{insight:{type,…}, latestRun:{status:"generated"\|…}}]}`. Polled with backoff `[1,1,2,3,5,8,13,21] s` | `matchReportInsights.listMatchReportInsightsForMatch` | `report-BVrpWDhT.js` |
| POST | `/api/app/coach-assist/insights/matches/{match_id}/insights:generate/` | – | – | `matchReportInsights.generateMatchReportInsightsForMatch` | `report-BVrpWDhT.js` |
| POST | `/api/app/coach-assist/insights/matches/{match_id}/insights/{insight_id}:generate/` | – | Run | `matchReportInsights.generateMatchReportInsightForMatch` | `report-BVrpWDhT.js` |
| GET | `/api/app/coach-assist/insights/matches/{match_id}/insights/{insight_id}/` | – | – | `matchReportInsights.retrieveMatchReportInsightForMatch` | no caller |
| GET/POST | `/api/app/clubs/{club}/teams/{team}/comparison-radial/` | GET q `fields`. POST `{config:{own_team:{team_slug,date_range:[YYYY-MM-DD,YYYY-MM-DD]}, comparing_team:{…}, key_metrics:[{id}]}}` | GET `{config:{…}}` | `teamComparison.get/createComparisonRadial` | raw in `worker-lkm0OaJA.js` (`sae`/`oae`) |
| GET/POST | `/api/app/clubs/{club}/teams/{team}/coach-note/` | POST `{note}` | `{note,…}` | `teamCoachNote.get/createCoachNote` | raw in `worker-lkm0OaJA.js`. Also `coach-note-FkTuueCn.js`, `view-BYcaVA08.js` |
| GET | `/api/app/clubs/{club}/teams/{team}/members/?status=active` | Paginated by `Link` | Members. The worker keeps `team_role==="player"` | `team…listMembers` | raw in `worker-lkm0OaJA.js` (`Xte`) |
| GET | `/api/app/matches/{id}/lineup/players/` | q `is_starting, is_unused_substitute` | `[{player:{id}, jersey_number, position_name, field_position, is_starting, is_team_captain, is_player_of_the_match}]` | `matchLineupPlayer.listLineupPlayers` | raw in `worker-lkm0OaJA.js` (`wte`), `report-BVrpWDhT.js` (lineup), `lineup-DELXq3XS.js` |
| GET | `/api/mes/v2/{match_id}/heatmap` → see the POST row below | | | | |
| POST | `/api/mes/v2/{match_id}/heatmap` | `{categories:number[], startTime, endTime}` (seconds) | **Blob (image)**. `a.size===0` is treated as an error | `mesV2Tracking.v2GenerateHeatmap` | `analysisSlice-CRlRsXf0.js` (`analysis/fetchIntervalHeatmap`, `analysis/fetchHeatmapImage`); categories from `heatmap-DP5wKYrX.js` |
| POST | `/api/mes/v2/{match_id}/player-heatmaps` | `{startTime,endTime,width,height,smoothing,team}` | ? | `mesV2Tracking.v2GenerateMatchPlayerHeatmaps` | **no caller** |
| POST | `/api/mes/v2/{match_id}/players/{jersey}/heatmap` | Same body | ? | `mesV2Tracking.v2GenerateMatchPlayerHeatmap` | **no caller** |
| POST | `/api/mes/v2/-/player-heatmaps` | `{matchIds[],mappings,team,width,height,smoothing}` | Array, wrapped as `{items}` | `mesV2Tracking.v2GetCrossMatchPlayerHeatmaps` | **no caller** |
| POST | `/api/mes/v2/-/players/{jersey}/heatmap` | Same | ? | `mesV2Tracking.v2GetCrossMatchPlayerHeatmap` | **no caller** |
| GET | `/api/mes/v2/{match_id}/player-tracking` | q `start` (seconds; the UI requests windows of ~30 s) | `{ "<timestamp>": [[trackId, category, x, y, jerseyNumber, distance, speed], …], … }` | `mesV2Tracking.v2GetPlayerTracking` | `playerTrackingSlice-BtWfkb3M.js` |
| GET | `/api/mes/v2/{match_id}/player-tracking/jersey-numbers` | q `periods` (repeatable, each `"start,end"`) | Array `[{start,end,left:number[],right:number[]}]`. The UI maps `own_side` to own/opponent and drops negative values | `mesV2Tracking.v2GetJerseyNumbers` | `lineupSlice-ecpjsJ8u.js` |
| GET | `/api/mes/v2/{match_id}/player-moments` | q `start, end, side, jersey` | `{moments:[{tracks:[[t, ?, ?, metersToBall], …]}], jersey, category}` | `mesV2Tracking.v2GetPlayerMoments` | `player-moments-provider-BjFaeazu.js` |
| GET | `/api/mes/v2/{id}/match-events` | q `team, playerJersey, eventTypes, aggregatedDuels` | `{events:[MesEvent]}` (see §4.3.4) | `mesV2Events.v2GetMatchEvents` | `eventsSlice-Cwu7ipgL.js`, `use-clear-clip-comments-on-unmount-8TJSJmJz.js` (`eventTypes:"FootballGoal"` for the scoreboard), workers |
| POST/PATCH/DELETE | `/api/mes/v2/event`, `/api/mes/v2/{match}/match-events/{event}` | body `attributes, editorId, eventType, id, matchId, outcome, periodId, periodTimeMs, playerId, playerJersey, team, videoTimeMs, x, z` | MesEvent | `mesV2Events.v2Create/Update/DeleteEvent` | `eventsSlice-Cwu7ipgL.js`, workers |
| GET | `/api/mes/v2/{match_id}/teams/{team}/stats` | `team` = `Own` \| `Opponent` | Array `[{eventType,total,byPeriod:{"1":n,…}}]` | `mesV2Statistics.v2GetTeamStats` | `analysisSlice-CRlRsXf0.js` (`mt()`, `analysis/fetchMESMatchStats`) |
| GET | `/api/mes/v2/{match_id}/match-momentum` | – | Array of `[timeSec, value]` tuples. The value is signed and plotted symmetrically around 0 | `mesV2MatchMomentum.v2GetMatchMomentum` | `analysisSlice-CRlRsXf0.js`. Rendered in `detail-B56tzMIL.js` (`I_`) and `multidimensional-timeline-CZmHuDQ8.js` |
| POST | `/api/mes/v2/{match_id}/passing-network` | `{team:"Own", periods:<periodSides>}` | `{nodes:[…], edges:[…]}` | `mesV2PassingNetwork.v2GetTeamPassingNetwork` | `report-BVrpWDhT.js` (`v_`) |
| GET | `/api/mes/v2/{match_id}/physical-metrics` | – | Array `[{drill:"ALL"\|…, teamId\|null, jerseyNumber, averageSpeed, maxSpeed, sprints, …}]` | `mesV2Physical.v2GetPhysicalMetricsByMatch` | `playerMetricsSlice-6A_Ud2SH.js` (keeps `drill==="ALL"`) |
| GET | `/api/mes/v2/{match_id}/physical-metrics-detail` | – | Array `[{id, metric:"Sprint"\|…, teamId, jerseyNumber, timestamp(ms), value}]` | `mesV2Physical.v2GetPhysicalMetricsDetailsByMatch` | `report-BVrpWDhT.js` (`td`, "Fastest Sprint" clips) |
| GET | `/api/mes/v2/teams/{team_id}/players/{jersey}/physical-metrics(-detail)` | – | Array | `mesV2Physical.v2GetPhysicalMetrics(Details)ByPlayer` | **no caller** |
| GET/POST | `/api/mes/v2/-/physical-metrics` | GET q `matchIds`. POST `{matchIds,mappings,teamId}` | Array | `mesV2Physical.v2GetCrossMatchPhysicalMetrics(ByGroupKey)` | **no caller** |
| POST | `/api/mes/v2/{match_id}/speed-zone-distribution` | `{periods,thresholds}` | ? | `mesV2Physical.computeMatchSpeedZoneDistribution` | **no caller** (the report takes `speed_zones` from match-report) |
| GET | `/api/mes/v2/{match_id}/teams/{team}/physical-stats` | – | Array | `mesV2Physical.v2GetTeamPhysicalStats` | **no caller** |
| GET | `/api/mes/v2/{match_id}/quality` | – | `{jersey:{legibility:"good"\|"reduced"\|"poor"\|…}}` | `mesV2Quality.v2GetMatchQuality` | `matchQualitySlice-CsC3JxwU.js`, `view-BYcaVA08.js` |
| GET | `/api/mes/v2/{match_id}/step-events` | – | Array `[{name:"ball_in_play"\|…, start, end}]` | `mesV2StepEvents.v2GetStepEvents` | `player-Bx73eTgL.js` (ball-in-play intervals) |
| GET | `/api/mes/v2/{match_id}/own-player-stats` | – | ? | `mesV2Statistics.v2GetMatchPlayerStats` | **no caller** |
| GET | `/api/mes/v2/{match_id}/teams/{team}/players/{jersey}/stats` | – | Array | `mesV2Statistics.v2GetPlayerStats` | **no caller** |
| GET | `/api/mes/v2/{match_id}/player-event-stats` | q `event_type` | Array | `mesV2Statistics.v2GetPlayerEventStatsByMatch` | **no caller** |
| POST | `/api/mes/v2/-/player-stats` | `{matchIds,mappings,teamId}` | Array | `mesV2Statistics.v2GetCrossMatchPlayerStats` | **no caller** |
| POST | `/api/mes/v2/-/player-events`, `/api/mes/v2/-/players/{jersey}/events` | `{eventTypes,mappings,matchIds,teamId}` | ? | `mesV2Statistics.v2GetCrossMatchPlayerEvents/Event` | **no caller** |
| POST | `/api/mes/v2/-/team-stats` | `{matchIds,periodsByMatch}` | Array | `mesV2Statistics.v2GetTeamStatsBatch` | **no caller** |
| GET | `/api/mes/v2/-/pass-strings` | q `matchIds` | Array | `mesV2Statistics.v2GetPassStrings` | **no caller** |
| GET | `/api/mes/v2/{match_id}/ui/score` | – | ? | `mesV2Statistics.v2GetMatchScore` | **no caller** |
| POST | `/api/mes/sync` | `{clubId,matchId,matchPeriods,recordingId,teamId}` | – | `mesV1Events.userSync` | `events-C4yabS_5.js` |
| GET | `/api/app/blueroots/reports/`, `/api/app/blueroots/reports/{recording_id}/`, `/api/app/blueroots/clubs/{club}/report/` | – | Blue Roots product reports | `recording.*`, `club.getBluerootsClubReport` | `view-BeFH8SC0.js` |

"No caller" means the generated client exposes the method but no shipped web chunk invokes it. These endpoints are probably used by the federated Player Offering remote (`https://d2gxpydnmytzsp.cloudfront.net/apps/player-offering/remoteEntry.js`, loaded by `_federation_PlayerOffering_Module-BCuwBr56.js`, which is not in the bundle set) or by the mobile apps.

### 4.1b Raw worker endpoints (not via the generated client)

| Method | Path | Body / query | Used for | Chunk |
|---|---|---|---|---|
| POST | `/api/app/analysis/stats/` | `{type:"cross_match", team_id, match_ids:[…], group_by:"player"}` | Studio player stats table. 404 means an empty result | `worker-lkm0OaJA.js` `Jm` (`fetchPlayerStatsData`, `fetchPlayerStatsTableData`) |
| POST | `/api/app/analysis/stats/` | `{type:"match_all_players", match_id, team_id}` | Single-match player stats with per-period breakdown (`includePeriodStats && 1 match`) | `worker-lkm0OaJA.js` `wae` |
| POST | `/api/app/analysis/stats/` | `{type:"team_match", team_id, match_ids:[match], group_by:"team_association"}` | Team event stats for one match when `has_events_enabled` | `worker-lkm0OaJA.js` and `worker-CgfQocFn.js` `cu.event_stats` |
| POST | `/api/app/analysis/leaderboards/` | `{team_id, match_ids, top:5}` | Studio leaderboards | `worker-lkm0OaJA.js` `Hae` (`fetchPlayerStatsLeaderboardData`) |
| POST | `/api/app/analysis/player-heatmaps/` | `{type:"cross_match_all_players", team_id, match_ids, smoothing:1.5}` | Studio position heatmaps (all players) | `worker-lkm0OaJA.js` `Bae` |
| POST | `/api/app/analysis/player-event-maps/` | `{type:"cross_match_all_players", team_id, match_ids, map_kind:"SHOTMAP"}` | Studio player shot map | `worker-lkm0OaJA.js` `ooe` |
| GET/POST | `/api/app/clubs/{club}/teams/{team}/key-metrics/` | POST `{metrics}` | Key metrics selection (200/201 → JSON, 204 → defaults) | `worker-lkm0OaJA.js` `fte`/`bte`, `worker-CgfQocFn.js` |
| GET/POST | `/api/app/clubs/{club}/teams/{team}/comparison-radial/` | `{config}` | Team comparison radial | `worker-lkm0OaJA.js` `sae`/`oae` |
| GET/POST | `/api/app/clubs/{club}/teams/{team}/coach-note/` | `{note}` | Coach note | `worker-lkm0OaJA.js` `mte`/`pte` |
| GET | `/api/app/clubs/{club}/teams/?fields=name&fields=slug` | Paginated | Team picker for the comparison | `worker-lkm0OaJA.js` `iae` |
| GET | `/api/app/matches/?ordering=-created&team=&club=&type=&own_team_formation=&page_size=\|date_start&date_end=&analytics_version=\|has_analytics=false&has_lineup_player=` | – | Studio match set from the filters (`xr()` / `Sr()`) | `worker-lkm0OaJA.js` |
| GET | `/api/app/matches/{id}/videos/?render_type=standard&ordering=-width` | – | First `video/mp4` | `worker-lkm0OaJA.js` `Jte` |
| GET | `{RAS}/recordings/{matchId}/analytics` | `credentials:omit` | RAS status. Keys present → `analytics_version` | `worker-*` `ia.analytics`. `analysisSlice-CRlRsXf0.js` uses `MATCHES.ras_status(match.recordings[0])` |
| GET | `{RAS}/recordings/{matchId}/match-details?filters=<start>,<end>&filters=…[&interactiveStrings=true]` | One `filters` per period timeframe. `interactiveStrings` only when feature flag `interactive_pass_strings` is on | Passes/possession (v1.1+) | `analysisSlice-CRlRsXf0.js` `yt` (`analysis/fetchPassesAndPossession`), workers `ia.match_details` |
| GET | `{RAS}/recordings/{matchId}/shot-details` | – | `{shot_details:[{id,name,timestamp,side,location:[x,y],team}]}` | `analysisSlice-CRlRsXf0.js` `bt` (`analysis/fetchShotmap`), workers |
| GET | `{RAS}/recordings/{matchId}/events` | – | Legacy RAS events (defined only) | workers `ia.events` |

## 4.2 Request body discriminators

### 4.2.1 `POST /api/app/analysis/stats/` (`teamMetrics.getStats`)

| `type` | Extra fields | Response `items[]` shape (as consumed) | Chunk |
|---|---|---|---|
| `team_match` | `team_id, match_ids:[1], group_by:"team_association"` | `{team_association:"own"\|other, stats:[{event_type?, computed_type?, value, periods:[{period:<number>, value}]}]}`. `computed_type:"MissedShots"` is kept separately | `worker-lkm0OaJA.js` `Xee` |
| `cross_match` | `team_id, match_ids, group_by:"player"` | `{player_id, user_id, avatar, player_profile_id, jersey_number, position, default_jersey_number, default_position, first_name, last_name, known_name, stats:[{type,value}]}`; `meta.positions` | `worker-lkm0OaJA.js` `mae` |
| `match_all_players` | `match_id, team_id` | `{player:{type:"identified"\|"jersey_only", player_id, user_id, first_name, last_name, known_name, avatar, jersey_number, position, default_jersey_number, default_position}, stats:[{type,value,periods:[{period,value}]}]}`; `meta.positions` | `worker-lkm0OaJA.js` `yae`/`hae` |
| `cross_match_user` / `cross_match_jersey` | `user_id` or `jersey_number`, plus `team_id, match_ids` | Item `{type:"cross_match_player", stats:[{type,value}]}`; `meta.stats_availability:[{analytics_version, has_ai_events, has_physical_stats}]` → coverage `ai-tracked`\|`partial`\|`manual-only` and `all-analytics-2`\|`mixed`\|`no-analytics-2` | `context-card-Jk_Nkykh.js` `Sa`, `Na`, `Ea` |

**Stat `type` keys** and the UI metric id each maps to (`worker-lkm0OaJA.js` `Cr`/`Tr`/`ku`, `context-card-Jk_Nkykh.js` `ja`/`ka`):

| API stat `type` | UI metric id | Transform |
|---|---|---|
| `matches_total` | `matches` | |
| `starts_total` | `starts` | |
| `captaincies_total` | `captaincies` | |
| `player_of_the_match_total` | `player_of_the_match` | |
| `football_goal_total` | `FootballGoal` | |
| `football_assist_total` | `assists` | |
| `football_goal_involvement_total` | `GoalInvolvements` | |
| `football_shots_total` | `MissedShots` | |
| `football_attempts_total` | `TotalShots` | |
| `football_conversion_rate` | `ConversionRate` | ×100, rounded |
| `football_corner_total` | `FootballCornerKick` | |
| `football_free_kick_total` | `FootballFreeKick` | |
| `football_throw_in_total` | `FootballThrowIn` | |
| `football_foul_total` | `FootballFoul` | |
| `football_goal_kick_total` | `FootballGoalKick` | |
| `football_penalty_total` | `FootballPenaltyKick` | |
| `football_passes_total` | `passes` | |
| `football_passes_completed_total` | `passes_successful` | |
| `football_passes_unsuccessful_total` | `passes_unsuccessful` | |
| `football_passes_success_rate` | `passes_success_rate` | ×100 |
| `distance_total_meters` | `distance_covered` / `distance` | |
| `sprints_total` | `sprints` | |
| `top_speed_kmh` | `top_speed` / `topSpeed` | |
| `average_speed_kmh` | `average_speed` / `averageSpeed` | |
| `seconds_played_total` | `minutes_played` / `secondsPlayed` | ÷60, rounded |
| `high_intensity_runs_total` | `high_intensity_runs` / `highIntensityRuns` | |
| `football_tackle_total` | `tackles` | |
| `football_duel_total` | `duels` | |
| `football_dribble_total` | `dribbles` | |
| `football_interception_total` | `interceptions` | |
| `football_loose_total` | `loose_ball_recoveries` | |
| `football_save_total` | `saves` | |
| `football_possession_won_total` | `recoveries` | |

Client-side derivations (`worker-lkm0OaJA.js` `pae`, `bae`):

- `MissedShots = max(TotalShots − FootballGoal, 0)`, used if it is absent.
- `passes_unsuccessful = passes − passes_successful`.
- `passes_success_rate = round(successful / passes × 100)`.
- `GoalInvolvements = goals + assists` if absent.
- `ConversionRate = round(goals / attempts × 100)` if absent.
- `TotalEvents = assists + Σ(FootballGoal, MissedShots, Corner, FreeKick, GoalKick, Penalty, ThrowIn, Foul)`.

### 4.2.2 `POST /api/app/analysis/player-heatmaps/` (`teamPlayerHeatmap.getPlayerHeatmaps`)

| `type` | Extra fields | Consumer |
|---|---|---|
| `cross_match_all_players` | `team_id, match_ids, smoothing:1.5` | `worker-lkm0OaJA.js` `Bae` (Studio). Items `{player, match_count, matrix}` |
| `cross_match_user` / `cross_match_jersey` (selector) | `team_id, match_ids, smoothing` | `context-card-Jk_Nkykh.js` (player focus card "maps" tab). `items[0].matrix.values` |
| `match_player` | `match_id, team_id, jersey_number, start_time, end_time, smoothing` | `context-card-Jk_Nkykh.js` (interval slider, 500 ms debounce), `report-BVrpWDhT.js` `hp` |
| `match_all_players` | `match_id, team_id, start_time, end_time, smoothing` | `report-BVrpWDhT.js` `El`. Items `{type:"match_player", player, matrix, average_position:{x,z}}` |

- `smoothing` = `1.5`, defined as `Rae` in `worker-lkm0OaJA.js` and as `_e`, exported as `i`, in `use-section-nav-DfFxQiqS.js`.
- **Matrix format**: `{values: base64 of a Uint8 grid, width, height, direction_of_play:"leftToRight"|"rightToLeft"}`. Each cell is `byte/255`, row-major. If `rightToLeft`, the rows and columns are reversed (`report-BVrpWDhT.js` `ps`).
- Studio and the focus card assume **60×30 = 1800 cells**: `pitch-analytics-CquIUgYq.js` `K` slices 30 rows of 60 and draws them onto a 400×200 canvas; `worker-lkm0OaJA.js` `$ae=1800`.
- `average_position {x,z}` is mapped to pitch `{x:1−z, y:x}` (`report-BVrpWDhT.js` `ds`).

### 4.2.3 `POST /api/app/analysis/player-event-maps/` (`teamPlayerEventMap.getPlayerEventMaps`)

- **Bodies**:
  - `{type:"cross_match_all_players", map_kind, match_ids:[…], team_id}`, used by Studio (`SHOTMAP`) and by `report-BVrpWDhT.js` `Xl` (one match id, all map kinds).
  - `{type:"match_player", map_kind:"SHOTMAP", jersey_number, match_id, team_id}`, used by `report-BVrpWDhT.js` `vp`.
  - Selector body plus `map_kind:"SHOTMAP"`, used by `context-card-Jk_Nkykh.js`.
- **`map_kind` enum and the MES event types each covers** (`report-BVrpWDhT.js` `Ve`):

  | `map_kind` | Event types |
  |---|---|
  | `SHOTMAP` | `FootballShot`, `FootballGoal` |
  | `TACKLE_MAP` | `tackle` |
  | `INTERCEPTION_MAP` | `interception` |
  | `BALL_RECOVERY_MAP` | `loose` |
  | `DUEL_MAP` | `duel` |
  | `FOUL_MAP` | `FootballFoul` |
  | `PASS_MAP` | `pass` |

- **Response**:
  - `direction_of_play`
  - `items[]`: `{player, events:[{event_id, match_id, event_type, outcome (1 = goal/success), x, z, video_time_ms, period}], unlocated_events:[{event_id, event_type, video_time_ms, period, match_id}]}`
  - `included.matches{<id>:{kickoff_time, opponent_name, url, own_score, opponent_score}}`
  - `included.positions`
  - `included.unassigned_events{events, unlocated_events}`
- **Coordinate handling**:
  - Report: `x' = 1 − z`, `y' = x` (portrait pitch; `report-BVrpWDhT.js` `Ot`).
  - Studio (`worker-lkm0OaJA.js` `eoe`) and context card (`Ze`): if `rightToLeft`, flip `x = 1 − x, z = 1 − z`, then `x' = 2x − 1` in −1..1 (half-pitch shot map) and `y' = clamp(z, 0, 1)`.
  - Goal vs. shot is decided by `outcome===1`. Unlocated events use `event_type==="FootballGoal"` instead.

### 4.2.4 `POST /api/app/analysis/leaderboards/` (raw, `worker-lkm0OaJA.js`)

- Body: `{team_id, match_ids, top:5}`.
- Response: `items:[{stat_type, entries:[{rank, player_id, user_id, first_name, last_name, jersey_number, default_jersey_number, position, default_position, player_profile_id, value}]}]`.
- The `stat_type` keys are the same as in §4.2.1 (`ku`). `football_conversion_rate` is ×100; `seconds_played_total` is ÷60.
- In cross-match views, jersey and position prefer `default_*` (`Qm`/`Xm("cross-match")`).

## 4.3 Response models and enums

### 4.3.1 MES heatmap image (`mesV2Tracking.v2GenerateHeatmap`)

- Request:
  - `categories` = `[1]` when the selected side is "left" and `[3]` when it is "right" (`heatmap-DP5wKYrX.js` `ee=[1]`, `ae=[3]`).
  - `startTime`/`endTime` in seconds (the default is the period timeframe).
  - The UI also tracks `side` and `period_index`, but these are not sent.
- Category codes match the tracking categories in `player-tracking-DshOpNPo.js`: `left_goalkeeper:0, left_outfield_player:1, right_goalkeeper:2, right_outfield_player:3, referee:4, ball:6`. So `[1]` means outfield players on the left side and `[3]` means outfield players on the right side.
- The response is an image Blob, shown via `URL.createObjectURL` and sized 95% of the pitch (`heatmap-DP5wKYrX.js` `te=.95`).

### 4.3.2 Player tracking frame (`playerTrackingSlice-BtWfkb3M.js` `D`)

- Tuple: `[trackId, category, x, y, jerseyNumber, distance, speed]`. Missing values are `-1`.
- Frames between timestamps are interpolated linearly.
- Sprint/run classification uses thresholds `{run, sprint}` passed in (`O()`).
- Categories (`player-tracking-DshOpNPo.js`):
  - Raw: `left_goalkeeper 0, left_outfield_player 1, right_goalkeeper 2, right_outfield_player 3, referee 4, ball 6`.
  - Mapped: `own_goalkeeper 0, own_outfield_player 1, opponent_goalkeeper 2, opponent_outfield_player 3, referee 4, ball 6, unknown_team_player 10`. The mapping depends on the period's `own_side`.

### 4.3.3 Player moments (`player-moments-provider-BjFaeazu.js`)

- `tracks[i] = [time, ?, ?, metersToBall]`.
- Client filters:
  - Meters-to-ball categories `[[0,3],[4,7],[8,10]]`.
  - Seconds-on-ball categories (moment duration) `[[0,4],[5,9],[10,20]]`.
  - `lead_lag_time` default 5 s.
- Defaults: `meters_to_ball_category:1, seconds_on_ball_category:0`. They are persisted in localStorage `veo.lineup-player-bar-settings`.

### 4.3.4 MES event (`worker-lkm0OaJA.js` `ir`)

- Fields: `{id, matchId, eventType, team:"Own"|"Opponent", playerId, playerJersey, x, z, outcome, periodId, periodTimeMs, videoTimeMs, attributes:[{label:"FootballAssist"|"CreatedByUser"|"opponent_event_id"|"opponent_jersey", type:"uuid"|"number", value}], editors:[{editorId}]}`.
- Standard event types (`_ee`): `FootballGoal, FootballGoalKick, FootballCornerKick, FootballFreeKick, FootballPenaltyKick, FootballShot, FootballKickOff, FootballThrowIn, FootballFoul, FootballOutOfPlay`.
- Feature-switched event types (`gm`):
  - `tackle`, `dribble` behind `tackles-dribbles-analytics-2`
  - `duel` behind `duels-analytics-2`
  - `interception`, `loose` behind `interceptions-recoveries-analytics-2`
  - `save` behind `saves-analytics-2`
  - `pass` behind `player-passes-events-panel`
  - Player pass metrics behind `player-passes-analytics-studio`
- UI labels (`analysisSlice-CRlRsXf0.js` `L`): Goal, Free kick, Corner, Goal kick, Kickoff, Penalty, Shot, Throw-in, Foul, Total attempts, Tackle, Duel, Dribble, Interception, Loose ball recovery, Save.
- MES type → legacy stat key (`hte`):

  | MES type | Legacy key |
  |---|---|
  | `FootballGoal`, `FootballShotGoal` | `goal` |
  | `FootballCornerKick` | `kick_corner` |
  | `FootballFreeKick` | `kick_free_kick` |
  | `FootballGoalKick` | `kick_goalie` |
  | `FootballPenaltyKick` | `kick_penalty` |
  | `FootballShot` | `kick_shot` |
  | `FootballKickOff` | `kick_start` |
  | `FootballThrowIn` | `throw_in` |
  | `FootballFoul` | `foul` |
  | `tackle` | `tackles` |
  | `duel` | `duels` |
  | `dribble` | `dribbles` |
  | `interception` | `interceptions` |
  | `loose` | `loose_ball_recoveries` |
  | `save` | `saves` |

- Legacy RAS tag → key (`Pm`): `goal→goal`, `corner→kick_corner`, `freekick→kick_free_kick`, `goal-kick→kick_goalie`, `penalty-kick→kick_penalty`, `shot-on-goal→kick_shot`, `kickoff→kick_start`.

### 4.3.5 RAS `match-details` (v1.1+; `worker-lkm0OaJA.js` `Rte`/`Mte`/`qte`/`mu`, `analysisSlice-CRlRsXf0.js`)

- The response is an array with one element per requested `filters` timeframe, in period order.
- Each element is keyed by pitch side `L`/`R`:
  - `passLocations{L:[{x,…}],R:[…]}`. `x` is in 0..1. Thirds are `x<1/3` and `x>2/3`, mapped to defensive/attacking via `own_side`.
  - `passStrings{L:[[length,count],…],R:[…]}`
  - `possessionLocations{L:{defensive,middle,attacking},R:{…}}`
  - `stats{PassesCompleted:{L,R}, PossessionSeconds:{L,R}, PossessionWon:{L,R}}`
- Derived values:
  - `possession_percent = round(PossessionSeconds[side] / ΣPossessionSeconds × 100)`, averaged over periods.
  - `possession_minutes = seconds / 60`.
  - `unassigned.possession_minutes = periodMinutes − Σpossession / 60`.
  - `longest_pass_string`.
  - `three_to_five_passes`: strings with length 3–5.
  - `six_or_more_passes`: strings with length ≥ 6.
  - `*_location_in_{defensive|middle|attacking}_third` as percentages.

### 4.3.6 RAS `analytics` (status) → `analytics_version` (`worker-lkm0OaJA.js` `$te`)

- Version `"2"` if the keys `ball-tracking`, `match-details`, `shot-details` **and** `match-report` are all present.
- Version `"1.1"` if the first three are present.
- Otherwise `"1"`.
- The studio match filter on `analytics_version` (`xte`) accepts `all`, `any`, `2`, `1`, `none` (`none` means `has_analytics=false`).
- If `feature-processing-status.analytics !== "completed"`, the match status becomes that value. Missing periods give `"missing-periods"`; a fetch failure gives `"fetching-error"`.

### 4.3.7 RAS `shot-details` (`analysisSlice-CRlRsXf0.js` `J`, `worker-lkm0OaJA.js` `_te`)

- `{shot_details:[{id, name:"kick_shot_goal"|"kick_shot_no_goal", timestamp(sec), side:"left"|"right", location:[x,y], team}]}`.
- A shot is assigned to own/opponent by comparing `side` with the period's `own_side`.
- Location is flipped `(1−x, 1−y)` when `(own_side=right && own) || (own_side=left && opponent)`, then `x = 2x − 1` (`Vte`).
- When `has_events_enabled` is set, MES `FootballShot`/`FootballGoal` events are used instead (`Ete`).

### 4.3.8 Match report response (partial; details are in the report section)

- Required keys: `match, teams, periods, players, events, scorers` (`matchReportSlice-dbGYMyIg.js`).
- `speed_zones`:
  - `status:"available"`
  - `thresholds{hsr_kmh, sprint_kmh}`
  - `items[]{start_ms, end_ms, own, opponent, players[]}`. `own`/`opponent` are `{status:"measured", percentages{below_hsr,hsr,sprint}}`. Each player is `{team:"Own"|"Opponent", jersey_number, distribution{status, percentages, durations{sprint_ms}}}`.
  - Source: `report-BVrpWDhT.js` `Jg`.
- Shot block fields: `total_shots, goals, conversion_rate_overall, shots_inside_box, goals_inside_box, conversion_rate_inside_box, shots_outside_box, goals_outside_box, conversion_rate_outside_box`, each keyed by period and side (`report-BVrpWDhT.js` `Kg`).
- Report source groups: `keyStats, attacking, defensive, passing, physical` (`report-BVrpWDhT.js` `Qg`).

### 4.3.9 Team metric catalogue (key metrics / comparison radial / studio)

Source: `settings---F8aIpR.js`, mirrored in `worker-lkm0OaJA.js`.

**Possession:**

| id | Label | Unit |
|---|---|---|
| `possession_percent` | Possession % | % |
| `possession_minutes` | Possession minutes | |
| `possession_won` | Possession won | |
| `possession_location_in_{defensive,middle,attacking}_third` | Possession location % in … third | % |

**Passes:**

| id | Label | Unit |
|---|---|---|
| `pass_location_in_{defensive,middle,attacking}_third` | Pass location % in … third | % |
| `passes_completed` | Passes completed | |
| `three_to_five_passes` | 3 to 5 passes | |
| `six_or_more_passes` | 6 or more passes | |
| `longest_pass_string` | Longest pass string | |

**Events:**

| id | Label |
|---|---|
| `goals_scored` | Goals scored |
| `goals_conceded` | Goals conceded |
| `kick_free_kick` | Free kicks |
| `shots_on_goal` | Shots (non-goal) |
| `shots_conceded` | Shots conceded |
| `kick_corner` | Corners |
| `kick_goalie` | Goal kicks |
| `kick_penalty` | Penalty kicks |
| `throw_in` | Throw-ins |
| `foul` | Fouls |
| `tackles` | Tackles |
| `duels` | Duels |
| `dribbles` | Dribbles |
| `interceptions` | Interceptions |
| `loose_ball_recoveries` | Loose ball recoveries |
| `saves` | Saves |

**Combos:**

| id | Label | Unit |
|---|---|---|
| `shots_to_goal_conversion_rate` | Conversion rate | % |
| `total_attempts` | Total attempts | |
| `total_attempts_conceded` | Total attempts conceded | |
| `attacking_events` | Attacking events | |
| `defensive_events` | Defensive events | |
| `win_ratio` | Win ratio | % |

Defaults and aggregation:

- Default key metrics when the API returns 204: `possession_percent, goals_scored, shots_on_goal`.
- Default radial metrics: `goals_scored, shots_on_goal, shots_to_goal_conversion_rate, win_ratio, passes_completed, possession_percent`.
- Default comparison ranges: own team over the last 30 days; comparing team over days 30–59 before today.
- Aggregation over matches (`worker-lkm0OaJA.js` `Bm`):
  - Goals are averaged over all matches.
  - Other metrics are averaged over matches that have data.
  - Decimals are 0 for the possession/pass/conversion metrics and 1 for everything else (`tae`).
  - `win_ratio = wins / matches × 100`.

**Player metric catalogue** (same file): physical, events and general groups with abbreviations. Units: distance in meters is converted to km; speed is in km/h; minutes is `min`.

### 4.3.10 Match momentum

- Response: array `[[t, v], …]`. The y-domain is symmetric, `[-max|v|, +max|v|]`, drawn as a 60 px high curve over the timeline x-scale (`detail-B56tzMIL.js` `I_`).
- Visibility is toggled via localStorage. A hint key is stored in `veo.hidden-hints` (`multidimensional-timeline-CZmHuDQ8.js`).

### 4.3.11 Permissions and feature keys seen next to these endpoints

- Permissions: `analysis.read_match_report_advanced` (a basic vs. advanced report), `matches.update_match`, `teams.update_team`, `coach_assist.create_run`, `coach_assist.view_match__generation`, `coach_assist.create_match__generation` (`report-gate-DAHFb1FG.js`).
- Feature flags: `interactive_pass_strings` (`analysisSlice-CRlRsXf0.js`), `coach_assist_match_report_insights` and `coach_assist_chat_bot` (`report-BVrpWDhT.js`), `player_offering` (route `/player`, `bootstrap-Mr09pQaM.js`).

## 4.4 Open questions that need a live API call

1. **Heatmap PNG categories** (`POST /api/mes/v2/{match}/heatmap`): confirm whether `categories` is a list of tracking-category codes. `[1]` and `[3]` match `left/right_outfield_player`. Find out whether goalkeepers (`0`, `2`) can be included. Find out the image format, resolution and orientation (always left→right?).
2. **`player-heatmaps` matrix**: confirm `width × height` (the client assumes 60×30) and whether it varies with smoothing. Check the orientation semantics of `direction_of_play`, and whether `values` is normalized per player or across players.
3. **`/analysis/stats/`**: list all `stat_type`s returned (e.g. passes for v1.1 matches, `football_possession_won_total`) and the full `meta.positions` shape (`{<code>:{label}}`?). Also confirm the `period` key format in `periods[]` (1-based number vs. public_identifier).
4. **`/analysis/player-event-maps/`**: get the coordinate system of `x`/`z` (0..1 along length/width?) and confirm `direction_of_play` per request vs. per match for cross-match. Check whether `outcome` exists for non-shot map kinds (pass success?) and whether `PASS_MAP` events include an end location.
5. **Match momentum**: find the units of `v` (−1..1? xT?), the sampling interval, and whether the sign positive means own team.
6. **Passing network**: get the `nodes`/`edges` fields (jersey, avg position x/z, pass counts, weights), the expected format of `periods` (array of `{timeframe, own_side}`?), and whether `team:"Opponent"` is supported.
7. **`v2GetTeamStats`**: confirm that the `byPeriod` keys are 1-based period numbers (the UI indexes `periods[n−1]`), and get the full `eventType` list including `MissedShots`.
8. **Physical metrics** (`/physical-metrics`, `-detail`): get the full field list (distance, HIR, sprints, top speed units). Find the `drill` values other than `ALL` and the `metric` enum other than `Sprint`.
9. **RAS match-details / shot-details**: these are fetched with `credentials:"omit"` against `RAS_URL`. Determine how access is authorized (signed URL? public CloudFront?), and get the exact `possessionLocations` and `passLocations` element fields beyond `x`.
10. **Uncalled MES cross-match endpoints** (`/api/mes/v2/-/player-stats`, `-/player-heatmaps`, `-/physical-metrics`, `-/pass-strings`, `-/team-stats`, `own-player-stats`, `speed-zone-distribution`): find out what format `mappings` takes (jersey→user mapping per match?), the shape of `periodsByMatch`, and the response models. These are presumably used by the federated Player Offering app or by mobile.
11. **`key-metrics` GET**: confirm whether it returns `{metrics:[{id}]}` or an array, since the worker falls back to `[]` on exception. Also check the `comparison-radial` GET shape `{config}`.
12. **`feature-processing-status`**: get the full key set (`analytics`, `ai_detection`, `player_spotlight`, …) and the status values (`completed`, `not-purchased`, `processing`, …).

# 5. Open questions that need a live API call (merged)

These are merged and de-duplicated from the detailed lists at the end of parts 1a, 1b, 2, 3 and 4. Each item names the part(s) it comes from and what to capture. A good capture set is one football match per analytics version (1, 1.1, 2), with confirmed periods, an own team and a lineup, from an account that has the advanced Match Report and Analytics 2.

**Heat maps**
1. `POST /api/mes/v2/{match}/heatmap`:
   - Meaning of every `categories` code. Only `[1]` (team on the left) and `[3]` (team on the right) are used; they match the tracking codes for outfield players on the left/right. Are 0/2 goalkeepers, 4 referee, 6 ball? Can a request mix several codes?
   - Image format (PNG?), pixel size, transparency, colour scale, orientation.
   - Whether `startTime`/`endTime` are recording seconds. (1a, 1b, 4)
2. `POST /api/app/analysis/player-heatmaps/`:
   - Real `matrix.width`/`height` per `type`. The cross-match code hard-codes 1800 = 30 × 60; the report reads `width`/`height`.
   - Row/column orientation: is row 0 the top or the bottom touchline?
   - Does `direction_of_play` apply per request or per match, and is it always present?
   - Are values normalised per player or across players?
   - Range of `average_position{x,z}`, plus `match_count` and the `meta.positions` code list. (2, 3, 4)

**Events and maps**
3. MES events and `player-event-maps`:
   - `x`/`z` range and origin (assumed 0..1 along length/width), and whether the backend already normalises them per period or direction of play.
   - `outcome` values per `map_kind` (is a pass a success?), the `period` value format, whether `PASS_MAP` includes an end location, and whether it is paginated. (1a, 2, 3, 4)
4. `GET /api/mes/v2/{id}/match-events`: the full `eventType` enum and the effect of `aggregatedDuels`. (1a, 4)
5. `GET /api/mes/v2/{id}/teams/{Own|Opponent}/stats`: are the `byPeriod` keys 1-based period numbers, and what is the full `eventType` set, including `MissedShots`/`TotalShots`? (1a, 4)

**Legacy RAS sources**
6. RAS `match-details` (one `filters=start,end` per period):
   - Full schema: `passLocations` element fields beyond `x`, `passStrings` as `[length, count]` pairs?, the `endLocation` format, the effect of `interactiveStrings=true`.
   - `possessionLocations` units (seconds or counts) and orientation.
   - `stats.PossessionSeconds` / `PassesCompleted` / `PossessionWon` per side L/R. (1a, 1b, 4)
7. RAS `shot-details`: the `name` values beyond `kick_shot_goal`, the `side` values, the `location` range, and the `timestamp` base. RAS `analytics` (status): exact keys and status strings, which the client uses to derive `analytics_version`. How is RAS access authorised, given it is fetched with `credentials:"omit"` (public CloudFront or signed URLs)? (1a, 1b, 4)

**Stats endpoints**
8. `POST /api/app/analysis/stats/` for each `type`:
   - The full list of `stats[].type` / `event_type` / `computed_type` values and the `team_association` values.
   - The `periods[].period` key format (number or public_identifier).
   - The `meta.positions` and `meta.stats_availability[]` fields. (1a, 1b, 2, 3, 4)
9. `POST /api/app/analysis/leaderboards/`: the full set of `stat_type` values, and whether `top` can be more than 5. (2, 4)

**Timeline and passing network**
10. `GET /api/mes/v2/{id}/match-momentum`: the tuple layout (assumed `[seconds, value]`), the value range and units, the sampling interval, and the sign convention before the client flips it to the home team. (1a, 4)
11. `POST /api/mes/v2/{id}/passing-network`:
   - The exact `periods` format (`[{periodId, ownSide}]`) and whether `team:"Opponent"` is supported.
   - The `nodes`/`edges` field set and the range of `averageTouchLocation`. (3, 4)

**Physical and tracking**
12. Physical metrics:
   - `GET /api/mes/v2/{id}/physical-metrics`: the full field list (distance, HSR, sprints, top/average speed, and their units) and the `drill` values other than `ALL`.
   - `physical-metrics-detail`: the `metric` enum other than `Sprint`, the unit of `value`, what `timestamp` is measured from, and the type of `jerseyNumber`.
   - Speed zones: default thresholds (`hsr_kmh`, `sprint_kmh`, team `speed_zones` lower bounds), bucket width, status values, and whether the percentages add up to 100. (2, 3, 4)
13. `GET /api/mes/v2/{id}/player-tracking?start=`: the window length (the client assumes about 30 s), frames per second, and the tuple layout `[trackId, category, x, y, jersey, distance, speed]` with units. (2, 4)
14. `GET /api/mes/v2/{id}/player-moments`: the track tuple layout (assumed `[t, x, z, metres_to_ball]`), the `category` values, and how `side` interacts with `jersey="goalie"`. (2, 4)

**Match report**
15. `GET /api/app/analysis/matches/{id}/match-report/`:
   - The `view` value and the key set of a basic report.
   - `events[].team` values; whether `players[]` contains only the own team; whether `period_id` is 1-based; whether period times are in seconds.
   - Whether every StatValue has a `comparison` and what `difference` means.
   - Whether `feature-processing-status.match_report` fields can be null. (3)
16. Coach Assist: does `insight_id` equal the insight `type`? What are the run status values? (3)

**Team settings and lists**
17. Team settings endpoints:
   - `key-metrics` GET: is it always `{metrics:[{id}]}` (204 means defaults), or sometimes a bare array?
   - `comparison-radial` GET on an unconfigured team: 204 or 404? Is `date_range` stored as `YYYY-MM-DD`?
   - The URL and permission-key format of the team permission fetch. (1b, 4)
18. `GET /api/app/matches/` list: does it contain `analytics_version`, `has_events_enabled`, `periods` and `info.stats.score` directly? Ordering and pagination when only `page_size` is given. `feature-processing-status`: the full key set and status values (`completed`, `processing`, `pending`, `not-purchased`, `error`, …). `GET /api/mes/v2/{id}/quality`: the fields besides `jersey.legibility`. (1b, 4)

**Not covered by the download**
19. The uncalled MES cross-match endpoints (`/api/mes/v2/-/player-stats`, `-/player-heatmaps`, `-/player-events`, `-/physical-metrics`, `-/team-stats`, `-/pass-strings`, `own-player-stats`, `speed-zone-distribution`): the format of `mappings` and `periodsByMatch`, and the response models. Also download and inspect the Player Offering `remoteEntry.js`, which probably consumes them. (2, 4)
20. CSS was not downloaded. In the legacy shot map, do the `.attacking-events` / `.defending-events` layers cover only one half of the pitch, which is what the `2x − 1` transform implies? (1b)
