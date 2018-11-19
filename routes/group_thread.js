const config = require('../config');
const db = require('../lib/db');
const utils = require('../lib/utils');

const express = require('express');
const router = express.Router();

let subthread_path = '/group/:slug([a-z][a-z0-9_-]+/[a-z][a-z0-9_-]+)/:id';
router.get(['/group/:slug/:id', subthread_path], async (req, rsp) => {

	try {

		let context = await db.get_context(req.params.slug);
		if (! context) {
			return utils.error_page(rsp, '404');
		}

		let person = await db.curr_person(req);
		let member = await db.get_member(person, context.id);

		if (! member) {
			return utils.error_page(rsp, '404');
		}

		db.set_context(person, context);

		let id = parseInt(req.params.id);
		let contexts = await db.get_contexts(person, id);

		let email = 'send';
		if (member.facets && member.facets.email) {
			email = member.facets.email;
		}

		rsp.render('page', {
			title: context.name,
			view: 'thread',
			content: {
				person: person,
				contexts: contexts,
				context: contexts.current,
				member: member,
				base_url: config.base_url,
				email: email
			}
		});

	} catch(err) {
		console.log(err.stack);
		utils.error_page(rsp, '500');
	}

});

module.exports = router;
