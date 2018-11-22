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

app.use(require('./routes/home'));                // /
app.use(require('./routes/group_create'));        // /group
app.use(require('./routes/group_index'));         // /group/:slug
app.use(require('./routes/group_thread'));        // /group/:slug/:id
app.use(require('./routes/join'));                // /join/:slug
app.use(require('./routes/settings_index'));      // /settings
app.use(require('./routes/settings_group'));      // /settings/:slug
app.use(require('./routes/person_css'));          // /person.css
app.use(require('./routes/api/ping'));            // /api/ping
app.use(require('./routes/api/login'));           // /api/login
                                                  // /login/:slug
                                                  // /logout
app.use(require('./routes/api/group'));           // /api/group
app.use(require('./routes/api/group_messages'));  // /api/group/:slug
app.use(require('./routes/api/send'));            // /api/send
app.use(require('./routes/api/reply'));           // /api/reply
app.use(require('./routes/api/profile'));         // /api/profile
app.use(require('./routes/api/message'));         // /api/message
app.use(require('./routes/api/replies'));         // /api/replies
app.use(require('./routes/api/update'));          // /api/update
app.use(require('./routes/api/delete'));          // /api/delete
app.use(require('./routes/api/leave'));           // /api/leave

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

		if (utils.url_slug_match(req.path.substr(1))) {
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

module.exports = app;
