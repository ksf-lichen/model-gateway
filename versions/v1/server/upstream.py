"""Upstream call: real OpenAI-compatible forward, or local Mock."""
from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any

import httpx

from store import sources_for_service


def ordered_sources(service: dict) -> list[dict]:
    """Intelligent routing candidate list (cost / fixed + failover order)."""
    sources = [s for s in sources_for_service(service["id"]) if s.get("status") != "异常"]
    if not sources:
        return []
    cred = [s for s in sources if s.get("baseUrl") and s.get("apiKey")]
    pool = cred or sources
    strategy = service.get("strategy") or "fixed"
    if strategy == "cost":
        def cost_key(s: dict):
            prices = s.get("prices") or {}
            try:
                return float(prices.get("busyInput") or prices.get("catalogInput") or 1e9)
            except (TypeError, ValueError):
                # fallback: prefer lower observed latency
                probe = s.get("lastProbe") or {}
                return float(probe.get("latencyMs") or 1e9)

        return sorted(pool, key=cost_key)
    # fixed order: keep insertion order (newest first in store → reverse for stable primary)
    return list(reversed(pool)) if service.get("strategy") == "fixed-asc" else pool


def pick_source(service: dict) -> dict | None:
    ordered = ordered_sources(service)
    if not ordered:
        return None
    return ordered[0]


def wants_stream(body: dict | None) -> bool:
    v = (body or {}).get("stream")
    return v is True or v == 1 or str(v).lower() == "true"


def forward_chat_with_failover(
    body: dict, service: dict
) -> tuple[int, dict | Any, dict | None, bool, dict, list]:
    """Try sources in routing order; failover on upstream 5xx / unreachable.

    Returns (status, payload, source, streaming, usage_box, attempts).
    usage_box accumulates {"usage": {...}} — filled immediately for JSON, or as SSE
    chunks are consumed for streaming.
    """
    candidates = ordered_sources(service)
    if not candidates:
        return (
            503,
            {"error": {"message": f"No upstream source for {service.get('serviceId')}", "type": "misconfigured"}},
            None,
            False,
            {"usage": None},
            [],
        )
    stream = wants_stream(body)
    last_status, last_data, last_src = (
        502,
        {"error": {"message": "all upstreams failed", "type": "upstream_unreachable"}},
        None,
    )
    last_usage = {"usage": None}
    attempts = []
    for src in candidates:
        last_src = src
        status, data, streaming, usage_box = forward_chat(
            body, src, service_id=service["serviceId"], stream=stream
        )
        last_usage = usage_box
        attempts.append({"sourceId": src.get("id"), "sourceModel": src.get("sourceModel"), "status": status})
        if status < 500:
            if streaming:
                return status, data, src, True, usage_box, attempts
            if isinstance(data, dict):
                data.setdefault("gateway", {})
                if isinstance(data["gateway"], dict):
                    data["gateway"].update(
                        {
                            "routing": service.get("strategy") or "fixed",
                            "failoverAttempts": attempts,
                        }
                    )
                if not usage_box.get("usage") and isinstance(data.get("usage"), dict):
                    usage_box["usage"] = data.get("usage")
            return status, data, src, False, usage_box, attempts
        last_status, last_data = status, data
    if isinstance(last_data, dict):
        last_data.setdefault("gateway", {})
        if isinstance(last_data["gateway"], dict):
            last_data["gateway"].update({"routing": service.get("strategy") or "fixed", "failoverAttempts": attempts})
    return last_status, last_data, last_src, False, last_usage, attempts


def _effective_cred(source: dict | None) -> tuple[str, str, str]:
    """Return baseUrl, apiKey, sourceModel."""
    base = (source or {}).get("baseUrl") or os.environ.get("DEFAULT_UPSTREAM_BASE_URL", "")
    key = (source or {}).get("apiKey") or os.environ.get("DEFAULT_UPSTREAM_API_KEY", "")
    model = (source or {}).get("sourceModel") or "mock-demo"
    return base.rstrip("/"), key, model


def use_mock(source: dict | None) -> bool:
    base, key, _ = _effective_cred(source)
    return not (base and key)


def mock_chat_completion(body: dict, *, service_id: str, source_model: str) -> dict:
    messages = body.get("messages") or []
    last = ""
    for m in reversed(messages):
        if isinstance(m, dict) and m.get("role") == "user":
            last = str(m.get("content") or "")
            break
    content = (
        f"[Mock · {service_id}] 已收到请求。"
        f"上游未配置 Base URL/API Key，因此返回模拟回复。"
        f"你说：{last[:200] or '（空）'}"
    )
    return {
        "id": f"chatcmpl-mock-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": service_id,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": max(1, len(last) // 4),
            "completion_tokens": max(1, len(content) // 4),
            "total_tokens": max(2, (len(last) + len(content)) // 4),
        },
        "gateway": {"mode": "mock", "sourceModel": source_model},
    }


def mock_embeddings(body: dict, *, service_id: str) -> dict:
    inp = body.get("input")
    texts = inp if isinstance(inp, list) else [inp or ""]
    return {
        "object": "list",
        "data": [
            {
                "object": "embedding",
                "index": i,
                "embedding": [0.01 * ((i + 1) % 7)] * 8,
            }
            for i, _ in enumerate(texts)
        ],
        "model": service_id,
        "usage": {"prompt_tokens": 8, "total_tokens": 8},
        "gateway": {"mode": "mock"},
    }


def mock_responses(body: dict, *, service_id: str, source_model: str) -> dict:
    # Simplified OpenAI Responses-like shape
    chat = mock_chat_completion(
        {"messages": [{"role": "user", "content": str(body.get("input") or body.get("prompt") or "")}]},
        service_id=service_id,
        source_model=source_model,
    )
    text = chat["choices"][0]["message"]["content"]
    return {
        "id": f"resp-mock-{uuid.uuid4().hex[:12]}",
        "object": "response",
        "created_at": int(time.time()),
        "model": service_id,
        "status": "completed",
        "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]}],
        "gateway": {"mode": "mock", "sourceModel": source_model},
    }


def probe_upstream(
    *,
    base_url: str,
    api_key: str,
    source_model: str = "",
    timeout: float = 25.0,
) -> dict[str, Any]:
    """Production connectivity check against an OpenAI-compatible upstream.

    Strategy:
    1) GET {base}/models — auth + reachability
    2) If sourceModel set: POST {base}/chat/completions (max_tokens=1) to verify the model
       (or when /models is unavailable / model not listed)
    """
    base = (base_url or "").strip().rstrip("/")
    key = (api_key or "").strip()
    model = (source_model or "").strip()
    if not base:
        return {"ok": False, "error": {"message": "baseUrl is required", "type": "validation_error"}}
    if not key:
        return {"ok": False, "error": {"message": "apiKey is required", "type": "validation_error"}}
    if not (base.startswith("http://") or base.startswith("https://")):
        return {
            "ok": False,
            "error": {"message": "baseUrl must start with http:// or https://", "type": "validation_error"},
        }

    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    started = time.perf_counter()
    model_ids: list[str] = []
    models_status: int | None = None
    models_err = ""

    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            try:
                mr = client.get(f"{base}/models", headers={"Authorization": f"Bearer {key}"})
                models_status = mr.status_code
                if mr.status_code < 400:
                    try:
                        payload = mr.json()
                    except Exception:
                        payload = {}
                    raw = payload.get("data") if isinstance(payload, dict) else None
                    if isinstance(raw, list):
                        model_ids = [
                            str(m.get("id"))
                            for m in raw
                            if isinstance(m, dict) and m.get("id")
                        ]
                else:
                    try:
                        err_body = mr.json()
                        models_err = str(
                            (err_body.get("error") or {}).get("message")
                            if isinstance(err_body, dict)
                            else mr.text[:240]
                        )
                    except Exception:
                        models_err = (mr.text or "")[:240]
            except httpx.HTTPError as e:
                models_err = f"models endpoint unreachable: {e}"

            # Prefer chat probe when model name is provided (authoritative for routing)
            if model:
                probe_body = {
                    "model": model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 1,
                    "stream": False,
                }
                cr = client.post(
                    f"{base}/chat/completions",
                    headers=headers,
                    content=json.dumps(probe_body, ensure_ascii=False).encode("utf-8"),
                )
                latency_ms = int((time.perf_counter() - started) * 1000)
                usage = None
                resp_json: dict[str, Any] | None = None
                try:
                    parsed = cr.json()
                    if isinstance(parsed, dict):
                        resp_json = parsed
                        if isinstance(parsed.get("usage"), dict):
                            usage = parsed["usage"]
                except Exception:
                    resp_json = None
                if cr.status_code < 400:
                    # 部分上游成功响应不带 usage，用探测请求体估算下限，避免费用漏记
                    if not usage:
                        usage = {"prompt_tokens": 4, "completion_tokens": 1, "total_tokens": 5}
                    return {
                        "ok": True,
                        "latencyMs": latency_ms,
                        "method": "chat/completions",
                        "statusCode": cr.status_code,
                        "models": model_ids[:30],
                        "modelMatched": model in model_ids if model_ids else None,
                        "message": f"上游连通，模型 {model} 可调用",
                        "usage": usage,
                        "requestBody": probe_body,
                        "responseBody": resp_json,
                    }
                msg = None
                if isinstance(resp_json, dict):
                    msg = (resp_json.get("error") or {}).get("message") if isinstance(resp_json.get("error"), dict) else None
                if not msg:
                    msg = (cr.text or "")[:300]
                return {
                    "ok": False,
                    "latencyMs": latency_ms,
                    "method": "chat/completions",
                    "statusCode": cr.status_code,
                    "models": model_ids[:30],
                    "usage": usage,
                    "requestBody": probe_body,
                    "responseBody": resp_json,
                    "error": {
                        "message": f"上游拒绝 chat/completions：{msg}",
                        "type": "upstream_rejected",
                    },
                }

            latency_ms = int((time.perf_counter() - started) * 1000)
            if models_status is not None and models_status < 400:
                return {
                    "ok": True,
                    "latencyMs": latency_ms,
                    "method": "models",
                    "statusCode": models_status,
                    "models": model_ids[:30],
                    "message": f"上游连通，已读取 {len(model_ids)} 个模型",
                }
            return {
                "ok": False,
                "latencyMs": latency_ms,
                "method": "models",
                "statusCode": models_status,
                "error": {
                    "message": models_err or "无法访问上游 /models，且未提供 sourceModel 做 chat 探测",
                    "type": "upstream_rejected",
                },
            }
    except httpx.HTTPError as e:
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "latencyMs": latency_ms,
            "error": {"message": f"upstream unreachable: {e}", "type": "upstream_unreachable"},
        }


def _parse_sse_usage_line(line: bytes, usage_box: dict) -> None:
    text = line.strip()
    if not text.startswith(b"data:"):
        return
    payload = text[5:].strip()
    if not payload or payload == b"[DONE]":
        return
    try:
        obj = json.loads(payload.decode("utf-8", errors="replace"))
    except Exception:
        return
    if isinstance(obj, dict) and isinstance(obj.get("usage"), dict):
        usage_box["usage"] = obj["usage"]


def mock_chat_sse(body: dict, *, service_id: str, source_model: str, usage_box: dict | None = None):
    """Yield OpenAI-compatible SSE bytes for mock mode."""
    chat = mock_chat_completion(body, service_id=service_id, source_model=source_model)
    if usage_box is not None:
        usage_box["usage"] = chat.get("usage")
    content = ((chat.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    created = chat.get("created") or int(time.time())
    cid = chat.get("id") or f"chatcmpl-mock-{uuid.uuid4().hex[:12]}"
    first = {
        "id": cid,
        "object": "chat.completion.chunk",
        "created": created,
        "model": service_id,
        "choices": [{"index": 0, "delta": {"role": "assistant", "content": content}, "finish_reason": None}],
    }
    last = {
        "id": cid,
        "object": "chat.completion.chunk",
        "created": created,
        "model": service_id,
        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        "usage": chat.get("usage"),
    }
    yield f"data: {json.dumps(first, ensure_ascii=False)}\n\n".encode("utf-8")
    yield f"data: {json.dumps(last, ensure_ascii=False)}\n\n".encode("utf-8")
    yield b"data: [DONE]\n\n"


def forward_chat(
    body: dict, source: dict | None, *, service_id: str, stream: bool | None = None
) -> tuple[int, dict | Any, bool, dict]:
    """Forward chat completion. Returns (status, payload, streaming, usage_box)."""
    base, key, source_model = _effective_cred(source)
    want_stream = wants_stream(body) if stream is None else bool(stream)
    usage_box: dict = {"usage": None}
    if not base or not key:
        if want_stream:
            return (
                200,
                mock_chat_sse(body, service_id=service_id, source_model=source_model, usage_box=usage_box),
                True,
                usage_box,
            )
        data = mock_chat_completion(body, service_id=service_id, source_model=source_model)
        usage_box["usage"] = data.get("usage")
        return 200, data, False, usage_box

    payload = dict(body)
    payload["model"] = source_model or payload.get("model")
    payload["stream"] = want_stream
    if want_stream:
        opts = payload.get("stream_options")
        if not isinstance(opts, dict):
            opts = {}
        opts = {**opts, "include_usage": True}
        payload["stream_options"] = opts
    url = f"{base}/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    if want_stream:
        client = httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0))
        try:
            req = client.build_request("POST", url, headers=headers, content=raw)
            resp = client.send(req, stream=True)
        except httpx.HTTPError as e:
            client.close()
            return 502, {"error": {"message": f"upstream request failed: {e}", "type": "upstream_unreachable"}}, False, usage_box

        if resp.status_code >= 400:
            try:
                err_text = resp.read().decode("utf-8", errors="replace")
                try:
                    data = json.loads(err_text) if err_text else {"error": {"message": "upstream error", "type": "upstream_error"}}
                except Exception:
                    data = {"error": {"message": err_text[:500], "type": "upstream_error"}}
            finally:
                resp.close()
                client.close()
            return resp.status_code, data, False, usage_box

        def generate():
            buf = b""
            try:
                for chunk in resp.iter_bytes():
                    if not chunk:
                        continue
                    yield chunk
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        _parse_sse_usage_line(line, usage_box)
                if buf:
                    _parse_sse_usage_line(buf, usage_box)
            finally:
                resp.close()
                client.close()

        return resp.status_code, generate(), True, usage_box

    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, headers=headers, content=raw)
        try:
            data = resp.json()
        except Exception:
            data = {"error": {"message": resp.text[:500], "type": "upstream_error"}}
        if isinstance(data, dict):
            data.setdefault("gateway", {})
            if isinstance(data["gateway"], dict):
                data["gateway"].update({"mode": "upstream", "sourceModel": source_model, "serviceId": service_id})
            usage_box["usage"] = data.get("usage")
        return resp.status_code, data, False, usage_box
    except httpx.HTTPError as e:
        return 502, {"error": {"message": f"upstream request failed: {e}", "type": "upstream_unreachable"}}, False, usage_box


def forward_embeddings(body: dict, source: dict | None, *, service_id: str) -> tuple[int, dict | Any]:
    base, key, source_model = _effective_cred(source)
    if not base or not key:
        return 200, mock_embeddings(body, service_id=service_id)
    payload = dict(body)
    payload["model"] = source_model or payload.get("model")
    url = f"{base}/embeddings"
    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(
                url,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                content=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            )
        data = resp.json() if resp.content else {}
        return resp.status_code, data
    except httpx.HTTPError as e:
        return 502, {"error": {"message": f"upstream request failed: {e}", "type": "upstream_unreachable"}}


def forward_responses(body: dict, source: dict | None, *, service_id: str) -> tuple[int, dict | Any]:
    base, key, source_model = _effective_cred(source)
    if not base or not key:
        return 200, mock_responses(body, service_id=service_id, source_model=source_model)
    # Many providers lack Responses API; map to chat/completions
    user_input = body.get("input") or body.get("prompt") or ""
    if isinstance(user_input, list):
        user_input = json.dumps(user_input, ensure_ascii=False)
    chat_body = {
        "model": source_model,
        "messages": [{"role": "user", "content": str(user_input)}],
        "stream": False,
    }
    status, chat, _streaming, _usage_box = forward_chat(chat_body, source, service_id=service_id, stream=False)
    if status >= 400 or not isinstance(chat, dict):
        return status, chat
    text = (
        ((chat.get("choices") or [{}])[0].get("message") or {}).get("content")
        or json.dumps(chat, ensure_ascii=False)[:500]
    )
    return 200, {
        "id": f"resp-{uuid.uuid4().hex[:12]}",
        "object": "response",
        "created_at": int(time.time()),
        "model": service_id,
        "status": "completed",
        "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]}],
        "gateway": {"mode": "upstream-mapped", "sourceModel": source_model},
    }
