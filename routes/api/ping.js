const utils = require('../../lib/utils');

const express = require('express');
const router = express.Router();

router.post('/api/ping', (req, rsp) => {
	const ip = utils.ip_address(req);
	return rsp.send({
		ok: true,
		pong: ip
	});
});

module.exports = router;
