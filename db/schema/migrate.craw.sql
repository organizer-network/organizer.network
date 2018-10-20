CREATE TABLE IF NOT EXISTS email_tx (
	id VARCHAR(255) PRIMARY KEY,
	message_id INTEGER,
	person_id INTEGER,
	created TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_rx (
	id VARCHAR(255) PRIMARY KEY,
	message_id INTEGER,
	person_id INTEGER,
	content TEXT,
	headers TEXT,
	created TIMESTAMP
);
