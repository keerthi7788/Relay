# Built from backend/, because the service shares backend/contracts with the engine.
FROM python:3.12-slim
WORKDIR /srv/backend/ai
COPY ai/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY ai/app ./app
COPY contracts ../contracts
RUN useradd --create-home relay
USER relay
EXPOSE 8090
CMD ["uvicorn", "--factory", "app.main:create_production_app", "--host", "0.0.0.0", "--port", "8090"]
