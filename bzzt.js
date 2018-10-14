// organizer.network
// v0.0.2 "bzzt"

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
const date_format = require('dateformat');
const mime = require('mime');
const sharp = require('sharp');
const session = require('express-session');
const pg_session = require('connect-pg-simple')(session);
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const sendgrid = require('@sendgrid/mail');
const mkdirp = require('mkdirp');
const multer = require('multer')

const person_slug_regex = /^\/[a-z0-9_][a-z0-9_]+$/;

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
	const smtp_transport = nodemailer.createTransport(config.smtp);
}

// Setup SendGrid if it's configured
if ('sendgrid_api_key' in config) {
	sendgrid.setApiKey(config.sendgrid_api_key);
}

const upload = multer();

db.query(`
	SELECT id
	FROM context
	WHERE slug = 'commons'
`, (err, res) => {

	if (err) {
		console.log(err);
		return;
	}

	if (res.rows.length == 0) {
		console.log("setting up 'commons' context");
		db.query(`
			INSERT INTO context (name, slug, parent_id, created)
			VALUES ('Commons', 'commons', 0, CURRENT_TIMESTAMP)
		`, (err) => {
			if (err) {
				console.log(err);
			}
		});
	}

});

function error_page(rsp, type) {
	rsp.render('page', {
		title: 'error',
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
				title: 'welcome',
				view: 'login',
				content: {
					context: null
				}
			});
		}

		let contexts = await get_contexts(person);
		let member = null;

		let title = 'hello';
		if (contexts.current) {
			title = contexts.current.name;
			member = await check_membership(person, contexts.current.id);
		}

		rsp.render('page', {
			title: title,
			view: 'home',
			content: {
				person: person,
				contexts: contexts,
				member: member,
				base_url: config.base_url
			}
		});

	} catch(err) {
		console.log(err);
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
		let contexts = null;

		if (person) {
			contexts = await get_contexts(person);
			if (member && person.current_id != context.id) {
				person.current_id = context.id;
				db.query(`
					UPDATE person
					SET context_id = $1
					WHERE id = $2
				`, [context.id, person.id]);
			}
			if (! contexts.current) {
				contexts.current = await add_context_details(context);
			}
		} else {
			contexts = {
				current: await add_context_details(context)
			};
		}

		rsp.render('page', {
			title: contexts.current.name,
			view: 'home',
			content: {
				person: person,
				contexts: contexts,
				member: member,
				base_url: config.base_url
			}
		});

	} catch(err) {
		console.log(err);
		error_page(rsp, '500');
	}

});

app.get('/join/:slug', async (req, rsp) => {

	try {

		let context = await get_context(req.params.slug);
		if (! context) {
			return error_page(rsp, '404');
		}

		let person = await curr_person(req);
		if (! person) {
			rsp.render('page', {
				title: 'welcome',
				view: 'login',
				content: {
					context: context,
					preview_link: true
				}
			});
		} else {
			let member = await check_membership(person, context.id);
			if (! member) {
				join_context(person, context.id);
			}
			rsp.redirect(`${config.base_url}/group/${context.slug}`);
		}

	} catch(err) {
		console.log(err);
		return error_page(rsp, '500');
	}

});

const login_hashes = {};
app.post('/api/login', (req, rsp) => {

	if (! 'body' in req ||
	    ! 'email' in req.body) {
		return rsp.status(400).send({
			ok: false,
			error: "Please include 'email' for your login."
		});
	}

	const hash = random(16);
	const login_url = `${config.base_url}/login/${hash}`;

	const email = normalize_email(req.body.email);
	const subject = 'organizer.network login link';
	const body = `Hello,

Follow this link to login:
${login_url}

(expires in 10 minutes)

<3`;

	function callback(id, slug) {

		login_hashes[id] = hash;
		setTimeout(function() {
			delete login_hashes[id];
		}, 10 * 60 * 1000);

		send_email(email, subject, body)
			.then((info) => {
				return rsp.status(200).send({
					ok: true,
					id: id,
					slug: slug
				});
			})
			.catch((err) => {
				return rsp.status(500).send({
					ok: false,
					error: "Error sending login email."
				});
			});

		if ('context' in req.body) {
			get_context(req.body.context)
			.then(async context => {
				let person = await get_person(slug);
				join_context(person, context.id);
			});
		}
	}

	db.query(`
		SELECT id, slug
		FROM person
		WHERE email = $1
		LIMIT 1
	`, [email], (err, res) => {

		if (err) {
			return rsp.status(500).send({
				ok: false,
				error: "Error checking 'person' table."
			});
		}

		if (res.rows.length == 1) {
			let id = res.rows[0].id;
			let slug = res.rows[0].slug;
			return callback(id, slug);
		}

		var slug = random(6);

		db.query(`
			INSERT INTO person
			(email, slug, created)
			VALUES ($1, $2, CURRENT_TIMESTAMP)
			RETURNING *
		`, [email, slug], (err, res) => {

			if (err) {
				return rsp.status(500).send({
					ok: false,
					error: "Error creating 'person' record."
				});
			}

			let id = res.rows[0].id;

			return callback(id, slug);
		});

	});

});

app.get('/login/:hash', (req, rsp) => {

	let hash = req.params.hash;

	for (let id in login_hashes) {
		if (login_hashes[id] == hash) {
			db.query(`
				SELECT *
				FROM person
				WHERE id = $1
			`, [id], (err, res) => {

				if (err || res.rows.length != 1) {
					console.log(err);
					return error_page(rsp, 'invalid-login');
				}

				let person = res.rows[0];
				req.session.person = person;

				let redirect = '/';
				if (! person.name) {
					redirect = `/${person.slug}?edit=1`;
				}
				rsp.redirect(`${config.base_url}${redirect}`);
			});
			delete login_hashes[id];
			return;
		}
	}

	error_page(rsp, 'invalid-login');
});

app.get('/logout', (req, rsp) => {
	delete req.session.person;
	rsp.redirect(`${config.base_url}/`);
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

app.post('/api/reply', upload.none(), (req, rsp) => {

	console.log(req.body);

	rsp.send({
		'ok': true
	});

});

app.post('/api/profile', async (req, rsp) => {

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

	try {
		var person = await curr_person(req);
		if (person.id !== parseInt(req.body.id)) {
			return rsp.status(403).send({
				ok: false,
				error: "You are only allowed to edit your own profile."
			});
		}
	} catch(err) {
		return rsp.status(400).send({
			ok: false,
			error: "You are unable to edit that profile."
		});
	}

	if (req.body.name == '') {
		return rsp.status(400).send({
			ok: false,
			error: "Please include a non-empty 'name'."
		});
	}

	if (req.body.slug == '' ||
	    ! ('/' + req.body.slug).match(person_slug_regex)) {
		return rsp.status(400).send({
			ok: false,
			error: "The URL format is: at least 2 letters, numbers, or underscores."
		});
	}

	try {
		let person_with_slug = await get_person(req.body.slug);
		if (person_with_slug.id !== person.id) {
			return rsp.status(400).send({
				ok: false,
				error: "That profile URL is already taken."
			});
		}
	} catch(err) {}

	db.query(`
		UPDATE person
		SET name = $1, about = $2, slug = $3
		WHERE id = $4
	`, [req.body.name, req.body.about, req.body.slug, req.body.id], async (err, res) => {

		if (err) {
			return rsp.status(500).send({
				ok: false,
				error: "Unable to update profile."
			});
		}

		let person = await curr_person(req);

		return rsp.send({
			ok: true,
			person: person
		});

	})
});

app.get('/api/message/:id', async (req, rsp) => {

	try {
		let query = await db.query(`
			SELECT message.*,
			       person.name AS person_name, person.slug AS person_slug
			FROM message, person
			WHERE message.id = $1
			  AND message.person_id = person.id
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
			message: message
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

		if (! member) {
			return rsp.status(403).send({
				ok: false,
				error: 'You are not authorized to load those replies.'
			});
		}

		query = await db.query(`
			SELECT message.*,
			       person.name AS person_name, person.slug AS person_slug
			FROM message, person
			WHERE message.in_reply_to = $1
			  AND message.person_id = person.id
			ORDER BY message.created
		`, [req.params.id]);

		message.replies = query.rows;

		rsp.render('replies', {
			message: message,
			context: {
				id: message.context_id,
				slug: message.context_slug
			}
		});

	} catch (err) {
		console.log(err.stack);
		return error_page(rsp, '500');
	}
});

app.get('/leave/:id', (req, rsp) => {

	db.query(`
		SELECT member.leave_slug, member.person_id, member.context_id,
		       context.name AS context_name
		FROM member, context
		WHERE member.leave_slug = $1
		  AND member.context_id = context.id
	`, [req.params.id], (err, res) => {

		if (err || res.rows.length == 0) {
			if (err) {
				console.log(err);
			}
			return error_page(rsp, 'leave-link-not-found');
		}

		let member = res.rows[0];

		db.query(`
			DELETE FROM member
			WHERE leave_slug = $1
		`, [member.leave_slug], (err, res) => {

			if (err) {
				console.log(err);
				return error_page(rsp, 'leave-link-not-found');
			}

			rsp.render('page', {
				title: 'goodbye',
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

		});

	});

});

app.use(async (req, rsp) => {

	let curr_id = null;
	let curr = await curr_person(req);
	if (curr) {
		curr_id = curr.id;
	}

	if (req.path.match(person_slug_regex)) {
		try {
			let person = await get_person(req.path.substr(1));
			if (person) {
				rsp.render('page', {
					title: person.name || 'profile',
					view: 'profile',
					content: {
						person: person,
						edit: (req.query.edit == '1'),
						base_url: config.base_url,
						curr_id: curr_id
					}
				});
			}
		} catch(err) {
			rsp.status(404);
			error_page(rsp, '404');
		}
		return;
	}

	rsp.status(404);
	error_page(rsp, '404');
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

function send_notifications(sender, message) {

	db.query(`
		SELECT member.leave_slug, person.email, person.name,
		       context.name AS context_name, context.slug AS context_slug
		FROM member, person, context
		WHERE member.context_id = $1
		  AND member.person_id != $2
		  AND person.id = member.person_id
		  AND context.id = member.context_id
	`, [message.context_id, message.person_id], async (err, res) => {

		for (let member of res.rows) {
			let subject = `${sender.name} posted in ${member.context_name}`;

			try {
				if (message.in_reply_to) {
					let query = await db.query(`
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
			} catch(err) {
				console.log(err.stack);
			}

			if (err) {
				console.log(`Error sending notifications for message ${message.id}`);
				console.log(err);
				return;
			}

			send_email(member.email, subject, `${message.content}

---
Permalink:
${config.base_url}/group/${member.context_slug}/${message.id}

Unsubscribe:
${config.base_url}/leave/${member.leave_slug}`);

		}

	});
}

function join_context(person, context_id) {

	let leave_slug = random(16);
	let invite_slug = random(16);

	db.query(`
		INSERT INTO member
		(person_id, context_id, leave_slug, invite_slug, created, updated)
		VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, [person.id, context_id, leave_slug, invite_slug]);

	db.query(`
		UPDATE person
		SET context_id = $1
		WHERE id = $2
	`, [context_id, person.id]);
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

function get_person(slug) {
	return new Promise((resolve, reject) => {
		db.query(`
			SELECT *
			FROM person
			WHERE slug = $1
		`, [slug], (err, res) => {
			if (err) {
				return reject(err);
			}
			if (res.rows.length == 0) {
				return reject(null);
			}
			resolve(res.rows[0]);
		});

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

function get_context(slug) {
	return new Promise((resolve, reject) => {
		db.query(`
			SELECT *
			FROM context
			WHERE slug = $1
		`, [slug], (err, res) => {

			if (err) {
				console.log(err);
				return reject();
			}

			if (res.rows.length == 0) {
				return resolve(null);
			}

			resolve(res.rows[0]);
		});
	});
}

function get_contexts(person) {

	return new Promise(async (resolve, reject) => {

		var contexts = {};

		try {

			let query = await db.query(`
				SELECT *
				FROM context
				WHERE parent_id = 0
				ORDER BY name
			`);

			contexts.public = query.rows;

			if (person) {

				query = await db.query(`
					SELECT context.*
					FROM member, context
					WHERE member.person_id = $1
					  AND context.id = member.context_id
				`, [person.id]);

				contexts.member_of = query.rows;
				contexts.public = contexts.public.filter((context) => {
					return context.id != person.context_id;
				});

				if (person.context_id) {

					query = await db.query(`
						SELECT *
						FROM context
						WHERE id = $1
					`, [person.context_id]);

					contexts.current = await add_context_details(query.rows[0]);
				}
			}

			resolve(contexts);

		} catch(err) {
			reject(err);
		}
	});
}

async function add_context_details(context) {

	let query = await db.query(`
		SELECT message.*,
		       person.name AS person_name, person.slug AS person_slug
		FROM message, person
		WHERE message.context_id = $1
		  AND message.person_id = person.id
		  AND message.in_reply_to IS NULL
		ORDER BY message.created DESC
		LIMIT 10
	`, [context.id]);

	context.messages = query.rows;

	let ids = context.messages.map(msg => msg.id);
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

	for (let message of context.messages) {
		if (message.id in replies) {
			message.reply_count = replies[message.id];
		} else {
			message.reply_count = 0;
		}
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
			.then(() => {
				resolve();
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
