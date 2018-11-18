const config = require('./config');
const pg = require('pg');
const db = new pg.Client(config.db_dsn);
db.connect();

module.exports = {

	query: (sql, values) => {
		 return db.query(sql, values);
	},

	get_person: (id_or_slug) => {
		return new Promise(async (resolve, reject) => {

			try {

				let query;

				if (typeof id_or_slug == 'string') {
					let slug = id_or_slug;
					query = await db.query(`
						SELECT *
						FROM person
						WHERE slug = $1
					`, [slug]);
				} else if (typeof id_or_slug == 'number') {
					let id = id_or_slug;
					query = await db.query(`
						SELECT *
						FROM person
						WHERE id = $1
					`, [id]);
				} else {
					throw new Error('Argument should be a string or number type.');
				}

				if (query.rows.length > 0) {
					return resolve(query.rows[0]);
				}

				return resolve(null);

			} catch(err) {
				console.log(err.stack);
				reject(err);
			}

		});
	},

	query_digest_members: () => {
		return db.query(`
			SELECT member.person_id, member.context_id
			FROM member, facet
			WHERE member.active = true
			  AND facet.target_id = member.id
			  AND facet.target_type = 'member'
			  AND facet.facet_type = 'email'
			  AND facet.content = 'digest'
		`);
	},

	query_digest_messages: (person, context) => {

		let values = [context_id, person_id];
		let facet = `last_digest_message_${context.id}`;

		let id_clause = '';
		if (person.facets && person.facets[facet]) {
			id_clause = 'AND message.id > $3';
			values.push(person.facets[facet]);
		}

		return db.query(`
			SELECT message.id, message.content, message.created,
				   message.in_reply_to, person.name
			FROM message, person
			WHERE message.context_id = $1
			  AND message.person_id != $2
			  AND message.created > CURRENT_TIMESTAMP - interval '1 day'
			  ${id_clause}
			  AND person.id = message.person_id
			ORDER BY message.created
		`, values);
	},

	get_digest_replies: (messages) => {
		return new Promise(async (resolve, reject) => {

			try {

				let placeholders = [];
				values = [];

				for (let message of messages) {
					if (message.in_reply_to) {
						placeholders.push('$' + (placeholders.length + 1));
						values.push(message.in_reply_to);
					}
				}

				if (values.length == 0) {
					return resolve([]);
				}

				placeholders = placeholders.join(', ');
				let sql = `
					SELECT id, content
					FROM message
					WHERE id IN (${placeholders})
				`;
				let query = await db.query(sql, values);

				resolve(query.rows);

			} catch(err) {
				console.log(sql, values);
				console.log(err.stack);
				reject(err);
			}

		});
	}

};
