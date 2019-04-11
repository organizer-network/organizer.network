const config = require('../config');
const db = require('../lib/db');
const utils = require('../lib/utils');

const instance = require('../lib/instance');
const express = require('express');
const router = express.Router();

router.get('/join/:slug', async (req, rsp) => {

	try {

		let invite = await db.get_invite(req.params.slug);
		if (! invite) {
			return utils.error_page(rsp, '404');
		}

		let person = await db.curr_person(req);

		let then = req.query.then;
		if (then && ! then.match(/^\//)) {
			then = null;
		}

		if (! person) {
			rsp.render('page', {
				title: 'Welcome',
				view: 'login',
			    content: {
				instance: instance,
					invite: invite,
					then: then
				}
			});
		} else {
			let invited_by = invite.person_id;
			await db.join_context(person, invite.context.id, invited_by);
			rsp.redirect(`${config.base_url}/group/${invite.context.slug}`);
		}

	} catch(err) {
		console.log(err.stack);
		return utils.error_page(rsp, '500');
	}

});

module.exports = router;
