const config = require('../config');
const db = require('../lib/db');
const utils = require('../lib/utils');

const express = require('express');
const router = express.Router();

router.get('/settings', async (req, rsp) => {

	try {

		let person = await db.curr_person(req);

		if (! person) {
			let then = '/settings';
			return rsp.render('page', {
				title: 'Login to continue',
				view: 'login',
				content: {
					invite: null,
					then: then
				}
			});
		}

		let contexts = await db.get_contexts(person);

		for (let context of contexts.member_of) {
			let member = await db.get_member(person, context.id);
			await db.add_facets(member, 'member', 'email');
			if (! member.facets) {
				member.facets = {};
			}
			if (! member.facets.email) {
				member.facets.email = 'send';
			}
			context.email = member.facets.email;
		}

		rsp.render('page', {
			title: 'Settings',
			view: 'settings',
			content: {
				context: null,
				contexts: contexts,
				person: person
			}
		});

	} catch(err) {
		console.log(err.stack);
		return utils.error_page(rsp, '500');
	}

});

module.exports = router;
