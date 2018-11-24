const config = require('../config');
const db = require('../lib/db');
const utils = require('../lib/utils');

const express = require('express');
const router = express.Router();

let subgroup_path = '/group/:slug([a-z][a-z0-9_-]+/[a-z][a-z0-9_-]+)';
router.get(['/group/:slug', subgroup_path], async (req, rsp) => {

	try {

		let context = await db.get_context(req.params.slug);
		if (! context) {
			return utils.error_page(rsp, '404');
		}

		let person = await db.curr_person(req);
		let member = await db.get_member(person, context.id, 'include inactive');
		let parent_member = false;

		if (context.parent_id) {
			parent_member = await db.get_member(person, context.parent_id);
		}

		if (! member &&
		    ! parent_member) {
			return utils.error_page(rsp, '404');
		}

		if (! member.active ||
		    (! member && parent_member)) {
			let inactive = ! (! member && parent_member);
			return rsp.render('page', {
				title: context.name,
				view: 'unsubscribed',
				content: {
					person: person,
					context: context,
					inactive: inactive
				}
			});
		}

		db.set_context(person, context);
		let contexts = await db.get_contexts(person);

		let then = req.query.then;
		if (then && ! then.match(/^\//)) {
			then = null;
		}

		let email = 'send';
		if (member.facets && member.facets.email) {
			email = member.facets.email;
		}

		rsp.render('page', {
			title: context.name,
			view: 'context',
			content: {
				person: person,
				contexts: contexts,
				context: contexts.current,
				member: member,
				base_url: config.base_url,
				then: then,
				email: email
			}
		});

	} catch(err) {
		console.log(err.stack);
		utils.error_page(rsp, '500');
	}

});

module.exports = router;
