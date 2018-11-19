const db = require('../../lib/db');
const notify = require('../../lib/notify');

const express = require('express');
const router = express.Router();

router.post('/api/send', async (req, rsp) => {

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

		let person = await db.curr_person(req);
		let member = await db.get_member(person, context_id);

		if (! member) {
			return rsp.status(403).send({
				ok: false,
				error: "You cannot send messages to that context."
			});
		}

		let message = await notify.send_message(person, context_id, in_reply_to, content);
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

module.exports = router;
