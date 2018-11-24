const db = require('../../lib/db');

const express = require('express');
const router = express.Router();

router.post('/api/update', async (req, rsp) => {

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
		let message = await db.get_message(id);

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

		message = await db.get_message(id);

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

module.exports = router;
