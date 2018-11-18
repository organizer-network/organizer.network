const config = require('./config');
const pg = require('pg');
const db = new pg.Client(config.db_dsn);
db.connect();

const self = {

	query: (sql, values) => {
		 return db.query(sql, values);
	},

	get_person: (id_or_slug) => {
		return new Promise(async (resolve, reject) => {

			try {

				let sql;
				const values = [id_or_slug];

				if (typeof id_or_slug == 'string') {
					sql = `
						SELECT *
						FROM person
						WHERE slug = $1
					`;
				} else if (typeof id_or_slug == 'number') {
					sql = `
						SELECT *
						FROM person
						WHERE id = $1
					`;
				} else {
					throw new Error('Argument should be a string or number type.');
				}

				const query = await db.query(sql, values);

				if (query.rows.length == 0) {
					// No person found, but we still resolve().
					return resolve(null);
				}

				return resolve(query.rows[0]);

			} catch(err) {
				console.log(sql, values);
				console.log(err.stack);
				reject(err);
			}

		});
	},

	get_context: (id_or_slug) => {
		return new Promise(async (resolve, reject) => {

			try {

				let sql;
				const values = [id_or_slug];

				if (typeof id_or_slug == 'string') {
					sql = `
						SELECT *
						FROM context
						WHERE slug = $1
					`;
				} else if (typeof id_or_slug == 'number') {
					sql = `
						SELECT *
						FROM context
						WHERE id = $1
					`;
				} else {
					throw new Error(`Argument ${id_or_slug} should be a string or number type.`);
				}

				const query = await db.query(sql, values);

				if (query.rows.length == 0) {
					// No context found, but we still resolve().
					return resolve(null);
				}

				resolve(query.rows[0]);

			} catch(err) {
				console.log(sql, values);
				console.log(err.stack);
				reject(err);
			}
		});
	},

	add_facets: (target, target_type, facet_type) => {
		return new Promise(async (resolve, reject) => {

			try {

				let sql;
				let facet_type_clause = '';
				const values = [target.id, target_type];

				if (facet_type) {
					facet_type_clause = 'AND facet_type = $3';
					values.push(facet_type);
				}

				sql = `
					SELECT *
					FROM facet
					WHERE target_id = $1
					  AND target_type = $2
					  ${facet_type_clause}
					ORDER BY facet_num
				`;
				const query = await db.query(sql, values);

				target.facets = {};

				for (let facet of query.rows) {
					if (facet.facet_num == -1) {
						target.facets[facet.facet_type] = facet.content;
					} else {
						if (! target.facets[facet.facet_type]) {
							target.facets[facet.facet_type] = [];
						}
						target.facets[facet.facet_type].push(facet.content);
					}
				}

				resolve(target);

			} catch(err) {
				console.log(sql, values);
				console.log(err.stack);
				reject(err);
			}

		});
	},

	set_facet: (target, target_type, facet_type, content, is_single) => {
		return new Promise(async (resolve, reject) => {

			try {

				let sql, values;
				let facet_num;

				await self.add_facets(target, target_type);

				if (is_single) {
					facet_num = -1;
					sql = `
						DELETE FROM facet
						WHERE target_id = $1
						  AND target_type = $2
						  AND facet_type = $3
					`;
					values = [target.id, target_type, facet_type];
					await db.query(sql, values);
				} else {
					facet_num = 0;
					if (target.facets[facet_type]) {
						facet_num = target.facets[facet_type].length;
					}
				}

				sql = `
					INSERT INTO facet
					(target_id, target_type, facet_type, facet_num, content, created, updated)
					VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
				`;
				values = [target.id, target_type, facet_type, facet_num, content];
				await db.query(sql, values);

				await self.add_facets(target, target_type);

				resolve(target);

			} catch(err) {
				console.log(sql, values);
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

module.exports = self;
