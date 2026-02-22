.PHONY: dev up down logs clean prod prod-down

dev:
	docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.dev.yml --profile dev up --build

up:
	docker compose --env-file .env -f docker/docker-compose.yml up --build -d

down:
	docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.dev.yml --profile dev down

logs:
	docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.dev.yml logs -f

clean:
	docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.dev.yml --profile dev down -v --remove-orphans

prod:
	docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up --build -d

prod-down:
	docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml down
