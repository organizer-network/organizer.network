# organizer.network

_Tools and strategies for social justice organizing._

## Early days

It's worth pointing out that this project is still in its early days, so proceed with a sense of adventure and patience.

## Versioning

* Current release: __[v0.0.5 "eeeeee"](https://github.com/organizer-network/organizer.network/releases/tag/v0.0.5)__ (on the `master` branch)
* Under development: __v0.0.6 "foom"__ (on the `develop` branch)

Versions names are based on [Tom Gauld's *A Noisy Alphabet*](http://myjetpack.tumblr.com/post/65442529656/a-noisy-alphabet-a-new-screenprint-by-tom).

## Developer setup

_This has only been tested on macOS and Ubuntu, but there's no reason to think it wouldn't work on other platforms. I definitely welcome hearing about your experience on, for example, Windows._

Dependencies:

* node.js 8 or 10
* PostgreSQL 10 or 11

## macOS setup

Note that these instructions are assuming a macOS development environment. You may need to adjust for other platforms. If you're looking to install this on a server, you may want to check out the [server setup guide](setup/setup.md).

* Install [node.js](https://nodejs.org/en/)
* Install PostgreSQL with Homebrew:

```
$ brew install postgres
```

Clone the repo:

```
$ git clone https://github.com/organizer-network/organizer.network.git
$ cd organizer.network
```

Setup node.js packages:

```
$ npm install
```

## Configure

First make a copy of the example config file:

```
$ cp config.js.example config.js
```

* Edit `session_secret` in `config.js`

Open config.js and place a new key inside `session_secret`. To generate a new random key run the following command in your terminal. This is just a random string that makes the browser sessions work securely.

```
$ openssl rand -hex 24
```

Your session_secret should look something like this:

```
session_secret: 'ad6fe27e6f551ec40f44b5f7ab46c45847e5d9s0813feb605',
```

* Edit `smtp` settings in `config.js` (optionally: set a [SendGrid](https://sendgrid.com/) API key)

Uncomment the `smtp` setting and update the keys with your personal email credentials OR uncomment the `sendgrid_api_key` and replace with an API key from SendGrid account.

* [How To Use Google's SMTP Server](https://www.digitalocean.com/community/tutorials/how-to-use-google-s-smtp-server)
* [Sign up for a new SendGrid account](https://signup.sendgrid.com/)

## Database setup

```
$ cd db/
$ make setup
```

## Optional: HTTPS

The `ssl` section of `config.js` configures your SSL certificate/key. If you comment out this part of the configuration the server will run using "plain vanilla HTTP."

Here is how to generate a self-signed SSL certificate, which is perfectly fine for development purposes:

```
$ cd ssl && openssl req -newkey rsa:2048 -nodes -keyout key.pem -x509 -days 365 -out cert.pem -subj "/C=US/ST=New York/L=Troy/O=organizer.network/CN=localhost"
```

# Run the server

```
$ cd ..
$ npm run
```

Load it up in a browser! By default it can be reached from `https://localhost:5000/`. If you used a self-signed SSL certificate ([described below](#ssl-certificates)) you will need to click through a security warning.

## Database tasks

Backup (it's a good idea to automate this on a server install):

```
$ cd db/
$ make backup
```

Migrate during version upgrades:

```
$ cd db/
$ make migrate
```

## PostgreSQL on Ubuntu

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

## Server setup

There is a [server setup guide](setup/setup.md) available that describes the process of signing up for a DigitalOcean droplet and deploying the software on a server.
