VERSION := bzzt
NOW := $(shell TZ=UTC date +%Y%m%d-%H%M%S)

setup:
	createdb $(VERSION)
	psql $(VERSION) < schema/setup.$(VERSION).sql
	psql $(VERSION) < ../node_modules/connect-pg-simple/table.sql
	mkdir -p $(VERSION)
	pg_dump $(VERSION) > $(VERSION)/$(NOW).sql

migrate: bzzt

backup:
	mkdir -p $(VERSION)
	pg_dump $(VERSION) > $(VERSION)/$(NOW).sql

bzzt:
	mkdir -p aarg
	pg_dump aarg > aarg/$(NOW).sql
	psql `whoami` -c "ALTER DATABASE aarg RENAME TO bzzt;"
	psql bzzt < schema/migrate.bzzt.sql
	mkdir -p bzzt
	pg_dump bzzt > bzzt/$(NOW).sql
