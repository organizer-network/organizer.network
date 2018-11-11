// organizer.network
// v0.1.0 "jiji"

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

const slug_regex = /^[a-z][a-z0-9_-]+$/i;

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
			let then = req.query.then;
			if (then && ! then.match(/^\//)) {
				then = null;
			}
			return rsp.render('page', {
				title: 'Welcome',
				view: 'login',
				content: {
					invite: null,
					then: then
				}
			});
		}

		if (person.context_id) {

			// If the person is logged in, and has a group context ID, redirect.

			let context = await get_context(person.context_id);
			return rsp.redirect(`/group/${context.slug}`);
		}

		let contexts = await get_contexts(person);

		let then = req.query.then;
		if (then && ! then.match(/^\//)) {
			then = null;
		}

		rsp.render('page', {
			title: 'Hello',
			view: 'home',
			content: {
				person: person,
				contexts: contexts,
				base_url: config.base_url,
				then: then
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

		let default_slug = random(16, 'slug');

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

let subgroup_path = '/group/:slug([a-z][a-z0-9_-]+/[a-z][a-z0-9_-]+)';
app.get(['/group/:slug', subgroup_path], async (req, rsp) => {

	try {

		let context = await get_context(req.params.slug);
		if (! context) {
			return error_page(rsp, '404');
		}

		let person = await curr_person(req);
		let member = await get_member(person, context.id, 'include inactive');
		let parent_member = false;

		if (context.parent_id) {
			parent_member = await get_member(person, context.parent_id);
		}

		if (! member &&
		    ! parent_member) {
			return error_page(rsp, '404');
		}

		if (! member.active ||
		    (! member && parent_member)) {
			let inactive = ! (! member && parent_member);
			return rsp.render('page', {
				title: context.name,
				view: 'unsubscribed',
				content: {
					person: person,
					context: context,
					inactive: inactive
				}
			});
		}

		set_context(person, context);
		let contexts = await get_contexts(person);

		let then = req.query.then;
		if (then && ! then.match(/^\//)) {
			then = null;
		}

		let email = 'send';
		if (member.facets && member.facets.email) {
			email = member.facets.email;
		}

		rsp.render('page', {
			title: context.name,
			view: 'context',
			content: {
				person: person,
				contexts: contexts,
				context: contexts.current,
				member: member,
				base_url: config.base_url,
				then: then,
				email: email
			}
		});

	} catch(err) {
		console.log(err.stack);
		error_page(rsp, '500');
	}

});

let subthread_path = '/group/:slug([a-z][a-z0-9_-]+/[a-z][a-z0-9_-]+)/:id';
app.get(['/group/:slug/:id', subthread_path], async (req, rsp) => {

	try {

		let context = await get_context(req.params.slug);
		if (! context) {
			return error_page(rsp, '404');
		}

		let person = await curr_person(req);
		let member = await get_member(person, context.id);

		if (! member) {
			return error_page(rsp, '404');
		}

		set_context(person, context);

		let id = parseInt(req.params.id);
		let contexts = await get_contexts(person, id);

		let email = 'send';
		if (member.facets && member.facets.email) {
			email = member.facets.email;
		}

		rsp.render('page', {
			title: context.name,
			view: 'thread',
			content: {
				person: person,
				contexts: contexts,
				context: contexts.current,
				member: member,
				base_url: config.base_url,
				email: email
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

		let then = req.query.then;
		if (then && ! then.match(/^\//)) {
			then = null;
		}

		if (! person) {
			rsp.render('page', {
				title: 'Welcome',
				view: 'login',
				content: {
					invite: invite,
					then: then
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

app.get('/settings', async (req, rsp) => {

	try {

		let person = await curr_person(req);

		if (! person) {
			let then = '/settings';
			return rsp.render('page', {
				title: 'Login to continue',
				view: 'login',
				content: {
					invite: null,
					then: then
				}
			});
		}

		let contexts = await get_contexts(person);

		for (let context of contexts.member_of) {
			let member = await get_member(person, context.id);
			await add_facets(member, 'member', 'email');
			if (! member.facets) {
				member.facets = {};
			}
			if (! member.facets.email) {
				member.facets.email = 'send';
			}
			context.email = member.facets.email;
		}

		rsp.render('page', {
			title: 'Settings',
			view: 'settings',
			content: {
				context: null,
				contexts: contexts,
				person: person
			}
		});

	} catch(err) {
		console.log(err.stack);
		return error_page(rsp, '500');
	}

});

app.get('/settings/:slug', async (req, rsp) => {

	try {

		let person = await curr_person(req);
		let context = await get_context(req.params.slug);

		if (! context) {
			return error_page(rsp, '404');
		}

		let member = await get_member(person, context.id);
		let contexts = await get_contexts(person);

		if (! member) {
			return error_page(rsp, '404');
		}

		let email = 'send';
		if (member.facets && member.facets.email) {
			email = member.facets.email;
		}

		let then = `/group/${context.slug}`;
		if (req.query.then) {
			then = req.query.then;
		}

		rsp.render('page', {
			title: 'Settings',
			view: 'settings',
			content: {
				context: context,
				contexts: contexts,
				person: person,
				member: member,
				email: email,
				then: then
			}
		});

	} catch(err) {
		console.log(err.stack);
		return error_page(rsp, '500');
	}

});

app.get('/user.css', async (req, rsp) => {

	rsp.append('Content-Type', 'text/css');

	const person = await curr_person(req);
	if (person) {
		rsp.send(`
			.message.person-${person.slug}:hover > .message-options {
				display: block;
			}
		`);
	} else {
		rsp.send('');
	}

});

app.post('/api/ping', (req, rsp) => {
	const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
	return rsp.send({
		ok: true,
		pong: ip
	});
});

app.get('/api/digest', async (req, rsp) => {

	try {

		let count = 0;

		let query = await db.query(`
			SELECT member.person_id, member.context_id
			FROM member, facet
			WHERE member.active = true
			  AND facet.target_id = member.id
			  AND facet.target_type = 'member'
			  AND facet.facet_type = 'email'
			  AND facet.content = 'digest'
		`);

		let digests = {};
		for (let member of query.rows) {
			if (! digests[member.person_id]) {
				digests[member.person_id] = [];
			}
			digests[member.person_id].push(member.context_id);
		}

		for (let person_id in digests) {
			count += await send_digest_emails(person_id, digests[person_id]);
		}

		rsp.send(`Sent ${count} digest emails.`);

	} catch(err) {
		console.log(err.stack);
		rsp.status(500).send("Could not send digest emails.");
	}

});

function send_digest_emails(person_id, contexts) {
	return new Promise(async (resolve, reject) => {

		try {

			let person = await get_person(parseInt(person_id));
			let digest = [];
			let msg_count = 0;

			for (let context_id of contexts) {

				let context = await get_context(parseInt(context_id));

				let facet = `last_digest_message_${context_id}`;
				await add_facets(person, 'person', facet);

				let values = [context_id, person_id];

				let id_clause = '';
				if (person.facets && person.facets[facet]) {
					id_clause = 'AND message.id > $3';
					values.push(person.facets[facet]);
				}

				let query = await db.query(`
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

				let messages = query.rows;
				let reply_msgs = {};
				let last_message_id = null;

				if (messages.length == 0) {
					continue;
				}

				let placeholders = [];
				values = [];
				for (let i = 0; i < messages.length; i++) {
					if (messages[i].in_reply_to) {
						placeholders.push('$' + (placeholders.length + 1));
						values.push(messages[i].in_reply_to);
					}
					last_message_id = messages[i].id;
				}

				if (values.length > 0) {
					placeholders = placeholders.join(', ');
					query = await db.query(`
						SELECT id, content
						FROM message
						WHERE id IN (${placeholders})
					`, values);

					for (let reply of query.rows) {
						let content = reply.content;
						content = content.replace(/\s+/g, ' ');
						if (content.length > 48) {
							content = content.substr(0, 48) + '...';
						}
						reply_msgs[reply.id] = content;
					}
				}

				let context_digest = [];
				for (let message of messages) {

					let subject = '';
					let message_url = `${config.base_url}/group/${context.slug}/${message.id}`;

					if (message.in_reply_to) {
						subject = `Re: ${reply_msgs[message.in_reply_to]}\n`;
						message_url = `${config.base_url}/group/${context.slug}/${message.in_reply_to}#${message.id}`;
					}

					context_digest.push(`${subject}${message.name} at ${message.created}:

${message.content}

Message link:
${message_url}`);
				}

				if (context_digest.length > 0) {
					await set_facet(person, 'person', facet, last_message_id, 'single');
					let context_txt = `${context.name}\n==================================================\n\n` + context_digest.join('\n\n---\n\n');
					digest.push(context_txt);
					msg_count += context_digest.length;
				}
			}

			if (msg_count > 0) {
				let plural = (msg_count == 1) ? '' : 's';
				let subject = `Digest: ${msg_count} message${plural}`;
				let body = digest.join('\n\n\n') + `\n\n---\nNotification settings:\n${config.base_url}/settings`;
				await send_email(person.email, subject, body);
				return resolve(1);
			}

			resolve(0);

		} catch(err) {
			console.log(err.stack);
			reject(err);
		}

	});
}

// Because the login hashes are stored in memory (and not in the database), it
// is important to check for pending logins when restarting the server. There is
// a console.log() of the number of pending logins whenever the number changes.
// (20181022/dphiffer)
const login_hashes = {};
const login_ips = {};

function reset_login_throttle(req) {
	let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
	delete login_ips[ip];
}

function throttle_logins(req) {

	let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
	console.log(`Login request from ${ip}`);

	if (! login_ips[ip]) {
		login_ips[ip] = 1;
	} else {
		login_ips[ip]++;
	}

	let count = config.login_throttle_count || 5;
	let timeout = config.login_throttle_timeout || 1000 * 60 * 5;

	if (login_ips[ip] == count + 1) {
		console.log(`Login throttle enabled for ${ip}`);
		setTimeout(function() {
			console.log(`Login throttle disabled for ${ip}`);
			reset_login_throttle(req);
		}, timeout);
	}

	if (login_ips[ip] > count) {
		return true;
	}

	return false;
}

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

		if (throttle_logins(req)) {
			return rsp.status(403).send({
				ok: false,
				error: "Sorry, you have requested too many logins. Please try again later."
			});
		}

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

Link expires in 1 hour.

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
			slug = random(6, 'slug');
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
		console.log(login_hashes);

		setTimeout(function() {

			// Expire the login hash.
			delete login_hashes[hash];

			count = Object.keys(login_hashes).length;
			now = (new Date()).toISOString();
			console.log(`${now}: ${count} logins pending`);
			console.log(login_hashes);

		}, 60 * 60 * 1000);

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

		if (throttle_logins(req)) {
			return error_page(rsp, 'invalid-login');
		}

		let hash = req.params.hash;

		if (login_hashes[hash]) {

			let login = login_hashes[hash];
			delete login_hashes[hash];

			let count = Object.keys(login_hashes).length;
			let now = (new Date()).toISOString();
			console.log(`${now}: ${count} logins pending`);
			console.log(login_hashes);

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
			reset_login_throttle(req);

			let redirect = '/';

			if (login.invite) {

				query = await db.query(`
					SELECT *
					FROM member
					WHERE active = true
					  AND invite_slug = $1
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
		let topic = req.body.topic || '';
		let parent_id = parseInt(req.body.parent_id) || null;

		if (! slug.match(slug_regex)) {
			return rsp.status(400).send({
				ok: false,
				error: "The URL format is: at least 2 letters, numbers, hyphens, or underscores."
			});
		}

		if (parent_id) {
			let parent = await get_context(parent_id);
			slug = `${parent.slug}/${slug}`;
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
			(name, slug, topic, parent_id, created)
			VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
			RETURNING *
		`, [name, slug, topic, parent_id]);

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
		let member = await get_member(person, context_id);

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
		let id = parseInt(req.params.id);
		let revision = req.query.revision || null;
		let message = await get_message(id, revision);

		if (! message) {
			return rsp.status(404).send({
				ok: false,
				error: 'Message not found.'
			});
		}

		let person = await curr_person(req);
		let member = await get_member(person, message.context_id);

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
		await add_message_details([message]);

		let person = await curr_person(req);
		let member = await get_member(person, message.context_id);

		query = await db.query(`
			SELECT message.*,
			       person.name AS person_name, person.slug AS person_slug
			FROM message, person
			WHERE message.in_reply_to = $1
			  AND message.person_id = person.id
			ORDER BY message.created
		`, [req.params.id]);

		message.replies = query.rows;
		await add_message_details(message.replies);

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

app.post('/api/delete', async (req, rsp) => {

	try {

		let id = req.body.id;
		if (! id) {
			return rsp.status(400).send({
				ok: false,
				error: "Please include a message 'id' param."
			});
		}

		let person = await curr_person(req);
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

		let person = await curr_person(req);
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

		let member = await get_member(person, context.id);

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
			WHERE member.active = true
			  AND member.leave_slug = $1
			  AND member.context_id = context.id
		`, [req.params.id]);

		if (query.rows.length < 1) {
			return error_page(rsp, 'invalid-unsubscribe');
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

		let context = await get_context(member.context_id);

		rsp.redirect(`/group/${context.slug}`);

	} catch(err) {
		console.log(err.stack);
		return error_page(rsp, '500');
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

		let person = await curr_person(req);
		if (! person) {
			return rsp.status(403).send({
				ok: false,
				error: 'You must be signed in to join groups.'
			});
		}

		let context_id = parseInt(req.body.context_id);
		let member = await get_member(person, context_id, 'include_inactive');
		if (! member) {

			let context = await get_context(context_id);
			if (context.parent_id) {
				let parent_member = await get_member(person, context.parent_id);
				if (parent_member) {
					await join_context(person, context_id);
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

		var person = await curr_person(req);
		var context = await get_context(parseInt(req.body.context_id));

		if (! person || ! context) {
			return rsp.status(400).send({
				ok: false,
				error: 'Invalid context or person record.'
			});
		}

		var member = await get_member(person, context.id);

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

		await set_facet(member, 'member', 'email', req.body.email, 'single');

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
		let curr = await curr_person(req);
		if (curr) {
			curr_id = curr.id;
		}

		if (req.path.substr(1).match(slug_regex)) {
			let person = await get_person(req.path.substr(1));
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
		error_page(rsp, '404');

	} catch(err) {
		console.log(err.stack);
		return error_page(rsp, '500');
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
			await add_message_details([message]);

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
			       person.email, person.name,
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

			let rsp = await send_email(member.email, subject, body, from);

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

			let member = await get_member(person, context_id);
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

function get_member(person, context_id, include_inactive) {
	return new Promise(async (resolve, reject) => {

		try {

			if (! person) {
				return resolve(false);
			}

			let query = await db.query(`
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

			await add_facets(member, 'member');

			resolve(member);

		} catch(err) {
			console.log(err.stack);
			reject(err);
		}
	});
}

function get_invite(slug) {
	return new Promise(async (resolve, reject) => {
		try {
			let query = await db.query(`
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

			if (query.rows.length > 0) {
				return resolve(query.rows[0]);
			}

			return resolve(null);

		} catch(err) {
			console.log(err.stack);
			reject(err);
		}

	});
}

function curr_person(req) {
	return new Promise(async (resolve, reject) => {

		try {

			if ('session' in req &&
			    'person' in req.session) {

				let query = await db.query(`
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
			console.log(err.stack);
			reject(err);
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
			await add_message_details([message]);

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

function add_context_details(context, before_id) {
	return new Promise(async (resolve, reject) => {

		try {

			let query;

			if (! context) {
				return resolve(context);
			}

			if (context.thread) {

				await add_message_details(context.thread);
				context.messages = context.thread.splice(0, 1);
				context.messages[0].replies = context.thread;

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

				await add_message_details(context.messages);
			}

			query = await db.query(`
				SELECT member.person_id, person.name, person.slug
				FROM member, person
				WHERE member.active = true
				  AND member.context_id = $1
				  AND member.person_id = person.id
				ORDER BY member.updated DESC
			`, [context.id]);

			context.members = query.rows;

			query = await db.query(`
				SELECT *
				FROM context
				WHERE parent_id = $1
			`, [context.id]);
			context.subgroups = query.rows;

			if (context.parent_id) {
				context.parent = await get_context(context.parent_id);
			}

			resolve(context);

		} catch(err) {
			console.log(err.stack);
			reject(err);
		}
	});
}

function add_message_details(messages) {
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

			let query = await db.query(`
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

			query = await db.query(`
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
			console.log(err.stack);
			reject(err);
		}
	});
}

function add_facets(target, target_type, facet_type) {
	return new Promise(async (resolve, reject) => {

		try {

			let facet_type_clause = '';
			let values = [target.id, target_type];

			if (facet_type) {
				facet_type_clause = 'AND facet_type = $3';
				values.push(facet_type);
			}

			let query = await db.query(`
				SELECT *
				FROM facet
				WHERE target_id = $1
				  AND target_type = $2
				  ${facet_type_clause}
				ORDER BY facet_num
			`, values);

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
			console.log(err.stack);
			reject(err);
		}

	});
}

function set_facet(target, target_type, facet_type, content, is_single) {
	return new Promise(async (resolve, reject) => {

		try {

			let facet_num;

			await add_facets(target, target_type);

			if (is_single) {
				facet_num = -1;
				await db.query(`
					DELETE FROM facet
					WHERE target_id = $1
					  AND target_type = $2
					  AND facet_type = $3
				`, [target.id, target_type, facet_type]);
			} else {
				facet_num = 0;
				if (target.facets[facet_type]) {
					facet_num = target.facets[facet_type].length;
				}
			}

			await db.query(`
				INSERT INTO facet
				(target_id, target_type, facet_type, facet_num, content, created, updated)
				VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			`, [target.id, target_type, facet_type, facet_num, content]);

			await add_facets(target, target_type);

			resolve(target);

		} catch(err) {
			console.log(err.stack);
			reject(err);
		}

	});
}

function send_email(to, subject, body, from) {
	return new Promise((resolve, reject) => {

		if (! from) {
			from = config.email_from;
		}

		const message = {
			from: from,
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

function random(count, is_slug) {

	const chars = 'abcdefghijkmnpqrstuwxyz0123456789';
	const letters = 'abcdefghijkmnpqrstuwxyz';

	// Note that we do not include the letters l or o to reduce the confusion
	// with numeric 1 and 0. (20181110/dphiffer)

	const rnd = crypto.randomBytes(count);
	const value = new Array(count);

	for (var i = 0; i < count; i++) {
		if (is_slug && i == 0) {

			// Context slugs cannot start with a number, which has to do with
			// matching subgroups and message IDs, so we just need to check
			// those ones. We enforce the same restriction on person slugs, only
			// to reduce the number of special cases for permalinks.
			// (20181110/dphiffer)

			let len = Math.min(256, letters.length);
			let d = 256 / len;
			value[i] = letters[Math.floor(rnd[i] / d)];

		} else {
			let len = Math.min(256, chars.length);
			let d = 256 / len;
			value[i] = chars[Math.floor(rnd[i] / d)];
		}
	}

	return value.join('');
}
