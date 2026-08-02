# ADR-004: Private Medienobjekte

Status: angenommen · 2. August 2026

Rohmedien, Render-Ergebnisse und Brand Assets liegen in getrennten privaten Buckets. Objektpfade beginnen mit dem Organisations- und Abteilungsscope, sind aber nicht selbst die Sicherheitsgrenze. RLS oder kurzlebige Signed URLs entscheiden über Zugriff.
