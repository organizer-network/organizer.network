const db = require('../../lib/db');

const express = require('express');
const router = express.Router();

router.post('/api/settings', async (req, rsp) => {

	try {

		if (! req.body.context_id) {
			return rsp.status(400).send({
				ok: false,
				error: 'Please include a context_id argument.'
			});
		}

		var person = await db.curr_person(req);
		var context = await db.get_context(parseInt(req.body.context_id));

		if (! person || ! context) {
			return rsp.status(400).send({
				ok: false,
				error: 'Invalid context or person record.'
			});
		}

		var member = await db.get_member(person, context.id);

		if (! member) {
			return rsp.status(403).send({
				ok: false,
				error: 'You are not a member of that group.'
			});
		}

		const valid_email_values = [
			'send',
			'digest',
			'none'
		];

		if (! req.body.email in valid_email_values) {
			return rsp.status(400).send({
				ok: false,
				error: 'Invalid email setting.'
			});
		}

		await db.set_facet(member, 'member', 'email', req.body.email, 'single');

		rsp.send({
			ok: true,
			group_url: '/group/' + context.slug
		});

	} catch(err) {
		console.log(err.stack);
		rsp.status(500).send({
			ok: false,
			error: 'Could not update settings.'
		});
	}

});

module.exports = router;
