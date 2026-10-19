import type { ApiEnvironment } from '@vereinsfunk/config'
import { createChainSigner, createSecretBox, parseSecretBoxKeys, type ChainSigner, type SecretBox } from '@vereinsfunk/secrets'

// bytea- und Embed-Helfer liegen in packages/secrets, weil der Worker sie ebenso braucht. Hier
// weiter exportiert, damit die bestehenden Importe aus ./secretBox.js unveraendert bleiben.
export { byteaToBuffer, ciphertextToBytea, EmbeddedProviderSecretSchema, unwrapEmbeddedSecret } from '@vereinsfunk/secrets'

// Gemeinsam fuer LLM-Provider-Schluessel (Paket 011) und Social-Connection-Tokens (Paket 012) --
// beide Verwendungen teilen denselben Schluesselsatz, statt einen zweiten mit eigenen Env-Variablen
// einzufuehren (Plan 012 sah urspruenglich SOCIAL_TOKEN_KEYS vor; SECRET_BOX_KEYS existierte zu dem
// Zeitpunkt bereits aus Paket 011 und wird stattdessen wiederverwendet).
// Absichtlich lazy statt beim Serverstart geprueft (wie createServiceClient/createUserClient):
// nicht jede Umgebung nutzt LLM-Provider- oder Kanalverwaltung, ein hartes Startup-Erfordernis waere
// verfruehte Kopplung an Features, die ein Deployment vielleicht nie anfasst.
export function createSecretBoxFromEnvironment(environment: ApiEnvironment): SecretBox {
  if (!environment.SECRET_BOX_KEYS || !environment.SECRET_BOX_CURRENT_KEY_VERSION) {
    throw new Error('SECRET_BOX_KEYS and SECRET_BOX_CURRENT_KEY_VERSION are required to manage encrypted secrets')
  }
  return createSecretBox(parseSecretBoxKeys(environment.SECRET_BOX_KEYS), environment.SECRET_BOX_CURRENT_KEY_VERSION)
}

// Paket 020: signiert den Kopf-Hash der Audit-Event-Kette je Verein mit demselben Schluesselsatz --
// eine eigene Env-Variable wollte der Plan ausdrücklich nicht ("packages/secrets, SECRET_BOX_KEYS").
// createChainSigner leitet daraus per HKDF einen eigenen HMAC-Schluessel ab, keine Wiederverwendung
// des rohen AES-Schluessels ueber zwei Algorithmen hinweg.
export function createChainSignerFromEnvironment(environment: ApiEnvironment): ChainSigner {
  if (!environment.SECRET_BOX_KEYS || !environment.SECRET_BOX_CURRENT_KEY_VERSION) {
    throw new Error('SECRET_BOX_KEYS and SECRET_BOX_CURRENT_KEY_VERSION are required to sign the audit chain')
  }
  return createChainSigner(parseSecretBoxKeys(environment.SECRET_BOX_KEYS), environment.SECRET_BOX_CURRENT_KEY_VERSION)
}
