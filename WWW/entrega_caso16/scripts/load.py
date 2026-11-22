#!/usr/bin/env python3
"""Spike reproducible REST/GraphQL. Mide, no presupone, latencia y recursos."""
import argparse
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
import json
import hashlib
import math
import os
from pathlib import Path
import platform
import statistics
import threading
import time
import httpx
from seed import Api

def process_metrics(pids):
    cpu, rss = 0.0, 0
    for pid in pids:
        try:
            stat = Path(f"/proc/{pid}/stat").read_text().split()
            cpu += (int(stat[13]) + int(stat[14])) / os.sysconf("SC_CLK_TCK")
            rss += int(stat[23]) * os.sysconf("SC_PAGE_SIZE")
        except (FileNotFoundError, ProcessLookupError):
            pass
    return cpu, rss

def run(api, concurrency, seconds, graphql, pids):
    token = api.login("lector") if graphql else None
    query = "{account(first:10){reader{id names state}loans{id mode items{copyId title dueAt document{author}}assessment{amount currency state}}totalLoans reservations{id date state}}}"
    barrier = threading.Barrier(concurrency + 1)
    stop = threading.Event()
    peak = [0]
    def monitor():
        while not stop.wait(.2):
            peak[0] = max(peak[0], process_metrics(pids)[1])
    def worker():
        samples, statuses, sizes = [], Counter(), []
        with httpx.Client(verify=api.context, timeout=12, limits=httpx.Limits(max_connections=1), trust_env=False) as client:
            barrier.wait()
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                start = time.monotonic()
                try:
                    response = client.post(api.base + "/graphql", json={"query": query}, headers={"Authorization": "Bearer " + token}) if graphql else client.get(api.base + "/catalog?size=10&q=")
                    status = str(response.status_code)
                    if graphql and response.json().get("errors"):
                        status = "graphql_error"
                    statuses[status] += 1
                    sizes.append(len(response.content))
                except Exception as e:
                    statuses[type(e).__name__] += 1
                samples.append((time.monotonic() - start) * 1000)
        return samples, statuses, sizes
    cpu0, rss0 = process_metrics(pids)
    peak[0] = rss0
    watcher = threading.Thread(target=monitor);watcher.start()
    start = time.monotonic()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(worker) for _ in range(concurrency)]
        barrier.wait()
        results = [f.result() for f in futures]
    elapsed = time.monotonic() - start
    stop.set();watcher.join()
    cpu1, _ = process_metrics(pids)
    samples = sorted(x for r in results for x in r[0])
    statuses = sum((r[1] for r in results), Counter())
    sizes = [n for r in results for n in r[2]]
    errors = len(samples) - statuses["200"]
    return {"protocol": "GraphQL sobre HTTPS" if graphql else "REST sobre HTTPS", "concurrency": concurrency,
            "requested_duration_s": seconds, "elapsed_s": round(elapsed, 3), "requests": len(samples),
            "throughput_rps": round(len(samples) / elapsed, 2), "p50_ms": round(statistics.median(samples), 2),
            "p95_ms": round(samples[max(0, math.ceil(.95 * len(samples)) - 1)], 2),
            "errors": errors, "status_counts": dict(statuses), "mean_response_bytes": round(statistics.mean(sizes)) if sizes else 0,
            "services_cpu_percent_one_core": round((cpu1 - cpu0) / elapsed * 100, 2),
            "services_peak_rss_mib": round(peak[0] / 1024**2, 2)}

if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--runtime", default=".runtime")
    p.add_argument("--seconds", type=int, default=10)
    p.add_argument("--concurrency", type=int, nargs="+", default=[1, 8, 16])
    p.add_argument("--output", default="evidencias/carga.json")
    a = p.parse_args()
    if not 1 <= a.seconds <= 300 or any(n < 1 or n > 64 for n in a.concurrency):
        p.error("Duración:1–300 s; concurrencia:1–64.")
    api = Api(a.runtime)
    pids = list(json.loads((api.runtime / "pids.json").read_text()).values())
    data = {"recorded_at_utc": datetime.now(timezone.utc).isoformat(),
            "artifact_sha256": hashlib.sha256((Path(__file__).resolve().parents[1] / "target/bec.jar").read_bytes()).hexdigest(),
            "environment": {"platform": platform.platform(), "python": platform.python_version(),
                           "logical_cpus": os.cpu_count(), "memory_total_kib": next(x.split()[1] for x in Path("/proc/meminfo").read_text().splitlines() if x.startswith("MemTotal:")),
                           "java_processes": len(pids), "java_heap_each_mib": 160, "profile": api.profile["profile"],
                           "client": "httpx; conexión HTTPS reutilizada por trabajador; verificación CA; HTTP/1.1",
                           "cpu_scope": "suma de 10 JVM, 100% = un núcleo; excluye generador Python",
                           "rss_scope": "suma RSS de 10 JVM; memoria compartida puede contarse repetida"},
            "dataset": api.call("GET", "/catalog?size=1")["total"], "results": []}
    for graphql in [False, True]:
        for concurrency in a.concurrency:
            result = run(api, concurrency, a.seconds, graphql, pids)
            data["results"].append(result)
            print(json.dumps(result))
    output = Path(a.output);output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=2, ensure_ascii=False))
