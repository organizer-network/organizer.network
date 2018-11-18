#!/usr/bin/env node

const db = require('../lib/db');
const config = require('../config');

find_digests()
.then(async (digests) => {
	let count = 0;
	for (let person_id in digests) {
		count += await send_digest_email(person_id, digests[person_id]);
	}
	console.log(`Sent ${count} digest emails.`);
})
.catch((err) => {
	console.log(err.stack);
});

function find_digests() {
	return new Promise(async (resolve, reject) => {
		try {

			let members = await db.get_digest_members();
			let digests = {};

			for (let member of members) {
				if (! digests[member.person_id]) {
					digests[member.person_id] = [];
				}
				digests[member.person_id].push(member.context_id);
			}

			resolve(digests);

		} catch(err) {
			console.log("Could not find digests.");
			reject(err);
		}
	});
}

function send_digest_email(person_id, contexts) {
	return new Promise(async (resolve, reject) => {

		try {

			let person = await db.get_person(parseInt(person_id));
			let digest = [];
			let msg_count = 0;

			for (let context_id of contexts) {

				let context = await db.get_context(parseInt(context_id));

				let facet = `last_digest_message_${context_id}`;
				await db.add_facets(person, 'person', facet);

				let messages = await db.get_digest_messages(person, context);
				let reply_msgs = {};

				if (messages.length == 0) {
					continue;
				}

				let last_message_id = messages[messages.length - 1].id;
				let replies = await db.get_digest_replies(messages);

				for (let reply of replies) {
					let content = reply.content;
					content = content.replace(/\s+/g, ' ');
					if (content.length > 48) {
						content = content.substr(0, 48) + '...';
					}
					reply_msgs[reply.id] = content;
				}

				let context_digest = [];
				for (let message of messages) {

					let subject = '';
					let message_url = `${config.base_url}/group/${context.slug}/${message.id}`;

					if (message.in_reply_to) {
						subject = `Re: ${reply_msgs[message.in_reply_to]}\n`;
						message_url = `${config.base_url}/group/${context.slug}/${message.in_reply_to}#${message.id}`;
					}

					context_digest.push(`${subject}${message.name} at ${message.created}:

${message.content}

Message link:
${message_url}`);
				}

				if (context_digest.length > 0) {
					await db.set_facet(person, 'person', facet, last_message_id, 'single');
					let context_txt = `${context.name}\n==================================================\n\n` + context_digest.join('\n\n---\n\n');
					digest.push(context_txt);
					msg_count += context_digest.length;
				}
			}

			if (msg_count > 0) {
				let plural = (msg_count == 1) ? '' : 's';
				let subject = `Digest: ${msg_count} message${plural}`;
				let body = digest.join('\n\n\n') + `\n\n---\nNotification settings:\n${config.base_url}/settings`;
				await notify.send_email(person.email, subject, body);
				return resolve(1);
			}

			resolve(0);

		} catch(err) {
			console.log('Could not send digest emails');
			reject(err);
		}

	});
}
