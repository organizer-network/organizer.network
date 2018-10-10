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
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const mkdirp = require('mkdirp');

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
	secret: config.session_secret,
	resave: false,
	saveUninitialized: false,
	cookie: {
		secure: true,
		maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
	}
}));

server.listen(config.port, () => {
	console.log(`listening on *:${config.port}`);
});

// Connect to PostgreSQL
const pg = require('pg');
const db = new pg.Client(config.db_dsn);
db.connect();

app.get('/', (req, rsp) => {

	let person = curr_person(req);

	if (person) {
		rsp.render('page', {
			title: 'hello',
			view: 'intro',
			content: {
				person: person
			}
		});
	} else {
		rsp.render('page', {
			title: 'hello',
			view: 'intro-login',
			content: {}
		});
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
					return rsp.render('page', {
						title: 'login error',
						view: 'error-login',
						content: {}
					});
				}

				req.session.person = res.rows[0];
				rsp.redirect(`/${res.rows[0].slug}`);
			});
			delete login_hashes[id];
			return;
		}
	}

	rsp.render('page', {
		title: 'login error',
		view: 'error-login',
		content: {}
	});
});


function curr_person(req) {
	if ('session' in req &&
	    'person' in req.session) {
		return req.session.person;
	}
	return null;
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
