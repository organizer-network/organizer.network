### [Organizer Network Docs](../README.md) → [Developer Documentation](README.md)

# Database tasks

Backup (it's a good idea to automate this on a server install):

```
$ cd db/
$ make backup
```

Migrate during version upgrades:

```
$ pm2 stop organizer.network
$ cd db/
$ make migrate
$ cd ..
$ pm2 start
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
