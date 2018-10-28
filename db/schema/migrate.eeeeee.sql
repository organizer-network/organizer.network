CREATE TABLE IF NOT EXISTS message_facet (
	message_id INTEGER,
	type VARCHAR(255),
	item_num INTEGER,
	content TEXT,
	created TIMESTAMP,
	updated TIMESTAMP
);
CREATE INDEX message_facet_idx ON message_facet (message_id);
