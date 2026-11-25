FROM python:3.12-slim

WORKDIR /app

COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt gunicorn

COPY server /app/server
COPY dist /app/dist

ENV PORT=8787
ENV GATEWAY_ENV=prod
ENV ADMIN_TOKEN=local-dev-token
ENV PYTHONUNBUFFERED=1

EXPOSE 8787

WORKDIR /app/server
CMD gunicorn -b 0.0.0.0:${PORT} -w 2 --threads 4 cloud_app:app
