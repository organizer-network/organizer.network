ALTER TABLE person ADD COLUMN url VARCHAR(255);
ALTER TABLE member ADD COLUMN updated TIMESTAMP;
ALTER TABLE member DROP COLUMN id;
ALTER TABLE member ADD COLUMN leave_slug VARCHAR(255);
ALTER TABLE member ADD COLUMN invite_slug VARCHAR(255);
ALTER TABLE context ADD COLUMN parent_id INTEGER;

UPDATE person SET name = NULL WHERE name = email;
UPDATE member SET created = CURRENT_TIMESTAMP, updated = CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX member_leave_idx ON member (leave_slug);
CREATE UNIQUE INDEX member_invite_idx ON member (invite_slug);
