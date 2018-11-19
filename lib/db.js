const config = require('../config');
const pg = require('pg');
const pool = pg.Pool({
	connectionString: config.db_dsn
});

const self = {

	pool: () => {
		return pool;
	},

	end: () => {
		pool.end();
	},

	query: (sql, values) => {
		return new Promise((resolve, reject) => {
			pool.query(sql, values, (err, res) => {
				if (err) {
					console.log(sql.replace(/\t/g, ''), values || '');
					return reject(err);
				}
				resolve(res);
			});
		});
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
					throw new Error('id_or_slug should be a string or number type.');
				}

				const query = await self.query(sql, values);

				if (query.rows.length == 0) {
					// No person found, but we still resolve().
					return resolve(null);
				}

				return resolve(query.rows[0]);

			} catch(err) {
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
					throw new Error(`id_or_slug should be a string or number type.`);
				}

				const query = await self.query(sql, values);

				if (query.rows.length == 0) {
					// No context found, but we still resolve().
					return resolve(null);
				}

				resolve(query.rows[0]);

			} catch(err) {
				reject(err);
			}
		});
	},

	add_facets: (target, target_type, facet_type) => {
		return new Promise(async (resolve, reject) => {

			try {

				let sql;
				const values = [target.id, target_type];

				let facet_type_clause = '';

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
				const query = await self.query(sql, values);

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
					await self.query(sql, values);
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
				await self.query(sql, values);

				await self.add_facets(target, target_type);

				resolve(target);

			} catch(err) {
				reject(err);
			}

		});
	},

	get_digest_members: () => {
		return new Promise(async (resolve, reject) => {

			let sql = `
				SELECT member.person_id, member.context_id
				FROM member, facet
				WHERE member.active = true
				  AND facet.target_id = member.id
				  AND facet.target_type = 'member'
				  AND facet.facet_type = 'email'
				  AND facet.content = 'digest'
			`;

			try {

				let query = await self.query(sql);
				resolve(query.rows);

			} catch(err) {
				reject(err);
			}
		});
	},

	get_digest_messages: (person, context) => {
		return new Promise(async (resolve, reject) => {

			let sql;
			const values = [context.id, person.id];

			try {
				let facet = `last_digest_message_${context.id}`;

				let id_clause = '';
				if (person.facets && person.facets[facet]) {
					id_clause = 'AND message.id > $3';
					values.push(person.facets[facet]);
				}

				sql = `
					SELECT message.id, message.content, message.created,
						   message.in_reply_to, person.name
					FROM message, person
					WHERE message.context_id = $1
					  AND message.person_id != $2
					  AND message.created > CURRENT_TIMESTAMP - interval '1 day'
					  ${id_clause}
					  AND person.id = message.person_id
					ORDER BY message.created
				`;

				let query = await self.query(sql, values);
				resolve(query.rows);

			} catch(err) {
				reject(err);
			}
		});
	},

	get_digest_replies: (messages) => {
		return new Promise(async (resolve, reject) => {

			let sql, values;

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
				sql = `
					SELECT id, content
					FROM message
					WHERE id IN (${placeholders})
				`;
				let query = await self.query(sql, values);

				resolve(query.rows);

			} catch(err) {
				reject(err);
			}

		});
	}

};

module.exports = self;
