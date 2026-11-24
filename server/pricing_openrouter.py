"""Fetch OpenRouter public model catalog and match list prices for prefilling.

OpenRouter /models returns the *cheapest* endpoint price, which is often a third-party
quantized route — not the official/list price users expect. For prefills we therefore
resolve /models/{id}/endpoints and prefer the author provider (or median) before FX.
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

import httpx

_CACHE: dict[str, Any] = {"at": 0.0, "models": [], "endpoints": {}}
_CACHE_TTL_SEC = 6 * 60 * 60
_ENDPOINT_TTL_SEC = 6 * 60 * 60

# author prefix on OpenRouter id → preferred provider_name substrings (case-insensitive)
_PREFERRED_PROVIDERS: dict[str, list[str]] = {
    "deepseek": ["deepseek"],
    "qwen": ["alibaba", "qwen"],
    "openai": ["openai"],
    "anthropic": ["anthropic"],
    "google": ["google"],
    "meta-llama": ["meta", "llama"],
    "mistralai": ["mistral"],
    "x-ai": ["x-ai", "xai"],
    "cohere": ["cohere"],
    "amazon": ["amazon", "bedrock"],
}


def _norm_key(model_id: str) -> str:
    return str(model_id or "").strip().lower()


def _tail(model_id: str) -> str:
    key = _norm_key(model_id)
    return key.split("/")[-1] if "/" in key else key


def _to_decimal(v: Any) -> Decimal | None:
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _format_money(val: Decimal) -> str:
    if val == 0:
        return "0"
    quant = Decimal("0.0001") if abs(val) < Decimal("10") else Decimal("0.01")
    text = f"{val.quantize(quant, rounding=ROUND_HALF_UP):f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def convert_usd_per_token(
    usd_per_token: Any,
    *,
    usd_cny: float = 7.2,
    currency: str = "CNY",
    billing_unit: str = "每 1M Tokens",
) -> str | None:
    """OpenRouter pricing.* is USD per token → target currency per 1M or 1K tokens."""
    n = _to_decimal(usd_per_token)
    if n is None:
        return None
    per_1m_usd = n * Decimal("1000000")
    cur = (currency or "CNY").upper()
    if "USD" in cur:
        amount = per_1m_usd
    else:
        rate = Decimal(str(usd_cny if usd_cny and usd_cny > 0 else 7.2))
        amount = per_1m_usd * rate
    unit = billing_unit or "每 1M Tokens"
    if "1K" in unit or "千" in unit:
        amount = amount / Decimal("1000")
    return _format_money(amount)


# backward-compatible alias
def usd_per_token_to_cny_per_1m(usd_per_token: Any, usd_cny: float) -> str | None:
    return convert_usd_per_token(usd_per_token, usd_cny=usd_cny, currency="CNY", billing_unit="每 1M Tokens")


def fetch_openrouter_models(*, force: bool = False, timeout: float = 30.0) -> dict[str, Any]:
    now = time.time()
    if not force and _CACHE["models"] and (now - float(_CACHE["at"] or 0)) < _CACHE_TTL_SEC:
        return {
            "ok": True,
            "cached": True,
            "count": len(_CACHE["models"]),
            "models": _CACHE["models"],
            "fetchedAt": _CACHE["at"],
        }
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            resp = client.get("https://openrouter.ai/api/v1/models")
            if resp.status_code >= 400:
                return {
                    "ok": False,
                    "error": {"message": f"OpenRouter 拒绝：HTTP {resp.status_code}", "type": "upstream_rejected"},
                    "models": [],
                }
            payload = resp.json() if resp.content else {}
            raw = payload.get("data") if isinstance(payload, dict) else None
            models: list[dict[str, Any]] = []
            if isinstance(raw, list):
                for item in raw:
                    if not isinstance(item, dict) or not item.get("id"):
                        continue
                    pricing = item.get("pricing") if isinstance(item.get("pricing"), dict) else {}
                    mid = str(item.get("id")).strip()
                    models.append(
                        {
                            "id": mid,
                            "name": item.get("name") or mid,
                            "canonicalSlug": item.get("canonical_slug") or "",
                            "pricing": {
                                "prompt": pricing.get("prompt"),
                                "completion": pricing.get("completion"),
                                "inputCacheRead": pricing.get("input_cache_read")
                                or pricing.get("inputCacheRead"),
                            },
                        }
                    )
            _CACHE["models"] = models
            _CACHE["at"] = now
            if force:
                _CACHE["endpoints"] = {}
            return {"ok": True, "cached": False, "count": len(models), "models": models, "fetchedAt": now}
    except httpx.HTTPError as e:
        return {
            "ok": False,
            "error": {"message": f"无法连接 OpenRouter：{e}", "type": "upstream_unreachable"},
            "models": _CACHE["models"] or [],
            "cached": bool(_CACHE["models"]),
        }


def _endpoint_sort_key(ep: dict[str, Any]) -> tuple[float, float]:
    pricing = ep.get("pricing") if isinstance(ep.get("pricing"), dict) else {}
    pin = _to_decimal(pricing.get("prompt"))
    pout = _to_decimal(pricing.get("completion"))
    return (
        float(pin * Decimal("1000000")) if pin is not None else 1e18,
        float(pout * Decimal("1000000")) if pout is not None else 1e18,
    )


def _normalize_endpoints(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    raw = None
    if isinstance(data, dict):
        raw = data.get("endpoints")
    elif isinstance(payload.get("endpoints"), list):
        raw = payload.get("endpoints")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        # status: 0 = up; negative often degraded — still usable for list price
        pricing = item.get("pricing") if isinstance(item.get("pricing"), dict) else {}
        if not pricing:
            continue
        out.append(
            {
                "providerName": item.get("provider_name") or item.get("name") or "",
                "tag": item.get("tag") or "",
                "status": item.get("status"),
                "pricing": {
                    "prompt": pricing.get("prompt"),
                    "completion": pricing.get("completion"),
                    "inputCacheRead": pricing.get("input_cache_read")
                    or pricing.get("inputCacheRead"),
                },
            }
        )
    return out


def fetch_openrouter_endpoints(model_id: str, *, force: bool = False, timeout: float = 20.0) -> list[dict[str, Any]]:
    mid = str(model_id or "").strip()
    if not mid:
        return []
    now = time.time()
    cached = _CACHE.get("endpoints") or {}
    hit = cached.get(mid)
    if not force and isinstance(hit, dict) and (now - float(hit.get("at") or 0)) < _ENDPOINT_TTL_SEC:
        return list(hit.get("endpoints") or [])
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            resp = client.get(f"https://openrouter.ai/api/v1/models/{mid}/endpoints")
            if resp.status_code >= 400:
                return []
            endpoints = _normalize_endpoints(resp.json() if resp.content else {})
            cached[mid] = {"at": now, "endpoints": endpoints}
            _CACHE["endpoints"] = cached
            return endpoints
    except httpx.HTTPError:
        return list((hit or {}).get("endpoints") or []) if isinstance(hit, dict) else []


def _pick_representative_endpoint(endpoints: list[dict[str, Any]]) -> tuple[dict[str, Any], str]:
    """Prefer the most common USD/1M pair (list-like); else median. Avoids cheapest outlier."""
    if len(endpoints) == 1:
        return endpoints[0], "single_endpoint"
    buckets: dict[tuple[float, float], list[dict[str, Any]]] = {}
    for ep in endpoints:
        pin, pout = _endpoint_sort_key(ep)
        key = (round(pin, 4), round(pout, 4))
        buckets.setdefault(key, []).append(ep)
    # most common price point; tie-break by higher prompt (closer to list, not dump)
    ranked = sorted(
        buckets.items(),
        key=lambda kv: (len(kv[1]), kv[0][0], kv[0][1]),
        reverse=True,
    )
    top_key, top_eps = ranked[0]
    if len(top_eps) >= 2 or (len(endpoints) >= 5 and len(top_eps) >= max(2, len(endpoints) // 5)):
        return top_eps[0], "mode"
    ordered = sorted(endpoints, key=_endpoint_sort_key)
    return ordered[len(ordered) // 2], "median"


def pick_list_pricing(model_id: str, endpoints: list[dict[str, Any]], fallback: dict[str, Any] | None = None) -> dict[str, Any]:
    """Prefer author/official provider; else mode/median of endpoints; else catalog fallback."""
    usable = [e for e in endpoints if isinstance(e.get("pricing"), dict)]
    author = _norm_key(model_id).split("/")[0] if "/" in _norm_key(model_id) else ""
    preferred_names = _PREFERRED_PROVIDERS.get(author, [])

    def provider_ok(ep: dict[str, Any], names: list[str]) -> bool:
        label = f"{ep.get('providerName') or ''} {ep.get('tag') or ''}".lower()
        return any(n in label for n in names)

    chosen: list[dict[str, Any]] = []
    reason = "catalog"
    if preferred_names:
        chosen = [e for e in usable if provider_ok(e, preferred_names)]
        if chosen:
            reason = "preferred_provider"
    if not chosen and usable:
        chosen = usable
        reason = "market"

    if chosen:
        if reason == "preferred_provider" and len(chosen) == 1:
            pick = chosen[0]
            price_source = reason
        elif reason == "preferred_provider":
            pick, sub = _pick_representative_endpoint(chosen)
            price_source = f"{reason}:{sub}"
        else:
            pick, sub = _pick_representative_endpoint(chosen)
            price_source = sub
        pricing = pick.get("pricing") or {}
        return {
            "pricing": pricing,
            "providerName": pick.get("providerName") or "",
            "providerTag": pick.get("tag") or "",
            "priceSource": price_source,
            "endpointCount": len(usable),
        }

    fb = fallback if isinstance(fallback, dict) else {}
    return {
        "pricing": fb,
        "providerName": "",
        "providerTag": "",
        "priceSource": "catalog_cheapest",
        "endpointCount": 0,
    }


def _score_match(req: str, cand: dict[str, Any]) -> tuple[int, str]:
    """Higher score = better. Return (score, reason)."""
    rid = _norm_key(req)
    rtail = _tail(req)
    cid = _norm_key(cand.get("id") or "")
    ctail = _tail(cid)
    cslug = _norm_key(cand.get("canonicalSlug") or "")
    if not rid or not cid:
        return (0, "")
    if rid == cid or (cslug and rid == cslug):
        return (100, "exact")
    if rtail and rtail == ctail and rtail == rid:
        return (92, "exact_tail")
    if rtail and rtail == ctail:
        return (85, "tail")
    if cid.endswith("/" + rid) or cid.endswith("/" + rtail):
        return (80, "suffix")
    if rid.endswith("/" + ctail) or rid.endswith(ctail):
        return (75, "req_suffix")
    # qwen3.8-max → qwen3.8-max-0902 / max-prime：弱前缀，单独打分便于歧义剔除
    if rtail and len(rtail) >= 4 and (ctail.startswith(rtail + "-") or ctail.startswith(rtail + ".")):
        return (70, "prefix_tail")
    if rtail and len(rtail) >= 4 and (rtail in cid or rtail in cslug):
        return (60, "contains")
    if ctail and len(ctail) >= 4 and ctail in rid:
        return (55, "contained")
    return (0, "")


def _pick_best_candidate(req: str, models: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, int, str]:
    scored: list[tuple[int, int, str, dict[str, Any]]] = []
    rtail = _tail(req)
    for cand in models:
        score, reason = _score_match(req, cand)
        if score <= 0:
            continue
        ctail = _tail(cand.get("id") or "")
        # tie-break: closer name length, then shorter id
        scored.append((score, -abs(len(ctail) - len(rtail)), reason, cand))
    if not scored:
        return None, 0, "unmatched"
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    best_score, _, best_reason, best = scored[0]
    # 弱匹配若并列靠前，宁可不填，避免 max→max-prime 错价
    weak = {"prefix_tail", "contains", "contained", "req_suffix"}
    if best_reason in weak:
        rivals = [s for s in scored if s[0] >= best_score - 5 and s[3] is not best]
        if rivals and rivals[0][0] >= best_score - 2:
            return None, 0, "ambiguous"
    if best_score < 80 and best_reason in {"contains", "contained", "prefix_tail"}:
        # 仅接受较稳的精确/后缀匹配；弱匹配一律交给人工
        return None, best_score, "ambiguous"
    return best, best_score, best_reason


def match_openrouter_prices(
    model_ids: list[str],
    *,
    usd_cny: float = 7.2,
    currency: str = "CNY · 人民币",
    billing_unit: str = "每 1M Tokens",
    force_refresh: bool = False,
) -> dict[str, Any]:
    catalog = fetch_openrouter_models(force=force_refresh)
    if not catalog.get("ok") and not catalog.get("models"):
        return {
            "ok": False,
            "error": catalog.get("error") or {"message": "OpenRouter 价目不可用", "type": "fetch_failed"},
            "items": [],
            "usdCny": usd_cny,
            "currency": currency,
            "billingUnit": billing_unit,
        }
    models = catalog.get("models") or []

    resolved: list[tuple[str, dict[str, Any] | None, int, str]] = []
    for raw_id in model_ids or []:
        mid = str(raw_id or "").strip()
        if not mid:
            continue
        best, best_score, best_reason = _pick_best_candidate(mid, models)
        resolved.append((mid, best, best_score, best_reason))

    # parallel fetch endpoints for matched ids
    endpoint_map: dict[str, list[dict[str, Any]]] = {}
    to_fetch = sorted({(b.get("id") or "") for _, b, _, _ in resolved if b and b.get("id")})
    if to_fetch:
        with ThreadPoolExecutor(max_workers=min(8, len(to_fetch))) as pool:
            futs = {pool.submit(fetch_openrouter_endpoints, mid, force=force_refresh): mid for mid in to_fetch}
            for fut in as_completed(futs):
                mid = futs[fut]
                try:
                    endpoint_map[mid] = fut.result() or []
                except Exception:
                    endpoint_map[mid] = []

    items = []
    matched = 0
    for mid, best, best_score, best_reason in resolved:
        if not best or best_score < 80:
            items.append(
                {
                    "sourceModel": mid,
                    "matched": False,
                    "reason": best_reason or "unmatched",
                    "openrouterId": (best or {}).get("id") if best else None,
                }
            )
            continue

        picked = pick_list_pricing(
            best.get("id") or "",
            endpoint_map.get(best.get("id") or "", []),
            fallback=best.get("pricing") or {},
        )
        pricing = picked.get("pricing") or {}
        busy_in = convert_usd_per_token(
            pricing.get("prompt"), usd_cny=usd_cny, currency=currency, billing_unit=billing_unit
        )
        busy_out = convert_usd_per_token(
            pricing.get("completion"), usd_cny=usd_cny, currency=currency, billing_unit=billing_unit
        )
        busy_cache = convert_usd_per_token(
            pricing.get("inputCacheRead"), usd_cny=usd_cny, currency=currency, billing_unit=billing_unit
        )
        if busy_in is None and busy_out is None:
            items.append(
                {
                    "sourceModel": mid,
                    "matched": False,
                    "openrouterId": best.get("id"),
                    "reason": "no_price",
                }
            )
            continue

        prompt_d = _to_decimal(pricing.get("prompt"))
        completion_d = _to_decimal(pricing.get("completion"))
        usd_in = _format_money(prompt_d * Decimal("1000000")) if prompt_d is not None else ""
        usd_out = _format_money(completion_d * Decimal("1000000")) if completion_d is not None else ""

        matched += 1
        items.append(
            {
                "sourceModel": mid,
                "matched": True,
                "matchScore": best_score,
                "matchReason": best_reason,
                "openrouterId": best.get("id"),
                "openrouterName": best.get("name"),
                "providerName": picked.get("providerName") or "",
                "providerTag": picked.get("providerTag") or "",
                "priceSource": picked.get("priceSource") or "",
                "endpointCount": picked.get("endpointCount") or 0,
                "currency": currency,
                "billingUnit": billing_unit,
                "usdCny": usd_cny,
                "usdInput": usd_in,
                "usdOutput": usd_out,
                "input": busy_in or "",
                "output": busy_out or "",
                "cache": busy_cache or "",
                "note": "OpenRouter 参考价（优先官方/中位渠道，非国内独家刊例），请核对后作为结算价",
            }
        )
    return {
        "ok": True,
        "cached": bool(catalog.get("cached")),
        "catalogCount": catalog.get("count") or len(models),
        "usdCny": usd_cny,
        "currency": currency,
        "billingUnit": billing_unit,
        "requested": len([m for m in (model_ids or []) if str(m or "").strip()]),
        "matchedCount": matched,
        "unmatchedCount": max(0, len(items) - matched),
        "items": items,
    }
