ALTER TABLE person ALTER context_id DROP DEFAULT;
UPDATE person SET context_id = NULL;
