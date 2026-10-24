# The stand-in game: Python with the Vikaki client. Built from the repo root so it can use the client in this checkout;
# in your own project, `pip install vikaki-client` instead (docs/docker.md).
FROM python:3.13-slim
WORKDIR /app
COPY clients/python /tmp/vikaki-client
RUN pip install --no-cache-dir /tmp/vikaki-client && rm -rf /tmp/vikaki-client
COPY examples/compose/game/game.py .
USER nobody
EXPOSE 8765
HEALTHCHECK --interval=2s --timeout=3s --start-period=2s --retries=30 CMD ["python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8765/healthz')"]
CMD ["python", "-u", "game.py"]
