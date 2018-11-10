DROP INDEX IF EXISTS person_idx;
CREATE INDEX IF NOT EXISTS person_idx ON person (email, slug);
CREATE UNIQUE INDEX IF NOT EXISTS person_slug_idx ON person (slug);
CREATE UNIQUE INDEX IF NOT EXISTS context_slug_idx ON context (slug);
