<script setup lang="ts">
const channelsState = reactive(await useChannels())
</script>

<template>
  <div class="mx-auto max-w-[980px] px-5 py-8 sm:px-10">
    <header class="mb-8">
      <div class="eyebrow mb-3">Verein</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Kanäle</h1>
      <p class="mt-2 text-sm text-[#727a75]">Instagram- und Facebook-Konten sowie die eigene Website/den Blog verbinden und festlegen, welche Abteilung sie bespielen darf.</p>
    </header>

    <div v-if="channelsState.loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <p v-else-if="channelsState.errorMessage" class="text-sm text-amber-800">{{ channelsState.errorMessage }}</p>
    <template v-else>
      <p v-if="channelsState.oauthError" class="mb-4 rounded-xl bg-amber-100 p-3 text-sm text-amber-800">{{ channelsState.oauthError }}</p>
      <p v-if="channelsState.actionError" class="mb-4 text-sm text-amber-800">{{ channelsState.actionError }}</p>

      <section v-if="channelsState.pendingId" class="card mb-6 p-6">
        <h2 class="mb-3 font-display text-base font-bold">Konto auswählen</h2>
        <p v-if="channelsState.pendingLoading" class="text-xs text-[#7b827d]">Wird geladen …</p>
        <template v-else-if="channelsState.pendingConnection">
          <p class="mb-3 text-[13px] text-[#727a75]">Welche Seite bzw. welches Instagram-Business-Konto soll verbunden werden?</p>
          <ul class="space-y-2"><li v-for="account in channelsState.pendingConnection.availableAccounts" :key="account.externalAccountId"><button type="button" :disabled="channelsState.pendingSelecting !== null" class="focus-ring flex w-full items-center gap-3 rounded-xl border border-[#dfe0d9] p-3 text-left text-sm hover:border-forest disabled:opacity-60" @click="channelsState.selectPendingAccount(account.externalAccountId)"><PlatformIcon :platform="channelsState.pendingConnection.platform" /><span class="flex-1 font-medium">{{ account.displayName }}</span><span v-if="channelsState.pendingSelecting === account.externalAccountId" class="text-[10px] text-[#9aa096]">Wird verbunden …</span></button></li></ul>
        </template>
        <p v-else class="text-xs text-amber-800">Diese Auswahl ist nicht mehr verfügbar.</p>
      </section>

      <section v-if="channelsState.canManageOrganizationChannels" class="card mb-6 p-6">
        <h2 class="mb-3 font-display text-base font-bold">Kanal verbinden</h2>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" :disabled="channelsState.connecting !== null" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" @click="channelsState.connect('instagram', 'organization', null)">Instagram verbinden (Verein)</button>
          <button type="button" :disabled="channelsState.connecting !== null" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" @click="channelsState.connect('facebook', 'organization', null)">Facebook verbinden (Verein)</button>
        </div>
        <div v-if="channelsState.channelPolicy?.allowDepartmentOwnedChannels" class="mt-4 border-t border-[#e8e9e2] pt-4">
          <p class="mb-2 text-[11px] font-semibold text-[#7b827d]">Eigener Abteilungskanal</p>
          <div class="flex flex-wrap items-center gap-2"><select v-model="channelsState.connectDepartmentId" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-xs"><option value="">Abteilung wählen …</option><option v-for="department in channelsState.departments" :key="department.id" :value="department.id">{{ department.name }}</option></select><button type="button" :disabled="!channelsState.connectDepartmentId || channelsState.connecting !== null" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold disabled:opacity-60" @click="channelsState.connect('instagram', 'department', channelsState.connectDepartmentId)">Instagram</button><button type="button" :disabled="!channelsState.connectDepartmentId || channelsState.connecting !== null" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold disabled:opacity-60" @click="channelsState.connect('facebook', 'department', channelsState.connectDepartmentId)">Facebook</button></div>
        </div>
        <div class="mt-4 border-t border-[#e8e9e2] pt-4">
          <p class="mb-2 text-[11px] font-semibold text-[#7b827d]">Eigene Website / Blog hinzufügen</p>
          <div class="flex flex-wrap items-end gap-2">
            <label class="flex flex-col gap-1"><span class="text-[11px] font-semibold">Anzeigename</span><input v-model="channelsState.websiteForm.displayName" placeholder="z. B. Vereinsblog" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-xs" /></label>
            <label class="flex flex-col gap-1"><span class="text-[11px] font-semibold">Adresse</span><input v-model="channelsState.websiteForm.url" type="url" placeholder="https://verein.de/blog" class="focus-ring w-56 rounded-lg border border-[#dfe0d9] p-2 text-xs" /></label>
            <label class="flex flex-col gap-1"><span class="text-[11px] font-semibold">Maximale Länge</span><input v-model="channelsState.websiteForm.maxCharacters" type="number" min="100" max="10000" placeholder="5000" class="focus-ring w-24 rounded-lg border border-[#dfe0d9] p-2 text-xs" /></label>
            <button type="button" :disabled="!channelsState.websiteForm.displayName.trim() || !channelsState.websiteForm.url.trim() || channelsState.creatingWebsite" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold disabled:opacity-60" @click="channelsState.createWebsiteChannel()">{{ channelsState.creatingWebsite ? 'Wird angelegt …' : 'Hinzufügen' }}</button>
          </div>
        </div>
        <div class="mt-4 space-y-2 border-t border-[#e8e9e2] pt-4">
          <label class="flex items-center gap-2 text-[12px] text-[#43483f]"><input type="checkbox" :checked="channelsState.channelPolicy?.allowDepartmentOwnedChannels ?? false" :disabled="channelsState.policyUpdating !== null" @change="channelsState.updateChannelPolicy('allow_department_owned_channels', ($event.target as HTMLInputElement).checked)" /> Abteilungen dürfen eigene Kanäle mitbringen</label>
          <label class="flex items-center gap-2 text-[12px] text-[#43483f]"><input type="checkbox" :checked="channelsState.channelPolicy?.requireChannelResponsible ?? false" :disabled="channelsState.policyUpdating !== null" @change="channelsState.updateChannelPolicy('require_channel_responsible', ($event.target as HTMLInputElement).checked)" /> Kanal ohne verantwortliche Person kann nicht bespielt werden</label>
        </div>
      </section>

      <ChannelCard v-for="channel in channelsState.channels" :key="channel.id" :channel="channel" :members="channelsState.members" :busy="channelsState.busyChannelId === channel.id" :can-manage="channelsState.canManageChannel(channel)" :department-name="channelsState.departmentName" v-model:purpose-draft="channelsState.purposeDraft[channel.id]!" v-model:max-characters-draft="channelsState.maxCharactersDraft[channel.id]!" v-model:editorial-imprint-url-draft="channelsState.editorialImprintUrlDraft[channel.id]!" v-model:editorial-privacy-url-draft="channelsState.editorialPrivacyUrlDraft[channel.id]!" v-model:editorial-responsible-profile-id-draft="channelsState.editorialResponsibleProfileIdDraft[channel.id]!" v-model:editorial-responsible-note-draft="channelsState.editorialResponsibleNoteDraft[channel.id]!" :editorial-saving="channelsState.editorialSavingId === channel.id" :editorial-error="channelsState.editorialErrorByChannel[channel.id]" @verify="channelsState.verifyChannel(channel)" @disconnect="channelsState.disconnectChannel(channel)" @save-purpose="channelsState.savePurpose(channel)" @save-max-characters="channelsState.saveMaxCharacters(channel)" @save-editorial="channelsState.saveEditorialFields(channel)" />
      <p v-if="!channelsState.channels.length" class="p-8 text-center text-xs text-[#9aa096]">Noch ist kein Kanal verbunden. Ihr könnt Beiträge vorbereiten, aber nicht veröffentlichen.</p>

      <section v-if="channelsState.assignmentChannels.length && channelsState.departments.length" class="card mt-8 overflow-x-auto p-6">
        <h2 class="mb-1 font-display text-base font-bold">Zuordnung</h2>
        <p class="mb-4 text-[11px] text-[#7b827d]">Wer darf welchen Kanal bespielen? Vereinsweit freigegeben gilt für alle Abteilungen.</p>
        <table class="w-full min-w-[480px] border-collapse text-[12px]"><thead><tr><th class="p-2 text-left font-semibold text-[#7b827d]"></th><th v-for="channel in channelsState.assignmentChannels" :key="channel.id" class="p-2 text-left font-semibold text-[#7b827d]"><div class="flex items-center gap-1.5"><PlatformIcon :platform="channel.platform" /> {{ channel.displayName }}</div></th></tr></thead><tbody><tr class="border-t border-[#e8e9e2]"><td class="p-2 font-medium">Ganzer Verein</td><td v-for="channel in channelsState.assignmentChannels" :key="channel.id" class="p-2"><input type="checkbox" :checked="!!channelsState.organizationScopeAssignment(channel)" :disabled="!channelsState.canManageChannel(channel) || channelsState.scopeBusyKey === `${channel.id}:organization`" @change="channelsState.toggleOrganizationScope(channel)" /></td></tr><tr v-for="department in channelsState.departments" :key="department.id" class="border-t border-[#e8e9e2]"><td class="p-2 font-medium">{{ department.name }}</td><td v-for="channel in channelsState.assignmentChannels" :key="channel.id" class="p-2"><input type="checkbox" :checked="!!channelsState.organizationScopeAssignment(channel) || !!channelsState.scopeAssignment(channel, department.id)" :disabled="!!channelsState.organizationScopeAssignment(channel) || !channelsState.canManageChannel(channel) || channelsState.scopeBusyKey === `${channel.id}:${department.id}`" @change="channelsState.toggleDepartmentScope(channel, department.id)" /></td></tr></tbody></table>
      </section>
    </template>
  </div>
</template>
