-- 0006_external_id_not_unique.sql
--
-- Canonical player identity moves from the ranking sheet's `ID` to the normalised name
-- (FR-004 as amended 2026-08-28; ADR-007 § Amendment; data-model.md § `players`).
--
-- The sheet's `ID` column is not unique. Measured against the live export on 2026-08-28: 784 rows,
-- 756 distinct `ID` values, 18 values shared by 46 rows describing different people, and 784
-- distinct normalised names. The sheet is maintained by a third party, so the club can neither
-- correct those rows nor prevent the next collision — and while `external_id` is UNIQUE NOT NULL
-- every import of the real sheet aborts, so nothing can be published at all.
--
-- `players.match_key` keeps its UNIQUE constraint and becomes the sole identity key. That makes the
-- importer's duplicate-match-key check load-bearing rather than defensive: it is now the only thing
-- standing between two people and a merged record.

alter table players drop constraint players_external_id_key;

-- Nullable because a future source row may legitimately lack an identifier, and because the column
-- is now informational only — nothing resolves identity through it.
alter table players alter column external_id drop not null;

comment on column players.external_id is
  'The ranking sheet''s ID column. Informational only: NOT unique, NOT the identity key. Never '
  'upsert on this — see ADR-007 § Amendment. players.match_key is the canonical identity.';

-- Deliberately no replacement index. Dropping the UNIQUE constraint drops the index it implied, and
-- no read path needs one: the column is read only when an operator is eyeballing a row. Adding an
-- index for that would be speculative (Principle V, YAGNI).

-- rollback:
-- -- Restoring UNIQUE NOT NULL is only sound if the data still satisfies it. On a database that has
-- -- imported the real sheet it will not, because that is the entire reason for this migration. Fail
-- -- with an explanation naming the offending values rather than letting a bare duplicate-key error
-- -- stand in for one, and never resolve it by deleting rows: every row here is a real person.
-- do $$
-- declare
--   dupes text;
--   nulls bigint;
-- begin
--   select count(*) into nulls from players where external_id is null;
--   if nulls > 0 then
--     raise exception
--       'Cannot roll back 0006: % player row(s) have a null external_id. Restoring NOT NULL would '
--       'require inventing an identifier for a real person. Assign identifiers first.', nulls;
--   end if;
--
--   select string_agg(external_id::text, ', ' order by external_id) into dupes
--   from (select external_id from players group by external_id having count(*) > 1) d;
--   if dupes is not null then
--     raise exception
--       'Cannot roll back 0006: external_id values (%) are each held by more than one player. '
--       'Restoring UNIQUE would require deleting real people. Reassign identifiers first.', dupes;
--   end if;
-- end $$;
--
-- comment on column players.external_id is null;
-- alter table players alter column external_id set not null;
-- alter table players add constraint players_external_id_key unique (external_id);
