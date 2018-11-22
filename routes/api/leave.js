const db = require('../../lib/db');
const utils = require('../../lib/utils');

const express = require('express');
const router = express.Router();

router.get('/leave/:id', async (req, rsp) => {

	try {

		let query = await db.query(`
			SELECT member.leave_slug, member.person_id, member.context_id,
			       context.name AS context_name
			FROM member, context
			WHERE member.active = true
			  AND member.leave_slug = $1
			  AND member.context_id = context.id
		`, [req.params.id]);

		if (query.rows.length < 1) {
			return utils.error_page(rsp, 'invalid-unsubscribe');
		}

		let member = query.rows[0];

		await db.query(`
			UPDATE member
			SET active = false
			WHERE leave_slug = $1
		`, [member.leave_slug]);

		await db.query(`
			UPDATE person
			SET context_id = NULL
			WHERE id = $1
			  AND context_id = $2
		`, [member.person_id, member.context_id]);

		let context = await db.get_context(member.context_id);

		rsp.redirect(`/group/${context.slug}`);

	} catch(err) {
		console.log(err.stack);
		return utils.error_page(rsp, '500');
	}

});

module.exports = router;
