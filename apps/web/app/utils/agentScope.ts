export type AgentScopeRequest = {
  organizationId: string
  departmentId?: string
}

// `null` ist im UI der explizite Vereins-Scope. In einer URL darf er jedoch nicht als
// Query-Parameter landen: der HTTP-Client serialisiert ihn als nackten Wert, den die API nicht
// wieder in `null` zurueckverwandeln kann. Ohne Parameter erkennt die API den Vereins-Scope.
export function toAgentScopeRequest(scope: { organizationId: string; departmentId: string | null }): AgentScopeRequest {
  return scope.departmentId
    ? { organizationId: scope.organizationId, departmentId: scope.departmentId }
    : { organizationId: scope.organizationId }
}
