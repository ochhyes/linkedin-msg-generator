"""
JSONL writer dla telemetrii fail'i scrape'a (#5).

Zapis append-only do pliku tekstowego, jedna linia = jeden fail.
Świadomie BEZ DB — `tail -f` wystarcza w MVP.

Brak rotation/retention — przy 100 fail'i/mies × ~2KB to ~2.4MB/rok. Stretch.
"""

import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict

from models import ScrapeFailureReport


# Module-level lock — gwarantuje że dwa równoległe POST'y nie przeplotą zapisów.
# FastAPI obsługuje requesty na jednej event loop, więc asyncio.Lock wystarczy.
_write_lock = asyncio.Lock()


def _serialize(report: ScrapeFailureReport) -> Dict[str, Any]:
    """Pydantic model → dict + dorzuca server_timestamp."""
    payload = report.model_dump()
    payload["server_timestamp"] = datetime.now(timezone.utc).isoformat()
    return payload


async def log_scrape_failure(report: ScrapeFailureReport, log_path: str) -> None:
    """
    Append jednej linii JSON do log_path.

    Telemetria NIE może rozłożyć endpointu — każdy IOError jest połykany
    i logowany do stderr. Endpoint zwraca 204 nawet jeśli zapis padł
    (z punktu widzenia extension'a fire-and-forget i tak nie obchodzi go ack).
    """
    payload = _serialize(report)
    line = json.dumps(payload, ensure_ascii=False) + "\n"

    try:
        parent = os.path.dirname(log_path)
        if parent:
            os.makedirs(parent, exist_ok=True)

        async with _write_lock:
            # Synchroniczny zapis pod async lock — krótki I/O,
            # nie warto ciągnąć aiofiles tylko dla jednej linii.
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(line)
    except OSError as e:
        # IOError / PermissionError / DiskFull — nie wywalaj endpointu.
        print(
            f"[diagnostics_logger] Failed to write to {log_path}: {e!r}",
            file=sys.stderr,
            flush=True,
        )
