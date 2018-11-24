const config = require('../../config');
const db = require('../../lib/db');
const utils = require('../../lib/utils');

const express = require('express');
const router = express.Router();

router.post('/api/group', async (req, rsp) => {

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

		if (! utils.url_slug_match(slug)) {
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

module.exports = router;
