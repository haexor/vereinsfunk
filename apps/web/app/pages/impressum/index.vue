<script setup lang="ts">
// Rechtstext fuer Vereinsfunk als Produkt selbst (Plan 020, Abschnitt "5. Die Anwendung
// selbst") -- ohne Anmeldung erreichbar und bewusst NICHT auf noindex gesetzt, im Unterschied
// zu den Einwilligungs-Token-Seiten. Die tatsaechliche Betreiberidentitaet ist nicht bekannt;
// jedes eckig geklammerte Feld ist ein Platzhalter, den der Betreiber vor Produktivbetrieb
// ausfuellen und anwaltlich pruefen lassen muss -- kein erfundener Name, keine erfundene Anschrift.
definePageMeta({ layout: 'auth' })
useHead({ title: 'Impressum — Vereinsfunk' })
</script>

<template>
  <div class="text-left">
    <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Impressum</h1>

    <div class="mt-4 rounded-xl bg-amber-100 p-3 text-xs text-amber-800">
      <strong>Platzhalter.</strong> Diese Seite ist noch nicht mit den echten Angaben des Betreibers gefüllt. Alle Felder in eckigen Klammern müssen vor Produktivbetrieb durch die tatsächlichen Angaben ersetzt und der gesamte Text anwaltlich geprüft werden.
    </div>

    <section class="mt-6">
      <h2 class="text-sm font-bold text-ink">Angaben gemäß § 5 TMG</h2>
      <p class="mt-2 text-sm text-[#43483f]">
        [Name des Betreibers bzw. der Betreiberin]<br />
        [Rechtsform]<br />
        [Straße und Hausnummer]<br />
        [Postleitzahl und Ort]<br />
        [Land]
      </p>
      <p class="mt-3 text-sm text-[#43483f]">Vertreten durch: [Name der vertretungsberechtigten Person]</p>
      <p class="mt-3 text-sm text-[#43483f]">Handels- oder Vereinsregister: [Registergericht und Registernummer, falls eingetragen]</p>
      <p class="mt-3 text-sm text-[#43483f]">USt-IdNr.: [USt-IdNr., falls vorhanden]</p>
    </section>

    <section class="mt-6">
      <h2 class="text-sm font-bold text-ink">Kontakt</h2>
      <p class="mt-2 text-sm text-[#43483f]">
        E-Mail: [E-Mail-Adresse]<br />
        Telefon: [Telefonnummer, falls angegeben werden soll]
      </p>
    </section>

    <section class="mt-6">
      <h2 class="text-sm font-bold text-ink">Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <p class="mt-2 text-sm text-[#43483f]">[Name und Anschrift der inhaltlich verantwortlichen Person]</p>
    </section>

    <section class="mt-6">
      <h2 class="text-sm font-bold text-ink">Streitschlichtung</h2>
      <p class="mt-2 text-sm text-[#43483f]">
        Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:
        <a href="https://ec.europa.eu/consumers/odr" class="font-semibold text-forest" rel="noopener">ec.europa.eu/consumers/odr</a>.
        Ob und in welchem Umfang der Betreiber an einem Streitbeilegungsverfahren teilnimmt, ist hier noch zu ergänzen.
      </p>
    </section>

    <p class="mt-6 text-xs text-[#9aa096]">
      Impressumsangaben für einen einzelnen Verein finden sich unter dessen eigenem Link, nicht auf dieser Seite.
      Die Datenschutzerklärung von Vereinsfunk steht unter <NuxtLink to="/datenschutz" class="font-semibold text-forest">/datenschutz</NuxtLink>.
    </p>
  </div>
</template>
