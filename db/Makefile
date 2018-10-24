VERSION := dibdib
NOW := $(shell TZ=UTC date +%Y%m%d-%H%M%S)

setup:
	createdb $(VERSION)
	psql $(VERSION) < schema/setup.$(VERSION).sql
	psql $(VERSION) < ../node_modules/connect-pg-simple/table.sql
	mkdir -p $(VERSION)
	pg_dump $(VERSION) > $(VERSION)/$(NOW).sql

migrate: bzzt craw dibdib

backup:
	mkdir -p $(VERSION)
	pg_dump $(VERSION) > $(VERSION)/$(NOW).sql

migrate_versions:
	mkdir -p $(FROM)
	pg_dump $(FROM) > $(FROM)/$(NOW).sql
	psql `whoami` -c "ALTER DATABASE $(FROM) RENAME TO $(TO);"
	psql $(TO) < schema/migrate.$(TO).sql
	mkdir -p $(TO)
	pg_dump $(TO) > $(TO)/$(NOW).sql
	sed -e "s/\(db_dsn:.*\)$(FROM)/\1$(TO)/" -i.bak ../config.js

bzzt:
	FROM=aarg TO=bzzt make migrate_versions

craw:
	FROM=bzzt TO=craw make migrate_versions

dibdib:
	FROM=craw TO=dibdib make migrate_versions
