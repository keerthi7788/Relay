SHELL := /bin/bash

-include .env

API_URL := http://localhost:8080
CONSOLE_URL := http://localhost:5173
WORLD_URL := http://localhost:9210
DOCKER_CONTEXT ?= default
COMPOSE := DOCKER_CONTEXT=$(DOCKER_CONTEXT) docker compose
SCRIPTS := backend/pack/scripts
AUTH := Authorization: Bearer $(DEMO_TOKEN)
OPEN_BROWSER ?= yes

# One-off containers for the test tools, so nothing but Docker needs installing.
TEST_RUN := DOCKER_CONTEXT=$(DOCKER_CONTEXT) docker run --rm --network host --user $$(id -u):$$(id -g) -e HOME=/tmp -v $(CURDIR):/repo
NODE_TEST := $(TEST_RUN) -w /repo/backend node:22 sh -c
CONSOLE_TEST := $(TEST_RUN) -w /repo/frontend node:22 sh -c
PYTHON_TEST := $(TEST_RUN) -w /repo/backend/ai python:3.12-slim sh -c
NPM_INSTALL := npm ci --no-audit --no-fund --silent

.DEFAULT_GOAL := help
.PHONY: help env run kill restart-worker status logs db-reset test smoke test-apis drill crash-drill test-all

help: ## Show this list
	@grep -E '^[a-z-]+:.*## ' Makefile | awk -F ':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

env:
	@[ -f .env ] || { \
		awk -v jwt="$$(openssl rand -hex 32)" -v password="$$(openssl rand -hex 12)" \
			'/^JWT_SECRET=$$/ { $$0 = "JWT_SECRET=" jwt } /^ADMIN_PASSWORD=$$/ { $$0 = "ADMIN_PASSWORD=" password } 1' \
			.env.example > .env; \
		chmod 600 .env; \
		echo "Created .env with a generated sign-in password."; \
	}
	@grep -qE '^OPENROUTER_API_KEY=.+' .env || { echo "Add OPENROUTER_API_KEY to .env, then run make run again."; exit 1; }

run: env ## Build and start everything in Docker
	@$(COMPOSE) up -d --build --wait
	@echo "Relay is running at $(CONSOLE_URL)"
	@opener=$$(command -v xdg-open || command -v open); \
		if [ "$(OPEN_BROWSER)" = yes ] && [ -n "$$opener" ]; then "$$opener" $(CONSOLE_URL) >/dev/null 2>&1 & fi

kill: ## Stop every container; data is kept
	@$(COMPOSE) stop
	@echo "Stopped"

restart-worker: ## Replace the worker container
	@$(COMPOSE) up -d --no-deps --force-recreate worker

status: ## Show which services are up
	@$(COMPOSE) ps --all --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'

logs: ## Follow the logs of every service
	@$(COMPOSE) logs -f

db-reset: ## Delete all workflows and runs (asks first)
	@read -p "Delete all Relay data? Type yes: " answer; [ "$$answer" = yes ] || { echo "Cancelled"; exit 1; }
	@$(COMPOSE) exec -T postgres psql -U relay -d relay -q -c "TRUNCATE schedules, queue_jobs, approvals, steps, runs, workflows"
	@$(COMPOSE) restart api
	@echo "Data deleted and the seed workflows reloaded."

test: ## Run lint and automated tests in containers (needs make run)
	@$(NODE_TEST) '$(NPM_INSTALL) && npx eslint src test && npx prettier --check src test --log-level warn && npm test --silent'
	@$(PYTHON_TEST) 'pip install -q --user --no-warn-script-location -r requirements-dev.txt && python -m ruff check . -q && python -m pytest -q'
	@$(CONSOLE_TEST) '$(NPM_INSTALL) && npx eslint src && npx vitest run'

smoke: ## Run Airtribe's smoke test (needs make run)
	@python3 $(SCRIPTS)/smoke_test.py --url $(API_URL) --token $(DEMO_TOKEN) --world $(WORLD_URL)

test-apis: ## Test every API live, with real AI (needs make run)
	@$(NODE_TEST) '$(NPM_INSTALL) && npm run --silent test:apis'

# Shared by both drills: start a slow run, then bring the worker back and check for duplicates.
start_slow_run = curl -sS -X POST $(WORLD_URL)/admin/reset -d '{}' >/dev/null; \
	run=$$(curl -sS -X POST $(API_URL)/workflows/wf_slow_fulfillment/trigger -H '$(AUTH)' -H 'Content-Type: application/json' \
		-d '{"input": {"order_id": "ord_2003", "customer_email": "lena@example.com"}}' \
		| python3 -c 'import json,sys; print(json.load(sys.stdin)["run_id"])'); \
	echo "Started $$run"

resume_and_check = sleep 2; $(MAKE) --no-print-directory restart-worker; echo "Worker restarted"; \
	for attempt in {1..240}; do \
		status=$$(curl -sS $(API_URL)/runs/$$run -H '$(AUTH)' | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])'); \
		case $$status in succeeded|failed|cancelled) break;; esac; sleep 0.25; \
	done; \
	echo "Run finished: $$status"; \
	[ "$$status" = succeeded ] && python3 $(SCRIPTS)/duplication_check.py --url $(WORLD_URL)

drill: ## Kill the worker during a delay, resume, check duplicates
	@$(start_slow_run); \
	for attempt in {1..100}; do curl -sS $(WORLD_URL)/admin/ledger | grep -q email.send && break; sleep 0.2; done; \
	$(COMPOSE) kill worker >/dev/null 2>&1; echo "Worker killed during the delay"; \
	$(resume_and_check)

crash-drill: ## Kill the worker after a side effect, before saving it
	@WORKER_CRASH_AFTER_NODE=create_shipment $(COMPOSE) up -d --no-deps --force-recreate worker
	@$(start_slow_run); \
	$(COMPOSE) wait worker >/dev/null; \
	echo "Worker died after the shipment call"; \
	$(resume_and_check)

test-all: ## Run every test from a clean start, then stop
	@$(MAKE) --no-print-directory kill >/dev/null
	@$(MAKE) --no-print-directory run OPEN_BROWSER=no
	@trap '$(MAKE) --no-print-directory kill' EXIT; \
	$(MAKE) --no-print-directory test && \
	$(MAKE) --no-print-directory smoke && \
	$(MAKE) --no-print-directory test-apis && \
	$(MAKE) --no-print-directory drill && \
	$(MAKE) --no-print-directory crash-drill && \
	echo "ALL CHECKS PASSED"
