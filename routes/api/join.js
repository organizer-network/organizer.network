const db = require('../../lib/db');

const express = require('express');
const router = express.Router();

router.post('/api/join', async (req, rsp) => {

	try {

		if (! req.body.context_id) {
			return rsp.status(400).send({
				ok: false,
				error: "Please include a 'context_id' param."
			});
		}

		let person = await db.curr_person(req);
		if (! person) {
			return rsp.status(403).send({
				ok: false,
				error: 'You must be signed in to join groups.'
			});
		}

		let context_id = parseInt(req.body.context_id);
		let member = await db.get_member(person, context_id, 'include_inactive');
		if (! member) {

			let context = await db.get_context(context_id);
			if (context.parent_id) {
				let parent_member = await db.get_member(person, context.parent_id);
				if (parent_member) {
					await db.join_context(person, context_id);
					return rsp.send({
						ok: true
					});
				}
			}

			return rsp.status(403).send({
				ok: false,
				error: 'Sorry you cannot join that group.'
			});
		}

		await db.query(`
			UPDATE member
			SET active = true
			WHERE person_id = $1
			  AND context_id = $2
		`, [person.id, context_id]);

		await db.query(`
			UPDATE person
			SET context_id = $1
			WHERE id = $2
		`, [context_id, person.id]);

		rsp.send({
			ok: true
		});

	} catch(err) {
		console.log(err.stack);
		rsp.status(500).send({
			ok: false,
			error: 'Could not join group.'
		});
	}

});

module.exports = router;
