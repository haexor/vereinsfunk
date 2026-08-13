begin;

-- Zwei aktive Provider derselben Aufgabenart mit gleicher priority machen "der aktive Provider"
-- undefiniert: order by priority allein laesst offen, welche der beiden Zeilen die Datenbank
-- zuerst liefert. Der Lesepfad (apps/worker/src/context.ts, loadActiveTextProvider) hat das
-- bisher zur Laufzeit erkannt und die Generierung verweigert -- also erst, wenn ein Mitglied
-- laengst auf "Erzeugen" gedrueckt hatte, und mit einer Meldung, die nach "kein Provider
-- hinterlegt" klingt. Ein Tiebreak ueber die id waere zwar stabil, wuerde aber lautlos einen
-- Gewinner kueren, an dem Kosten, Qualitaet und der Anbieter mit Zugriff auf die Vereinsdaten
-- haengen. Der Konflikt gehoert deshalb dorthin, wo er entsteht und aufloesbar ist: in die
-- Provider-Verwaltung, im Moment des Speicherns.

-- Bestehende Gleichstaende deterministisch aufloesen, bevor der Index entsteht. Bewusst nur die
-- Zeilen verschieben, die tatsaechlich kollidieren: die mit der kleinsten id behaelt ihre
-- priority. Das ist genau die Zeile, die der bestehende Index (task_kind, priority, id) bisher
-- zuerst geliefert haette -- die faktisch geltende Auswahl bleibt also, was sie war, statt sich
-- beim Deployment umzudrehen. Die verschobenen Zeilen landen oberhalb des bisherigen Maximums
-- ihrer Aufgabenart und koennen dadurch weder untereinander noch mit einer behaltenen Zeile
-- erneut kollidieren. Ihre Reihenfolge untereinander kann sich dabei verschieben -- erhalten
-- bleibt bewusst nur, wer vorne steht, denn nur diese Zeile routet ueberhaupt etwas. Faende die
-- Aufloesung nicht jeden Fall, scheiterte das create unique index unten und die Migration braeche
-- ab -- sie prueft sich also selbst.
with shifted as (
  select
    config.id,
    config.task_kind,
    row_number() over (partition by config.task_kind order by config.priority, config.id) as offset_in_kind
  from public.llm_provider_configurations config
  where config.is_active
    and exists (
      select 1
      from public.llm_provider_configurations other
      where other.is_active
        and other.task_kind = config.task_kind
        and other.priority = config.priority
        and other.id < config.id
    )
),
ceiling as (
  select task_kind, max(priority) as max_priority
  from public.llm_provider_configurations
  where is_active
  group by task_kind
)
update public.llm_provider_configurations config
set priority = ceiling.max_priority + shifted.offset_in_kind
from shifted
join ceiling on ceiling.task_kind = shifted.task_kind
where config.id = shifted.id;

-- Partiell auf is_active: eine abgeschaltete Zeile routet nichts und darf ihre priority behalten.
-- Ein Ersatz-Provider laesst sich dadurch weiterhin vorbereiten, ohne den aktiven zu verdraengen
-- -- nur das Aktivschalten verlangt dann eine freie Prioritaet.
create unique index llm_provider_configurations_active_task_priority_unique
  on public.llm_provider_configurations (task_kind, priority) where is_active;

-- Ersetzt llm_provider_configurations_active_task_priority_idx (2026081103): dieselbe
-- Teilbedingung, dieselben fuehrenden Spalten. Die dritte Spalte id trug dort nur den Tiebreak,
-- den es ab hier nicht mehr geben kann.
drop index public.llm_provider_configurations_active_task_priority_idx;

commit;
