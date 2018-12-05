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

				self.send_notifications(person, message, from);
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
	},

	send_notifications: async (sender, message, from) => {

		try {

			let query = await db.query(`
				SELECT member.id, member.invite_slug, member.leave_slug,
				       person.id AS person_id, person.email, person.name,
				       context.name AS context_name, context.slug AS context_slug
				FROM member, person, context
				WHERE member.context_id = $1
				  AND member.active = true
				  AND member.person_id != $2
				  AND person.id = member.person_id
				  AND context.id = member.context_id
			`, [message.context_id, message.person_id]);

			let members = query.rows;

			let placeholders = [];
			let values = [];
			for (let member of members) {
				values.push(member.id);
				placeholders.push(`$${values.length}`);
			}
			let email_settings = {};

			if (values.length > 0) {
				placeholders = placeholders.join(', ');
				query = await db.query(`
					SELECT target_id, content
					FROM facet
					WHERE target_id IN (${placeholders})
					  AND target_type = 'member'
					  AND facet_type = 'email'
				`, values);

				for (let facet of query.rows) {
					email_settings[facet.target_id] = facet.content;
				}
			}

			let max_subject_length = 48;
			let subject = message.content;
			if (message.in_reply_to) {
				query = await db.query(`
					SELECT content
					FROM message
					WHERE id = $1
				`, [message.in_reply_to]);
				subject = `Re: ${query.rows[0].content}`;
				max_subject_length += 4;
			}
			subject = subject.replace(/\s+/g, ' ');
			if (subject.length > max_subject_length) {
				subject = subject.substr(0, max_subject_length) + '...';
			}

			for (let member of members) {

				if (email_settings[member.id] &&
				    email_settings[member.id] != 'send') {
					continue;
				}

				let message_link = `${config.base_url}/group/${member.context_slug}/${message.id}`;
				if (message.in_reply_to) {
					message_link = `${config.base_url}/group/${member.context_slug}/${message.in_reply_to}#${message.id}`;
				}

				let body = `${message.content}

---
Message link:
${message_link}

Too many emails? Update your notification settings:
${config.base_url}/settings

Unsubscribe from ${member.context_name}:
${config.base_url}/leave/${member.leave_slug}`;

				let rsp = await self.send_email(member.email, subject, body, from);

				if (rsp && rsp.length > 0 && rsp[0].headers) {
					let email_id = rsp[0].headers['x-message-id'];
					db.query(`
						INSERT INTO email_tx
						(id, context_id, message_id, person_id, created)
						VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
					`, [email_id, message.context_id, message.id, member.person_id]);
				}

			}

		} catch(err) {
			console.log(err.stack);
		}
	}
};

module.exports = self;
