const config = require('../config');
const utils = require('../lib/utils');

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

	curr_person: (req) => {
		return new Promise(async (resolve, reject) => {

			try {

				if ('session' in req &&
				    'person' in req.session) {

					let query = await self.query(`
						SELECT *
						FROM person
						WHERE id = $1
					`, [req.session.person.id]);

					if (query.rows.length > 0) {
						return resolve(query.rows[0]);
					}
				}

				resolve(null);

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

	get_contexts: (person, message_id) => {
		return new Promise(async (resolve, reject) => {

			try {

				let query;
				const contexts = {};

				if (person) {

					query = await self.query(`
						SELECT context.*
						FROM member, context
						WHERE member.active = true
						  AND member.person_id = $1
						  AND member.context_id = context.id
					`, [person.id]);

					contexts.member_of = query.rows;

					let subgroups = {};
					for (let context of contexts.member_of) {
						if (context.parent_id) {
							if (! subgroups[context.parent_id]) {
								subgroups[context.parent_id] = [];
							}
							subgroups[context.parent_id].push(context);
						}
					}

					for (let context of contexts.member_of) {
						if (subgroups[context.id]) {
							context.subgroups = subgroups[context.id];
						} else {
							context.subgroups = [];
						}
					}

					let thread = null;
					let context_id = null;

					if (person.context_id) {
						context_id = person.context_id;
					}

					if (message_id) {
						query = await self.query(`
							SELECT message.*,
								   person.slug AS person_slug, person.name AS person_name
							FROM message, person
							WHERE (message.id = $1 OR in_reply_to = $1)
							  AND message.person_id = person.id
							ORDER BY created
						`, [message_id]);
						thread = query.rows;
						context_id = thread[0].context_id;
					}

					if (context_id) {

						query = await self.query(`
							SELECT *
							FROM context
							WHERE id = $1
						`, [context_id]);

						let current = query.rows[0];

						if (thread) {
							current.thread = thread;
						}

						contexts.current = await self.add_context_details(current);
					}
				}

				resolve(contexts);

			} catch(err) {
				reject(err);
			}
		});
	},

	add_context_details: (context, before_id) => {
		return new Promise(async (resolve, reject) => {

			try {

				let query;

				if (! context) {
					return resolve(context);
				}

				if (context.thread) {

					await self.add_message_details(context.thread);
					context.messages = context.thread.splice(0, 1);
					context.messages[0].replies = context.thread;

				} else {

					let before_clause = '';
					let values = [context.id];
					if (before_id) {
						before_clause = 'AND message.id < $2';
						values.push(before_id);
					}

					query = await self.query(`
						SELECT message.*,
						       person.name AS person_name, person.slug AS person_slug
						FROM message, person
						WHERE message.context_id = $1
						  ${before_clause}
						  AND message.person_id = person.id
						  AND message.in_reply_to IS NULL
						ORDER BY message.created DESC
						LIMIT 10
					`, values);

					context.messages = query.rows;

					query = await self.query(`
						SELECT COUNT(id) AS total_messages
						FROM message
						WHERE context_id = $1
						  AND in_reply_to IS NULL
					`, [context.id]);

					context.total_messages = query.rows[0].total_messages;
					await self.add_topic_revision(context);
					await self.add_message_details(context.messages);
				}

				query = await self.query(`
					SELECT member.person_id, person.name, person.slug
					FROM member, person
					WHERE member.active = true
					  AND member.context_id = $1
					  AND member.person_id = person.id
					ORDER BY member.updated DESC
				`, [context.id]);

				context.members = query.rows;

				query = await self.query(`
					SELECT *
					FROM context
					WHERE parent_id = $1
				`, [context.id]);
				context.subgroups = query.rows;

				if (context.parent_id) {
					context.parent = await self.get_context(context.parent_id);
				}

				resolve(context);

			} catch(err) {
				reject(err);
			}
		});
	},

	add_topic_revision: function(context) {
		return new Promise(async (resolve, reject) => {

			try {

				await self.add_facets(context, 'context', 'topic_revision');
				if (context.raw_facets['topic_revision'] &&
				    context.raw_facets['topic_revision'].length > 0) {
					let rev = context.raw_facets['topic_revision'].pop();
					rev.content = JSON.parse(rev.content);
					let person_id = rev.content.person_id;
					let person = await self.get_person(person_id);
					context.topic_revision = {
						person: person,
						topic: rev.content.topic,
						updated: rev.updated.toJSON()
					};
				}

				resolve(context);

			} catch(err) {
				reject(err);
			}
		});
	},

	add_message_details: (messages) => {
		return new Promise(async (resolve, reject) => {

			try {

				if (! 'length' in messages || messages.length == 0) {
					return resolve(messages);
				}

				let ids = messages.map(msg => msg.id);
				let placeholders = [];
				for (let i = 0; i < ids.length; i++) {
					placeholders.push('$' + (i + 1));
				}

				placeholders = placeholders.join(', ');

				let query = await self.query(`
					SELECT in_reply_to AS id,
						   COUNT(id) AS reply_count
					FROM message
					WHERE in_reply_to IN (${placeholders})
					GROUP BY in_reply_to
				`, ids);

				let replies = {};
				for (let reply of query.rows) {
					replies[reply.id] = reply.reply_count;
				}

				query = await self.query(`
					SELECT target_id, content, created
					FROM facet
					WHERE target_id IN (${placeholders})
					  AND target_type = 'message'
					  AND facet_type = 'revision'
					ORDER BY created DESC
				`, ids);

				let revisions = {};
				for (let revision of query.rows) {

					revision.created = new Date(revision.created).toISOString();

					if (! revisions[revision.target_id]) {
						revisions[revision.target_id] = [];
					}
					revisions[revision.target_id].push({
						created: revision.created,
						content: revision.content
					});
				}

				for (let message of messages) {

					message.created = new Date(message.created).toISOString();
					message.updated = new Date(message.updated).toISOString();

					if (message.id in replies) {
						message.reply_count = replies[message.id];
					} else {
						message.reply_count = 0;
					}

					if (revisions[message.id]) {
						message.revisions = revisions[message.id];
					} else {
						message.revisions = [];
					}
					message.revisions.unshift({
						created: message.updated,
						content: message.content
					});
					message.revision_dates = message.revisions.map(rev => rev.created);
				}

				resolve(messages);

			} catch(err) {
				reject(err);
			}
		});
	},

	get_latest_messages: (contexts) => {
		return new Promise((resolve, reject) => {

			try {

				let promises = [];
				let ids = contexts.map(ctx => parseInt(ctx.id));
				for (id of ids) {
					promises.push(self.get_context_latest_message(id));
				}

				Promise.all(promises)
					.then(messages => {
						let latest = {};
						for (msg of messages) {
							if (msg) {
								latest[msg.context_id] = msg;
							}
						}
						resolve(latest);
					})
					.catch(err => reject(err));

			} catch (err) {
				reject(err);
			}
		});
	},

	get_context_latest_message: function(context_id) {
		return new Promise(async (resolve, reject) => {

			try {
				let query = await self.query(`
					SELECT message.id, message.context_id,
					       message.content, message.created,
					       person.name AS person_name, person.slug AS person_slug
					FROM message, person
					WHERE message.person_id = person.id
					  AND message.context_id = $1
					ORDER BY message.created DESC
					LIMIT 1
				`, [context_id]);

				resolve(query.rows[0]);

			} catch(err) {
				reject(err);
			}

		});
	},

	set_context: (person, context) => {
		if (person.context_id != context.id) {
			person.context_id = context.id;
			self.query(`
				UPDATE person
				SET context_id = $1
				WHERE id = $2
			`, [context.id, person.id]);
		}
	},

	join_context: (person, context_id, invited_by) => {
		return new Promise(async (resolve, reject) => {

			try {

				await self.query(`
					UPDATE person
					SET context_id = $1
					WHERE id = $2
				`, [context_id, person.id]);

				let member = await self.get_member(person, context_id);
				if (member) {
					return resolve(member);
				}

				let leave_slug = utils.random(16);
				let invite_slug = utils.random(16);
				let query;

				if (invited_by) {
					query = await self.query(`
						INSERT INTO member
						(person_id, context_id, leave_slug, invite_slug, invited_by, created, updated)
						VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
						RETURNING *
					`, [person.id, context_id, leave_slug, invite_slug, invited_by]);
				} else {
					query = await self.query(`
						INSERT INTO member
						(person_id, context_id, leave_slug, invite_slug, created, updated)
						VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
						RETURNING *
					`, [person.id, context_id, leave_slug, invite_slug]);
				}

				member = query.rows[0];
				return resolve(member);

			} catch (err) {
				reject(err);
			}

		});
	},

	get_invite: (slug) => {
		return new Promise(async (resolve, reject) => {
			try {
				let query = await self.query(`
					SELECT *
					FROM member
					WHERE active = true
					  AND invite_slug = $1
				`, [slug]);

				let invite;

				if (query.rows.length == 0) {
					resolve(false);
				} else {
					invite = query.rows[0];
					invite.person = await self.get_person(invite.person_id);
					invite.context = await self.get_context(invite.context_id);
					resolve(invite);
				}
			} catch(err) {
				reject(err);
			}
		});
	},

	get_member: (person, context_id, include_inactive) => {
		return new Promise(async (resolve, reject) => {

			try {

				if (! person) {
					return resolve(false);
				}

				let query = await self.query(`
					SELECT *
					FROM member
					WHERE person_id = $1
					  AND context_id = $2
				`, [person.id, context_id]);


				if (query.rows.length == 0) {
					return resolve(false);
				}

				let member = query.rows[0];

				if (! member.active && ! include_inactive) {
					return resolve(false);
				}

				await self.add_facets(member, 'member');

				resolve(member);

			} catch(err) {
				reject(err);
			}
		});
	},

	get_message: (id, revision) => {
		return new Promise(async (resolve, reject) => {

			try {

				id = parseInt(id);
				let query = await self.query(`
					SELECT message.*,
						   person.name AS person_name, person.slug AS person_slug,
						   context.slug AS context_slug
					FROM message, person, context
					WHERE message.id = $1
					  AND message.person_id = person.id
					  AND message.context_id = context.id
				`, [id]);

				if (query.rows.length == 0) {
					// No message found, but we still resolve().
					return resolve(null);
				}

				let message = query.rows[0];
				await self.add_message_details([message]);

				if (revision) {
					message.revision = revision;
					message.content = message.revisions[revision].content;
				}

				resolve(message);

			} catch(err) {
				console.log(err.stack);
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

				if (! facet_type) {
					target.facets = {};
					target.raw_facets = {};
				} else {
					if (! target.facets) {
						target.facets = {};
					} else if (facet_type in target.facets) {
						delete target.facets[facet_type];
					}
					if (! target.raw_facets) {
						target.raw_facets = {};
					} else if (facet_type in target.raw_facets) {
						delete target.raw_facets[facet_type];
					}
				}

				for (let facet of query.rows) {
					if (facet.facet_num == -1) {
						target.facets[facet.facet_type] = facet.content;
					} else {
						if (! target.facets[facet.facet_type]) {
							target.facets[facet.facet_type] = [];
						}
						target.facets[facet.facet_type].push(facet.content);
					}
					if (! target.raw_facets[facet.facet_type]) {
						target.raw_facets[facet.facet_type] = [];
					}
					target.raw_facets[facet.facet_type].push(facet);
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
