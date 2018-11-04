ALTER TABLE message_facet RENAME TO facet;
ALTER TABLE facet RENAME COLUMN message_id TO target_id;
ALTER TABLE facet RENAME COLUMN type TO facet_type;
ALTER TABLE facet RENAME COLUMN item_num TO facet_num;
ALTER TABLE facet ADD COLUMN target_type VARCHAR(255) NOT NULL;
ALTER TABLE member ADD COLUMN id SERIAL PRIMARY KEY;

DROP INDEX message_facet_idx;
CREATE INDEX facet_idx ON facet (target_id, target_type, facet_type, facet_num);

UPDATE facet SET target_type = 'message';
