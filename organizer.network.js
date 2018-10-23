// organizer.network
// v0.0.3 "craw"

// versioning based on Tom Gauld's A Noisy Alphabet
// http://myjetpack.tumblr.com/post/65442529656/a-noisy-alphabet-a-new-screenprint-by-tom

// config.js
const fs = require('fs');
const path = require('path');
if (! fs.existsSync(`${__dirname}/config.js`)) {
	console.log('Please set up config.js');
	return;
}
const config = require('./config.js');

// server
const express = require('express');
const app = express();
var server;

if ('ssl' in config) {
	// Setup HTTPS server
	let https_options = {};
	for (let key in config.ssl) {
		https_options[key] = fs.readFileSync(`${__dirname}/${config.ssl[key]}`);
	}
	server = require('https').createServer(https_options, app);
} else {
	// Setup HTTP server
	server = require('http').createServer(app);
}

const io = require('socket.io')(server);
const body_parser = require('body-parser');
const marked = require('marked');
const yaml = require('js-yaml');
const mime = require('mime');
const sharp = require('sharp');
const session = require('express-session');
const pg_session = require('connect-pg-simple')(session);
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const sendgrid = require('@sendgrid/mail');
const mkdirp = require('mkdirp');
const multer = require('multer')

const slug_regex = /^[a-z0-9_-][a-z0-9_-]+$/;

marked.setOptions({
	gfm: true,
	smartypants: true
});

// Setup CORS
io.origins((origin, callback) => {
	if (config.cors_origins.indexOf('*') !== -1) {
		callback(null, true);
	} else if (config.cors_origins.indexOf(origin) !== -1 ||
	           config.cors_origins.indexOf(origin + '/') !== -1) {
		callback(null, true);
	} else {
		console.log(`CORS blocked origin: ${origin}`);
		return callback('origin not allowed', false);
	}
});

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(body_parser.urlencoded({ extended: false }));
app.use(body_parser.json());
app.use(session({
	store: new pg_session({
		conString: config.db_dsn
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
app.enable('trust proxy');

server.listen(config.port, () => {
	console.log(`listening on *:${config.port}`);
});

// Connect to PostgreSQL
const pg = require('pg');
const db = new pg.Client(config.db_dsn);
db.connect();

// Setup SMTP if it's configured
if ('smtp' in config) {
	var smtp_transport = nodemailer.createTransport(config.smtp);
}

// Setup SendGrid if it's configured
if ('sendgrid_api_key' in config) {
	sendgrid.setApiKey(config.sendgrid_api_key);
}

const upload = multer();

function error_page(rsp, type) {
	rsp.render('page', {
		title: 'Error',
		view: 'error',
		content: {
			type: type
		}
	});
}

app.get('/', async (req, rsp) => {

	try {

		let person = await curr_person(req);

		if (! person) {
			return rsp.render('page', {
				title: 'Welcome',
				view: 'login',
				content: {
					invite: null,
					then: req.query.then
				}
			});
		}

		if (person.context_id) {

			// If the person is logged in, and has a group context ID, redirect.

			let context = await get_context(person.context_id);
			return rsp.redirect(`/group/${context.slug}`);
		}

		let contexts = await get_contexts(person);

		rsp.render('page', {
			title: 'Hello',
			view: 'home',
			content: {
				person: person,
				contexts: contexts,
				base_url: config.base_url,
				then: req.query.then
			}
		});

	} catch(err) {
		console.log(err.stack);
		error_page(rsp, '500');
	}
});

app.get('/group', async (req, rsp) => {

	try {

		let person = await curr_person(req);
		let contexts = await get_contexts(person);

		if (! person) {
			return rsp.redirect('/?then=%2Fgroup');
		}

		let default_slug = random(16);

		rsp.render('page', {
			title: 'Create a new group',
			view: 'new-group',
			content: {
				person: person,
				contexts: contexts,
				base_url: config.base_url,
				default_slug: default_slug
			}
		});

	} catch(err) {
		console.log(err.stack);
		error_page(rsp, '500');
	}
});

app.get('/group/:slug', async (req, rsp) => {

	try {

		let context = await get_context(req.params.slug);
		if (! context) {
			return error_page(rsp, '404');
		}

		let person = await curr_person(req);
		let member = await check_membership(person, context.id);

		if (! member) {
			return error_page(rsp, '404');
		}

		set_context(person, context);
		let contexts = await get_contexts(person);

		rsp.render('page', {
			title: context.name,
			view: 'context',
			content: {
				person: person,
				contexts: contexts,
				context: contexts.current,
				member: member,
				base_url: config.base_url,
				then: req.query.then
			}
		});

	} catch(err) {
		console.log(err.stack);
		error_page(rsp, '500');
	}

});

app.get('/group/:slug/:id', async (req, rsp) => {

	try {

		let context = await get_context(req.params.slug);
		if (! context) {
			return error_page(rsp, '404');
		}

		let person = await curr_person(req);
		let member = await check_membership(person, context.id);

		if (! member) {
			return error_page(rsp, '404');
		}

		set_context(person, context);

		let id = parseInt(req.params.id);
		let contexts = await get_contexts(person, id);

		rsp.render('page', {
			title: context.name,
			view: 'thread',
			content: {
				person: person,
				contexts: contexts,
				context: contexts.current,
				member: member,
				base_url: config.base_url
			}
		});

	} catch(err) {
		console.log(err.stack);
		error_page(rsp, '500');
	}

});

app.get('/join/:slug', async (req, rsp) => {

	try {

		let invite = await get_invite(req.params.slug);
		if (! invite) {
			return error_page(rsp, '404');
		}

		let person = await curr_person(req);

		if (! person) {
			rsp.render('page', {
				title: 'Welcome',
				view: 'login',
				content: {
					invite: invite,
					then: req.query.then
				}
			});
		} else {
			let invited_by = invite.person_id;
			await join_context(person, invite.context.id, invited_by);
			rsp.redirect(`${config.base_url}/group/${invite.context.slug}`);
		}

	} catch(err) {
		console.log(err.stack);
		return error_page(rsp, '500');
	}

});

app.post('/api/ping', (req, rsp) => {
	const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
	return rsp.send({
		ok: true,
		pong: ip
	});
});

// Because the login hashes are stored in memory (and not in the database), it
// is important to check for pending logins when restarting the server. There is
// a console.log() of the number of pending logins whenever the number changes.
// (20181022/dphiffer)
const login_hashes = {};

app.post('/api/login', async (req, rsp) => {

	try {

		if (! 'body' in req ||
		    ! 'email' in req.body) {
			return rsp.status(400).send({
				ok: false,
				error: "Please include 'email' for your login."
			});
		}

		let hash = random(16);
		let login_url = `${config.base_url}/login/${hash}`;

		while (hash in login_hashes) {

			// This is extremely improbable and will likely never happen.

			console.log('Login hash collision!');
			hash = random(16);
			login_url = `${config.base_url}/login/${hash}`;
		}

		const email = normalize_email(req.body.email);
		const subject = 'organizer.network login link';
		const body = `Hello,

Follow this link to login:
${login_url}

(expires in 10 minutes)

<3`;

		let query = await db.query(`
			SELECT id, slug
			FROM person
			WHERE email = $1
			LIMIT 1
		`, [email]);

		let id, slug;

		if (query.rows.length == 1) {
			id = query.rows[0].id;
			slug = query.rows[0].slug;
		} else {
			slug = random(6);
			query = await db.query(`
				INSERT INTO person
				(email, slug, created)
				VALUES ($1, $2, CURRENT_TIMESTAMP)
				RETURNING *
			`, [email, slug]);
			id = query.rows[0].id;
		}

		login_hashes[hash] = {
			id: id
		};

		if (req.body.invite) {
			login_hashes[hash]['invite'] = req.body.invite;
		}

		let count = Object.keys(login_hashes).length;
		let now = (new Date()).toISOString();
		console.log(`${now}: ${count} logins pending`);

		setTimeout(function() {

			// Expire the login hash.
			delete login_hashes[hash];

			count = Object.keys(login_hashes).length;
			now = (new Date()).toISOString();
			console.log(`${now}: ${count} logins pending`);

		}, 10 * 60 * 1000);

		await send_email(email, subject, body);

		return rsp.send({
			ok: true
		});

	} catch(err) {
		console.log(err.stack);
		return rsp.status(500).send({
			ok: false,
			error: "Error creating 'person' record."
		});
	}

});

app.get('/login/:hash', async (req, rsp) => {

	try {

		let hash = req.params.hash;

		if (login_hashes[hash]) {

			let login = login_hashes[hash];
			delete login_hashes[hash];

			let count = Object.keys(login_hashes).length;
			let now = (new Date()).toISOString();
			console.log(`${now}: ${count} logins pending`);

			let query = await db.query(`
				SELECT *
				FROM person
				WHERE id = $1
			`, [login.id]);

			if (query.rows.length != 1) {
				return error_page(rsp, 'invalid-login');
			}

			let person = query.rows[0];
			req.session.person = person;

			let redirect = '/';

			if (login.invite) {

				query = await db.query(`
					SELECT *
					FROM member
					WHERE invite_slug = $1
				`, [login.invite]);

				let member = query.rows[0];
				let invited_by = member.person_id;
				await join_context(person, member.context_id, invited_by);
				let context = await get_context(member.context_id);

				redirect = `/group/${context.slug}`;
			}

			if (! person.name) {
				let then = '';
				if (redirect != '/') {
					then = encodeURIComponent(redirect);
				}
				redirect = `/${person.slug}?edit=1`;
				if (then) {
					redirect += `&then=${then}`;
				}
			}

			return rsp.redirect(`${config.base_url}${redirect}`);
		}

		error_page(rsp, 'invalid-login');

	} catch(err) {
		console.log(err.stack);
		error_page(rsp, '500');
	}
});

app.get('/logout', (req, rsp) => {
	delete req.session.person;
	rsp.redirect(`${config.base_url}/`);
});

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

		if (! slug.match(slug_regex)) {
			return rsp.status(400).send({
				ok: false,
				error: "The URL format is: at least 2 letters, numbers, hyphens, or underscores."
			});
		}

		let person = await curr_person(req);
		if (! person) {
			return rsp.status(403).send({
				ok: false,
				error: "You must be signed in to create a group."
			});
		}

		let context = await get_context(slug);
		if (context) {
			return rsp.status(400).send({
				ok: false,
				error: "Sorry, that group URL is already taken."
			});
		}

		let query = await db.query(`
			INSERT INTO context
			(name, slug, created)
			VALUES ($1, $2, CURRENT_TIMESTAMP)
			RETURNING *
		`, [name, slug]);

		let group = query.rows[0];

		await join_context(person, group.id);

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

		let person = await curr_person(req);
		let member = await check_membership(person, context_id);

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

app.post('/api/reply', upload.none(), async (req, rsp) => {

	try {

		let reply = req.body;

		let id = reply.headers.match(/Message-Id: <([^>]+)>/i);
		let in_reply_to = reply.headers.match(/In-Reply-To: <([^>]+)>/i);

		let context_id = -1;
		let message_id = -1;
		let person_id = -1;

		if (! id || ! reply_to) {
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

		let query = db.query(`
			SELECT *
			FROM email_tx
			WHERE id = $1
		`, [in_reply_to]);

		if (query.rows.length > 0) {
			let email_tx = query.rows[0];

			context_id = parseInt(email_tx.context_id);
			person_id = parseInt(email_tx.person_id);
			in_reply_to = parseInt(email_tx.message_id);

			let person = await get_person(person_id);
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

		let person = await curr_person(req);
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

		let person_with_slug = await get_person(req.body.slug);
		if (person_with_slug.id !== person.id) {
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

		person = await curr_person(req);

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
		let person = await curr_person(req);
		let member = await check_membership(person, message.context_id);

		if (! member) {
			return rsp.status(403).send({
				ok: false,
				error: 'You are not authorized to load that message.'
			});
		}

		query = await db.query(`
			SELECT COUNT(id) AS reply_count
			FROM message
			WHERE in_reply_to = $1
		`, [req.params.id]);

		message.reply_count = query.rows[0].reply_count;

		rsp.render('message', {
			message: message,
			context: {
				slug: message.context_slug
			},
			member: member
		});

	} catch (err) {
		console.log(err.stack);
		return error_page(rsp, '500');
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
		let person = await curr_person(req);
		let member = await check_membership(person, message.context_id);

		query = await db.query(`
			SELECT message.*,
			       person.name AS person_name, person.slug AS person_slug
			FROM message, person
			WHERE message.in_reply_to = $1
			  AND message.person_id = person.id
			ORDER BY message.created
		`, [req.params.id]);

		message.replies = query.rows;
		await add_reply_counts(message.replies);

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
		return error_page(rsp, '500');
	}
});

app.get('/api/group/:slug', async (req, rsp) => {

	try {

		let person = await curr_person(req);

		if (! person) {
			return rsp.status(403).send({
				ok: false,
				error: 'You must be signed in to load group content.'
			});
		}

		let context = await get_context(req.params.slug);

		if (! context) {
			return rsp.status(404).send({
				ok: false,
				error: 'Group not found.'
			});
		}

		let member = await check_membership(person, context.id);

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
		await add_context_details(context, before_id);

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
			WHERE member.leave_slug = $1
			  AND member.context_id = context.id
		`, [req.params.id]);

		let member = query.rows[0];

		await db.query(`
			DELETE FROM member
			WHERE leave_slug = $1
		`, [member.leave_slug]);

		rsp.render('page', {
			title: 'Unsubscribed',
			view: 'leave',
			content: {
				context: member.context_name
			}
		});

		db.query(`
			UPDATE person
			SET context_id = NULL
			WHERE id = $1
			  AND context_id = $2
		`, [member.person_id, member.context_id]);

	} catch(err) {
		console.log(err.stack);
		return error_page(rsp, '500');
	}

});

app.use(async (req, rsp) => {

	try {

		let curr_id = null;
		let curr = await curr_person(req);
		if (curr) {
			curr_id = curr.id;
		}

		if (req.path.substr(1).match(slug_regex)) {
			let person = await get_person(req.path.substr(1));
			if (person) {
				rsp.render('page', {
					title: person.name || 'Profile',
					view: 'profile',
					content: {
						person: person,
						edit: (req.query.edit == '1'),
						base_url: config.base_url,
						curr_id: curr_id,
						then: req.query.then
					}
				});
				return;
			}
		}

		rsp.status(404);
		error_page(rsp, '404');

	} catch(err) {
		console.log(err.stack);
		return error_page(rsp, '500');
	}
});

function send_message(person, context_id, in_reply_to, content) {
	return new Promise((resolve, reject) => {
		db.query(`
			INSERT INTO message
			(person_id, context_id, in_reply_to, content, created)
			VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
			RETURNING *
		`, [person.id, context_id, in_reply_to, content], (err, res) => {
			if (err) {
				console.log('Error sending message:');
				console.log(err);
				return reject(err);
			}
			if (res.rows.length == 0) {
				reject('Could not send message.');
			} else {
				let message = res.rows[0];
				message.reply_count = 0;
				resolve(message);
				send_notifications(person, message);
				db.query(`
					UPDATE member
					SET updated = CURRENT_TIMESTAMP
					WHERE person_id = $1
					  AND context_id = $2
				`, [person.id, context_id]);
			}
		});
	});
}

async function send_notifications(sender, message) {

	try {

		let query = await db.query(`
			SELECT member.leave_slug, member.person_id,
			       person.email, person.name,
			       context.name AS context_name, context.slug AS context_slug
			FROM member, person, context
			WHERE member.context_id = $1
			  AND member.person_id != $2
			  AND person.id = member.person_id
			  AND context.id = member.context_id
		`, [message.context_id, message.person_id]);

		let members = query.rows;

		for (let member of members) {
			let subject = `${sender.name} posted in ${member.context_name}`;

			if (message.in_reply_to) {
				query = await db.query(`
					SELECT content
					FROM message
					WHERE id = $1
				`, [message.in_reply_to]);

				subject = `Re: ${query.rows[0].content}`;
				subject = subject.replace(/\s+/g, ' ');
				if (subject.length > 100) {
					subject = subject.substr(0, 100) + '...';
				}
			}

			let rsp = await send_email(member.email, subject, `${message.content}

---
Message link:
${config.base_url}/group/${member.context_slug}/${message.id}

Unsubscribe from ${member.context_name}:
${config.base_url}/leave/${member.leave_slug}`);

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

function join_context(person, context_id, invited_by) {

	return new Promise(async (resolve, reject) => {

		try {

			await db.query(`
				UPDATE person
				SET context_id = $1
				WHERE id = $2
			`, [context_id, person.id]);

			let member = await check_membership(person, context_id);
			if (member) {
				return resolve(member);
			}

			let leave_slug = random(16);
			let invite_slug = random(16);
			let query;

			if (invited_by) {
				query = await db.query(`
					INSERT INTO member
					(person_id, context_id, leave_slug, invite_slug, invited_by, created, updated)
					VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
					RETURNING *
				`, [person.id, context_id, leave_slug, invite_slug, invited_by]);
			} else {
				query = await db.query(`
					INSERT INTO member
					(person_id, context_id, leave_slug, invite_slug, created, updated)
					VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
					RETURNING *
				`, [person.id, context_id, leave_slug, invite_slug]);
			}

			member = query.rows[0];
			return resolve(member);

		} catch (err) {
			console.log(err.stack);
			reject(err);
		}

	});
}

function check_membership(person, context_id) {
	return new Promise((resolve, reject) => {
		if (! person) {
			return resolve(false);
		}
		db.query(`
			SELECT *
			FROM member
			WHERE person_id = $1
			  AND context_id = $2
		`, [person.id, context_id], (err, res) => {
			if (err) {
				console.log('Error checking membership:');
				console.log(err);
				return reject(err);
			}
			if (res.rows.length == 0) {
				resolve(false);
			} else {
				resolve(res.rows[0]);
			}
		});
	});
}

function get_invite(slug) {
	return new Promise(async (resolve, reject) => {
		try {
			let query = await db.query(`
				SELECT *
				FROM member
				WHERE invite_slug = $1
			`, [slug]);

			let invite;

			if (query.rows.length == 0) {
				resolve(false);
			} else {
				invite = query.rows[0];
				invite.person = await get_person(invite.person_id);
				invite.context = await get_context(invite.context_id);
				resolve(invite);
			}
		} catch(err) {
			console.log(err.stack);
			reject(err);
		}
	});
}

function get_person(id_or_slug) {
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

			if (query.rows.length == 0) {
				return reject(null);
			}
			resolve(query.rows[0]);

		} catch(err) {
			console.log(err.stack);
			reject(err);
		}

	});
}

function curr_person(req) {
	return new Promise((resolve, reject) => {
		if ('session' in req &&
		    'person' in req.session) {
			db.query(`
				SELECT *
				FROM person
				WHERE id = $1
			`, [req.session.person.id], (err, res) => {
				if (err) {
					return reject(err);
				}
				resolve(res.rows[0]);
			});
		} else {
			resolve(null);
		}
	});
}

function get_context(id_or_slug) {

	return new Promise(async (resolve, reject) => {

		try {
			let query;

			if (typeof id_or_slug == 'string') {
				let slug = id_or_slug;
				query = await db.query(`
					SELECT *
					FROM context
					WHERE slug = $1
				`, [slug]);
			} else if (typeof id_or_slug == 'number') {
				let id = id_or_slug;
				query = await db.query(`
					SELECT *
					FROM context
					WHERE id = $1
				`, [id]);
			} else {
				throw new Error(`Argument ${id_or_slug} should be a string or number type.`);
			}

			if (query.rows.length == 0) {
				// No context found, but we still resolve().
				return resolve(null);
			}

			let context = query.rows[0];
			resolve(context);

		} catch(err) {
			console.log(err.stack);
			reject(err);
		}
	});
}

function get_contexts(person, message_id) {

	return new Promise(async (resolve, reject) => {

		try {

			let query;
			const contexts = {};

			if (person) {

				query = await db.query(`
					SELECT context.*
					FROM member, context
					WHERE member.person_id = $1
					  AND member.context_id = context.id
				`, [person.id]);

				contexts.member_of = query.rows;

				let thread = null;
				let context_id = null;

				if (person.context_id) {
					context_id = person.context_id;
				}

				if (message_id) {
					query = await db.query(`
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

					query = await db.query(`
						SELECT *
						FROM context
						WHERE id = $1
					`, [context_id]);

					let current = query.rows[0];

					if (thread) {
						current.thread = thread;
					}

					contexts.current = await add_context_details(current);
				}
			}

			resolve(contexts);

		} catch(err) {
			reject(err);
		}
	});
}

function set_context(person, context) {
	if (person.context_id != context.id) {
		person.context_id = context.id;
		db.query(`
			UPDATE person
			SET context_id = $1
			WHERE id = $2
		`, [context.id, person.id]);
	}
}

async function add_context_details(context, before_id) {

	let query;

	if (! context) {
		return;
	}

	if (context.thread) {

		context.messages = context.thread.splice(0, 1);
		context.messages[0].replies = context.thread;
		context.messages[0].reply_count = context.messages[0].replies.length;
		await add_reply_counts(context.messages[0].replies);

	} else {

		let before_clause = '';
		let values = [context.id];
		if (before_id) {
			before_clause = 'AND message.id < $2';
			values.push(before_id);
		}

		query = await db.query(`
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

		query = await db.query(`
			SELECT COUNT(id) AS total_messages
			FROM message
			WHERE context_id = $1
			  AND in_reply_to IS NULL
		`, [context.id]);

		context.total_messages = query.rows[0].total_messages;

		await add_reply_counts(context.messages);
	}

	query = await db.query(`
		SELECT member.person_id, person.name, person.slug
		FROM member, person
		WHERE member.context_id = $1
		  AND member.person_id = person.id
		ORDER BY member.updated DESC
	`, [context.id]);

	context.members = query.rows;

	return context;
}

async function add_reply_counts(messages) {

	if (messages.length == 0) {
		return;
	}

	let ids = messages.map(msg => msg.id);
	let placeholders = [];
	for (let i = 0; i < ids.length; i++) {
		placeholders.push('$' + (i + 1));
	}

	placeholders = placeholders.join(', ');

	query = await db.query(`
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

	for (let message of messages) {
		if (message.id in replies) {
			message.reply_count = replies[message.id];
		} else {
			message.reply_count = 0;
		}
	}
}

function send_email(to, subject, body) {
	return new Promise((resolve, reject) => {

		const message = {
			from: config.email_from,
			to: to,
			subject: subject,
			text: body
		};

		if ('sendgrid_api_key' in config) {
			sendgrid.send(message)
			.then((rsp) => {
				resolve(rsp);
			})
			.catch(err => {
				reject(err);
			});
		} else if ('smtp' in config) {
			smtp_transport.sendMail(message, (err, info) => {
				if (err) {
					return reject(err);
				}
				return resolve(info);
			});
		}
	});
}

function normalize_email(email) {
	return email.trim().toLowerCase();
}

function random(count) {
	const chars = 'abcdefghijkmnpqrstuwxyz0123456789';
	const rnd = crypto.randomBytes(count);
	const value = new Array(count);
	const len = Math.min(256, chars.length);
	const d = 256 / len;

	for (var i = 0; i < count; i++) {
		value[i] = chars[Math.floor(rnd[i] / d)]
	};

	return value.join('');
}
