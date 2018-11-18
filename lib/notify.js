const config = require('../config');
const nodemailer = require('nodemailer');
const sendgrid = require('@sendgrid/mail');

// Setup SMTP if it's configured
if ('smtp' in config) {
	var smtp_transport = nodemailer.createTransport(config.smtp);
}

// Setup SendGrid if it's configured
if ('sendgrid_api_key' in config) {
	sendgrid.setApiKey(config.sendgrid_api_key);
}

const self = {

	send_email: (to, subject, body, from) => {
		return new Promise((resolve, reject) => {

			if (! from) {
				from = config.email_from;
			}

			const message = {
				from: from,
				to: to,
				subject: subject,
				text: body
			};

			if ('sendgrid_api_key' in config) {
				sendgrid.send(message)
				.then((rsp) => {
					resolve(rsp);
				})
				.catch(err => {
					reject(err);
				});
			} else if ('smtp' in config) {
				smtp_transport.sendMail(message, (err, info) => {
					if (err) {
						return reject(err);
					}
					return resolve(info);
				});
			}
		});
	}
};

module.exports = self;
