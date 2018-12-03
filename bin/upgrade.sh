#!/bin/bash

pm2 restart ecosystem.config.js --env maintenance
cd db
make migrate
cd ..
pm2 restart ecosystem.config.js --env production
