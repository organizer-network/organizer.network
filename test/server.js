const request = require('supertest');
const create_server = require('../lib/server');
const db = require('../lib/db');

describe('lib/server.js', () => {

	var server;

	beforeEach(() => {
		server = create_server();
	});

	afterEach(() => {
		server.close();
	});

	after(() => {
		db.end();
	});

	it('responds to /', (done) => {
		request(server)
		.get('/')
		.expect(200, done);
	});

	it('404 everything else', (done) => {
		request(server)
		.get('/foo/bar')
		.expect(404, done);
	});
});
