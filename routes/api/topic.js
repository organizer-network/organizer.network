const db = require('../../lib/db');

const express = require('express');
const router = express.Router();

router.post('/api/topic', async (req, rsp) => {

	try {

		let id = req.body.context_id;
		if (! id) {
			return rsp.status(400).send({
				ok: false,
				error: "Please include a 'context_id' param."
			});
		}

		let topic = req.body.topic;
		if (! 'topic' in req.body) {
			return rsp.status(400).send({
				ok: false,
				error: "Please include a 'topic' param."
			});
		}

		await db.query(`
			UPDATE context
			SET topic = $1
			WHERE id = $2
		`, [topic, id]);

		rsp.send({
			ok: true,
			topic: topic
		});

	} catch(err) {
		console.log(err.stack);
		rsp.status(500).send({
			ok: false,
			error: 'Could not set topic.'
		});
	}

});

module.exports = router;
