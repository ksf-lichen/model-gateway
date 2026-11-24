"""JSON file persistence for services, sources, and API keys."""
from __future__ import annotations

import json
import os
import secrets
import threading
import time
from copy import deepcopy
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent / "data"
STORE_PATH = DATA_DIR / "store.json"
_lock = threading.RLock()


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _default_store() -> dict[str, Any]:
    # 空目录起步：只保留用户在控制台真实创建、且可配置上游的服务/源
    return {
        "services": [],
        "sources": [],
        "keys": [],
        "callLogs": [],
    }


def ensure_store() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not STORE_PATH.exists():
        save_store(_default_store())


def load_store() -> dict[str, Any]:
    ensure_store()
    with _lock:
        with STORE_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)


def save_store(data: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STORE_PATH.with_suffix(".tmp")
    with _lock:
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(STORE_PATH)


def mutate(fn):
    with _lock:
        data = load_store()
        result = fn(data)
        save_store(data)
        return result


def list_services() -> list[dict]:
    return deepcopy(load_store().get("services", []))


def get_service(service_id: str | None = None, *, by_name: str | None = None) -> dict | None:
    for s in load_store().get("services", []):
        if service_id and s.get("id") == service_id:
            return deepcopy(s)
        if by_name and (s.get("serviceId") == by_name or s.get("name") == by_name):
            return deepcopy(s)
    return None


def create_service(payload: dict) -> dict:
    def _do(data):
        sid = payload.get("serviceId", "").strip().lower().replace(" ", "-")
        if not sid:
            raise ValueError("serviceId required")
        if any(s.get("serviceId") == sid for s in data["services"]):
            raise ValueError("serviceId already exists")
        item = {
            "id": f"svc-{int(time.time() * 1000)}",
            "name": (payload.get("name") or sid).strip(),
            "serviceId": sid,
            "hosting": "local" if payload.get("hosting") == "local" else "saas",
            "modality": payload.get("modality") or "对话 / 推理",
            "protocol": payload.get("protocol") or "OpenAI · Chat Completions",
            "desc": payload.get("desc") or "",
            "status": "已发布",
            "strategy": payload.get("strategy") or "fixed",
            "enabled": payload.get("enabled", True) is not False,
            "created": _now(),
        }
        data["services"].insert(0, item)
        return deepcopy(item)

    return mutate(_do)


def update_service(svc_id: str, payload: dict) -> dict:
    def _do(data):
        for s in data["services"]:
            if s["id"] == svc_id:
                for k in ("name", "hosting", "modality", "protocol", "desc", "strategy", "status"):
                    if k in payload and payload[k] is not None:
                        s[k] = payload[k]
                if "enabled" in payload:
                    s["enabled"] = bool(payload["enabled"])
                if s.get("hosting") not in ("saas", "local"):
                    s["hosting"] = "saas"
                return deepcopy(s)
        raise KeyError("service not found")

    return mutate(_do)


def list_sources() -> list[dict]:
    return deepcopy(load_store().get("sources", []))


def sources_for_service(service_ref: str) -> list[dict]:
    return [s for s in list_sources() if s.get("serviceRef") == service_ref and s.get("status") != "已停用"]


def create_source(payload: dict) -> dict:
    def _do(data):
        ref = payload.get("serviceRef") or ""
        matched = next((s for s in data["services"] if s["id"] == ref or s.get("serviceId") == ref), None)
        if not matched:
            raise ValueError("serviceRef not found")
        ref = matched["id"]
        base_url = (payload.get("baseUrl") or "").strip().rstrip("/")
        api_key = (payload.get("apiKey") or "").strip()
        source_model = (payload.get("sourceModel") or "").strip()
        if not base_url or not api_key:
            raise ValueError("生产接入必须提供 baseUrl 与 apiKey，并完成上游连通性校验")
        if not source_model:
            raise ValueError("sourceModel is required")
        item = {
            "id": f"src-{int(time.time() * 1000)}",
            "name": (payload.get("name") or source_model or "upstream").strip(),
            "serviceRef": ref,
            "provider": payload.get("provider") or "Custom",
            "region": payload.get("region") or "本地",
            "protocol": payload.get("protocol") or "OpenAI · Chat Completions",
            "baseUrl": base_url,
            "sourceModel": source_model,
            "apiKey": api_key,
            "status": payload.get("status") or "运行中",
            "lastProbe": payload.get("lastProbe") or {},
            "verifiedAt": payload.get("verifiedAt") or _now(),
            "created": _now(),
            "timeout": payload.get("timeout"),
            "concurrency": payload.get("concurrency"),
            "retries": payload.get("retries"),
            "circuit": payload.get("circuit"),
            "healthCheck": payload.get("healthCheck"),
            "prices": payload.get("prices") if isinstance(payload.get("prices"), dict) else {},
            "capabilities": payload.get("capabilities") if isinstance(payload.get("capabilities"), dict) else {},
            "customCapabilities": payload.get("customCapabilities") or "",
        }
        data["sources"].insert(0, item)
        out = deepcopy(item)
        if out.get("apiKey"):
            out["apiKey"] = "••••" + out["apiKey"][-4:]
            out["hasApiKey"] = True
        else:
            out["hasApiKey"] = False
        return out

    return mutate(_do)


def get_source(source_id: str) -> dict | None:
    for s in load_store().get("sources", []):
        if s.get("id") == source_id:
            return deepcopy(s)
    return None


def update_source(source_id: str, payload: dict) -> dict:
    def _do(data):
        for i, s in enumerate(data["sources"]):
            if s.get("id") != source_id:
                continue
            for field in (
                "name",
                "provider",
                "region",
                "protocol",
                "baseUrl",
                "sourceModel",
                "serviceRef",
                "status",
                "lastProbe",
                "verifiedAt",
                "timeout",
                "concurrency",
                "retries",
                "circuit",
                "healthCheck",
                "customCapabilities",
            ):
                if field in payload and payload[field] is not None:
                    val = payload[field]
                    if field == "baseUrl":
                        val = str(val).strip().rstrip("/")
                    s[field] = val
            if isinstance(payload.get("prices"), dict):
                s["prices"] = payload["prices"]
            if isinstance(payload.get("capabilities"), dict):
                s["capabilities"] = payload["capabilities"]
            if payload.get("apiKey"):
                s["apiKey"] = str(payload["apiKey"]).strip()
            data["sources"][i] = s
            return public_source(s)
        raise KeyError(source_id)

    return mutate(_do)


def public_source(src: dict) -> dict:
    out = deepcopy(src)
    key = out.get("apiKey") or ""
    out["hasApiKey"] = bool(key)
    out["apiKey"] = ("••••" + key[-4:]) if key else ""
    out.setdefault("usedIn", "0")
    out.setdefault("usedOut", "0")
    out.setdefault("usedCache", "0")
    out.setdefault("usedSpend", "0.00")
    out.setdefault("callCount", 0)
    return out


def list_keys() -> list[dict]:
    keys = deepcopy(load_store().get("keys", []))
    for k in keys:
        k.pop("secret", None)
        k["mask"] = k.get("mask") or "ak_live_••••"
        k["runtimeStatus"] = key_runtime_status(k)
    return keys


def _parse_expire_ts(expires_at: str | None) -> float | None:
    if not expires_at:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return time.mktime(time.strptime(expires_at[:19], fmt if len(expires_at) > 10 else "%Y-%m-%d"))
        except ValueError:
            continue
    return None


def key_runtime_status(key: dict) -> str:
    """Normalize virtual-key lifecycle status for runtime checks."""
    status = key.get("status") or "健康"
    if status in ("已吊销", "已禁用", "已撤销"):
        return "已吊销"
    if status in ("已暂停", "暂停", "已停用", "停用"):
        return "已停用"
    if key.get("expirePreset") != "never":
        ts = _parse_expire_ts(key.get("expiresAt"))
        if ts is not None and ts < time.time():
            return "已过期"
    return status if status else "健康"


def find_key_by_secret(secret: str) -> dict | None:
    for k in load_store().get("keys", []):
        if k.get("secret") != secret:
            continue
        runtime = key_runtime_status(k)
        if runtime in ("已吊销", "已禁用"):
            return None
        out = deepcopy(k)
        out["runtimeStatus"] = runtime
        return out
    return None


def create_key(payload: dict) -> dict:
    def _do(data):
        kind = payload.get("keyKind") or payload.get("kind") or "app"
        if kind not in ("app", "personal"):
            raise ValueError("keyKind must be app or personal")
        refs = payload.get("serviceRefs") or []
        if isinstance(refs, str):
            refs = [refs]
        if not refs:
            # default: all enabled services
            refs = [s["id"] for s in data["services"] if s.get("enabled") is not False]
        secret = "ak_live_" + secrets.token_hex(16)
        over = payload.get("overLimit") or "立即拒绝并返回 429"
        item = {
            "id": f"key-{int(time.time() * 1000)}",
            "type": "api",
            "keyKind": kind,
            "name": (payload.get("name") or f"{kind}-key").strip(),
            "secret": secret,
            "mask": "ak_live_••••" + secret[-4:].upper(),
            "owner": payload.get("owner") or "",
            "ownerMemberId": payload.get("ownerMemberId") or "",
            "orgLevel": payload.get("orgLevel") or "dept",
            "orgId": payload.get("orgId") or payload.get("billingDept") or "",
            "orgName": payload.get("orgName") or payload.get("billingDept") or "",
            "billingDept": payload.get("billingDept") or payload.get("orgName") or "",
            "serviceRefs": refs,
            "limitMode": payload.get("limitMode") or "both",
            "window": payload.get("window") or "每天",
            "maxInTokens": payload.get("maxInTokens") or "",
            "maxOutTokens": payload.get("maxOutTokens") or "",
            "maxSpend": payload.get("maxSpend") or "",
            "overLimit": over,
            "expirePreset": payload.get("expirePreset") or "never",
            "expiresAt": payload.get("expiresAt") or "",
            "usedIn": "0",
            "usedOut": "0",
            "usedCache": "0",
            "usedSpend": "0.00",
            "status": "健康",
            "env": payload.get("env") or "prod",
            "created": _now(),
            "rotated": "—",
            "lastUsed": "—",
        }
        data["keys"].insert(0, item)
        out = deepcopy(item)
        out["plaintext"] = secret
        out.pop("secret", None)
        return out

    return mutate(_do)


def update_key(key_id: str, payload: dict) -> dict:
    def _do(data):
        for i, k in enumerate(data["keys"]):
            if k.get("id") != key_id:
                continue
            for field in (
                "name",
                "status",
                "limitMode",
                "window",
                "maxInTokens",
                "maxOutTokens",
                "maxSpend",
                "overLimit",
                "expirePreset",
                "expiresAt",
                "serviceRefs",
                "orgLevel",
                "orgId",
                "orgName",
                "billingDept",
            ):
                if field in payload and payload[field] is not None:
                    k[field] = payload[field]
            data["keys"][i] = k
            out = deepcopy(k)
            out.pop("secret", None)
            out["runtimeStatus"] = key_runtime_status(out)
            return out
        raise KeyError(key_id)

    return mutate(_do)


def delete_key(key_id: str) -> dict:
    """Permanently remove a virtual API key from the gateway store."""

    def _do(data):
        for i, k in enumerate(data.get("keys") or []):
            if k.get("id") != key_id:
                continue
            removed = deepcopy(k)
            data["keys"].pop(i)
            removed.pop("secret", None)
            return removed
        raise KeyError(key_id)

    return mutate(_do)


def rotate_key(key_id: str) -> dict:
    """Rotate virtual key secret (Create→Rotate lifecycle)."""

    def _do(data):
        for i, k in enumerate(data["keys"]):
            if k.get("id") != key_id:
                continue
            if key_runtime_status(k) == "已吊销":
                raise ValueError("revoked key cannot be rotated")
            secret = "ak_live_" + secrets.token_hex(16)
            k["secret"] = secret
            k["mask"] = "ak_live_••••" + secret[-4:].upper()
            k["rotated"] = _now()
            if k.get("status") in ("已暂停", "已停用", "暂停", "停用"):
                pass
            else:
                k["status"] = "健康"
            data["keys"][i] = k
            out = deepcopy(k)
            out["plaintext"] = secret
            out.pop("secret", None)
            return out
        raise KeyError(key_id)

    return mutate(_do)


def key_quota_blocked(key: dict) -> tuple[bool, str]:
    """FinOps hard-limit check: token / spend quotas with hard overLimit."""
    over = key.get("overLimit") or ""
    hard = "拒绝" in over or "429" in over or "阻断" in over
    if not hard:
        return False, ""
    mode = key.get("limitMode") or "both"
    if mode in ("spend", "both"):
        max_spend = _to_float(key.get("maxSpend"))
        used_spend = _to_float(key.get("usedSpend"))
        if max_spend > 0 and used_spend >= max_spend:
            return True, f"Key spend quota exceeded ({used_spend}/{max_spend})"
    if mode in ("token", "both"):
        max_in = _to_float(key.get("maxInTokens"))
        max_out = _to_float(key.get("maxOutTokens"))
        used_in = _to_float(key.get("usedIn"))
        used_out = _to_float(key.get("usedOut"))
        if max_in > 0 and used_in >= max_in:
            return True, f"Key input token quota exceeded ({int(used_in)}/{int(max_in)})"
        if max_out > 0 and used_out >= max_out:
            return True, f"Key output token quota exceeded ({int(used_out)}/{int(max_out)})"
    return False, ""


def touch_key_usage(key_id: str) -> None:
    def _do(data):
        for k in data["keys"]:
            if k["id"] == key_id:
                k["lastUsed"] = _now()
                break
        return None

    mutate(_do)


_MAX_AUDIT_TEXT = 200_000
_MAX_INLINE_BINARY = 240


def _truncate_text(value: Any, limit: int = _MAX_AUDIT_TEXT) -> str:
    text = str(value if value is not None else "")
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…(已截断，原长 {len(text)} 字符)"


def _looks_like_data_url(value: str) -> bool:
    return isinstance(value, str) and value.startswith("data:") and ";base64," in value[:128]


def _file_meta(
    *,
    name: str = "",
    mime: str = "",
    url: str = "",
    size: int | None = None,
    kind: str = "file",
    excerpt: str = "",
) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "kind": kind or "file",
        "name": name or "未命名附件",
        "mime": mime or "",
        "size": size,
        "truncated": False,
    }
    if url:
        if _looks_like_data_url(url) or len(url) > _MAX_INLINE_BINARY:
            meta["truncated"] = True
            meta["urlPreview"] = url[:80] + ("…" if len(url) > 80 else "")
            meta["note"] = "二进制/Base64 内容已省略，仅保留元数据"
        else:
            meta["url"] = url
    if excerpt:
        meta["excerpt"] = _truncate_text(excerpt, 4000)
    return meta


def _sanitize_content_part(part: Any, files: list[dict]) -> Any:
    if isinstance(part, str):
        return _truncate_text(part)
    if not isinstance(part, dict):
        return part

    out = dict(part)
    ptype = str(out.get("type") or "")

    # OpenAI vision / file parts
    if "text" in out and isinstance(out.get("text"), str):
        out["text"] = _truncate_text(out["text"])
    if "input_text" in out and isinstance(out.get("input_text"), str):
        out["input_text"] = _truncate_text(out["input_text"])

    image = out.get("image_url")
    if isinstance(image, dict):
        url = str(image.get("url") or "")
        meta = _file_meta(
            name=str(image.get("name") or "image"),
            mime=str(image.get("mime_type") or image.get("mime") or "image/*"),
            url=url,
            kind="image",
        )
        files.append(meta)
        out["image_url"] = {
            "url": meta.get("url") or meta.get("urlPreview") or "[omitted]",
            "detail": image.get("detail"),
            "name": meta["name"],
            "audit": {"truncated": meta["truncated"], "note": meta.get("note")},
        }
    elif isinstance(image, str):
        meta = _file_meta(name="image", url=image, kind="image", mime="image/*")
        files.append(meta)
        out["image_url"] = meta.get("url") or meta.get("urlPreview") or "[omitted]"

    file_obj = out.get("file") if isinstance(out.get("file"), dict) else None
    if file_obj is None and ptype in ("file", "input_file", "document"):
        file_obj = out
    if isinstance(file_obj, dict):
        data = file_obj.get("file_data") or file_obj.get("data") or file_obj.get("url") or ""
        meta = _file_meta(
            name=str(file_obj.get("filename") or file_obj.get("name") or out.get("filename") or "attachment"),
            mime=str(file_obj.get("mime_type") or file_obj.get("mime") or out.get("mime_type") or ""),
            url=str(data) if isinstance(data, str) else "",
            size=_to_int(file_obj.get("size"), 0) or None,
            kind="file",
            excerpt=str(file_obj.get("excerpt") or file_obj.get("text") or ""),
        )
        files.append(meta)
        cleaned = {
            "filename": meta["name"],
            "mime_type": meta["mime"],
            "size": meta["size"],
            "audit": {"truncated": meta["truncated"], "note": meta.get("note")},
        }
        if meta.get("excerpt"):
            cleaned["excerpt"] = meta["excerpt"]
        if meta.get("url"):
            cleaned["url"] = meta["url"]
        if "file" in out:
            out["file"] = cleaned
        else:
            out.update(cleaned)
            for heavy in ("file_data", "data"):
                out.pop(heavy, None)

    # Anthropic-style / generic base64 fields
    for key in ("source", "inline_data"):
        blob = out.get(key)
        if isinstance(blob, dict) and (blob.get("data") or blob.get("url")):
            raw = str(blob.get("data") or blob.get("url") or "")
            meta = _file_meta(
                name=str(out.get("name") or blob.get("media_type") or key),
                mime=str(blob.get("media_type") or blob.get("mime_type") or ""),
                url=raw,
                kind="file",
            )
            files.append(meta)
            out[key] = {
                "media_type": meta["mime"],
                "data": meta.get("url") or meta.get("urlPreview") or "[omitted]",
                "audit": {"truncated": meta["truncated"], "note": meta.get("note")},
            }

    return out


def _sanitize_message_content(content: Any, files: list[dict]) -> Any:
    if isinstance(content, str):
        return _truncate_text(content)
    if isinstance(content, list):
        return [_sanitize_content_part(part, files) for part in content]
    if isinstance(content, dict):
        return _sanitize_content_part(content, files)
    return content


def snapshot_request_payload(body: Any) -> tuple[dict[str, Any] | None, list[dict]]:
    """Return audit-safe request body + extracted file metas (text kept, binary omitted)."""
    if not isinstance(body, dict):
        return None, []
    files: list[dict] = []
    out = deepcopy(body)

    messages = out.get("messages")
    if isinstance(messages, list):
        cleaned = []
        for msg in messages:
            if not isinstance(msg, dict):
                cleaned.append(msg)
                continue
            m = dict(msg)
            if "content" in m:
                m["content"] = _sanitize_message_content(m.get("content"), files)
            cleaned.append(m)
        out["messages"] = cleaned

    for key in ("input", "prompt", "instructions"):
        if key in out and isinstance(out.get(key), (str, list, dict)):
            out[key] = _sanitize_message_content(out.get(key), files)

    # top-level files / attachments arrays
    for key in ("files", "attachments", "documents"):
        arr = out.get(key)
        if not isinstance(arr, list):
            continue
        cleaned_arr = []
        for item in arr:
            if isinstance(item, dict):
                cleaned_arr.append(_sanitize_content_part(item, files))
            elif isinstance(item, str):
                meta = _file_meta(name=item.split("/")[-1] or "attachment", url=item)
                files.append(meta)
                cleaned_arr.append(meta)
            else:
                cleaned_arr.append(item)
        out[key] = cleaned_arr

    # de-dupe files by name+mime+kind
    uniq: list[dict] = []
    seen: set[str] = set()
    for f in files:
        sig = f"{f.get('kind')}|{f.get('name')}|{f.get('mime')}|{f.get('urlPreview') or f.get('url') or ''}"
        if sig in seen:
            continue
        seen.add(sig)
        uniq.append(f)
    return out, uniq


def snapshot_response_payload(data: Any, *, streaming: bool = False) -> dict[str, Any] | None:
    """Return audit-safe response body; stream responses keep usage/summary only."""
    if streaming:
        usage = None
        text = ""
        if isinstance(data, dict):
            usage = data.get("usage")
            choices = data.get("choices") or []
            if choices and isinstance(choices[0], dict):
                msg = (choices[0].get("message") or {}) if isinstance(choices[0].get("message"), dict) else {}
                text = str(msg.get("content") or choices[0].get("text") or "")
        return {
            "stream": True,
            "note": "流式响应：分片正文未整包落库，保留摘要与 usage",
            "usage": usage,
            "textPreview": _truncate_text(text, 8000) if text else "",
        }
    if data is None:
        return None
    if not isinstance(data, dict):
        return {"raw": _truncate_text(data, 8000)}
    out = deepcopy(data)
    # trim heavy embedding vectors
    if isinstance(out.get("data"), list) and out.get("object") == "list":
        trimmed = []
        for item in out["data"][:20]:
            if isinstance(item, dict) and "embedding" in item:
                emb = item.get("embedding")
                trimmed.append(
                    {
                        **{k: v for k, v in item.items() if k != "embedding"},
                        "embedding": f"[vector len={len(emb) if isinstance(emb, list) else 'n/a'}]",
                    }
                )
            else:
                trimmed.append(item)
        out["data"] = trimmed
        if len(data.get("data") or []) > 20:
            out["_truncatedItems"] = len(data["data"])
    choices = out.get("choices")
    if isinstance(choices, list):
        for ch in choices:
            if not isinstance(ch, dict):
                continue
            msg = ch.get("message")
            if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                msg["content"] = _truncate_text(msg["content"])
            if isinstance(ch.get("text"), str):
                ch["text"] = _truncate_text(ch["text"])
    return out


def append_call_log(entry: dict) -> None:
    def _do(data):
        logs = data.setdefault("callLogs", [])
        logs.insert(0, {**entry, "time": entry.get("time") or _now()})
        data["callLogs"] = logs[:1000]
        return None

    mutate(_do)


def list_call_logs(
    *,
    service_id: str = "",
    service_ref: str = "",
    source_id: str = "",
    key_id: str = "",
    limit: int = 200,
) -> list[dict]:
    logs = load_store().get("callLogs") or []
    out = []
    for item in logs:
        if service_id and item.get("model") != service_id and item.get("serviceId") != service_id:
            continue
        if service_ref and item.get("serviceRef") != service_ref:
            continue
        if source_id and item.get("sourceId") != source_id:
            continue
        if key_id and item.get("keyId") != key_id:
            continue
        out.append(deepcopy(item))
        if len(out) >= max(1, min(limit, 1000)):
            break
    return out


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def extract_usage(payload: Any) -> dict[str, int]:
    """Normalize OpenAI-compatible usage into prompt / completion / cached tokens."""
    usage = payload
    if isinstance(payload, dict) and "usage" in payload:
        usage = payload.get("usage")
    if not isinstance(usage, dict):
        return {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0, "total_tokens": 0}

    prompt = _to_int(usage.get("prompt_tokens") or usage.get("input_tokens"))
    completion = _to_int(usage.get("completion_tokens") or usage.get("output_tokens"))
    details = usage.get("prompt_tokens_details") or usage.get("input_tokens_details") or {}
    cached = 0
    if isinstance(details, dict):
        cached = _to_int(
            details.get("cached_tokens")
            or details.get("cache_read_tokens")
            or details.get("cache_read_input_tokens")
        )
    if not cached:
        cached = _to_int(
            usage.get("cached_tokens")
            or usage.get("cache_read_input_tokens")
            or usage.get("prompt_cache_hit_tokens")
        )
    cached = max(0, min(cached, prompt)) if prompt else max(0, cached)
    total = _to_int(usage.get("total_tokens"), prompt + completion)
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "cached_tokens": cached,
        "total_tokens": total,
    }


def _active_price_triplet(prices: dict | None) -> tuple[float, float, float]:
    p = prices if isinstance(prices, dict) else {}
    hour = time.localtime().tm_hour
    if p.get("timePricing"):
        if 9 <= hour < 22:
            return (
                _to_float(p.get("busyInput") or p.get("flatInput")),
                _to_float(p.get("busyOutput") or p.get("flatOutput")),
                _to_float(p.get("busyCache") or p.get("flatCache")),
            )
        return (
            _to_float(p.get("idleInput") or p.get("flatInput") or p.get("busyInput")),
            _to_float(p.get("idleOutput") or p.get("flatOutput") or p.get("busyOutput")),
            _to_float(p.get("idleCache") or p.get("flatCache") or p.get("busyCache")),
        )
    return (
        _to_float(p.get("flatInput") or p.get("busyInput")),
        _to_float(p.get("flatOutput") or p.get("busyOutput")),
        _to_float(p.get("flatCache") or p.get("busyCache")),
    )


def estimate_usage_cost(prices: dict | None, usage: dict | None) -> float:
    """Estimate CNY cost from source prices (per 1M tokens) and usage."""
    u = usage if isinstance(usage, dict) else {}
    prompt = _to_int(u.get("prompt_tokens"))
    completion = _to_int(u.get("completion_tokens"))
    cached = _to_int(u.get("cached_tokens"))
    cached = max(0, min(cached, prompt)) if prompt else max(0, cached)
    billable_in = max(0, prompt - cached)
    pin, pout, pcache = _active_price_triplet(prices)
    discount = _to_float((prices or {}).get("discount"), 100.0) / 100.0
    if discount <= 0:
        discount = 1.0
    unit = 1_000_000.0
    raw = billable_in / unit * pin + completion / unit * pout + cached / unit * pcache
    return round(raw * discount, 6)


def _add_num_str(current: Any, delta: float, *, money: bool = False) -> str:
    base = _to_float(current)
    nxt = base + delta
    if money:
        return f"{nxt:.4f}".rstrip("0").rstrip(".") if nxt else "0.00"
    if abs(nxt - round(nxt)) < 1e-9:
        return str(int(round(nxt)))
    return f"{nxt:.4f}".rstrip("0").rstrip(".")


def record_invocation(
    *,
    key_id: str = "",
    source_id: str = "",
    service_ref: str = "",
    service_id: str = "",
    audience: str = "",
    env: str = "prod",
    status: int = 200,
    stream: bool = False,
    routing: str = "fixed",
    user_id: str = "",
    usage: dict | None = None,
    latency_ms: int | None = None,
    failover_attempts: list | None = None,
    request_body: dict | None = None,
    response_body: Any = None,
    route: str = "",
    prices: dict | None = None,
    key_name: str = "",
    purpose: str = "",
    source_model: str = "",
    source_name: str = "",
    provider: str = "",
    mode: str = "upstream",
) -> dict:
    """Persist one proxied call: call log + key counters + source counters.

    Audit retention: request/response text is kept (truncated); file/binary payloads
    are stored as metadata only and listed under ``files``.
    """
    usage_norm = extract_usage(usage or {})
    prompt = usage_norm["prompt_tokens"]
    completion = usage_norm["completion_tokens"]
    cached = usage_norm["cached_tokens"]
    request_payload, files = snapshot_request_payload(request_body)
    response_payload = snapshot_response_payload(response_body, streaming=bool(stream))

    def _do(data):
        key = next((k for k in data.get("keys", []) if k.get("id") == key_id), None) if key_id else None
        source = next((s for s in data.get("sources", []) if s.get("id") == source_id), None) if source_id else None
        price_book = prices if isinstance(prices, dict) and prices else ((source or {}).get("prices") or {})
        cost = estimate_usage_cost(price_book, usage_norm) if status < 400 else 0.0

        if key is not None:
            key["lastUsed"] = _now()
            if status < 400:
                key["usedIn"] = _add_num_str(key.get("usedIn"), prompt)
                key["usedOut"] = _add_num_str(key.get("usedOut"), completion)
                key["usedCache"] = _add_num_str(key.get("usedCache"), cached)
                key["usedSpend"] = f"{_to_float(key.get('usedSpend')) + cost:.4f}"

        if source is not None and status < 400:
            source["usedIn"] = _add_num_str(source.get("usedIn"), prompt)
            source["usedOut"] = _add_num_str(source.get("usedOut"), completion)
            source["usedCache"] = _add_num_str(source.get("usedCache"), cached)
            source["usedSpend"] = f"{_to_float(source.get('usedSpend')) + cost:.4f}"
            source["callCount"] = _to_int(source.get("callCount")) + 1
            source["lastUsed"] = _now()

        svc = None
        ref = service_ref or (source or {}).get("serviceRef") or ""
        if ref:
            svc = next((s for s in data.get("services", []) if s.get("id") == ref or s.get("serviceId") == ref), None)
        resolved_service_id = service_id or (svc or {}).get("serviceId") or ""

        entry = {
            "id": f"clog-{int(time.time() * 1000)}-{secrets.token_hex(3)}",
            "audience": audience,
            "env": env,
            "keyId": key_id or "",
            "keyName": (key or {}).get("name") or key_name or "",
            "model": resolved_service_id,
            "serviceId": resolved_service_id,
            "serviceRef": (svc or {}).get("id") or ref,
            "mode": mode or "upstream",
            "purpose": purpose or "",
            "sourceId": source_id or (source or {}).get("id") or "",
            "sourceModel": (source or {}).get("sourceModel") or source_model or "",
            "sourceName": (source or {}).get("name") or source_name or source_model or "",
            "provider": (source or {}).get("provider") or provider or "",
            "routing": routing,
            "route": route or "/v1/chat/completions",
            "status": status,
            "stream": bool(stream),
            "userId": user_id or "",
            "promptTokens": prompt,
            "completionTokens": completion,
            "cachedTokens": cached,
            "totalTokens": usage_norm["total_tokens"] or (prompt + completion),
            "cost": cost,
            "latencyMs": latency_ms,
            "failoverAttempts": failover_attempts or [],
            "requestPayload": request_payload,
            "responsePayload": response_payload,
            "files": files,
            "time": _now(),
        }
        logs = data.setdefault("callLogs", [])
        logs.insert(0, entry)
        data["callLogs"] = logs[:1000]
        return deepcopy(entry)

    return mutate(_do)


def find_source_for_probe(*, base_url: str = "", source_model: str = "", api_key: str = "", source_id: str = "") -> dict | None:
    """Best-effort match an existing source for attributing probe cost."""
    if source_id:
        hit = get_source(source_id)
        if hit:
            return hit
    base = (base_url or "").strip().rstrip("/")
    model = (source_model or "").strip()
    key = (api_key or "").strip()
    sources = load_store().get("sources") or []
    candidates = []
    for s in sources:
        if model and (s.get("sourceModel") or "") != model:
            continue
        if base and (s.get("baseUrl") or "").rstrip("/") != base:
            continue
        if key and (s.get("apiKey") or "") and (s.get("apiKey") or "") != key:
            continue
        candidates.append(s)
    if len(candidates) == 1:
        return deepcopy(candidates[0])
    if not candidates and model:
        soft = [s for s in sources if (s.get("sourceModel") or "") == model]
        if len(soft) == 1:
            return deepcopy(soft[0])
    return deepcopy(candidates[0]) if candidates else None


def record_probe_invocation(
    *,
    probe: dict | None,
    source: dict | None = None,
    prices: dict | None = None,
    provider: str = "",
    source_model: str = "",
    env: str = "prod",
) -> dict | None:
    """Persist connectivity-check chat calls into callLogs / source counters / cost.

    Only chat/completions probes consume billable tokens; /models listing is skipped.
    """
    result = probe if isinstance(probe, dict) else {}
    if result.get("method") != "chat/completions":
        return None
    usage = result.get("usage") if isinstance(result.get("usage"), dict) else None
    ok = bool(result.get("ok"))
    # 成功探测一定记账；失败仅在上游已返回 usage 时记账（确有计费痕迹）
    if not ok and not usage:
        return None
    if ok and not usage:
        usage = {"prompt_tokens": 4, "completion_tokens": 1, "total_tokens": 5}

    src = source if isinstance(source, dict) else None
    price_book = prices if isinstance(prices, dict) and prices else None
    entry = record_invocation(
        key_id="",
        key_name="连通性探测",
        source_id=(src or {}).get("id") or "",
        service_ref=(src or {}).get("serviceRef") or "",
        audience="probe",
        env=env,
        status=int(result.get("statusCode") or (200 if ok else 422)),
        stream=False,
        routing="probe",
        usage=usage,
        latency_ms=result.get("latencyMs"),
        request_body=result.get("requestBody") if isinstance(result.get("requestBody"), dict) else {
            "model": (src or {}).get("sourceModel") or source_model,
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 1,
            "stream": False,
        },
        response_body=result.get("responseBody") if isinstance(result.get("responseBody"), dict) else (
            {"error": result.get("error")} if not ok else None
        ),
        route="/admin/sources/probe",
        prices=price_book,
        purpose="upstream_connectivity_probe",
        source_model=(src or {}).get("sourceModel") or source_model or "",
        source_name=(src or {}).get("name") or "",
        provider=(src or {}).get("provider") or provider or "",
        mode="probe",
    )
    # 回写探测摘要，便于前端展示费用
    if isinstance(probe, dict) and entry:
        probe["recorded"] = True
        probe["cost"] = entry.get("cost")
        probe["promptTokens"] = entry.get("promptTokens")
        probe["completionTokens"] = entry.get("completionTokens")
        probe["callLogId"] = entry.get("id")
    return entry


def admin_token() -> str:
    return os.environ.get("ADMIN_TOKEN", "local-dev-token")
