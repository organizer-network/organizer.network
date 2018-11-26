// organizer.network
// v0.1.1 "klatch"

// versioning based on Tom Gauld's A Noisy Alphabet
// http://myjetpack.tumblr.com/post/65442529656/a-noisy-alphabet-a-new-screenprint-by-tom

const utils = require('./lib/utils');
utils.check_config();

const config = require('./config');
const db = require('./lib/db');
const notify = require('./lib/notify');

// server
const express = require('express');
const app = express();

const body_parser = require('body-parser');
const session = require('express-session');
const pg_session = require('connect-pg-simple')(session);

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(body_parser.urlencoded({ extended: false }));
app.use(body_parser.json());
app.use(session({
	store: new pg_session({
		pool: db.pool()
	}),
	secret: config.session_secret,
	resave: false,
	saveUninitialized: false,
	proxy: true,
	cookie: {
		secure: false,
		maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
	}
}));
app.use((req, rsp, next) => {
	rsp.append('X-Frame-Options', 'deny');
	rsp.append('Cache-Control', 'no-cache,no-store');
	rsp.append('Pragma', 'no-cache');
	rsp.append('X-Content-Type-Options', 'nosniff');
	rsp.append('X-XSS-Protection', '1; mode=block');
	rsp.append('Content-Security-Policy', "default-src 'self';");
	next();
});
app.enable('trust proxy');

app.use(require('./routes/home'));                // /
app.use(require('./routes/group_create'));        // /group
app.use(require('./routes/group_index'));         // /group/:slug
app.use(require('./routes/group_thread'));        // /group/:slug/:id
app.use(require('./routes/join'));                // /join/:slug
app.use(require('./routes/settings_index'));      // /settings
app.use(require('./routes/settings_group'));      // /settings/:slug
app.use(require('./routes/person_css'));          // /person.css
app.use(require('./routes/api/ping'));            // /api/ping
app.use(require('./routes/api/login'));           // /api/login
                                                  // /login/:slug
                                                  // /logout
app.use(require('./routes/api/group'));           // /api/group
app.use(require('./routes/api/group_messages'));  // /api/group/:slug
app.use(require('./routes/api/send'));            // /api/send
app.use(require('./routes/api/reply'));           // /api/reply
app.use(require('./routes/api/profile'));         // /api/profile
app.use(require('./routes/api/message'));         // /api/message
app.use(require('./routes/api/replies'));         // /api/replies
app.use(require('./routes/api/update'));          // /api/update
app.use(require('./routes/api/delete'));          // /api/delete
app.use(require('./routes/api/leave'));           // /api/leave
app.use(require('./routes/api/join'));            // /api/join
app.use(require('./routes/api/settings'));        // /api/settings
app.use(require('./routes/profile.js'));          // /:slug

module.exports = app;
