# organizer.network

_Tools and strategies for social justice organizing._

## Setup

Prerequisites:

* node.js 8/10 ([macOS](https://nodejs.org/en/), [Ubuntu](https://nodejs.org/en/download/package-manager/#debian-and-ubuntu-based-linux-distributions))
* PostgreSQL 10.x ([macOS](https://wiki.postgresql.org/wiki/Homebrew), [Ubuntu](https://tecadmin.net/install-postgresql-server-on-ubuntu/))

Setup node.js packages:

```
$ npm install
```

Configure:

```
$ cp config.js.example config.js
```

* Edit `session_secret` in `config.js`
* Edit `smtp` settings in `config.js`

Database setup:

(Ubuntu users may need to `createuser` and allow local connections, described below.)

```
$ cd db/
$ make setup
```

## Database tasks

Backup (it's a good idea to automate this):

```
$ cd db/
$ make backup
```

Migrate during upgrades:

```
$ cd db/
$ make migrate
```

Setup a Postgres account on Ubuntu:

```
$ sudo -u postgres createuser -d `whoami`
```

Setup Postgres to accept localhost connections on Ubuntu:

Edit `edit /etc/postgresql/10/main/pg_hba.conf` with the following line change.

```
# IPv4 local connections:
host    all             all             127.0.0.1/32            trust
```

## SSL certificates

The `ssl` section of `config.js` configures your SSL certificate/key. If you comment out this part of the configuration the server will use plain vanilla HTTP.

If you want to use a self-signed SSL certificate for development purposes:

```
$ cd ssl && openssl req -newkey rsa:2048 -nodes -keyout key.pem -x509 -days 365 -out cert.pem -subj "/C=US/ST=New York/L=Troy/O=organizer.network/CN=localhost"
```
