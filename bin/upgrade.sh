#!/bin/bash

WHOAMI=`python -c 'import os, sys; print os.path.realpath(sys.argv[1])' $0`
BIN=`dirname $WHOAMI`
PROJECT=`dirname $BIN`

cd "$PROJECT"

git stash
git checkout master
git pull origin master

if [ ! -f instance.yml ] ; then
	cp instance.yml.example instance.yml
fi

pm2 restart ecosystem.config.js --env maintenance
npm install

cd "$PROJECT/db"
make migrate

cd "$PROJECT"
pm2 restart ecosystem.config.js --env production
