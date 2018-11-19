const express = require('express');
const router = express.Router();

const config = require('../config');
const db = require('../lib/db');
const utils = require('../lib/utils');

router.get('/group', async (req, rsp) => {

	try {

		let person = await db.curr_person(req);
		let contexts = await db.get_contexts(person);

		if (! person) {
			return rsp.redirect('/?then=%2Fgroup');
		}

		let default_slug = utils.random(16, 'slug');

		rsp.render('page', {
			title: 'Create a new group',
			view: 'new-group',
			content: {
				person: person,
				contexts: contexts,
				base_url: config.base_url,
				default_slug: default_slug
			}
		});

	} catch(err) {
		console.log(err.stack);
		utils.error_page(rsp, '500');
	}
});

module.exports = router;
