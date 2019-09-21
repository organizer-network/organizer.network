const db = require('../../lib/db');
const notify = require('../../lib/notify');

const multer = require('multer');
const upload = multer();

const express = require('express');
const router = express.Router();

router.post('/api/reply', upload.none(), async (req, rsp) => {

	try {

		let reply = req.body;

		if (! reply.headers || ! reply.text) {
			return rsp.status(400).send({
				ok: false,
				error: 'Please post a valid JSON reply object.'
			});
		}

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
			let in_reply_to_msg = await db.get_message(in_reply_to);
			if (in_reply_to_msg.in_reply_to) {
				in_reply_to = parseInt(in_reply_to_msg.in_reply_to);
			}

			let person = await db.get_person(person_id);
			let message = await notify.send_message(person, context_id, in_reply_to, content);
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
			'ok': false,
			'error': err.toString()
		});
	}

});

module.exports = router;
