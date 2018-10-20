VERSION := craw
NOW := $(shell TZ=UTC date +%Y%m%d-%H%M%S)

setup:
	createdb $(VERSION)
	psql $(VERSION) < schema/setup.$(VERSION).sql
	psql $(VERSION) < ../node_modules/connect-pg-simple/table.sql
	mkdir -p $(VERSION)
	pg_dump $(VERSION) > $(VERSION)/$(NOW).sql

migrate: bzzt craw

backup:
	mkdir -p $(VERSION)
	pg_dump $(VERSION) > $(VERSION)/$(NOW).sql

migrate_versions:
	VERSION=$(FROM) make backup
	psql `whoami` -c "ALTER DATABASE $(FROM) RENAME TO $(TO);"
	psql $(TO) < schema/migrate.$(TO).sql
	VERSION=$(TO) make backup

bzzt:
	FROM=aarg TO=bzzt make migrate_versions

craw:
	FROM=bzzt TO=craw make migrate_versions
