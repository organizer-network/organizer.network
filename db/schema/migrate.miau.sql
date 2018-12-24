CREATE TABLE IF NOT EXISTS route (
	slug VARCHAR(255),
	target_id INTEGER NOT NULL,
	target_type VARCHAR(255) NOT NULL,
	type VARCHAR(255) DEFAULT 'active',
	updated TIMESTAMP,
	created TIMESTAMP
);
CREATE INDEX route_idx ON route (slug, target_id, target_type);
