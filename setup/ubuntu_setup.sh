#!/bin/bash

# Before running this:
#
# sudo mkdir -p /var/www/organizer.network
# sudo chown `whoami`:`whoami` /var/www/organizer.network
# cd /var/www/organizer.network
# git clone https://github.com/organizer-network/organizer.network.git .
#
# See also: setup.md

if [ "$EUID" -ne 0 ] ; then
	echo "Please run with admin privs: sudo ./ubuntu_setup.sh"
	exit 1
fi

PROJECT_PATH="/var/www/organizer.network"
VERSION="craw"

curl -sL https://deb.nodesource.com/setup_10.x | sudo -E bash -
wget -q https://www.postgresql.org/media/keys/ACCC4CF8.asc -O - | sudo apt-key add -
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt/ `lsb_release -cs`-pgdg main" >> /etc/apt/sources.list.d/pgdg.list'

apt install -y nginx nodejs postgresql postgresql-contrib build-essential jq
npm install -g pm2

cp /etc/postgresql/10/main/pg_hba.conf /etc/postgresql/10/main/pg_hba.conf.bak
cp pg_hba.conf /etc/postgresql/10/main/pg_hba.conf
chown postgres:postgres /etc/postgresql/10/main/pg_hba.conf
chmod 640 /etc/postgresql/10/main/pg_hba.conf

sudo -u postgres createuser -d `whoami`
sudo systemctl restart postgres

cd "$PROJECT_PATH"
sudo -u `whoami` npm install

cd "$PROJECT_PATH/db"
make setup

cd "$PROJECT_PATH"
cp setup/config.js.setup config.js
SECRET=`openssl rand -base64 32`
sed -e "s/\(db_dsn:.*\)dbname/\1$VERSION/" \
    -e "s/session_secret:.*$/session_secret: '$SECRET',/" \
    -i.bak config.js

sudo -u `whoami` pm2 start organizer.network.js

rm /etc/nginx/sites-enabled/default
ln -s "$PROJECT_PATH/setup/nginx.conf" /etc/nginx/sites-enabled/organizer.network
sudo service nginx restart

ufw allow 80
ufw allow 443
ufw allow 22
yes | ufw enable

echo "done"
