CREATE TABLE IF NOT EXISTS email_tx (
	id VARCHAR(255) PRIMARY KEY,
	context_id INTEGER,
	message_id INTEGER,
	person_id INTEGER,
	created TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_rx (
	id VARCHAR(255) PRIMARY KEY,
	context_id INTEGER,
	message_id INTEGER,
	person_id INTEGER,
	reply_json TEXT,
	created TIMESTAMP
);
