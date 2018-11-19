const config = require('../config');
const db = require('../lib/db');
const utils = require('../lib/utils');

const express = require('express');
const router = express.Router();

router.get('/', async (req, rsp) => {

	try {

		let person = await db.curr_person(req);

		if (! person) {
			let then = req.query.then;
			if (then && ! then.match(/^\//)) {
				then = null;
			}
			return rsp.render('page', {
				title: 'Welcome',
				view: 'login',
				content: {
					invite: null,
					then: then
				}
			});
		}

		if (person.context_id) {

			// If the person is logged in, and has a group context ID, redirect.

			let context = await db.get_context(person.context_id);
			return rsp.redirect(`/group/${context.slug}`);
		}

		let contexts = await db.get_contexts(person);

		let then = req.query.then;
		if (then && ! then.match(/^\//)) {
			then = null;
		}

		rsp.render('page', {
			title: 'Hello',
			view: 'home',
			content: {
				person: person,
				contexts: contexts,
				base_url: config.base_url,
				then: then
			}
		});

	} catch(err) {
		console.log(err.stack);
		utils.error_page(rsp, '500');
	}
});

module.exports = router;
