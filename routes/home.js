const config = require('../config');
const db = require('../lib/db');
const utils = require('../lib/utils');
const instance = require('../lib/instance');

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
					instance: instance,
					invite: null,
					then: then
				}
			});
		}

		let contexts = await db.get_contexts(person);
		let latest_messages = await db.get_latest_messages(contexts.member_of);

		let by_last_updated = (a, b) => {
			if (a.last_updated > b.last_updated) {
				return -1;
			} else {
				return 1;
			}
		};

		for (let group of contexts.member_of) {
			group.last_updated = group.created;
			if (group.subgroups) {
				for (let subgroup of group.subgroups) {
					subgroup.last_updated = subgroup.created;
					group.last_updated = Math.max(group.last_updated, subgroup.last_updated);
				}
				group.subgroups.sort(by_last_updated);
			}
		}

		contexts.member_of.sort(by_last_updated);

		let then = req.query.then;
		if (then && ! then.match(/^\//)) {
			then = null;
		}

		rsp.render('page', {
			title: 'Hello',
			view: 'home',
			content: {
				instance: instance,
				person: person,
				contexts: contexts,
				latest_messages: latest_messages,
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
