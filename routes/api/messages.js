const db = require('../../lib/db');

const express = require('express');
const router = express.Router();

router.get(['/api/messages', '/api/messages/:slug'], async (req, rsp) => {

	try {

		let person = await db.curr_person(req);

		if (! person) {
			return rsp.status(403).send({
				ok: false,
				error: 'You must be signed in to load group content.'
			});
		}

		let context;
		if (req.params.slug) {
			context = await db.get_context(req.params.slug);
			if (! context) {
				return rsp.status(404).send({
					ok: false,
					error: 'Context not found.'
				});
			}

			let member = await db.get_member(person, context.id);
			if (! member) {
				return rsp.status(403).send({
					ok: false,
					error: 'You are not authorized to load that group content.'
				});
			}
		} else {
			let contexts = await db.get_contexts(person);
			context = await db.get_latest_messages(contexts.member_of);
		}

		let before_id = null;
		if ('before_id' in req.query) {
			before_id = parseInt(req.query.before_id);
		}
		await db.add_context_details(context, before_id);

		rsp.render('message-page', {
			context: context
		});

	} catch(err) {
		console.log(err.stack);
		rsp.status(500).send({
			ok: false,
			error: 'Could not load group messages.'
		});
	}

});

module.exports = router;
