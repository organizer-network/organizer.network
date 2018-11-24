const config = require('../config');
const db = require('../lib/db');
const utils = require('../lib/utils');

const express = require('express');
const router = express.Router();

router.get('/settings/:slug', async (req, rsp) => {

	try {

		let person = await db.curr_person(req);
		let context = await db.get_context(req.params.slug);

		if (! context) {
			return utils.error_page(rsp, '404');
		}

		let member = await db.get_member(person, context.id);
		let contexts = await db.get_contexts(person);

		if (! member) {
			return utils.error_page(rsp, '404');
		}

		let email = 'send';
		if (member.facets && member.facets.email) {
			email = member.facets.email;
		}

		let then = `/group/${context.slug}`;
		if (req.query.then) {
			then = req.query.then;
		}

		rsp.render('page', {
			title: 'Settings',
			view: 'settings',
			content: {
				context: context,
				contexts: contexts,
				person: person,
				member: member,
				email: email,
				then: then
			}
		});

	} catch(err) {
		console.log(err.stack);
		return utils.error_page(rsp, '500');
	}

});

module.exports = router;
