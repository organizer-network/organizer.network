const config = require('../../config');
const db = require('../../lib/db');
const utils = require('../../lib/utils');
const notify = require('../../lib/notify');
const instance = require('../../lib/instance');

const express = require('express');
const router = express.Router();

// Because the login hashes are stored in memory (and not in the database), it
// is important to check for pending logins when restarting the server. There is
// a console.log() of the number of pending logins whenever the number changes.
// (20181022/dphiffer)
const login_hashes = {};
const login_ips = {};

function reset_login_throttle(req) {
	let ip = utils.ip_address(req);
	delete login_ips[ip];
}

function throttle_logins(req) {

	let ip = utils.ip_address(req);
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

router.post('/api/login', async (req, rsp) => {

	try {

		if (! 'body' in req ||
		    ! 'email' in req.body) {
			return rsp.status(400).send({
				ok: false,
				error: "Please include 'email' for your login."
			});
		}

		let hash = utils.random(16);
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
			hash = utils.random(16);
			login_url = `${config.base_url}/login/${hash}`;
		}

		const email = utils.normalize_email(req.body.email);
		const subject = `${instance.name} login link`;
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
			slug = utils.random(6, 'slug');
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

		await notify.send_email(email, subject, body);

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

router.get('/login/:hash', async (req, rsp) => {

	try {

		if (throttle_logins(req)) {
			return utils.error_page(rsp, 'invalid-login');
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
				return utils.error_page(rsp, 'invalid-login');
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
				await db.join_context(person, member.context_id, invited_by);
				let context = await db.get_context(member.context_id);

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

		utils.error_page(rsp, 'invalid-login');

	} catch(err) {
		console.log(err.stack);
		utils.error_page(rsp, '500');
	}
});

router.get('/logout', (req, rsp) => {
	delete req.session.person;
	rsp.redirect(`${config.base_url}/`);
});

module.exports = router;
