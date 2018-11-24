const db = require('../../lib/db');

const express = require('express');
const router = express.Router();

router.get('/api/replies/:id', async (req, rsp) => {

	try {
		let query = await db.query(`
			SELECT message.*,
			       person.name AS person_name, person.slug AS person_slug,
			       context.slug AS context_slug
			FROM message, person, context
			WHERE message.id = $1
			  AND message.person_id = person.id
			  AND message.context_id = context.id
		`, [req.params.id]);

		if (query.rows.length == 0) {
			return rsp.status(404).send({
				ok: false,
				error: 'Message not found.'
			});
		}

		let message = query.rows[0];
		await db.add_message_details([message]);

		let person = await db.curr_person(req);
		let member = await db.get_member(person, message.context_id);

		query = await db.query(`
			SELECT message.*,
			       person.name AS person_name, person.slug AS person_slug
			FROM message, person
			WHERE message.in_reply_to = $1
			  AND message.person_id = person.id
			ORDER BY message.created
		`, [req.params.id]);

		message.replies = query.rows;
		await db.add_message_details(message.replies);

		rsp.render('replies', {
			message: message,
			context: {
				id: message.context_id,
				slug: message.context_slug
			},
			member: member
		});

	} catch (err) {
		console.log(err.stack);
		return rsp.status(500).send('<div class="response">Could not load replies.</div>');
	}
});

module.exports = router;
