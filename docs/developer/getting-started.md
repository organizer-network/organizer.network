### [Organizer Network Docs](../README.md) → [Developer Documentation](README.md)

# Getting Started

This is a short guide describing how to set up a new development environment.

## Dependencies

* [node.js](https://nodejs.org/) 8 or 10
* [PostgreSQL](https://www.postgresql.org/) 10 or 11

## Developer setup

These setup instructions assume a macOS development environment. You may need to adjust for other platforms. If you're looking to install this on a server, you may want to check out the [server setup guide](server-setup.md).

* Install [node.js](https://nodejs.org/)
* Download and run [Postgress.app](https://postgresapp.com/downloads.html)

Check to make sure you have `git` installed.

```
$ git --version
git version 2.17.2 (Apple Git-113)
```

If you see an error message instead of the version, you can either [install Xcode](https://developer.apple.com/xcode/) (which bundles `git`) or [install git separately](https://developer.apple.com/xcode/).

## Clone the repo

```
$ git clone https://github.com/organizer-network/organizer.network.git
$ cd organizer.network
```

## Install npm dependencies

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
ad6fe27e6f551ec40f44b5f7ab46c45847e5d9s0813feb605
```

Once you finish editing, the `session_secret` should look something like this:

```
session_secret: 'ad6fe27e6f551ec40f44b5f7ab46c45847e5d9s0813feb605',
```

* Edit `smtp` settings in `config.js` (optionally: set a [SendGrid](https://sendgrid.com/) API key)

Uncomment the `smtp` setting and update the keys with your personal email credentials OR uncomment the `sendgrid_api_key` and replace with an API key from SendGrid account.

* [How To Use Google's SMTP Server](https://www.digitalocean.com/community/tutorials/how-to-use-google-s-smtp-server)
* [Sign up for a new SendGrid account](https://signup.sendgrid.com/)

Make a copy of the example instance file:

```
$ cp instance.yml.example instance.yml
```

Edit the instance file to your liking.

## Database setup

Make sure you have an instance of PostgreSQL running.

```
$ psql --version
psql (PostgreSQL) 11.0
```

If you see something different, you may need to edit your terminal `$PATH` to include Postgres.app.

```
$ export PATH="/Applications/Postgres.app/Contents/Versions/11/bin:$PATH"
```

You will probably want to add `export PATH="/Applications/Postgres.app/Contents/Versions/11/bin:$PATH"` to your `.bashrc` or `.zshrc` file so that it gets applied any time you use the terminal.

```
$ cd db/
$ make setup
```

You should see output that starts with `createdb` and ends with `pg_dump`. Once you finish, go back up to the main project directory.

```
$ cd ..
```

## Optional: HTTPS

The `ssl` section of `config.js` configures your SSL certificate/key. If you comment out the `ssl` part of the configuration the server will run using "plain vanilla HTTP."

Here is how to generate a self-signed SSL certificate, which is perfectly fine for development purposes:

```
$ cd ssl && openssl req -newkey rsa:2048 -nodes -keyout key.pem -x509 -days 365 -out cert.pem -subj "/C=US/ST=New York/L=Troy/O=organizer.network/CN=localhost"
```

That command should generate two files in your `ssl` folder: `cert.pem` and `key.pem`. The configuration to use them looks like this:

```
ssl: {
    key: "ssl/key.pem",
    cert: "ssl/cert.pem"
},
```

# Run the server

Now you can go into the project folder and start the server.

```
$ npm run start
```

Then load it up in a browser! By default it can be reached from `https://localhost:5000/`. If you used a self-signed SSL certificate you will need to click through a security warning.
