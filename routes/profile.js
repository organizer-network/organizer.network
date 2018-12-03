const config = require('../config');
const db = require('../lib/db');
const utils = require('../lib/utils');

const express = require('express');
const router = express.Router();

router.use(async (req, rsp) => {

	try {

		let curr_id = null;
		let curr = await db.curr_person(req);
		if (curr) {
			curr_id = curr.id;
		}

		if (utils.url_slug_match(req.path.substr(1))) {
			let profile = await db.get_person(req.path.substr(1));
			if (profile) {
				let then = req.query.then;
				if (then && ! (/^\//)) {
					then = null;
				}
				rsp.render('page', {
					title: profile.name || 'Profile',
					view: 'profile',
					content: {
						profile: profile,
						person: curr,
						edit: (req.query.edit == '1'),
						base_url: config.base_url,
						curr_id: curr_id,
						then: then,
						contexts: await db.get_contexts(curr)
					}
				});
				return;
			}
		}

		rsp.status(404);
		utils.error_page(rsp, '404');

	} catch(err) {
		console.log(err.stack);
		return utils.error_page(rsp, '500');
	}
});

module.exports = router;
