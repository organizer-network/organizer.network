# organizer.network

_Tools and strategies for social justice organizing._

## Setup

Prerequisites:

* node.js 8/10 ([macOS](https://nodejs.org/en/), [Ubuntu](https://nodejs.org/en/download/package-manager/#debian-and-ubuntu-based-linux-distributions))
* PostgreSQL 10.x ([macOS](https://wiki.postgresql.org/wiki/Homebrew), [Ubuntu](https://tecadmin.net/install-postgresql-server-on-ubuntu/))

Quick install:

```
$ npm install
$ cp config.js.example config.js
```

Configure:

* Edit `session_secret` in `config.js`
* Edit `smtp` settings in `config.js`

Setup Postgres on macOS:

```
$ createdb aarg
$ psql aarg < db/aarg.sql
$ psql aarg < node_modules/connect-pg-simple/table.sql
```

Setup Postgres on Ubuntu:

```
$ sudo -u postgres createuser -d `whoami`
$ createdb aarg
$ psql aarg < db/aarg.sql
$ psql aarg < node_modules/connect-pg-simple/table.sql
```

If you want to set up Postgres to accept localhost connections, `edit /etc/postgresql/10/main/pg_hba.conf`:

```
# IPv4 local connections:
host    all             all             127.0.0.1/32            trust
```

If you want to use a self-signed SSL certificate (you can also comment out the `ssl` config to run on plain vanilla HTTP):

```
$ cd ssl && openssl req -newkey rsa:2048 -nodes -keyout key.pem -x509 -days 365 -out cert.pem -subj "/C=US/ST=New York/L=Troy/O=organizer.network/CN=localhost"
```
