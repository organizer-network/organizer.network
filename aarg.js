// organizer.network
// v0.0.1 "aarg"
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
const mkdirp = require('mkdirp');

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
			INSERT INTO context (name, slug, created)
			VALUES ('Commons', 'commons', CURRENT_TIMESTAMP)
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

app.get('/', (req, rsp) => {

	curr_person(req)
	.then((person) => {

		if (! person) {
			return rsp.render('page', {
				title: 'welcome',
				view: 'login',
				content: {}
			});
		}

		curr_context(person)
		.then((context) => {
			rsp.render('page', {
				title: context.name,
				view: 'home',
				content: {
					person: person,
					context: context
				}
			});
		})
		.catch((err) => {
			console.log(err);
			error_page(rsp, 'invalid-context');
		});

	})
	.catch((err) => {
		console.log(err);
		error_page(rsp, 'invalid-person');
	});
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
	const body = `Hello ${email},

Here is your one-time login link (expires in 10 minutes):
${login_url}

Thank you!`;

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
			(email, name, slug, created)
			VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
			RETURNING *
		`, [email, email, slug], (err, res) => {

			if (err) {
				return rsp.status(500).send({
					ok: false,
					error: "Error creating 'person' record."
				});
			}

			let id = res.rows[0].id;
			join_context(res.rows[0], 1);

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
					return error_page(rsp, 'invalid-login');
				}

				let person = res.rows[0];
				req.session.person = person;

				let redirect = '/';
				if (person.name == person.email) {
					redirect = `/${person.slug}?edit=1`;
				}
				rsp.redirect(redirect);
			});
			delete login_hashes[id];
			return;
		}
	}

	error_page(rsp, 'invalid-login');
});

app.get('/logout', (req, rsp) => {
	delete req.session.person;
	rsp.redirect('/');
});

app.post('/api/send', (req, rsp) => {

	if (! 'body' in req ||
	    ! 'content' in req.body ||
	    ! 'context_id' in req.body ||
	    req.body.content == '') {
		return rsp.status(400).send({
			ok: false,
			error: "Please include 'content' and 'context_id' params."
		});
	}

	let content = req.body.content.trim();
	let context_id = parseInt(req.body.context_id);

	curr_person(req)
	.then((person) => {

		check_membership(person, context_id)
		.then((is_member) => {

			if (! is_member) {
				return rsp.status(403).send({
					ok: false,
					error: "You cannot send messages to that context."
				});
			}

			send_message(person, context_id, content)
			.then((message) => {
				return rsp.send({
					ok: true,
					message_id: message.id
				});
			});

		});
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

app.get('/api/message/:id', (req, rsp) => {

	db.query(`
		SELECT message.*, person.name
		FROM message, person
		WHERE message.id = $1
		  AND message.person_id = person.id
	`, [req.params.id], (err, res) => {

		if (err || res.rows.length == 0) {
			return rsp.status(404).send({
				ok: false,
				error: 'Message not found.'
			});
		}

		let message = res.rows[0];

		curr_person(req)
		.then((person) => {

			check_membership(person, message.context_id)
			.then((is_member) => {

				if (! is_member) {
					return rsp.status(403).send({
						ok: false,
						error: 'You are not authorized to load that message.'
					});
				}

				rsp.render('message', {
					message: message
				});

			});

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
					title: person.name,
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

function send_message(person, context_id, content) {
	return new Promise((resolve, reject) => {
		db.query(`
			INSERT INTO message
			(person_id, context_id, content, created)
			VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
			RETURNING *
		`, [person.id, context_id, content], (err, res) => {
			if (err) {
				console.log('Error sending message:');
				console.log(err);
				return reject(err);
			}
			if (res.rows.length == 0) {
				reject('Could not send message.');
			} else {
				resolve(res.rows[0]);
			}
		});
	});
}

function join_context(person, context_id) {
	let id = random(16);
	db.query(`
		INSERT INTO member
		(id, person_id, context_id)
		VALUES ($1, $2, $3)
	`, [id, person.id, context_id]);
}

function check_membership(person, context_id) {
	return new Promise((resolve, reject) => {
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

function curr_context(person) {
	return new Promise((resolve, reject) => {
		if (person && person.context_id) {
			db.query(`
				SELECT *
				FROM context
				WHERE id = $1
			`, [person.context_id], (err, res) => {

				if (err) {
					return reject(err);
				}

				const context = res.rows[0];

				db.query(`
					SELECT message.*, person.name, person.slug
					FROM message, person
					WHERE message.context_id = $1
					  AND message.person_id = person.id
					ORDER BY message.created DESC
					LIMIT 10
				`, [context.id], (err, res) => {

					if (err) {
						return reject(err);
					}

					context.messages = res.rows;

					db.query(`
						SELECT person.name, person.slug
						FROM member, person
						WHERE member.context_id = $1
						  AND member.person_id = person.id
						ORDER BY member.created
					`, [context.id], (err, res) => {

						if (err) {
							return reject(err);
						}

						context.members = res.rows;

						resolve(context);
					});

				});
			});
		} else {
			reject(null);
		}
	});
}

function send_email(to, subject, body) {
	return new Promise((resolve, reject) => {
		const transporter = nodemailer.createTransport(config.smtp);
		const options = {
			from: config.email_from,
			to: to,
			subject: subject,
			text: body
		};
		transporter.sendMail(options, (err, info) => {
			if (err) {
				return reject(err);
			}
			return resolve(info);
		});
	});
}

function normalize_email(email) {
	return email.trim().toLowerCase();
}

function date(date) {
	return date_format(new Date(date), 'isoDateTime');
}
app.locals.date = date;

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
