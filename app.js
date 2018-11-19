// organizer.network
// v0.1.0 "jiji"

// versioning based on Tom Gauld's A Noisy Alphabet
// http://myjetpack.tumblr.com/post/65442529656/a-noisy-alphabet-a-new-screenprint-by-tom

const utils = require('./lib/utils');
utils.check_config();

const config = require('./config');
const db = require('./lib/db');
const notify = require('./lib/notify');

// server
const express = require('express');
const app = express();

const body_parser = require('body-parser');
const session = require('express-session');
const pg_session = require('connect-pg-simple')(session);

const slug_regex = /^[a-z][a-z0-9_-]+$/i;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(body_parser.urlencoded({ extended: false }));
app.use(body_parser.json());
app.use(session({
	store: new pg_session({
		pool: db.pool()
	}),
	secret: config.session_secret,
	resave: false,
	saveUninitialized: false,
	proxy: true,
	cookie: {
		secure: false,
		maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
	}
}));
app.use((req, rsp, next) => {
	rsp.append('X-Frame-Options', 'deny');
	rsp.append('Cache-Control', 'no-cache,no-store');
	rsp.append('Pragma', 'no-cache');
	rsp.append('X-Content-Type-Options', 'nosniff');
	rsp.append('X-XSS-Protection', '1; mode=block');
	rsp.append('Content-Security-Policy', "default-src 'self';");
	next();
});
app.enable('trust proxy');

app.use(require('./routes/home'));				// /
app.use(require('./routes/group_create'));		// /group
app.use(require('./routes/group_index'));		// /group/:slug
app.use(require('./routes/group_thread'));		// /group/:slug/:id
app.use(require('./routes/join'));				// /join/:slug
app.use(require('./routes/settings_index'));	// /settings
app.use(require('./routes/settings_group'));	// /settings/:slug
app.use(require('./routes/person_css'));		// /person.css
app.use(require('./routes/api/ping'));			// /api/ping
app.use(require('./routes/api/login'));			// /api/login
												// /login/:slug
												// /logout




app.post('/api/group', async (req, rsp) => {

	try {

		if (! req.body.name ||
		    ! req.body.slug) {
			return rsp.status(400).send({
				ok: false,
				error: "Please include a name and a URL slug."
			});
		}

		let name = req.body.name;
		let slug = req.body.slug;
		let topic = req.body.topic || '';
		let parent_id = parseInt(req.body.parent_id) || null;

		if (! slug.match(slug_regex)) {
			return rsp.status(400).send({
				ok: false,
				error: "The URL format is: at least 2 letters, numbers, hyphens, or underscores."
			});
		}

		if (parent_id) {
			let parent = await db.get_context(parent_id);
			slug = `${parent.slug}/${slug}`;
		}

		let person = await db.curr_person(req);
		if (! person) {
			return rsp.status(403).send({
				ok: false,
				error: "You must be signed in to create a group."
			});
		}

		let context = await db.get_context(slug);
		if (context) {
			return rsp.status(400).send({
				ok: false,
				error: "Sorry, that group URL is already taken."
			});
		}

		let query = await db.query(`
			INSERT INTO context
			(name, slug, topic, parent_id, created)
			VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
			RETURNING *
		`, [name, slug, topic, parent_id]);

		let group = query.rows[0];

		await db.join_context(person, group.id);

		rsp.send({
			ok: true,
			group: group
		});

	} catch(err) {
		console.log(err.stack);
		return rsp.status(500).send({
			ok: false,
			error: "Could not create a new group."
		});
	}

});

app.post('/api/send', async (req, rsp) => {

	if (! 'body' in req ||
	    ! 'content' in req.body ||
	    req.body.content == '') {
		return rsp.status(400).send({
			ok: false,
			error: "You gotta type something in."
		});
	}

	if (! 'body' in req ||
	    ! 'context' in req.body) {
		return rsp.status(400).send({
			ok: false,
			error: "Please include a 'context' arg."
		});
	}

	try {

		let content = req.body.content.trim();
		let context_id = parseInt(req.body.context_id);

		let in_reply_to = null;
		if ('in_reply_to' in req.body) {
			in_reply_to = parseInt(req.body.in_reply_to);
		}

		let person = await db.curr_person(req);
		let member = await db.get_member(person, context_id);

		if (! member) {
			return rsp.status(403).send({
				ok: false,
				error: "You cannot send messages to that context."
			});
		}

		let message = await send_message(person, context_id, in_reply_to, content);
		return rsp.send({
			ok: true,
			message: message
		});

	} catch(err) {
		console.log(err.stack);
		return rsp.status(500).send({
			ok: false,
			error: "Could not send message."
		});
	}

});

const multer = require('multer');
const upload = multer();

app.post('/api/reply', upload.none(), async (req, rsp) => {

	try {

		let reply = req.body;

		let id = reply.headers.match(/Message-Id: <([^@]+)@/i);
		let in_reply_to = reply.headers.match(/In-Reply-To: <([^@]+)@/i);

		let context_id = -1;
		let message_id = -1;
		let person_id = -1;

		if (! id || ! in_reply_to) {
			console.log('Could not parse reply.');
			console.log(reply);
			return;
		}

		id = id[1];
		in_reply_to = in_reply_to[1];

		let lines = reply.text.trim().split('\n');
		let content = [];
		let quoted = [];

		for (let line of lines) {
			if (line.match(/^>/)) {
				quoted.push(line);
			} else if (line.match(/^(>\s*)*---$/)) {
				break;
			} else {
				if (quoted.length > 0) {
					content = content.concat(quoted);
					quoted = [];
				}
				content.push(line);
			}
		}

		content = content.join('\n').trim();

		let query = await db.query(`
			SELECT *
			FROM email_tx
			WHERE id = $1
		`, [in_reply_to]);

		if (query.rows.length > 0) {
			let email_tx = query.rows[0];

			context_id = parseInt(email_tx.context_id);
			person_id = parseInt(email_tx.person_id);
			in_reply_to = parseInt(email_tx.message_id);

			// See also: https://github.com/organizer-network/organizer.network/issues/2
			// (20181027/dphiffer)
			let in_reply_to_msg = await get_message(in_reply_to);
			if (in_reply_to_msg.in_reply_to) {
				in_reply_to = parseInt(in_reply_to_msg.in_reply_to);
			}

			let person = await db.get_person(person_id);
			let message = await send_message(person, context_id, in_reply_to, content);
			message_id = message.id;
		}

		let reply_json = JSON.stringify(reply);

		await db.query(`
			INSERT INTO email_rx
			(id, message_id, person_id, reply_json, created)
			VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
		`, [id, message_id, person_id, reply_json]);

		rsp.send({
			'ok': true
		});

	} catch(err) {
		console.log(err.stack);
		rsp.status(500).send({
			'ok': false
		});
	}

});

app.post('/api/profile', async (req, rsp) => {

	try {

		if (! 'body' in req ||
		    ! 'id' in req.body ||
		    ! 'name' in req.body ||
		    ! 'about' in req.body ||
		    ! 'slug' in req.body ||
		    req.body.content == '') {
			return rsp.status(400).send({
				ok: false,
				error: "Please include 'id', 'name', 'about', and 'slug' params."
			});
		}

		let person = await db.curr_person(req);
		if (person.id !== parseInt(req.body.id)) {
			return rsp.status(403).send({
				ok: false,
				error: "You are only allowed to edit your own profile."
			});
		}

		if (req.body.name == '') {
			return rsp.status(400).send({
				ok: false,
				error: "Please include a non-empty name."
			});
		}

		if (! req.body.slug.match(slug_regex)) {
			return rsp.status(400).send({
				ok: false,
				error: "The URL format is: at least 2 letters, numbers, hyphens, or underscores."
			});
		}

		let person_with_slug = await db.get_person(req.body.slug);
		if (person_with_slug && person_with_slug.id !== person.id) {
			return rsp.status(400).send({
				ok: false,
				error: "That profile URL is already taken."
			});
		}

		await db.query(`
			UPDATE person
			SET name = $1, about = $2, slug = $3
			WHERE id = $4
		`, [req.body.name, req.body.about, req.body.slug, req.body.id]);

		person = await db.curr_person(req);

		return rsp.send({
			ok: true,
			person: person
		});

	} catch(err) {
		console.log(err.stack);
		return rsp.status(500).send({
			ok: false,
			error: "Could not update profile."
		});
	}
});

app.get('/api/message/:id', async (req, rsp) => {

	try {
		let id = parseInt(req.params.id);
		let revision = req.query.revision || null;
		let message = await get_message(id, revision);

		if (! message) {
			return rsp.status(404).send({
				ok: false,
				error: 'Message not found.'
			});
		}

		let person = await db.curr_person(req);
		let member = await db.get_member(person, message.context_id);

		if (! member) {
			return rsp.status(403).send({
				ok: false,
				error: 'You are not authorized to load that message.'
			});
		}

		if (req.query.format == 'html') {
			rsp.render('message', {
				message: message,
				context: {
					slug: message.context_slug
				},
				member: member
			});
		} else {
			rsp.send({
				ok: true,
				message: message
			});
		}

	} catch (err) {
		console.log(err.stack);
		return utils.error_page(rsp, '500');
	}
});

app.get('/api/replies/:id', async (req, rsp) => {

	try {
		let query = await db.query(`
			SELECT message.*,
			       person.name AS person_name, person.slug AS person_slug,
			       context.slug AS context_slug
			FROM message, person, context
			WHERE message.id = $1
			  AND message.person_id = person.id
			  AND message.context_id = context.id
		`, [req.params.id]);

		if (query.rows.length == 0) {
			return rsp.status(404).send({
				ok: false,
				error: 'Message not found.'
			});
		}

		let message = query.rows[0];
		await db.get_message_details([message]);

		let person = await db.curr_person(req);
		let member = await db.get_member(person, message.context_id);

		query = await db.query(`
			SELECT message.*,
			       person.name AS person_name, person.slug AS person_slug
			FROM message, person
			WHERE message.in_reply_to = $1
			  AND message.person_id = person.id
			ORDER BY message.created
		`, [req.params.id]);

		message.replies = query.rows;
		await db.get_message_details(message.replies);

		rsp.render('replies', {
			message: message,
			context: {
				id: message.context_id,
				slug: message.context_slug
			},
			member: member
		});

	} catch (err) {
		console.log(err.stack);
		return utils.error_page(rsp, '500');
	}
});

app.post('/api/delete', async (req, rsp) => {

	try {

		let id = req.body.id;
		if (! id) {
			return rsp.status(400).send({
				ok: false,
				error: "Please include a message 'id' param."
			});
		}

		let person = await db.curr_person(req);
		let message = await get_message(id);
		if (message.person_id != person.id) {
			return rsp.status(403).send({
				ok: false,
				error: "You cannot delete other people's messages."
			});
		}

		await db.query(`
			DELETE FROM message
			WHERE id = $1
		`, [id]);

		await db.query(`
			DELETE FROM facet
			WHERE target_id = $1
			  AND type = 'message'
		`, [id]);

		console.log(`Deleted message ${message.id} by ${person.slug} (${person.id}): ${message.content}`);

		rsp.send({
			ok: true
		});

	} catch(err) {
		console.log(err.stack);
		rsp.status(500).send({
			ok: false,
			error: 'Could not delete message.'
		});
	}

});

app.post('/api/update', async (req, rsp) => {

	try {

		let id = req.body.id;
		let content = req.body.content;
		if (! id || ! content) {
			return rsp.status(400).send({
				ok: false,
				error: "Please include message 'id' and 'content' params."
			});
		}

		let person = await db.curr_person(req);
		let message = await get_message(id);

		if (message.person_id != person.id) {
			return rsp.status(403).send({
				ok: false,
				error: "You cannot edit other people's messages."
			});
		}

		await db.query(`
			INSERT INTO facet
			(target_id, target_type, facet_type, content, created, updated)
			VALUES ($1, 'message', 'revision', $2, $3, CURRENT_TIMESTAMP)
		`, [id, message.content, message.updated]);

		await db.query(`
			UPDATE message
			SET content = $1,
			    updated = CURRENT_TIMESTAMP
			WHERE id = $2
		`, [content, id]);

		message = await get_message(id);

		rsp.send({
			ok: true,
			message: message
		});

	} catch(err) {
		console.log(err.stack);
		rsp.status(500).send({
			ok: false,
			error: 'Could not update message.'
		});
	}

});

app.get('/api/group/:slug', async (req, rsp) => {

	try {

		let person = await db.curr_person(req);

		if (! person) {
			return rsp.status(403).send({
				ok: false,
				error: 'You must be signed in to load group content.'
			});
		}

		let context = await db.get_context(req.params.slug);

		if (! context) {
			return rsp.status(404).send({
				ok: false,
				error: 'Group not found.'
			});
		}

		let member = await db.get_member(person, context.id);

		if (! member) {
			return rsp.status(403).send({
				ok: false,
				error: 'You are not authorized to load that group content.'
			});
		}

		let before_id = null;
		if ('before_id' in req.query) {
			before_id = parseInt(req.query.before_id);
		}
		await db.get_context_details(context, before_id);

		rsp.render('message-page', {
			context: context,
			member: member
		});

	} catch(err) {
		console.log(err.stack);
		rsp.status(500).send({
			ok: false,
			error: 'Could not load group messages.'
		});
	}

});

app.get('/leave/:id', async (req, rsp) => {

	try {

		let query = await db.query(`
			SELECT member.leave_slug, member.person_id, member.context_id,
			       context.name AS context_name
			FROM member, context
			WHERE member.active = true
			  AND member.leave_slug = $1
			  AND member.context_id = context.id
		`, [req.params.id]);

		if (query.rows.length < 1) {
			return utils.error_page(rsp, 'invalid-unsubscribe');
		}

		let member = query.rows[0];

		await db.query(`
			UPDATE member
			SET active = false
			WHERE leave_slug = $1
		`, [member.leave_slug]);

		await db.query(`
			UPDATE person
			SET context_id = NULL
			WHERE id = $1
			  AND context_id = $2
		`, [member.person_id, member.context_id]);

		let context = await db.get_context(member.context_id);

		rsp.redirect(`/group/${context.slug}`);

	} catch(err) {
		console.log(err.stack);
		return utils.error_page(rsp, '500');
	}

});

app.post('/api/join', async (req, rsp) => {

	try {

		if (! req.body.context_id) {
			return rsp.status(400).send({
				ok: false,
				error: "Please include a 'context_id' param."
			});
		}

		let person = await db.curr_person(req);
		if (! person) {
			return rsp.status(403).send({
				ok: false,
				error: 'You must be signed in to join groups.'
			});
		}

		let context_id = parseInt(req.body.context_id);
		let member = await db.get_member(person, context_id, 'include_inactive');
		if (! member) {

			let context = await db.get_context(context_id);
			if (context.parent_id) {
				let parent_member = await db.get_member(person, context.parent_id);
				if (parent_member) {
					await db.join_context(person, context_id);
					return rsp.send({
						ok: true
					});
				}
			}

			return rsp.status(403).send({
				ok: false,
				error: 'Sorry you cannot join that group.'
			});
		}

		await db.query(`
			UPDATE member
			SET active = true
			WHERE person_id = $1
			  AND context_id = $2
		`, [person.id, context_id]);

		await db.query(`
			UPDATE person
			SET context_id = $1
			WHERE id = $2
		`, [context_id, person.id]);

		rsp.send({
			ok: true
		});

	} catch(err) {
		console.log(err.stack);
		rsp.status(500).send({
			ok: false,
			error: 'Could not join group.'
		});
	}

});

app.post('/api/settings', async (req, rsp) => {

	try {

		if (! req.body.context_id) {
			return rsp.status(400).send({
				ok: false,
				error: 'Please include a context_id argument.'
			});
		}

		var person = await db.curr_person(req);
		var context = await db.get_context(parseInt(req.body.context_id));

		if (! person || ! context) {
			return rsp.status(400).send({
				ok: false,
				error: 'Invalid context or person record.'
			});
		}

		var member = await db.get_member(person, context.id);

		if (! member) {
			return rsp.status(403).send({
				ok: false,
				error: 'You are not a member of that group.'
			});
		}

		const valid_email_values = [
			'send',
			'digest',
			'none'
		];

		if (! req.body.email in valid_email_values) {
			return rsp.status(400).send({
				ok: false,
				error: 'Invalid email setting.'
			});
		}

		await db.set_facet(member, 'member', 'email', req.body.email, 'single');

		rsp.send({
			ok: true,
			group_url: '/group/' + context.slug
		});

	} catch(err) {
		console.log(err.stack);
		rsp.status(500).send({
			ok: false,
			error: 'Could not update settings.'
		});
	}

});

app.use(async (req, rsp) => {

	try {

		let curr_id = null;
		let curr = await db.curr_person(req);
		if (curr) {
			curr_id = curr.id;
		}

		if (req.path.substr(1).match(slug_regex)) {
			let person = await db.get_person(req.path.substr(1));
			if (person) {
				let then = req.query.then;
				if (then && ! (/^\//)) {
					then = null;
				}
				rsp.render('page', {
					title: person.name || 'Profile',
					view: 'profile',
					content: {
						person: person,
						edit: (req.query.edit == '1'),
						base_url: config.base_url,
						curr_id: curr_id,
						then: then
					}
				});
				return;
			}
		}

		rsp.status(404);
		utils.error_page(rsp, '404');

	} catch(err) {
		console.log(err.stack);
		return utils.error_page(rsp, '500');
	}
});

function send_message(person, context_id, in_reply_to, content) {
	return new Promise(async (resolve, reject) => {

		try {

			let query = await db.query(`
				INSERT INTO message
				(person_id, context_id, in_reply_to, content, created, updated)
				VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
				RETURNING *
			`, [person.id, context_id, in_reply_to, content]);

			let message = query.rows[0];
			await db.get_message_details([message]);

			resolve(message);

			let from = config.email_from;
			let email_match = from.match(/<([^>]+)>/);

			if (email_match) {
				from = `"${person.name}" <${email_match[1]}>`;
			} else {
				// This is assuming config.from_email is set to an email address
				// without a "name" part, e.g. 'foo@bar.com'
				from = `"${person.name}" <${from}>`;
			}

			send_notifications(person, message, from);
			await db.query(`
				UPDATE member
				SET updated = CURRENT_TIMESTAMP
				WHERE person_id = $1
				  AND context_id = $2
			`, [person.id, context_id]);

		} catch(err) {
			console.log(err.stack);
			reject(err);
		}
	});
}

async function send_notifications(sender, message, from) {

	try {

		let query = await db.query(`
			SELECT member.id, member.invite_slug, member.leave_slug,
			       person.id AS person_id, person.email, person.name,
			       context.name AS context_name, context.slug AS context_slug
			FROM member, person, context
			WHERE member.context_id = $1
			  AND member.active = true
			  AND member.person_id != $2
			  AND person.id = member.person_id
			  AND context.id = member.context_id
		`, [message.context_id, message.person_id]);

		let members = query.rows;

		let placeholders = [];
		let values = [];
		for (let member of members) {
			values.push(member.id);
			placeholders.push(`$${values.length}`);
		}
		let email_settings = {};

		if (values.length > 0) {
			placeholders = placeholders.join(', ');
			query = await db.query(`
				SELECT target_id, content
				FROM facet
				WHERE target_id IN (${placeholders})
				  AND target_type = 'member'
				  AND facet_type = 'email'
			`, values);

			for (let facet of query.rows) {
				email_settings[facet.target_id] = facet.content;
			}
		}

		let subject = message.content;
		if (message.in_reply_to) {
			query = await db.query(`
				SELECT content
				FROM message
				WHERE id = $1
			`, [message.in_reply_to]);
			subject = `Re: ${query.rows[0].content}`;
		}
		subject = subject.replace(/\s+/g, ' ');
		if (subject.length > 48) {
			subject = subject.substr(0, 48) + '...';
		}

		for (let member of members) {

			if (email_settings[member.id] &&
			    email_settings[member.id] != 'send') {
				continue;
			}

			let message_link = `${config.base_url}/group/${member.context_slug}/${message.id}`;
			if (message.in_reply_to) {
				message_link = `${config.base_url}/group/${member.context_slug}/${message.in_reply_to}#${message.id}`;
			}

			let body = `${message.content}

---
Message link:
${message_link}

Too many emails? Update your notification settings:
${config.base_url}/settings

Unsubscribe from ${member.context_name}:
${config.base_url}/leave/${member.leave_slug}`;

			let rsp = await notify.send_email(member.email, subject, body, from);

			if (rsp && rsp.length > 0 && rsp[0].headers) {
				let email_id = rsp[0].headers['x-message-id'];
				db.query(`
					INSERT INTO email_tx
					(id, context_id, message_id, person_id, created)
					VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
				`, [email_id, message.context_id, message.id, member.person_id]);
			}

		}

	} catch(err) {
		console.log(err.stack);
	}
}

function get_message(id, revision) {
	return new Promise(async (resolve, reject) => {

		try {

			id = parseInt(id);
			let query = await db.query(`
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
			await db.get_message_details([message]);

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
}

module.exports = app;
