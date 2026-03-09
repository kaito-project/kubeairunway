FROM python:3.14-slim

RUN pip install --no-cache-dir huggingface_hub==1.6.0 && \
    hf version

ENTRYPOINT ["hf"]
