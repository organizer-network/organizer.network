# organizer.network

_Tools and strategies for social justice organizing._

## Setup

Prerequisites:

* node.js 8/10
* PostgreSQL 10.x

Quick install:

```
$ npm install
$ cp config.js.example config.js
$ cd ssl && openssl req -newkey rsa:2048 -nodes -keyout key.pem -x509 -days 365 -out cert.pem -subj "/C=US/ST=New York/L=Troy/O=organizer.network/CN=localhost"
$ createdb aarg
$ psql aarg < db/aarg.sql
```

Configure:

* Edit `session_secret` in `config.js`
* Edit `smtp` settings in `config.js`
