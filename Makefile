SHELL := /bin/bash

-include .env

API_URL := http://localhost:8080
CONSOLE_URL := http://localhost:5173
AI_URL := http://localhost:8090
WORLD_URL := http://localhost:9210
RUN_DIR := .run
DOCKER_CONTEXT ?= default
COMPOSE := DOCKER_CONTEXT=$(DOCKER_CONTEXT) docker compose
SCRIPTS := backend/pack/scripts
AUTH := Authorization: Bearer $(DEMO_TOKEN)
OPEN_BROWSER ?= yes

.DEFAULT_GOAL := help
.PHONY: help install run kill restart-worker status db-reset test smoke test-apis drill crash-drill test-all

help: ## Show this list
	@grep -E '^[a-z-]+:.*## ' Makefile | awk -F ':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

install: ## Install dependencies and create .env
	cd backend && npm install
	cd frontend && npm install
	python3 -m venv backend/ai/.venv
	backend/ai/.venv/bin/pip install -q -r backend/ai/requirements-dev.txt
	@[ -f .env ] || { \
		cp .env.example .env; chmod 600 .env; \
		sed -i.bak -e "s/^JWT_SECRET=$$/JWT_SECRET=$$(openssl rand -hex 32)/" -e "s/^ADMIN_PASSWORD=$$/ADMIN_PASSWORD=$$(openssl rand -hex 12)/" .env; \
		rm -f .env.bak; \
		echo "Created .env with a generated sign-in password. Add OPENROUTER_API_KEY to it."; \
	}

run: ## Start Postgres, mock world, AI service, API, worker and console
	@command -v node >/dev/null || { echo "Node.js 22+ is not installed. See README.md."; exit 1; }
	@if curl -sf -m 1 $(API_URL)/health >/dev/null; then echo "Already running. Run make kill first."; exit 1; fi
	@$(COMPOSE) up -d --wait
	@mkdir -p $(RUN_DIR)
	@(exec python3 $(SCRIPTS)/mock_world.py --port 9210) > $(RUN_DIR)/world.log 2>&1 & echo $$! > $(RUN_DIR)/world.pid
	@(cd backend/ai && exec .venv/bin/uvicorn --factory app.main:create_production_app --port 8090) > $(RUN_DIR)/ai.log 2>&1 & echo $$! > $(RUN_DIR)/ai.pid
	@(cd backend && exec node src/api.js) > $(RUN_DIR)/api.log 2>&1 & echo $$! > $(RUN_DIR)/api.pid
	@(cd frontend && exec node_modules/.bin/vite) > $(RUN_DIR)/console.log 2>&1 & echo $$! > $(RUN_DIR)/console.pid
	@$(MAKE) --no-print-directory restart-worker
	@for url in $(WORLD_URL) $(AI_URL) $(API_URL); do \
		for attempt in {1..40}; do curl -sf -m 1 $$url/health >/dev/null && break; sleep 0.25; done; \
		curl -sf -m 1 $$url/health >/dev/null || { echo "$$url did not start. See $(RUN_DIR)/*.log"; $(MAKE) --no-print-directory kill >/dev/null; exit 1; }; \
	done
	@for attempt in {1..40}; do curl -sf -m 1 $(CONSOLE_URL) >/dev/null && break; sleep 0.25; done
	@echo "Relay is running at $(CONSOLE_URL)"
	@opener=$$(command -v xdg-open || command -v open); \
		if [ "$(OPEN_BROWSER)" = yes ] && [ -n "$$opener" ]; then "$$opener" $(CONSOLE_URL) >/dev/null 2>&1 & fi

kill: ## Stop everything except Postgres
	@for name in console worker api ai world; do \
		[ -f $(RUN_DIR)/$$name.pid ] && kill $$(cat $(RUN_DIR)/$$name.pid) 2>/dev/null; \
		rm -f $(RUN_DIR)/$$name.pid; \
	done; true
	@echo "Stopped"

restart-worker: ## Start the worker, replacing a running one
	@mkdir -p $(RUN_DIR)
	@[ -f $(RUN_DIR)/worker.pid ] && kill $$(cat $(RUN_DIR)/worker.pid) 2>/dev/null; true
	@(cd backend && exec node src/worker.js) >> $(RUN_DIR)/worker.log 2>&1 & echo $$! > $(RUN_DIR)/worker.pid

status: ## Show which services are up
	@printf '%-12s %-24s %s\n' SERVICE URL STATUS
	@curl -sf -m 1 $(CONSOLE_URL) >/dev/null && state=up || state=down; \
		printf '%-12s %-24s %s\n' Console $(CONSOLE_URL) "$$state"
	@for service in "API $(API_URL)" "AI-service $(AI_URL)" "Mock-world $(WORLD_URL)"; do \
		set -- $$service; \
		curl -sf -m 1 $$2/health >/dev/null && state=up || state=down; \
		printf '%-12s %-24s %s\n' "$$1" "$$2" "$$state"; \
	done
	@$(COMPOSE) exec -T postgres pg_isready -q 2>/dev/null && state=up || state=down; \
		printf '%-12s %-24s %s\n' Postgres localhost:5544 "$$state"
	@kill -0 $$(cat $(RUN_DIR)/worker.pid 2>/dev/null) 2>/dev/null && state=up || state=down; \
		printf '%-12s %-24s %s\n' Worker "(no URL)" "$$state"

db-reset: ## Delete all workflows and runs (asks first)
	@read -p "Delete all Relay data? Type yes: " answer; [ "$$answer" = yes ] || { echo "Cancelled"; exit 1; }
	@$(COMPOSE) exec -T postgres psql -U relay -d relay -q -c "TRUNCATE schedules, queue_jobs, approvals, steps, runs, workflows"
	@echo "Data deleted. Restart the API to reload the seed workflows."

test: ## Run lint and automated tests (needs Postgres)
	@cd backend && npx eslint src test && npx prettier --check src test --log-level warn && npm test --silent
	@cd backend/ai && .venv/bin/ruff check . -q && .venv/bin/python -m pytest -q
	@cd frontend && npx eslint src && npx vitest run

smoke: ## Run Airtribe's smoke test (needs make run)
	@python3 $(SCRIPTS)/smoke_test.py --url $(API_URL) --token $(DEMO_TOKEN) --world $(WORLD_URL)

test-apis: ## Test every API live, with real AI (needs make run)
	@cd backend && npm run --silent test:apis

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
	kill -9 $$(cat $(RUN_DIR)/worker.pid); echo "Worker killed during the delay"; \
	$(resume_and_check)

crash-drill: ## Kill the worker after a side effect, before saving it
	@kill $$(cat $(RUN_DIR)/worker.pid) 2>/dev/null; sleep 1
	@(cd backend && WORKER_CRASH_AFTER_NODE=create_shipment exec node src/worker.js) >> $(RUN_DIR)/worker.log 2>&1 & echo $$! > $(RUN_DIR)/worker.pid
	@$(start_slow_run); \
	for attempt in {1..300}; do kill -0 $$(cat $(RUN_DIR)/worker.pid) 2>/dev/null || break; sleep 0.2; done; \
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
