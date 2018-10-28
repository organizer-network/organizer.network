VERSION := foom
NOW := $(shell TZ=UTC date +%Y%m%d-%H%M%S)

setup:
ifeq (, $(shell which createdb))
	$(error "Oops, it looks like you still need to install PostgreSQL.")
endif
	createdb $(VERSION)
	psql $(VERSION) < schema/setup.sql
	psql $(VERSION) < ../node_modules/connect-pg-simple/table.sql
	mkdir -p aarg
	mkdir -p bzzt
	mkdir -p craw
	mkdir -p dibdib
	mkdir -p eeeeee
	mkdir -p foom
	pg_dump $(VERSION) > $(VERSION)/$(NOW).sql

migrate: bzzt craw dibdib eeeeee foom

backup:
	mkdir -p $(VERSION)
	pg_dump $(VERSION) > $(VERSION)/$(NOW).sql

migrate_versions:
	@echo "migrating $(FROM) to $(TO)"
	@echo "--------------------------------"
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

eeeeee:
	FROM=dibdib TO=eeeeee make migrate_versions

foom:
	FROM=eeeeee TO=foom make migrate_versions
