const db = require('../../lib/db');
const utils = require('../../lib/utils');
const notify = require('../../lib/notify');

const express = require('express');
const router = express.Router();

router.post('/api/profile', async (req, rsp) => {

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

		if (! utils.url_slug_match(req.body.slug)) {
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

module.exports = router;
