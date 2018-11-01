# organizer.network

_Tools and strategies for social justice organizing._

## Early days

It's worth pointing out that this project is still in its early days, so proceed with a sense of adventure and patience.

## Versioning

* Current release: __[v0.0.6 "foom"](https://github.com/organizer-network/organizer.network/releases/tag/v0.0.6)__
* Under development: __v0.0.7 "grrr"__

Versions names are based on [Tom Gauld's *A Noisy Alphabet*](http://myjetpack.tumblr.com/post/65442529656/a-noisy-alphabet-a-new-screenprint-by-tom).

## Contributing

Organizer.network welcomes contributors!

* Drop in on our [meta group](https://organizer.network/join/yycczw12923m2stb) and say hello.
* Some issues in GitHub are [labeled as good for first-time contributors](https://github.com/organizer-network/organizer.network/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22).
* Please assign an issue to yourself if you intend to work on it.
* If you find something seems broken, please [write up an issue](https://github.com/organizer-network/organizer.network/issues).
* New development happens on the `develop` branch, `master` branch reflects the current release.
* If you'd like commit access to the repo, just post your GitHub account in the meta group.

You may notice dphiffer uses [emoji codes](http://emoji-cheat-sheet.com/) in his commit messages, this is entirely optional.

## Dependencies

* node.js 8 or 10
* PostgreSQL 10 or 11

## Developer setup

This has only been tested on macOS and Ubuntu, but there's no reason to think it wouldn't work on other platforms. I definitely welcome hearing about your experience on, for example, Windows.

These setup instructions assume a macOS development environment. You may need to adjust for other platforms. If you're looking to install this on a server, you may want to check out the [server setup guide](setup/setup.md).

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

Make sure you have an instance of Postgres running.

If you don't want to run a Postgres instance from the command line you can also install the [Postgres app](https://postgresapp.com/downloads.html).

```
$ cd db/
$ make setup
$ cd ..
```

## Optional: HTTPS

The `ssl` section of `config.js` configures your SSL certificate/key. If you comment out the `ssl` part of the configuration the server will run using "plain vanilla HTTP."

Here is how to generate a self-signed SSL certificate, which is perfectly fine for development purposes:

```
$ cd ssl && openssl req -newkey rsa:2048 -nodes -keyout key.pem -x509 -days 365 -out cert.pem -subj "/C=US/ST=New York/L=Troy/O=organizer.network/CN=localhost"
```

# Run the server

Just go into the project folder and start the server.

```
$ npm run start
```

Then load it up in a browser! By default it can be reached from `https://localhost:5000/`. If you used a self-signed SSL certificate you will need to click through a security warning.

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

Edit `/etc/postgresql/10/main/pg_hba.conf` with the following line change.

```
# IPv4 local connections:
host    all             all             127.0.0.1/32            trust
```

## Server setup

There is a [server setup guide](setup/setup.md) available that describes the process of signing up for a DigitalOcean droplet and deploying the software on a server.
