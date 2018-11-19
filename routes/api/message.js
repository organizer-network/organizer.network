const db = require('../../lib/db');
const utils = require('../../lib/utils');

const express = require('express');
const router = express.Router();

router.get('/api/message/:id', async (req, rsp) => {

	try {
		let id = parseInt(req.params.id);
		let revision = req.query.revision || null;
		let message = await db.get_message(id, revision);

		if (! message) {
			return rsp.status(404).send({
				ok: false,
				error: 'Message not found.'
			});
		}

		let person = await db.curr_person(req);
		let member = await db.get_member(person, message.context_id);

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
		return utils.error_page(rsp, '500');
	}
});

module.exports = router;
