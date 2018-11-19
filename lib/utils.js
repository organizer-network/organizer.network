const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = {

	check_config: () => {
		if (! fs.existsSync(`${__dirname}/../config.js`)) {
			console.log('Please set up config.js');
			process.exit();
		}
	},

	random: (count, is_slug) => {

		const chars = 'abcdefghijkmnpqrstuwxyz0123456789';
		const letters = 'abcdefghijkmnpqrstuwxyz';

		// Note that we do not include the letters l or o to reduce the confusion
		// with numeric 1 and 0. (20181110/dphiffer)

		const rnd = crypto.randomBytes(count);
		const value = new Array(count);

		for (var i = 0; i < count; i++) {
			if (is_slug && i == 0) {

				// Context slugs cannot start with a number, which has to do with
				// matching subgroups and message IDs, so we just need to check
				// those ones. We enforce the same restriction on person slugs, only
				// to reduce the number of special cases for permalinks.
				// (20181110/dphiffer)

				let len = Math.min(256, letters.length);
				let d = 256 / len;
				value[i] = letters[Math.floor(rnd[i] / d)];

			} else {
				let len = Math.min(256, chars.length);
				let d = 256 / len;
				value[i] = chars[Math.floor(rnd[i] / d)];
			}
		}

		return value.join('');
	},

	normalize_email: (email) => {
		return email.trim().toLowerCase();
	},

	error_page: (rsp, type) => {
		rsp.render('page', {
			title: 'Error',
			view: 'error',
			content: {
				type: type
			}
		});
	}

};
