const config = require('../config');
const db = require('./db');

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

	send_message: (person, context_id, in_reply_to, content) => {
		return new Promise(async (resolve, reject) => {

			try {

				let query = await db.query(`
					INSERT INTO message
					(person_id, context_id, in_reply_to, content, created, updated)
					VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
					RETURNING *
				`, [person.id, context_id, in_reply_to, content]);

				let message = query.rows[0];
				await db.add_message_details([message]);

				resolve(message);

				let from = config.email_from;
				let email_match = from.match(/<([^>]+)>/);

				if (email_match) {
					from = `"${person.name}" <${email_match[1]}>`;
				} else {
					// This is assuming config.from_email is set to an email address
					// without a "name" part, e.g. 'foo@bar.com'
					from = `"${person.name}" <${from}>`;
				}

				send_notifications(person, message, from);
				await db.query(`
					UPDATE member
					SET updated = CURRENT_TIMESTAMP
					WHERE person_id = $1
					  AND context_id = $2
				`, [person.id, context_id]);

			} catch(err) {
				reject(err);
			}
		});
	},

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
