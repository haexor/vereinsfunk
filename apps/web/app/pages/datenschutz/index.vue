<script setup lang="ts">
// Datenschutzerklaerung fuer Vereinsfunk als Produkt selbst (Plan 020, Abschnitt "5. Die
// Anwendung selbst") -- ohne Anmeldung erreichbar, bewusst nicht auf noindex gesetzt. Betrifft
// die Verarbeitung durch den Betreiber der Plattform; fuer Mitgliederdaten eines einzelnen
// Vereins ist der Verein selbst verantwortlich (siehe Abschnitt unten). Platzhalter analog zu
// /impressum: kein erfundener Name, keine erfundene Anschrift.
definePageMeta({ layout: 'auth' })
useHead({ title: 'Datenschutzerklärung — Vereinsfunk' })
</script>

<template>
  <div class="text-left">
    <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Datenschutzerklärung</h1>

    <div class="mt-4 rounded-xl bg-amber-100 p-3 text-xs text-amber-800">
      <strong>Platzhalter.</strong> Diese Seite beschreibt die Verarbeitung grundsätzlich, ist aber noch nicht mit den echten Angaben des Betreibers gefüllt. Alle Felder in eckigen Klammern müssen vor Produktivbetrieb ausgefüllt und der gesamte Text anwaltlich geprüft werden.
    </div>

    <section class="mt-6">
      <h2 class="text-sm font-bold text-ink">1. Verantwortlicher</h2>
      <p class="mt-2 text-sm text-[#43483f]">
        [Name des Betreibers bzw. der Betreiberin]<br />
        [Straße, Postleitzahl und Ort]<br />
        E-Mail für Datenschutzanfragen: [E-Mail-Adresse]
      </p>
    </section>

    <section class="mt-6">
      <h2 class="text-sm font-bold text-ink">2. Datenschutzbeauftragter</h2>
      <p class="mt-2 text-sm text-[#43483f]">[Name und Kontakt der/des Datenschutzbeauftragten, falls bestellt — sonst entfällt dieser Abschnitt]</p>
    </section>

    <section class="mt-6">
      <h2 class="text-sm font-bold text-ink">3. Welche Daten wir verarbeiten</h2>
      <p class="mt-2 text-sm text-[#43483f]">
        Kontodaten der Vereine und ihrer Nutzer:innen mit Vereinszugang (Name, E-Mail-Adresse, Rolle), von Vereinen hochgeladene Inhalte
        (Texte, Fotos, Videos) zur Planung und Veröffentlichung von Social-Media-Beiträgen, sowie technische Protokolldaten zum
        Betrieb der Plattform (u. a. Zeitstempel, Fehlerprotokolle).
      </p>
    </section>

    <section class="mt-6">
      <h2 class="text-sm font-bold text-ink">4. Zweck und Rechtsgrundlage</h2>
      <p class="mt-2 text-sm text-[#43483f]">
        Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO) für die Bereitstellung der Plattform an den Verein, berechtigtes Interesse
        (Art. 6 Abs. 1 lit. f DSGVO) für Betriebssicherheit und Missbrauchsschutz.
      </p>
    </section>

    <section class="mt-6">
      <h2 class="text-sm font-bold text-ink">5. Cookies und Tracking</h2>
      <p class="mt-2 text-sm text-[#43483f]">
        Es wird ausschließlich ein technisch notwendiges Sitzungscookie gesetzt (Art. 6 Abs. 1 lit. f DSGVO). Es findet derzeit
        keine Analyse- oder Marketing-Software mit Personenbezug statt. Sollte sich das ändern, wird vor dem Einsatz ein
        Einwilligungsbanner ergänzt.
      </p>
    </section>

    <section class="mt-6">
      <h2 class="text-sm font-bold text-ink">6. Empfänger und Auftragsverarbeiter</h2>
      <p class="mt-2 text-sm text-[#43483f]">
        [Liste der eingesetzten Dienste, z. B. Hosting, Datenbank, E-Mail-Versand, LLM-Anbieter — durch den Betreiber zu
        ergänzen]. Für die Veröffentlichung auf Instagram und Facebook übermittelt der jeweilige Verein Inhalte im Rahmen der
        von ihm hergestellten Verbindung an Meta Platforms Ireland Limited; die Datenschutzerklärung von Meta gilt zusätzlich.
      </p>
    </section>

    <section class="mt-6">
      <h2 class="text-sm font-bold text-ink">7. Speicherdauer</h2>
      <p class="mt-2 text-sm text-[#43483f]">
        Kontodaten eines Vereins bleiben bestehen, solange das Vereinskonto genutzt wird. Aufbewahrungsfristen für
        Rohmedien, Audit-Protokolle und Einwilligungsnachweise legt jeder Verein selbst unter „Recht &amp; Datenschutz“ in
        seinem Vereinskonto fest — dort wirken sie auch automatisiert. Eine vollständige Löschung eines Vereinskontos ist
        derzeit keine automatisierte Selbstbedienungsfunktion; sie erfolgt auf Anfrage über die in Abschnitt 8 genannte
        Kontaktadresse.
      </p>
    </section>

    <section class="mt-6">
      <h2 class="text-sm font-bold text-ink">8. Rechte der betroffenen Person</h2>
      <p class="mt-2 text-sm text-[#43483f]">
        Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch — sowie das
        Recht auf Beschwerde bei einer Datenschutz-Aufsichtsbehörde. Anfragen an: [E-Mail-Adresse für Datenschutzanfragen].
      </p>
    </section>

    <section class="mt-6">
      <h2 class="text-sm font-bold text-ink">9. Verantwortung der Vereine für ihre Mitglieder</h2>
      <p class="mt-2 text-sm text-[#43483f]">
        Für personenbezogene Daten, die ein Verein über seine Mitglieder, Angehörige und Fotos verarbeitet, ist der jeweilige
        Verein datenschutzrechtlich verantwortlich — nicht der Betreiber von Vereinsfunk. Impressum und Datenschutzhinweise
        eines einzelnen Vereins sind über dessen eigenen, von ihm verlinkten Link abrufbar.
      </p>
    </section>

    <p class="mt-6 text-xs text-[#9aa096]">Das Impressum von Vereinsfunk steht unter <NuxtLink to="/impressum" class="font-semibold text-forest">/impressum</NuxtLink>.</p>
  </div>
</template>
