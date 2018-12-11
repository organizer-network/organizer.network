#!/bin/bash

WHOAMI=`python -c 'import os, sys; print os.path.realpath(sys.argv[1])' $0`
PROJECT=`dirname $WHOAMI`

cd "$PROJECT"
pm2 restart ecosystem.config.js --env maintenance

npm install

cd "$PROJECT/db"
make migrate

if [ ! -f "$PROJECT/instance.yml" ] ; then
	cp "$PROJECT/instance.yml.example" "$PROJECT/instance.yml"
fi

cd "$PROJECT"
pm2 restart ecosystem.config.js --env production
