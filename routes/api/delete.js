const db = require('../../lib/db');

const express = require('express');
const router = express.Router();

router.post('/api/delete', async (req, rsp) => {

	try {

		let id = req.body.id;
		if (! id) {
			return rsp.status(400).send({
				ok: false,
				error: "Please include a message 'id' param."
			});
		}

		let person = await db.curr_person(req);
		let message = await db.get_message(id);
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
			  AND facet_type = 'message'
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

module.exports = router;
