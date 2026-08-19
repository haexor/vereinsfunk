begin;

-- Validates the NOT VALID constraint added in 2026081911 under SHARE UPDATE EXCLUSIVE, which
-- allows concurrent reads and writes, instead of the ACCESS EXCLUSIVE a combined statement holds.
alter table public.generation_candidates validate constraint generation_candidates_round_input_hash_check;

commit;
