"""Bounded transport pages for one already-selected prediction cohort."""

import orjson
from flask import Response

PAGE_SIZE = 25_000


def prediction_response(result, stream_pages=False):
    if not stream_pages:
        return Response(orjson.dumps(result))

    rows = result["data"]
    metadata = {key: value for key, value in result.items() if key != "data"}
    metadata.update(format="prediction-pages-v1", row_count=len(rows))

    def pages():
        yield orjson.dumps(metadata) + b"\n"
        for start in range(0, len(rows), PAGE_SIZE):
            yield orjson.dumps({"data": rows[start : start + PAGE_SIZE]}) + b"\n"
        yield b'{"done":true}\n'

    return Response(pages(), mimetype="application/x-ndjson")
