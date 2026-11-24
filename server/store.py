"""JSON file persistence for services, sources, and API keys."""
from __future__ import annotations

import json
import os
import secrets
import threading
import time
from collections import defaultdict, deque
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
        "providers": [],
        "sources": [],
        "keys": [],
        "callLogs": [],
    }


def ensure_store() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not STORE_PATH.exists():
        save_store(_default_store())


def _normalize_base_url(url: str) -> str:
    return (url or "").strip().rstrip("/")


def load_store() -> dict[str, Any]:
    ensure_store()
    with _lock:
        with STORE_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if "providers" not in data or not isinstance(data.get("providers"), list):
            data["providers"] = []
        if _migrate_providers_inplace(data):
            save_store(data)
        return data


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


def detect_provider_vendor(name: str) -> str:
    text = name or ""
    lower = text.lower()
    if "阿里" in text or "aliyun" in lower or "百炼" in text or "dashscope" in lower:
        return "aliyun"
    if "腾讯" in text or "tencent" in lower:
        return "tencent"
    if "火山" in text or "volc" in lower or "豆包" in text:
        return "volcengine"
    if "deepseek" in lower:
        return "deepseek"
    if "openai" in lower:
        return "openai"
    return "other"


def _public_invoice_block(invoice: Any) -> dict:
    inv = invoice if isinstance(invoice, dict) else {}
    ak = str(inv.get("accessKeyId") or "").strip()
    secret = str(inv.get("accessKeySecret") or "").strip()
    return {
        "enabled": bool(inv.get("enabled")),
        "titleId": str(inv.get("titleId") or "").strip(),
        "recipientEmails": list(inv.get("recipientEmails") or []),
        "invoiceType": inv.get("invoiceType") if inv.get("invoiceType") in (0, 1) else 0,
        "invoiceMode": inv.get("invoiceMode") if inv.get("invoiceMode") in (0, 1) else 0,
        "remark": inv.get("remark") or "",
        "nbid": inv.get("nbid") or "",
        "ecId": inv.get("ecId") or "",
        "accountIds": list(inv.get("accountIds") or []),
        "hasCredentials": bool(ak and secret),
        "accessKeyIdMasked": (("••••" + ak[-4:]) if len(ak) >= 4 else ("••••" if ak else "")),
    }


def provider_invoice_ready(prov: dict) -> bool:
    """Aliyun providers become invoice-ready after title + BSS credentials are filled."""
    if detect_provider_vendor(prov.get("name") or "") != "aliyun":
        return False
    inv = prov.get("invoice") if isinstance(prov.get("invoice"), dict) else {}
    title = str(inv.get("titleId") or "").strip()
    emails = inv.get("recipientEmails") or []
    ak = str(inv.get("accessKeyId") or "").strip() or str(prov.get("apiKey") or "").strip()
    secret = str(inv.get("accessKeySecret") or "").strip()
    # secret may live only in invoice block; model apiKey alone is not enough for BSS
    return bool(title and emails and ak and secret)


def public_provider(prov: dict) -> dict:
    out = deepcopy(prov)
    key = out.get("apiKey") or ""
    out["hasApiKey"] = bool(key)
    out["apiKey"] = ("••••" + key[-4:]) if key else ""
    out["vendor"] = detect_provider_vendor(out.get("name") or "")
    out["invoice"] = _public_invoice_block(out.get("invoice"))
    out["invoiceReady"] = provider_invoice_ready(prov)
    out.setdefault("status", "运行中")
    out.setdefault("sourceCount", 0)
    return out


def admin_provider_detail(provider_id: str) -> dict:
    """Full provider including secrets — for local invoice API / admin only."""
    prov = get_provider(provider_id)
    if not prov:
        raise KeyError(provider_id)
    out = deepcopy(prov)
    out["vendor"] = detect_provider_vendor(out.get("name") or "")
    out["invoiceReady"] = provider_invoice_ready(prov)
    out["hasApiKey"] = bool(out.get("apiKey"))
    return out


def _provider_group_key(provider_name: str, base_url: str) -> str:
    return f"{(provider_name or 'Custom').strip().lower()}|{_normalize_base_url(base_url).lower()}"


def _new_provider_id() -> str:
    return f"prov-{int(time.time() * 1000)}-{secrets.token_hex(2)}"


def _provider_from_source_fields(
    *,
    name: str = "",
    protocol: str = "",
    base_url: str = "",
    api_key: str = "",
    region: str = "",
    timeout: Any = 30,
    concurrency: Any = 500,
    retries: Any = 2,
    circuit: Any = 5,
    health_check: str = "每 30 秒",
    status: str = "运行中",
) -> dict:
    return {
        "id": _new_provider_id(),
        "name": (name or "Custom").strip() or "Custom",
        "protocol": protocol or "OpenAI · Chat Completions",
        "baseUrl": _normalize_base_url(base_url),
        "apiKey": (api_key or "").strip(),
        "region": region or "本地",
        "timeout": timeout if timeout is not None else 30,
        "concurrency": concurrency if concurrency is not None else 500,
        "retries": retries if retries is not None else 2,
        "circuit": circuit if circuit is not None else 5,
        "healthCheck": health_check or "每 30 秒",
        "status": status or "运行中",
        "created": _now(),
    }


def _find_provider_in_data(data: dict, provider_id: str | None = None, *, name: str = "", base_url: str = "") -> dict | None:
    providers = data.get("providers") or []
    if provider_id:
        for p in providers:
            if p.get("id") == provider_id:
                return p
    if name or base_url:
        key = _provider_group_key(name, base_url)
        for p in providers:
            if _provider_group_key(p.get("name") or "", p.get("baseUrl") or "") == key:
                return p
    return None


def _sync_sources_from_provider(data: dict, provider: dict) -> None:
    """Copy connection fields from provider onto child sources for runtime forwarding."""
    pid = provider.get("id")
    if not pid:
        return
    base = _normalize_base_url(provider.get("baseUrl") or "")
    for s in data.get("sources") or []:
        if s.get("providerId") != pid:
            continue
        s["provider"] = provider.get("name") or s.get("provider") or "Custom"
        s["protocol"] = provider.get("protocol") or s.get("protocol")
        s["baseUrl"] = base
        if provider.get("apiKey"):
            s["apiKey"] = provider.get("apiKey")
        for field in ("region", "timeout", "concurrency", "retries", "circuit", "healthCheck"):
            if provider.get(field) is not None:
                s[field] = provider.get(field)


def _migrate_providers_inplace(data: dict) -> bool:
    """Group legacy sources into providers; return True if store mutated."""
    changed = False
    data.setdefault("providers", [])
    sources = data.get("sources") or []
    for s in sources:
        if s.get("providerId"):
            # drop dangling providerId
            if not _find_provider_in_data(data, s.get("providerId")):
                s.pop("providerId", None)
                changed = True
            continue
        name = s.get("provider") or "Custom"
        base = _normalize_base_url(s.get("baseUrl") or "")
        found = _find_provider_in_data(data, name=name, base_url=base)
        if not found:
            found = _provider_from_source_fields(
                name=name,
                protocol=s.get("protocol") or "",
                base_url=base,
                api_key=s.get("apiKey") or "",
                region=s.get("region") or "",
                timeout=s.get("timeout"),
                concurrency=s.get("concurrency"),
                retries=s.get("retries"),
                circuit=s.get("circuit"),
                health_check=s.get("healthCheck") or "每 30 秒",
                status=s.get("status") or "运行中",
            )
            data["providers"].insert(0, found)
            changed = True
        elif not found.get("apiKey") and s.get("apiKey"):
            found["apiKey"] = s.get("apiKey")
            changed = True
        if s.get("providerId") != found["id"]:
            s["providerId"] = found["id"]
            changed = True
        # keep inherited fields aligned
        s["provider"] = found.get("name") or s.get("provider")
        if found.get("baseUrl"):
            s["baseUrl"] = found["baseUrl"]
    return changed


def _ensure_provider_for_connection(
    data: dict,
    *,
    provider_id: str = "",
    name: str = "",
    protocol: str = "",
    base_url: str = "",
    api_key: str = "",
    region: str = "",
    timeout: Any = 30,
    concurrency: Any = 500,
    retries: Any = 2,
    circuit: Any = 5,
    health_check: str = "每 30 秒",
) -> dict:
    base = _normalize_base_url(base_url)
    found = _find_provider_in_data(data, provider_id or None, name=name, base_url=base)
    if found:
        if name:
            found["name"] = name.strip() or found.get("name") or "Custom"
        if protocol:
            found["protocol"] = protocol
        if base:
            found["baseUrl"] = base
        if api_key:
            found["apiKey"] = api_key.strip()
        if region:
            found["region"] = region
        for field, val in (
            ("timeout", timeout),
            ("concurrency", concurrency),
            ("retries", retries),
            ("circuit", circuit),
            ("healthCheck", health_check),
        ):
            if val is not None and val != "":
                found[field] = val
        _sync_sources_from_provider(data, found)
        return found
    item = _provider_from_source_fields(
        name=name,
        protocol=protocol,
        base_url=base,
        api_key=api_key,
        region=region,
        timeout=timeout,
        concurrency=concurrency,
        retries=retries,
        circuit=circuit,
        health_check=health_check,
    )
    data.setdefault("providers", []).insert(0, item)
    return item


def list_providers() -> list[dict]:
    data = load_store()
    sources = data.get("sources") or []
    out = []
    for p in data.get("providers") or []:
        pub = public_provider(p)
        pub["sourceCount"] = sum(1 for s in sources if s.get("providerId") == p.get("id"))
        out.append(pub)
    return out


def get_provider(provider_id: str) -> dict | None:
    for p in load_store().get("providers", []):
        if p.get("id") == provider_id:
            return deepcopy(p)
    return None


def create_provider(payload: dict) -> dict:
    def _do(data):
        base = _normalize_base_url(payload.get("baseUrl") or "")
        api_key = (payload.get("apiKey") or "").strip()
        name = (payload.get("name") or payload.get("provider") or "").strip()
        if not name:
            raise ValueError("供应商名称必填")
        if not base:
            raise ValueError("baseUrl 必填")
        if not api_key:
            raise ValueError("apiKey 必填")
        existing = _find_provider_in_data(data, name=name, base_url=base)
        if existing:
            raise ValueError("已存在相同名称与 Base URL 的供应商")
        item = _provider_from_source_fields(
            name=name,
            protocol=payload.get("protocol") or "",
            base_url=base,
            api_key=api_key,
            region=payload.get("region") or "",
            timeout=payload.get("timeout"),
            concurrency=payload.get("concurrency"),
            retries=payload.get("retries"),
            circuit=payload.get("circuit"),
            health_check=payload.get("healthCheck") or "每 30 秒",
            status=payload.get("status") or "运行中",
        )
        data.setdefault("providers", []).insert(0, item)
        return public_provider(item)

    return mutate(_do)


def update_provider(provider_id: str, payload: dict) -> dict:
    def _do(data):
        for i, p in enumerate(data.get("providers") or []):
            if p.get("id") != provider_id:
                continue
            for field in (
                "name",
                "protocol",
                "region",
                "timeout",
                "concurrency",
                "retries",
                "circuit",
                "healthCheck",
                "status",
            ):
                if field in payload and payload[field] is not None:
                    p[field] = payload[field]
            if "baseUrl" in payload and payload["baseUrl"] is not None:
                p["baseUrl"] = _normalize_base_url(payload["baseUrl"])
            if payload.get("apiKey"):
                p["apiKey"] = str(payload["apiKey"]).strip()
            if isinstance(payload.get("invoice"), dict):
                cur = p.get("invoice") if isinstance(p.get("invoice"), dict) else {}
                nxt = dict(cur)
                inv = payload["invoice"]
                for field in (
                    "enabled",
                    "titleId",
                    "recipientEmails",
                    "invoiceType",
                    "invoiceMode",
                    "remark",
                    "nbid",
                    "ecId",
                    "accountIds",
                    "securityToken",
                ):
                    if field in inv and inv[field] is not None:
                        nxt[field] = inv[field]
                if "accessKeyId" in inv:
                    nxt["accessKeyId"] = str(inv.get("accessKeyId") or "").strip()
                if "accessKeySecret" in inv:
                    nxt["accessKeySecret"] = str(inv.get("accessKeySecret") or "").strip()
                if "enabled" not in nxt:
                    nxt["enabled"] = True
                p["invoice"] = nxt
            if not (p.get("name") or "").strip():
                raise ValueError("供应商名称必填")
            if not p.get("baseUrl"):
                raise ValueError("baseUrl 必填")
            data["providers"][i] = p
            _sync_sources_from_provider(data, p)
            pub = public_provider(p)
            pub["sourceCount"] = sum(1 for s in data.get("sources") or [] if s.get("providerId") == provider_id)
            return pub
        raise KeyError(provider_id)

    return mutate(_do)


def delete_provider(provider_id: str, *, delete_sources: bool = False) -> dict:
    def _do(data):
        providers = data.get("providers") or []
        idx = next((i for i, p in enumerate(providers) if p.get("id") == provider_id), -1)
        if idx < 0:
            raise KeyError(provider_id)
        removed = providers.pop(idx)
        sources = data.get("sources") or []
        if delete_sources:
            data["sources"] = [s for s in sources if s.get("providerId") != provider_id]
        else:
            for s in sources:
                if s.get("providerId") == provider_id:
                    s.pop("providerId", None)
        return public_provider(removed)

    return mutate(_do)


def list_services() -> list[dict]:
    return deepcopy(load_store().get("services", []))


def get_service(service_id: str | None = None, *, by_name: str | None = None) -> dict | None:
    for s in load_store().get("services", []):
        if service_id and s.get("id") == service_id:
            return deepcopy(s)
        if by_name and (s.get("serviceId") == by_name or s.get("name") == by_name):
            return deepcopy(s)
    return None


def sanitize_service_id(raw: str) -> str:
    text = (raw or "").strip().lower().replace(" ", "-")
    out = []
    for ch in text:
        if ch.isalnum() or ch in "._-":
            out.append(ch)
        elif ch in "/:\\|":
            out.append("-")
    sid = "".join(out).strip("-._")
    while "--" in sid:
        sid = sid.replace("--", "-")
    return sid[:120] or "model"


def create_service(payload: dict) -> dict:
    def _do(data):
        sid = sanitize_service_id(payload.get("serviceId", ""))
        if not sid:
            raise ValueError("serviceId required")
        if any(s.get("serviceId") == sid for s in data["services"]):
            raise ValueError("serviceId already exists")
        item = {
            "id": f"svc-{int(time.time() * 1000)}-{secrets.token_hex(2)}",
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


def get_or_create_service_by_model(source_model: str, *, protocol: str = "", hosting: str = "saas") -> dict:
    """Find service by serviceId derived from upstream model id, or create one."""
    sid = sanitize_service_id(source_model)
    existing = next((s for s in list_services() if s.get("serviceId") == sid), None)
    if existing:
        return existing
    return create_service(
        {
            "serviceId": sid,
            "name": source_model or sid,
            "protocol": protocol or "OpenAI · Chat Completions",
            "hosting": hosting or "saas",
            "strategy": "fixed",
            "enabled": True,
        }
    )


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


def prices_configured(prices: Any) -> bool:
    """True when busy/flat input+output (or timed segments) are set."""
    if not isinstance(prices, dict):
        return False
    segs = prices.get("timeSegments")
    if isinstance(segs, list):
        for seg in segs:
            if (
                isinstance(seg, dict)
                and seg.get("input") not in (None, "")
                and seg.get("output") not in (None, "")
            ):
                return True
    inn = prices.get("busyInput")
    if inn in (None, ""):
        inn = prices.get("flatInput")
    out = prices.get("busyOutput")
    if out in (None, ""):
        out = prices.get("flatOutput")
    return inn not in (None, "") and out not in (None, "")


def _ensure_service_for_model(
    data: dict,
    source_model: str,
    *,
    protocol: str = "",
    hosting: str = "saas",
) -> dict:
    """Find service by sanitized model id, or create one in-place on store data."""
    sid = sanitize_service_id(source_model)
    existing = next((s for s in data.get("services", []) if s.get("serviceId") == sid), None)
    if existing:
        return existing
    item = {
        "id": f"svc-{int(time.time() * 1000)}-{secrets.token_hex(2)}",
        "name": source_model,
        "serviceId": sid,
        "hosting": hosting or "saas",
        "modality": "对话 / 推理",
        "protocol": protocol or "OpenAI · Chat Completions",
        "desc": f"由源模型接入自动创建（{source_model}）",
        "status": "已发布",
        "strategy": "fixed",
        "enabled": True,
        "created": _now(),
    }
    data.setdefault("services", []).insert(0, item)
    return item


def create_source(payload: dict) -> dict:
    def _do(data):
        source_model = (payload.get("sourceModel") or "").strip()
        if not source_model:
            raise ValueError("sourceModel is required")
        provider_id = str(payload.get("providerId") or "").strip()
        base_url = _normalize_base_url(payload.get("baseUrl") or "")
        api_key = (payload.get("apiKey") or "").strip()
        prov = None
        if provider_id:
            prov = _find_provider_in_data(data, provider_id)
            if not prov:
                raise ValueError("providerId not found")
            base_url = _normalize_base_url(prov.get("baseUrl") or "") or base_url
            if not api_key:
                api_key = (prov.get("apiKey") or "").strip()
        if not base_url or not api_key:
            raise ValueError("生产接入必须提供 baseUrl 与 apiKey，并完成上游连通性校验")
        # 源模型接入默认不绑定服务；仅当显式传入 serviceRef 时关联（例如从模型服务侧改绑）
        ref_raw = str(payload.get("serviceRef") or "").strip()
        ref = ""
        if ref_raw:
            matched = next((s for s in data["services"] if s["id"] == ref_raw or s.get("serviceId") == ref_raw), None)
            if not matched:
                raise ValueError("serviceRef not found")
            ref = matched["id"]
        if not prov:
            prov = _ensure_provider_for_connection(
                data,
                provider_id=provider_id,
                name=payload.get("provider") or "",
                protocol=payload.get("protocol") or "",
                base_url=base_url,
                api_key=api_key,
                region=payload.get("region") or "",
                timeout=payload.get("timeout"),
                concurrency=payload.get("concurrency"),
                retries=payload.get("retries"),
                circuit=payload.get("circuit"),
                health_check=payload.get("healthCheck") or "每 30 秒",
            )
        item = {
            "id": f"src-{int(time.time() * 1000)}",
            "name": (payload.get("name") or source_model or "upstream").strip(),
            "serviceRef": ref,
            "providerId": prov["id"],
            "provider": prov.get("name") or payload.get("provider") or "Custom",
            "region": payload.get("region") or prov.get("region") or "本地",
            "protocol": payload.get("protocol") or prov.get("protocol") or "OpenAI · Chat Completions",
            "baseUrl": _normalize_base_url(prov.get("baseUrl") or base_url),
            "sourceModel": source_model,
            "apiKey": (prov.get("apiKey") or api_key),
            "status": payload.get("status") or "运行中",
            "lastProbe": payload.get("lastProbe") or {},
            "verifiedAt": payload.get("verifiedAt") or _now(),
            "created": _now(),
            "timeout": payload.get("timeout") if payload.get("timeout") is not None else prov.get("timeout"),
            "concurrency": payload.get("concurrency") if payload.get("concurrency") is not None else prov.get("concurrency"),
            "retries": payload.get("retries") if payload.get("retries") is not None else prov.get("retries"),
            "circuit": payload.get("circuit") if payload.get("circuit") is not None else prov.get("circuit"),
            "healthCheck": payload.get("healthCheck") or prov.get("healthCheck"),
            "prices": payload.get("prices") if isinstance(payload.get("prices"), dict) else {},
            "capabilities": payload.get("capabilities") if isinstance(payload.get("capabilities"), dict) else {},
            "customCapabilities": payload.get("customCapabilities") or "",
            "contextLength": payload.get("contextLength") if payload.get("contextLength") not in (None, "") else None,
            "maxTokens": payload.get("maxTokens") if payload.get("maxTokens") not in (None, "") else None,
        }
        data["sources"].insert(0, item)
        return public_source(item)

    return mutate(_do)


def create_sources_batch(
    *,
    models: list[str],
    base_url: str = "",
    api_key: str = "",
    provider: str = "",
    provider_id: str = "",
    region: str = "",
    protocol: str = "",
    timeout: Any = 30,
    concurrency: Any = 500,
    retries: Any = 2,
    circuit: Any = 5,
    health_check: str = "每 30 秒",
    prices: dict | None = None,
    prices_by_model: dict | None = None,
    capabilities: dict | None = None,
    custom_capabilities: str = "",
    context_length: Any = None,
    max_tokens: Any = None,
    last_probe: dict | None = None,
    auto_create_services: bool = False,
) -> dict[str, Any]:
    """Create many sources under one supplier. Skips duplicates. By default does not bind services."""
    model_ids = []
    seen_m: set[str] = set()
    for raw in models or []:
        mid = str(raw or "").strip()
        if not mid or mid in seen_m:
            continue
        seen_m.add(mid)
        model_ids.append(mid)
    if not model_ids:
        raise ValueError("请至少选择一个上游模型")
    per_model = prices_by_model if isinstance(prices_by_model, dict) else {}
    default_prices = prices if isinstance(prices, dict) else {}

    def _do(data):
        created = []
        skipped = []
        services_created = []
        ts = int(time.time() * 1000)
        existing_prov = _find_provider_in_data(data, provider_id) if provider_id else None
        inherited_key = (api_key or "").strip() or ((existing_prov or {}).get("apiKey") or "")
        inherited_base = _normalize_base_url(base_url) or _normalize_base_url((existing_prov or {}).get("baseUrl") or "")
        if not inherited_base or not inherited_key:
            raise ValueError("baseUrl 与 apiKey 必填（可来自已有供应商）")
        prov = _ensure_provider_for_connection(
            data,
            provider_id=provider_id or ((existing_prov or {}).get("id") or ""),
            name=provider or ((existing_prov or {}).get("name") or ""),
            protocol=protocol or ((existing_prov or {}).get("protocol") or ""),
            base_url=inherited_base,
            api_key=inherited_key,
            region=region or ((existing_prov or {}).get("region") or ""),
            timeout=timeout if timeout is not None else (existing_prov or {}).get("timeout"),
            concurrency=concurrency if concurrency is not None else (existing_prov or {}).get("concurrency"),
            retries=retries if retries is not None else (existing_prov or {}).get("retries"),
            circuit=circuit if circuit is not None else (existing_prov or {}).get("circuit"),
            health_check=health_check or ((existing_prov or {}).get("healthCheck") or "每 30 秒"),
        )
        base = _normalize_base_url(prov.get("baseUrl") or "")
        key = (prov.get("apiKey") or "").strip()
        for i, source_model in enumerate(model_ids):
            model_prices = per_model.get(source_model)
            if not isinstance(model_prices, dict):
                model_prices = default_prices

            # 批量接入只落源模型能力，不自动创建/绑定对外服务；绑定在「模型服务配置」中完成
            service_ref = ""
            if auto_create_services:
                sid = sanitize_service_id(source_model)
                svc = next((s for s in data.get("services", []) if s.get("serviceId") == sid), None)
                if not svc:
                    svc = {
                        "id": f"svc-{ts}-{i}-{secrets.token_hex(2)}",
                        "name": source_model,
                        "serviceId": sid,
                        "hosting": "saas",
                        "modality": "对话 / 推理",
                        "protocol": prov.get("protocol") or "OpenAI · Chat Completions",
                        "desc": f"由供应商 Key 批量接入自动创建（{source_model}）",
                        "status": "已发布",
                        "strategy": "fixed",
                        "enabled": True,
                        "created": _now(),
                    }
                    data.setdefault("services", []).insert(0, svc)
                    services_created.append(deepcopy(svc))
                service_ref = svc["id"]

            dup = next(
                (
                    s
                    for s in data.get("sources", [])
                    if (s.get("sourceModel") or "") == source_model
                    and (
                        s.get("providerId") == prov["id"]
                        or _normalize_base_url(s.get("baseUrl") or "") == base
                    )
                ),
                None,
            )
            if dup:
                if not dup.get("providerId"):
                    dup["providerId"] = prov["id"]
                skipped.append(
                    {
                        "sourceModel": source_model,
                        "reason": "已存在相同供应商 / Base URL + 源模型",
                        "sourceId": dup.get("id"),
                    }
                )
                continue

            item = {
                "id": f"src-{ts}-{i}-{secrets.token_hex(2)}",
                "name": source_model,
                "serviceRef": service_ref,
                "providerId": prov["id"],
                "provider": prov.get("name") or provider or "Custom",
                "region": prov.get("region") or region or "本地",
                "protocol": prov.get("protocol") or protocol or "OpenAI · Chat Completions",
                "baseUrl": base,
                "sourceModel": source_model,
                "apiKey": key,
                "status": "运行中",
                "lastProbe": last_probe or {
                    "ok": True,
                    "method": "models",
                    "message": "批量接入：已通过供应商 /models 列表校验",
                },
                "verifiedAt": _now(),
                "created": _now(),
                "timeout": prov.get("timeout", timeout),
                "concurrency": prov.get("concurrency", concurrency),
                "retries": prov.get("retries", retries),
                "circuit": prov.get("circuit", circuit),
                "healthCheck": prov.get("healthCheck") or health_check,
                "prices": deepcopy(model_prices) if isinstance(model_prices, dict) else {},
                "capabilities": deepcopy(capabilities) if isinstance(capabilities, dict) else {},
                "customCapabilities": custom_capabilities or "",
                "contextLength": context_length if context_length not in (None, "") else None,
                "maxTokens": max_tokens if max_tokens not in (None, "") else None,
            }
            data.setdefault("sources", []).insert(0, item)
            created.append(public_source(item))

        unbound = [c.get("sourceModel") for c in created if not c.get("serviceRef")]
        return {
            "provider": public_provider(prov),
            "providerId": prov["id"],
            "created": created,
            "skipped": skipped,
            "servicesCreated": services_created,
            "createdCount": len(created),
            "skippedCount": len(skipped),
            "servicesCreatedCount": len(services_created),
            "unboundModels": unbound,
            "unboundCount": len(unbound),
        }

    return mutate(_do)


def create_sources_under_provider(
    provider_id: str,
    *,
    models: list[str],
    prices: dict | None = None,
    prices_by_model: dict | None = None,
    capabilities: dict | None = None,
    custom_capabilities: str = "",
    context_length: Any = None,
    max_tokens: Any = None,
    last_probe: dict | None = None,
    auto_create_services: bool = False,
) -> dict[str, Any]:
    """Append model capabilities under an existing supplier; reuse stored credentials."""
    prov = get_provider(provider_id)
    if not prov:
        raise KeyError(provider_id)
    return create_sources_batch(
        models=models,
        base_url=prov.get("baseUrl") or "",
        api_key=prov.get("apiKey") or "",
        provider=prov.get("name") or "",
        provider_id=provider_id,
        region=prov.get("region") or "",
        protocol=prov.get("protocol") or "",
        timeout=prov.get("timeout"),
        concurrency=prov.get("concurrency"),
        retries=prov.get("retries"),
        circuit=prov.get("circuit"),
        health_check=prov.get("healthCheck") or "每 30 秒",
        prices=prices,
        prices_by_model=prices_by_model,
        capabilities=capabilities,
        custom_capabilities=custom_capabilities,
        context_length=context_length,
        max_tokens=max_tokens,
        last_probe=last_probe,
        auto_create_services=auto_create_services,
    )


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
            if isinstance(payload.get("prices"), dict):
                s["prices"] = payload["prices"]
            if "serviceRef" in payload and payload["serviceRef"] is not None:
                ref_raw = str(payload.get("serviceRef") or "").strip()
                if ref_raw:
                    matched = next(
                        (svc for svc in data["services"] if svc["id"] == ref_raw or svc.get("serviceId") == ref_raw),
                        None,
                    )
                    if not matched:
                        raise ValueError("serviceRef not found")
                    s["serviceRef"] = matched["id"]
                else:
                    s["serviceRef"] = ""
            for field in (
                "name",
                "provider",
                "providerId",
                "region",
                "protocol",
                "baseUrl",
                "sourceModel",
                "status",
                "lastProbe",
                "verifiedAt",
                "timeout",
                "concurrency",
                "retries",
                "circuit",
                "healthCheck",
                "customCapabilities",
                "contextLength",
                "maxTokens",
            ):
                if field in payload and payload[field] is not None:
                    val = payload[field]
                    if field == "baseUrl":
                        val = _normalize_base_url(str(val))
                    s[field] = val
            if "contextLength" in payload and payload.get("contextLength") in (None, ""):
                s["contextLength"] = None
            if "maxTokens" in payload and payload.get("maxTokens") in (None, ""):
                s["maxTokens"] = None
            if isinstance(payload.get("capabilities"), dict):
                s["capabilities"] = payload["capabilities"]
            if payload.get("apiKey"):
                s["apiKey"] = str(payload["apiKey"]).strip()
            # Keep supplier link / inherit connection when possible
            if s.get("providerId"):
                prov = _find_provider_in_data(data, s.get("providerId"))
                if prov:
                    if payload.get("apiKey") or ("baseUrl" in payload and payload["baseUrl"] is not None) or payload.get("provider") or payload.get("protocol"):
                        if payload.get("apiKey"):
                            prov["apiKey"] = s.get("apiKey")
                        if "baseUrl" in payload and payload["baseUrl"] is not None:
                            prov["baseUrl"] = s.get("baseUrl")
                        if payload.get("provider"):
                            prov["name"] = s.get("provider")
                        if payload.get("protocol"):
                            prov["protocol"] = s.get("protocol")
                        _sync_sources_from_provider(data, prov)
                    else:
                        s["provider"] = prov.get("name") or s.get("provider")
                        s["baseUrl"] = _normalize_base_url(prov.get("baseUrl") or s.get("baseUrl") or "")
                        if not payload.get("apiKey") and prov.get("apiKey"):
                            s["apiKey"] = prov.get("apiKey")
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


def normalize_key_env(value) -> str:
    env = str(value or "prod").strip().lower()
    if env not in ("prod", "test"):
        raise ValueError("env must be prod or test")
    return env


def key_secret_prefix(env: str) -> str:
    return "ak_test_" if normalize_key_env(env) == "test" else "ak_live_"


def _optional_rate_limit(value) -> str:
    """Positive int as string; blank means unlimited."""
    if value is None or value == "":
        return ""
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return ""
    return str(n) if n > 0 else ""


def list_keys() -> list[dict]:
    keys = deepcopy(load_store().get("keys", []))
    for k in keys:
        k.pop("secret", None)
        try:
            env = normalize_key_env(k.get("env"))
        except ValueError:
            env = "prod"
        k["env"] = env
        prefix = key_secret_prefix(env)
        k["mask"] = k.get("mask") or f"{prefix}••••"
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


def new_app_id() -> str:
    """Public application identifier for AppId + Secret auth (not a secret)."""
    return "app_" + secrets.token_hex(8)


OPS_ASSISTANT_ROLE = "ops-assistant"
OPS_ASSISTANT_NAME = "运维助手"


def ensure_ops_assistant_key(*, include_secret: bool = False) -> dict:
    """Platform-owned app key for console ops assistant; usage rolls into normal billing."""

    def _do(data):
        services = [s for s in data.get("services", []) if s.get("enabled") is not False]
        refs = [s["id"] for s in services]
        found = None
        for k in data.get("keys", []):
            if k.get("platformRole") == OPS_ASSISTANT_ROLE or (k.get("name") or "") == OPS_ASSISTANT_NAME:
                found = k
                break
        if found is None:
            secret = "ak_live_" + secrets.token_hex(16)
            found = {
                "id": f"key-{int(time.time() * 1000)}",
                "type": "api",
                "keyKind": "app",
                "platformRole": OPS_ASSISTANT_ROLE,
                "name": OPS_ASSISTANT_NAME,
                "secret": secret,
                "mask": "ak_live_••••" + secret[-4:].upper(),
                "owner": "平台",
                "ownerMemberId": "",
                "orgLevel": "platform",
                "orgId": "platform",
                "orgName": "平台运维",
                "billingDept": "平台运维",
                "serviceRefs": refs,
                "limitMode": "both",
                "window": "每天",
                "maxInTokens": "",
                "maxOutTokens": "",
                "maxSpend": "",
                "rpm": "",
                "tpm": "",
                "overLimit": "立即拒绝并返回 429",
                "expirePreset": "never",
                "expiresAt": "",
                "requireAppId": False,
                "appId": "",
                "usedIn": "0",
                "usedOut": "0",
                "usedCache": "0",
                "usedSpend": "0.00",
                "status": "健康",
                "env": "prod",
                "created": _now(),
                "rotated": "—",
                "lastUsed": "—",
            }
            data.setdefault("keys", []).insert(0, found)
        else:
            found["platformRole"] = OPS_ASSISTANT_ROLE
            found["name"] = OPS_ASSISTANT_NAME
            found["keyKind"] = "app"
            found["requireAppId"] = False
            found["appId"] = ""
            found["orgLevel"] = found.get("orgLevel") or "platform"
            found["billingDept"] = found.get("billingDept") or "平台运维"
            if refs:
                found["serviceRefs"] = refs
            if (found.get("status") or "") in ("已停用", "已暂停", "暂停", "停用"):
                found["status"] = "健康"
        out = deepcopy(found)
        out["runtimeStatus"] = key_runtime_status(out)
        if not include_secret:
            out.pop("secret", None)
        return out

    return mutate(_do)


def create_key(payload: dict) -> dict:
    def _do(data):
        kind = payload.get("keyKind") or payload.get("kind") or "app"
        if kind not in ("app", "personal"):
            raise ValueError("keyKind must be app or personal")
        env = normalize_key_env(payload.get("env"))
        prefix = key_secret_prefix(env)
        refs = payload.get("serviceRefs") or []
        if isinstance(refs, str):
            refs = [refs]
        if not refs:
            # default: all enabled services
            refs = [s["id"] for s in data["services"] if s.get("enabled") is not False]
        secret = prefix + secrets.token_hex(16)
        over = payload.get("overLimit") or "立即拒绝并返回 429"
        require_raw = payload.get("requireAppId")
        require_app_id = bool(require_raw is True or require_raw == "true" or require_raw == "1")
        # AppId 校验仅面向应用 Key；个人 Key 忽略该开关
        if kind != "app":
            require_app_id = False
        app_id = ""
        if require_app_id:
            existing = str(payload.get("appId") or "").strip()
            app_id = existing if existing.startswith("app_") else new_app_id()
        item = {
            "id": f"key-{int(time.time() * 1000)}",
            "type": "api",
            "keyKind": kind,
            "name": (payload.get("name") or f"{kind}-key").strip(),
            "secret": secret,
            "mask": f"{prefix}••••" + secret[-4:].upper(),
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
            "rpm": _optional_rate_limit(payload.get("rpm") if payload.get("rpm") is not None else payload.get("qpm")),
            "tpm": _optional_rate_limit(payload.get("tpm")),
            "overLimit": over,
            "expirePreset": payload.get("expirePreset") or "never",
            "expiresAt": payload.get("expiresAt") or "",
            "requireAppId": require_app_id,
            "appId": app_id,
            "usedIn": "0",
            "usedOut": "0",
            "usedCache": "0",
            "usedSpend": "0.00",
            "status": "健康",
            "env": env,
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
            if "rpm" in payload or "qpm" in payload:
                raw = payload["rpm"] if "rpm" in payload else payload.get("qpm")
                k["rpm"] = _optional_rate_limit(raw)
            if "tpm" in payload:
                k["tpm"] = _optional_rate_limit(payload.get("tpm"))
            if "requireAppId" in payload and payload["requireAppId"] is not None:
                raw = payload["requireAppId"]
                want = bool(raw is True or raw == "true" or raw == "1")
                if (k.get("keyKind") or "app") != "app":
                    want = False
                k["requireAppId"] = want
                if want and not str(k.get("appId") or "").strip():
                    k["appId"] = new_app_id()
                if not want:
                    # 关闭校验时保留已生成的 appId，便于再次开启
                    k.setdefault("appId", k.get("appId") or "")
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
            env = normalize_key_env(k.get("env") or "prod")
            k["env"] = env
            prefix = key_secret_prefix(env)
            secret = prefix + secrets.token_hex(16)
            k["secret"] = secret
            k["mask"] = f"{prefix}••••" + secret[-4:].upper()
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


# Sliding 60s window per Key for RPM/QPM + TPM. In-memory (per gateway process).
_RATE_WINDOW_SEC = 60.0
_rate_lock = threading.Lock()
_rate_events: dict[str, deque] = defaultdict(deque)  # key_id -> deque[(ts, tokens)]


def _prune_rate_window(dq: deque, now: float) -> None:
    while dq and now - dq[0][0] > _RATE_WINDOW_SEC:
        dq.popleft()


def key_rate_usage(key_id: str) -> tuple[int, int]:
    """Return (requests_in_window, tokens_in_window) for diagnostics."""
    if not key_id:
        return 0, 0
    now = time.time()
    with _rate_lock:
        dq = _rate_events.get(key_id) or deque()
        _prune_rate_window(dq, now)
        return len(dq), int(sum(t for _, t in dq))


def admit_key_rate(key: dict) -> tuple[bool, str]:
    """Hard rate-limit check + reserve one request slot. Always hard 429 (not soft overLimit)."""
    key_id = (key or {}).get("id") or ""
    if not key_id:
        return False, ""
    rpm = _to_float(key.get("rpm"))
    tpm = _to_float(key.get("tpm"))
    if rpm <= 0 and tpm <= 0:
        return False, ""
    now = time.time()
    with _rate_lock:
        dq = _rate_events[key_id]
        _prune_rate_window(dq, now)
        req_count = len(dq)
        token_sum = int(sum(t for _, t in dq))
        if rpm > 0 and req_count >= rpm:
            return True, f"Key QPM/RPM exceeded ({req_count}/{int(rpm)} per minute)"
        if tpm > 0 and token_sum >= tpm:
            return True, f"Key TPM exceeded ({token_sum}/{int(tpm)} tokens per minute)"
        dq.append((now, 0))
        return False, ""


def finalize_key_rate(key_id: str, tokens: int = 0) -> None:
    """Attach token usage to the latest reserved request for TPM accounting."""
    if not key_id:
        return
    add = max(0, int(tokens or 0))
    if add <= 0:
        return
    now = time.time()
    with _rate_lock:
        dq = _rate_events[key_id]
        _prune_rate_window(dq, now)
        if dq:
            ts, prev = dq[-1]
            dq[-1] = (ts, prev + add)
        else:
            dq.append((now, add))


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


def normalize_base_url(base_url: str | None) -> str:
    return str(base_url or "").strip().rstrip("/")


def supplier_spend(base_url: str | None, *, data: dict | None = None) -> float:
    """Sum usedSpend across sources that share the same normalized Base URL."""
    base = normalize_base_url(base_url)
    if not base:
        return 0.0
    store = data if isinstance(data, dict) else load_store()
    total = 0.0
    for src in store.get("sources") or []:
        if normalize_base_url(src.get("baseUrl")) != base:
            continue
        total += _to_float(src.get("usedSpend"))
    return total


def resolve_spend_tier(prices: dict | None, spend: float) -> dict | None:
    """Pick the spend tier whose [minSpend, maxSpend) contains current supplier spend."""
    p = prices if isinstance(prices, dict) else {}
    if not (p.get("tieredPricing") is True or p.get("tieredPricing") == "true"):
        return None
    tiers = p.get("spendTiers")
    if not isinstance(tiers, list) or not tiers:
        return None
    amount = max(0.0, float(spend or 0.0))
    ordered: list[dict[str, Any]] = []
    for raw in tiers:
        if not isinstance(raw, dict):
            continue
        try:
            mn = float(raw.get("minSpend") if raw.get("minSpend") not in (None, "") else 0)
        except (TypeError, ValueError):
            mn = 0.0
        mx_raw = raw.get("maxSpend")
        try:
            mx = None if mx_raw in (None, "") else float(mx_raw)
        except (TypeError, ValueError):
            mx = None
        ordered.append({**raw, "minSpend": mn, "maxSpend": mx})
    ordered.sort(key=lambda t: float(t.get("minSpend") or 0))
    for tier in ordered:
        mn = float(tier.get("minSpend") or 0)
        mx = tier.get("maxSpend")
        if amount < mn:
            continue
        if mx is None or amount < float(mx):
            return tier
    return ordered[-1] if ordered else None


def _active_price_triplet(
    prices: dict | None,
    *,
    supplier_spend_amount: float | None = None,
) -> tuple[float, float, float]:
    p = prices if isinstance(prices, dict) else {}
    hour = time.localtime().tm_hour
    tier = None
    if supplier_spend_amount is not None:
        tier = resolve_spend_tier(p, supplier_spend_amount)
    if tier:
        pin = _to_float(tier.get("input") or p.get("busyInput") or p.get("flatInput"))
        pout = _to_float(tier.get("output") or p.get("busyOutput") or p.get("flatOutput"))
        pcache_raw = tier.get("cache")
        pcache = _to_float(pcache_raw if pcache_raw not in (None, "") else pin)
        if p.get("timePricing") and not (9 <= hour < 22):
            # 阶梯档存忙时/统一价；闲时优先行内闲时价，否则按闲时倍率回退
            ratio = _to_float(p.get("idleRatio"), 50.0) / 100.0
            if ratio <= 0:
                ratio = 0.5
            idle_in = p.get("idleInput")
            idle_out = p.get("idleOutput")
            idle_cache = p.get("idleCache")
            return (
                _to_float(idle_in) if idle_in not in (None, "") else pin * ratio,
                _to_float(idle_out) if idle_out not in (None, "") else pout * ratio,
                _to_float(idle_cache) if idle_cache not in (None, "") else pcache * ratio,
            )
        return (pin, pout, pcache)
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


def estimate_usage_cost(
    prices: dict | None,
    usage: dict | None,
    *,
    supplier_spend_amount: float | None = None,
) -> float:
    """Estimate CNY cost from source prices (per 1M tokens) and usage."""
    u = usage if isinstance(usage, dict) else {}
    prompt = _to_int(u.get("prompt_tokens"))
    completion = _to_int(u.get("completion_tokens"))
    cached = _to_int(u.get("cached_tokens"))
    cached = max(0, min(cached, prompt)) if prompt else max(0, cached)
    billable_in = max(0, prompt - cached)
    pin, pout, pcache = _active_price_triplet(prices, supplier_spend_amount=supplier_spend_amount)
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
        spend_before = supplier_spend((source or {}).get("baseUrl"), data=data) if source else 0.0
        cost = (
            estimate_usage_cost(price_book, usage_norm, supplier_spend_amount=spend_before)
            if status < 400
            else 0.0
        )

        if key is not None:
            key["lastUsed"] = _now()
            if status < 400:
                key["usedIn"] = _add_num_str(key.get("usedIn"), prompt)
                key["usedOut"] = _add_num_str(key.get("usedOut"), completion)
                key["usedCache"] = _add_num_str(key.get("usedCache"), cached)
                key["usedSpend"] = f"{_to_float(key.get('usedSpend')) + cost:.4f}"

        # TPM accounting uses total tokens for this call (RPM already reserved at admit).
        if key_id:
            finalize_key_rate(key_id, usage_norm["total_tokens"] or (prompt + completion))

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
