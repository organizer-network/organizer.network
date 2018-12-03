const config = require('../config');
const db = require('../lib/db');
const utils = require('../lib/utils');

const express = require('express');
const router = express.Router();

router.get('/person.css', async (req, rsp) => {

	rsp.append('Content-Type', 'text/css');

	const person = await db.curr_person(req);
	if (person) {
		rsp.send(`
			.message.person-${person.slug} > .message-options {
				display: block;
			}
		`);
	} else {
		rsp.send('');
	}

});

module.exports = router;
