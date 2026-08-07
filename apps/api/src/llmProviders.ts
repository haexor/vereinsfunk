// createSecretBoxFromEnvironment/ciphertextToBytea zogen nach ./secretBox.ts um (Paket 012 nutzt
// beide Helfer fuer Social-Connection-Tokens wieder, ein Import von hier waere fuer eine
// kanalfremde Datei irrefuehrend gewesen -- Aufrufer importieren jetzt direkt aus ./secretBox.js).

export function mapLlmProviderConfigurationRow(row: Record<string, unknown>, hasSecret: boolean) {
  return {
    id: row.id,
    label: row.label,
    protocol: row.protocol,
    baseUrl: row.base_url,
    model: row.model,
    purpose: row.purpose,
    priority: row.priority,
    isActive: row.is_active,
    systemPromptOverride: row.system_prompt_override,
    hasSecret,
  }
}
