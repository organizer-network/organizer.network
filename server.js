module.exports = () => {

	let server;

	const fs = require('fs');
	const config = require('./config');
	const app = require('./app');

	if ('ssl' in config) {
		// Setup HTTPS server
		let https_options = {};
		for (let key in config.ssl) {
			https_options[key] = fs.readFileSync(`${__dirname}/${config.ssl[key]}`);
		}
		server = require('https').createServer(https_options, app);
	} else {
		// Setup HTTP server
		server = require('http').createServer(app);
	}

	server.listen(config.port, () => {
		console.log(`listening on *:${config.port}`);
	});

	const io = require('socket.io')(server);

	// Setup CORS
	io.origins((origin, callback) => {
		if (config.cors_origins.indexOf('*') !== -1) {
			callback(null, true);
		} else if (config.cors_origins.indexOf(origin) !== -1 ||
		           config.cors_origins.indexOf(origin + '/') !== -1) {
			callback(null, true);
		} else {
			console.log(`CORS blocked origin: ${origin}`);
			return callback('origin not allowed', false);
		}
	});

	return server;

};
