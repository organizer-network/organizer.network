#!/bin/bash

# Before running this:
#
# sudo mkdir -p /var/www/organizer.network
# sudo chown `whoami`:`whoami` /var/www/organizer.network
# cd /var/www/organizer.network
# git clone https://github.com/organizer-network/organizer.network.git .
#
# See also: https://github.com/organizer-network/organizer.network/blob/develop/docs/running/server-setup.md

PROJECT_PATH="/var/www/organizer.network"
VERSION="lunk"

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
cp config.js.example config.js

sudo rm /etc/nginx/sites-enabled/default
sudo ln -s "$PROJECT_PATH/setup/nginx.conf" /etc/nginx/sites-enabled/organizer.network
sudo service nginx restart

sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 22
yes | sudo ufw enable

"$PROJECT_PATH/bin/install.sh"

echo "Next steps:"
echo "  * Edit config.js"
echo "  * Start the service: pm2 start"
