#!/bin/bash

# Before running this:
#
# sudo mkdir -p /var/www/organizer.network
# sudo chown `whoami`:`whoami` /var/www/organizer.network
# cd /var/www/organizer.network
# git clone https://github.com/organizer-network/organizer.network.git .
#
# See also: setup.md

PROJECT_PATH="/var/www/organizer.network"
VERSION="klatch"

curl -sL https://deb.nodesource.com/setup_10.x | sudo -E bash -
wget -q https://www.postgresql.org/media/keys/ACCC4CF8.asc -O - | sudo apt-key add -
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt/ `lsb_release -cs`-pgdg main" >> /etc/apt/sources.list.d/pgdg.list'

sudo apt update
sudo apt install -y nginx nodejs postgresql postgresql-contrib build-essential jq
sudo npm install -g pm2

sudo cp /etc/postgresql/11/main/pg_hba.conf /etc/postgresql/11/main/pg_hba.conf.bak
sudo cp "$PROJECT_PATH/setup/pg_hba.conf" /etc/postgresql/11/main/pg_hba.conf
sudo chown postgres:postgres /etc/postgresql/11/main/pg_hba.conf
sudo chmod 640 /etc/postgresql/11/main/pg_hba.conf

sudo -u postgres createuser -d `whoami`
sudo -u postgres createdb `whoami`
sudo systemctl restart postgresql

cd "$PROJECT_PATH"
npm install

cd "$PROJECT_PATH/db"
make setup

cd "$PROJECT_PATH"
cp setup/config.js.setup config.js
SECRET=`openssl rand -hex 24`
IP_ADDR=`curl -s -XPOST https://organizer.network/api/ping | jq -r ".pong"`
BASE_URL="http://$IP_ADDR"
sed -e "s/base_url: ''/base_url: '$BASE_URL'/" \
    -e "s/\(db_dsn:.*\)dbname/\1$VERSION/" \
    -e "s/session_secret: ''/session_secret: '$SECRET'/" \
    -i.bak config.js

pm2 start organizer.network.js

sudo rm /etc/nginx/sites-enabled/default
sudo ln -s "$PROJECT_PATH/setup/nginx.conf" /etc/nginx/sites-enabled/organizer.network
sudo service nginx restart

sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 22
yes | sudo ufw enable

echo "done"
