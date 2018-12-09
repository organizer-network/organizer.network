VERSION := miau
VERSIONS = aarg bzzt craw dibdib eeeeee foom grrr hup ifff jiji klatch lunk miau
NOW := $(shell TZ=UTC date +%Y%m%d-%H%M%S)

setup:
ifeq (, $(shell which createdb))
	$(error "Oops, it looks like you still need to install PostgreSQL.")
endif
	createdb $(VERSION)
	psql $(VERSION) < schema/setup.sql
	psql $(VERSION) < ../node_modules/connect-pg-simple/table.sql
	mkdir -p $(VERSION)
	pg_dump $(VERSION) > $(VERSION)/$(NOW).sql

migrate:
	@for version in $(VERSIONS) ; do \
		if [ $$prev ] && [ -d $$prev ] && [ ! -d $$version ] ; then \
			FROM=$$prev TO=$$version make migrate_versions ; \
		fi ; \
		prev=$$version ; \
	done

backup:
	mkdir -p $(VERSION)
	pg_dump $(VERSION) > $(VERSION)/$(NOW).sql

migrate_versions:
ifeq (,$(wildcard $(TO)))
	@echo "migrating $(FROM) to $(TO)"
	mkdir -p $(FROM)
	pg_dump $(FROM) > $(FROM)/$(NOW).sql
	psql `whoami` -c "ALTER DATABASE $(FROM) RENAME TO $(TO);"
	psql $(TO) < schema/migrate.$(TO).sql
	mkdir -p $(TO)
	pg_dump $(TO) > $(TO)/$(NOW).sql
	sed -e "s/\(db_dsn:.*\)$(FROM)/\1$(TO)/" -i.bak ../config.js
else
	@echo "skipping $(TO)"
endif
