#!/bin/bash

WHOAMI=`python -c 'import os, sys; print os.path.realpath(sys.argv[1])' $0`
PROJECT=`dirname $WHOAMI`

if [ ! -f config.js ] ; then
	cp config.js.example config.js
fi

if [ ! -f instance.yml ] ; then
	cp instance.yml.example instance.yml
fi

if [ ! -f nginx.conf ] ; then
	cp setup/nginx.conf.example setup/nginx.conf
fi

cd "$PROJECT"
npm install

cd "$PROJECT/db"
make setup
