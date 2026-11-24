"""Aegis model gateway — Admin API + Personal/App OpenAI-compatible proxy."""
from __future__ import annotations

import os
import threading
import time
from functools import wraps
from pathlib import Path

from flask import Flask, Response, jsonify, request, stream_with_context

import store
from pricing_openrouter import match_openrouter_prices
from upstream import (
    discover_upstream_models,
    forward_chat_with_failover,
    forward_embeddings,
    forward_responses,
    pick_source,
    probe_upstream,
    use_mock,
)

ROOT = Path(__file__).resolve().parent


def create_app(env: str = "prod") -> Flask:
    app = Flask(__name__)
    app.config["GATEWAY_ENV"] = "test" if env == "test" else "prod"

    @app.after_request
    def cors(resp):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Headers"] = (
            "Authorization, Content-Type, X-Admin-Token, X-User-Id, X-Org-Dept, "
            "X-Gateway-Env, X-App-Id, X-App-ID, AppId, appid"
        )
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, PUT, DELETE, OPTIONS"
        return resp

    @app.route("/admin/<path:_any>", methods=["OPTIONS"])
    @app.route("/personal/<path:_any>", methods=["OPTIONS"])
    @app.route("/app/<path:_any>", methods=["OPTIONS"])
    def options(_any=""):
        return ("", 204)

    def require_admin(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            token = request.headers.get("X-Admin-Token") or request.args.get("token") or ""
            if token != store.admin_token():
                return jsonify({"error": {"message": "invalid admin token", "type": "auth_error"}}), 401
            return fn(*args, **kwargs)

        return wrapper

    # ---------- Admin ----------
    @app.get("/admin/health")
    def health():
        return jsonify(
            {
                "ok": True,
                "env": app.config["GATEWAY_ENV"],
                "services": len(store.list_services()),
                "sources": len(store.list_sources()),
                "keys": len(store.list_keys()),
            }
        )

    @app.get("/admin/services")
    @require_admin
    def admin_list_services():
        return jsonify({"items": store.list_services()})

    @app.post("/admin/services")
    @require_admin
    def admin_create_service():
        try:
            item = store.create_service(request.get_json(force=True, silent=True) or {})
            return jsonify(item), 201
        except ValueError as e:
            return jsonify({"error": {"message": str(e)}}), 400

    @app.patch("/admin/services/<svc_id>")
    @require_admin
    def admin_patch_service(svc_id):
        try:
            item = store.update_service(svc_id, request.get_json(force=True, silent=True) or {})
            return jsonify(item)
        except KeyError:
            return jsonify({"error": {"message": "service not found"}}), 404

    @app.get("/admin/sources")
    @require_admin
    def admin_list_sources():
        return jsonify({"items": [store.public_source(s) for s in store.list_sources()]})

    @app.get("/admin/providers")
    @require_admin
    def admin_list_providers():
        return jsonify({"items": store.list_providers()})

    @app.get("/admin/providers/<provider_id>")
    @require_admin
    def admin_get_provider(provider_id):
        """Return full provider (incl. secrets) for local invoice tooling."""
        try:
            return jsonify(store.admin_provider_detail(provider_id))
        except KeyError:
            return jsonify({"error": {"message": "provider not found"}}), 404

    @app.post("/admin/providers")
    @require_admin
    def admin_create_provider():
        try:
            item = store.create_provider(request.get_json(force=True, silent=True) or {})
            return jsonify(item), 201
        except ValueError as e:
            return jsonify({"error": {"message": str(e)}}), 400

    @app.patch("/admin/providers/<provider_id>")
    @require_admin
    def admin_patch_provider(provider_id):
        try:
            return jsonify(store.update_provider(provider_id, request.get_json(force=True, silent=True) or {}))
        except KeyError:
            return jsonify({"error": {"message": "provider not found"}}), 404
        except ValueError as e:
            return jsonify({"error": {"message": str(e)}}), 400

    @app.delete("/admin/providers/<provider_id>")
    @require_admin
    def admin_delete_provider(provider_id):
        delete_sources = str(request.args.get("deleteSources") or "").lower() in ("1", "true", "yes")
        try:
            return jsonify(store.delete_provider(provider_id, delete_sources=delete_sources))
        except KeyError:
            return jsonify({"error": {"message": "provider not found"}}), 404

    @app.post("/admin/providers/<provider_id>/sources")
    @require_admin
    def admin_provider_add_sources(provider_id):
        """在已有供应商下追加源模型能力，复用其 Base URL / Key。"""
        body = request.get_json(force=True, silent=True) or {}
        models = body.get("models") if isinstance(body.get("models"), list) else []
        if not models:
            return jsonify({"error": {"message": "请至少选择一个上游模型"}}), 400
        prov = store.get_provider(provider_id)
        if not prov:
            return jsonify({"error": {"message": "provider not found"}}), 404
        base_url = prov.get("baseUrl") or ""
        api_key = prov.get("apiKey") or ""
        discover = discover_upstream_models(
            base_url=base_url,
            api_key=api_key,
            timeout=float(body.get("timeout") or prov.get("timeout") or 25),
        )
        if not discover.get("ok"):
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": discover.get("error")
                        or {"message": "无法读取上游模型列表", "type": "discover_failed"},
                        "discover": discover,
                    }
                ),
                422,
            )
        available = set(discover.get("models") or [])
        unknown = [m for m in models if str(m).strip() and str(m).strip() not in available]
        force = bool(body.get("force"))
        if unknown and not force:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": {
                            "message": f"以下模型不在上游 /models 列表中：{', '.join(unknown[:8])}"
                            + ("…" if len(unknown) > 8 else ""),
                            "type": "model_not_listed",
                        },
                        "unknown": unknown,
                        "discover": discover,
                    }
                ),
                422,
            )
        prices_by_model = body.get("pricesByModel") if isinstance(body.get("pricesByModel"), dict) else {}
        try:
            result = store.create_sources_under_provider(
                provider_id,
                models=[str(m).strip() for m in models if str(m).strip()],
                prices=body.get("prices") if isinstance(body.get("prices"), dict) else {},
                prices_by_model=prices_by_model,
                capabilities=body.get("capabilities") if isinstance(body.get("capabilities"), dict) else {},
                custom_capabilities=body.get("customCapabilities") or "",
                context_length=body.get("contextLength"),
                max_tokens=body.get("maxTokens"),
                last_probe={
                    "ok": True,
                    "method": "models",
                    "latencyMs": discover.get("latencyMs"),
                    "message": discover.get("message") or "厂商追加模型：已通过 /models 校验",
                },
                auto_create_services=body.get("autoCreateServices") is True,
            )
            return jsonify({"ok": True, "discover": discover, **result}), 201
        except KeyError:
            return jsonify({"error": {"message": "provider not found"}}), 404
        except ValueError as e:
            return jsonify({"error": {"message": str(e)}}), 400

    @app.post("/admin/sources/discover")
    @require_admin
    def admin_discover_source_models():
        """用供应商 Key 拉取上游 /models 全量列表（不发起 chat，不计费）。"""
        body = request.get_json(force=True, silent=True) or {}
        base_url = body.get("baseUrl") or ""
        api_key = body.get("apiKey") or ""
        provider_id = str(body.get("providerId") or "").strip()
        if provider_id and (not base_url or not api_key):
            prov = store.get_provider(provider_id)
            if not prov:
                return jsonify({"error": {"message": "provider not found"}}), 404
            base_url = base_url or (prov.get("baseUrl") or "")
            api_key = api_key or (prov.get("apiKey") or "")
        result = discover_upstream_models(
            base_url=base_url,
            api_key=api_key,
            timeout=float(body.get("timeout") or 25),
        )
        code = 200 if result.get("ok") else 422
        return jsonify(result), code

    @app.post("/admin/pricing/openrouter/match")
    @require_admin
    def admin_match_openrouter_prices():
        """用 OpenRouter 公开价目为模型清单预填参考刊例价（USD→CNY / 1M tokens）。"""
        body = request.get_json(force=True, silent=True) or {}
        models = body.get("models") if isinstance(body.get("models"), list) else []
        if not models:
            return jsonify({"error": {"message": "请提供 models 列表"}}), 400
        try:
            usd_cny = float(body.get("usdCny") or 7.2)
        except (TypeError, ValueError):
            usd_cny = 7.2
        currency = str(body.get("currency") or "CNY · 人民币")
        billing_unit = str(body.get("billingUnit") or "每 1M Tokens")
        result = match_openrouter_prices(
            [str(m).strip() for m in models if str(m).strip()],
            usd_cny=usd_cny,
            currency=currency,
            billing_unit=billing_unit,
            force_refresh=bool(body.get("forceRefresh")),
        )
        code = 200 if result.get("ok") else 422
        return jsonify(result), code

    @app.post("/admin/sources/batch")
    @require_admin
    def admin_create_sources_batch():
        """同一供应商 Key 下批量接入多个源模型；默认不绑定对外服务。"""
        body = request.get_json(force=True, silent=True) or {}
        base_url = (body.get("baseUrl") or "").strip()
        api_key = (body.get("apiKey") or "").strip()
        models = body.get("models") if isinstance(body.get("models"), list) else []
        if not base_url or not api_key:
            return jsonify({"error": {"message": "baseUrl 与 apiKey 必填"}}), 400
        if not models:
            return jsonify({"error": {"message": "请至少选择一个上游模型"}}), 400

        discover = discover_upstream_models(
            base_url=base_url,
            api_key=api_key,
            timeout=float(body.get("timeout") or 25),
        )
        if not discover.get("ok"):
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": discover.get("error")
                        or {"message": "无法读取上游模型列表", "type": "discover_failed"},
                        "discover": discover,
                    }
                ),
                422,
            )

        available = set(discover.get("models") or [])
        unknown = [m for m in models if str(m).strip() and str(m).strip() not in available]
        # 上游列表偶发不全时仍允许强制接入（前端可确认）
        force = bool(body.get("force"))
        if unknown and not force:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": {
                            "message": f"以下模型不在上游 /models 列表中：{', '.join(unknown[:8])}"
                            + ("…" if len(unknown) > 8 else ""),
                            "type": "model_not_listed",
                        },
                        "unknown": unknown,
                        "discover": discover,
                    }
                ),
                422,
            )

        prices_by_model = body.get("pricesByModel") if isinstance(body.get("pricesByModel"), dict) else {}
        try:
            result = store.create_sources_batch(
                models=[str(m).strip() for m in models if str(m).strip()],
                base_url=base_url,
                api_key=api_key,
                provider=body.get("provider") or "",
                region=body.get("region") or "",
                protocol=body.get("protocol") or "",
                timeout=body.get("timeout") or 30,
                concurrency=body.get("concurrency") or 500,
                retries=body.get("retries") if body.get("retries") is not None else 2,
                circuit=body.get("circuit") if body.get("circuit") is not None else 5,
                health_check=body.get("healthCheck") or "每 30 秒",
                prices=body.get("prices") if isinstance(body.get("prices"), dict) else {},
                prices_by_model=prices_by_model,
                capabilities=body.get("capabilities") if isinstance(body.get("capabilities"), dict) else {},
                custom_capabilities=body.get("customCapabilities") or "",
                context_length=body.get("contextLength"),
                max_tokens=body.get("maxTokens"),
                last_probe={
                    "ok": True,
                    "method": "models",
                    "latencyMs": discover.get("latencyMs"),
                    "message": discover.get("message") or "批量接入：已通过供应商 /models 校验",
                },
                # 默认不自动创建/绑定服务；仅显式 true 时才自动建服务
                auto_create_services=body.get("autoCreateServices") is True,
            )
            return jsonify({"ok": True, "discover": discover, **result}), 201
        except ValueError as e:
            return jsonify({"error": {"message": str(e)}}), 400

    @app.post("/admin/sources/probe")
    @require_admin
    def admin_probe_source():
        """Live upstream connectivity check; chat 探测产生的 Token/费用写入 callLogs。"""
        body = request.get_json(force=True, silent=True) or {}
        result = probe_upstream(
            base_url=body.get("baseUrl") or "",
            api_key=body.get("apiKey") or "",
            source_model=body.get("sourceModel") or "",
            timeout=float(body.get("timeout") or 25),
        )
        matched = store.find_source_for_probe(
            base_url=body.get("baseUrl") or "",
            source_model=body.get("sourceModel") or "",
            api_key=body.get("apiKey") or "",
        )
        prices = body.get("prices") if isinstance(body.get("prices"), dict) else None
        store.record_probe_invocation(
            probe=result,
            source=matched,
            prices=prices or ((matched or {}).get("prices") if matched else None),
            provider=body.get("provider") or "",
            source_model=body.get("sourceModel") or "",
            env=app.config["GATEWAY_ENV"],
        )
        code = 200 if result.get("ok") else 422
        return jsonify(result), code

    @app.patch("/admin/sources/<src_id>")
    @require_admin
    def admin_patch_source(src_id):
        """Update source metadata without re-probing. Empty apiKey keeps the stored key."""
        src = store.get_source(src_id)
        if not src:
            return jsonify({"error": {"message": "source not found"}}), 404
        body = request.get_json(force=True, silent=True) or {}
        patch = {}
        for field in (
            "name",
            "baseUrl",
            "sourceModel",
            "provider",
            "region",
            "protocol",
            "timeout",
            "concurrency",
            "retries",
            "circuit",
            "healthCheck",
            "customCapabilities",
            "prices",
            "capabilities",
            "apiKey",
            "serviceRef",
            "autoCreateService",
            "status",
        ):
            if field not in body or body[field] is None:
                continue
            if field == "apiKey" and not str(body[field]).strip():
                continue
            patch[field] = body[field]
        if not patch:
            return jsonify(store.public_source(src))
        try:
            updated = store.update_source(src_id, patch)
        except KeyError:
            return jsonify({"error": {"message": "source not found"}}), 404
        except ValueError as e:
            return jsonify({"error": {"message": str(e), "type": "validation_error"}}), 400
        return jsonify(updated)

    @app.post("/admin/sources/<src_id>/probe")
    @require_admin
    def admin_probe_existing_source(src_id):
        src = store.get_source(src_id)
        if not src:
            return jsonify({"error": {"message": "source not found"}}), 404
        body = request.get_json(force=True, silent=True) or {}
        result = probe_upstream(
            base_url=body.get("baseUrl") or src.get("baseUrl") or "",
            api_key=body.get("apiKey") or src.get("apiKey") or "",
            source_model=body.get("sourceModel") or src.get("sourceModel") or "",
            timeout=float(body.get("timeout") or 25),
        )
        patch = {
            "lastProbe": {
                "ok": bool(result.get("ok")),
                "latencyMs": result.get("latencyMs"),
                "method": result.get("method"),
                "message": result.get("message")
                or ((result.get("error") or {}).get("message") if not result.get("ok") else None),
                "cost": result.get("cost"),
                "promptTokens": result.get("promptTokens"),
                "completionTokens": result.get("completionTokens"),
            },
        }
        if result.get("ok"):
            patch["status"] = "运行中"
            patch["verifiedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
        else:
            patch["status"] = "异常"
        for field in (
            "baseUrl",
            "sourceModel",
            "provider",
            "region",
            "protocol",
            "timeout",
            "concurrency",
            "retries",
            "circuit",
            "healthCheck",
            "customCapabilities",
            "prices",
            "capabilities",
            "apiKey",
            "serviceRef",
            "autoCreateService",
        ):
            if field in body and body[field] is not None:
                if field == "apiKey" and not str(body[field]).strip():
                    continue
                patch[field] = body[field]
        try:
            updated = store.update_source(src_id, patch)
        except (KeyError, ValueError):
            updated = src
        prices = body.get("prices") if isinstance(body.get("prices"), dict) else None
        store.record_probe_invocation(
            probe=result,
            source=store.get_source(src_id) or updated or src,
            prices=prices,
            provider=body.get("provider") or src.get("provider") or "",
            source_model=body.get("sourceModel") or src.get("sourceModel") or "",
            env=app.config["GATEWAY_ENV"],
        )
        # lastProbe 补上记账后的费用字段
        if result.get("recorded"):
            try:
                store.update_source(
                    src_id,
                    {
                        "lastProbe": {
                            **(patch.get("lastProbe") or {}),
                            "cost": result.get("cost"),
                            "promptTokens": result.get("promptTokens"),
                            "completionTokens": result.get("completionTokens"),
                            "callLogId": result.get("callLogId"),
                        }
                    },
                )
            except KeyError:
                pass
        code = 200 if result.get("ok") else 422
        return jsonify(result), code

    @app.post("/admin/sources")
    @require_admin
    def admin_create_source():
        body = request.get_json(force=True, silent=True) or {}
        base_url = (body.get("baseUrl") or "").strip()
        api_key = (body.get("apiKey") or "").strip()
        source_model = (body.get("sourceModel") or "").strip()
        if not base_url or not api_key or not source_model:
            return (
                jsonify(
                    {
                        "error": {
                            "message": "生产接入必须填写 Base URL、上游 API Key 与源模型名称，并完成连通性校验",
                            "type": "validation_error",
                        }
                    }
                ),
                400,
            )
        probe = probe_upstream(
            base_url=base_url,
            api_key=api_key,
            source_model=source_model,
            timeout=float(body.get("timeout") or 25),
        )
        if not probe.get("ok"):
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": probe.get("error")
                        or {"message": "upstream probe failed", "type": "probe_failed"},
                        "probe": probe,
                    }
                ),
                422,
            )
        try:
            item = store.create_source(
                {
                    **body,
                    "status": "运行中",
                    "lastProbe": {
                        "ok": True,
                        "latencyMs": probe.get("latencyMs"),
                        "method": probe.get("method"),
                        "message": probe.get("message"),
                    },
                    "verifiedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
                }
            )
            # 接入时强制探测会产生真实下游费用，记入用量
            full = store.get_source(item.get("id") or "") or None
            prices = body.get("prices") if isinstance(body.get("prices"), dict) else None
            store.record_probe_invocation(
                probe=probe,
                source=full,
                prices=prices or ((full or {}).get("prices") if full else None),
                provider=body.get("provider") or "",
                source_model=source_model,
                env=app.config["GATEWAY_ENV"],
            )
            if probe.get("recorded") and item.get("id"):
                try:
                    store.update_source(
                        item["id"],
                        {
                            "lastProbe": {
                                "ok": True,
                                "latencyMs": probe.get("latencyMs"),
                                "method": probe.get("method"),
                                "message": probe.get("message"),
                                "cost": probe.get("cost"),
                                "promptTokens": probe.get("promptTokens"),
                                "completionTokens": probe.get("completionTokens"),
                                "callLogId": probe.get("callLogId"),
                            }
                        },
                    )
                except KeyError:
                    pass
            item["probe"] = probe
            return jsonify(item), 201
        except ValueError as e:
            return jsonify({"error": {"message": str(e)}}), 400

    @app.get("/admin/keys")
    @require_admin
    def admin_list_keys():
        return jsonify({"items": store.list_keys()})

    @app.get("/admin/assistant")
    @require_admin
    def admin_assistant_status():
        key = store.ensure_ops_assistant_key(include_secret=False)
        return jsonify(
            {
                "ready": True,
                "key": {
                    "id": key.get("id"),
                    "name": key.get("name"),
                    "mask": key.get("mask"),
                    "status": key.get("runtimeStatus") or key.get("status"),
                    "usedIn": key.get("usedIn"),
                    "usedOut": key.get("usedOut"),
                    "usedSpend": key.get("usedSpend"),
                    "billingDept": key.get("billingDept") or "平台运维",
                    "serviceRefs": key.get("serviceRefs") or [],
                },
            }
        )

    @app.post("/admin/assistant/chat")
    @require_admin
    def admin_assistant_chat():
        """Console ops assistant: use platform key so usage is billed/tracked without client secrets."""
        key = store.ensure_ops_assistant_key(include_secret=True)
        body = request.get_json(force=True, silent=True) or {}
        if isinstance(body, dict):
            body = dict(body)
            body["stream"] = False
        return _handle_chat("app", key=key, body=body)

    @app.get("/admin/call-logs")
    @require_admin
    def admin_list_call_logs():
        try:
            limit = int(request.args.get("limit") or 200)
        except (TypeError, ValueError):
            limit = 200
        items = store.list_call_logs(
            service_id=request.args.get("serviceId") or "",
            service_ref=request.args.get("serviceRef") or "",
            source_id=request.args.get("sourceId") or "",
            key_id=request.args.get("keyId") or "",
            limit=limit,
        )
        return jsonify({"items": items})

    def _key_curl(item: dict) -> tuple[str, str]:
        # Curl host follows the Key's bound env, not the admin process env.
        env = (item.get("env") or "prod").strip().lower()
        if env not in ("prod", "test"):
            env = "prod"
        port = int(os.environ.get("TEST_PORT" if env == "test" else "PROD_PORT", 8788 if env == "test" else 8787))
        kind = item.get("keyKind") or "app"
        path = "/personal/v1/chat/completions" if kind == "personal" else "/app/v1/chat/completions"
        host = f"127.0.0.1:{port}"
        model = "your-service-id"
        refs = item.get("serviceRefs") or []
        if refs:
            svc = store.get_service(refs[0])
            if svc:
                model = svc.get("serviceId") or model
        plain = item.get("plaintext") or "$API_KEY"
        app_id = (item.get("appId") or "").strip()
        need_app = bool(item.get("requireAppId")) and bool(app_id) and kind == "app"
        curl = (
            f'curl -s http://{host}{path} -H "Authorization: Bearer {plain}" '
            + ('-H "X-User-Id: u_demo" ' if kind == "personal" else "")
            + (f'-H "X-App-Id: {app_id}" ' if need_app else "")
            + f'-H "Content-Type: application/json" '
            f'-d "{{\\"model\\":\\"{model}\\",\\"messages\\":[{{\\"role\\":\\"user\\",\\"content\\":\\"你好\\"}}]}}"'
        )
        return curl, f"http://{host}"

    @app.post("/admin/keys")
    @require_admin
    def admin_create_key():
        try:
            item = store.create_key(request.get_json(force=True, silent=True) or {})
            curl, base = _key_curl(item)
            item["curlExample"] = curl
            item["gatewayBase"] = base
            return jsonify(item), 201
        except ValueError as e:
            return jsonify({"error": {"message": str(e)}}), 400

    @app.patch("/admin/keys/<key_id>")
    @require_admin
    def admin_patch_key(key_id):
        try:
            item = store.update_key(key_id, request.get_json(force=True, silent=True) or {})
            return jsonify(item)
        except KeyError:
            return jsonify({"error": {"message": "key not found"}}), 404
        except ValueError as e:
            return jsonify({"error": {"message": str(e)}}), 400

    @app.post("/admin/keys/<key_id>/rotate")
    @require_admin
    def admin_rotate_key(key_id):
        try:
            item = store.rotate_key(key_id)
            curl, base = _key_curl(item)
            item["curlExample"] = curl
            item["gatewayBase"] = base
            return jsonify(item)
        except KeyError:
            return jsonify({"error": {"message": "key not found"}}), 404
        except ValueError as e:
            return jsonify({"error": {"message": str(e)}}), 400

    @app.post("/admin/keys/<key_id>/suspend")
    @require_admin
    def admin_suspend_key(key_id):
        try:
            return jsonify(store.update_key(key_id, {"status": "已停用"}))
        except KeyError:
            return jsonify({"error": {"message": "key not found"}}), 404

    @app.post("/admin/keys/<key_id>/resume")
    @require_admin
    def admin_resume_key(key_id):
        try:
            return jsonify(store.update_key(key_id, {"status": "健康"}))
        except KeyError:
            return jsonify({"error": {"message": "key not found"}}), 404

    @app.post("/admin/keys/<key_id>/revoke")
    @require_admin
    def admin_revoke_key(key_id):
        try:
            return jsonify(store.update_key(key_id, {"status": "已吊销"}))
        except KeyError:
            return jsonify({"error": {"message": "key not found"}}), 404

    def _admin_delete_key(key_id):
        try:
            return jsonify(store.delete_key(key_id))
        except KeyError:
            return jsonify({"error": {"message": "key not found"}}), 404

    @app.delete("/admin/keys/<key_id>")
    @require_admin
    def admin_delete_key(key_id):
        return _admin_delete_key(key_id)

    @app.post("/admin/keys/<key_id>/delete")
    @require_admin
    def admin_delete_key_post(key_id):
        return _admin_delete_key(key_id)

    # ---------- Gateway helpers ----------
    def _bearer() -> str:
        auth = request.headers.get("Authorization") or ""
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        return ""

    def _request_app_id() -> str:
        """Read public AppId from common OpenAI-compatible client headers / query."""
        for name in ("X-App-Id", "X-App-ID", "X-AppId", "AppId", "appid", "APPID"):
            val = (request.headers.get(name) or "").strip()
            if val:
                return val
        return (request.args.get("appId") or request.args.get("appid") or "").strip()

    def _auth_key(audience: str):
        secret = _bearer()
        if not secret:
            return None, (jsonify({"error": {"message": "Missing Bearer token", "type": "auth_error"}}), 401)
        key = store.find_key_by_secret(secret)
        if not key:
            return None, (jsonify({"error": {"message": "Invalid API key", "type": "auth_error"}}), 401)
        if key.get("keyKind") != audience:
            return None, (
                jsonify(
                    {
                        "error": {
                            "message": f"This endpoint only accepts {audience} keys",
                            "type": "auth_error",
                        }
                    }
                ),
                403,
            )
        key_env = (key.get("env") or "prod").strip().lower()
        if key_env not in ("prod", "test"):
            key_env = "prod"
        gateway_env = app.config["GATEWAY_ENV"]
        if key_env != gateway_env:
            return None, (
                jsonify(
                    {
                        "error": {
                            "message": (
                                f"API key is bound to {key_env} but this gateway is {gateway_env}; "
                                "use the matching entry port"
                            ),
                            "type": "env_mismatch",
                        }
                    }
                ),
                403,
            )
        runtime = key.get("runtimeStatus") or store.key_runtime_status(key)
        if runtime in ("已暂停", "已停用"):
            return None, (jsonify({"error": {"message": "API key is suspended", "type": "key_suspended"}}), 403)
        if runtime == "已过期":
            return None, (jsonify({"error": {"message": "API key has expired", "type": "key_expired"}}), 403)
        if runtime == "已吊销":
            return None, (jsonify({"error": {"message": "API key has been revoked", "type": "key_revoked"}}), 401)
        blocked, reason = store.key_quota_blocked(key)
        if blocked:
            return None, (jsonify({"error": {"message": reason, "type": "quota_exceeded"}}), 429)
        rate_blocked, rate_reason = store.admit_key_rate(key)
        if rate_blocked:
            return None, (
                jsonify(
                    {
                        "error": {
                            "message": rate_reason,
                            "type": "rate_limit_exceeded",
                        }
                    }
                ),
                429,
            )
        if audience == "personal" and not (request.headers.get("X-User-Id") or "").strip():
            return None, (
                jsonify(
                    {
                        "error": {
                            "message": "Personal key requires X-User-Id header",
                            "type": "auth_error",
                        }
                    }
                ),
                401,
            )
        expected_app = str(key.get("appId") or "").strip()
        if audience == "app" and key.get("requireAppId") and expected_app:
            provided = _request_app_id()
            if not provided:
                return None, (
                    jsonify(
                        {
                            "error": {
                                "message": "This API key requires X-App-Id header",
                                "type": "auth_error",
                                "code": "missing_app_id",
                            }
                        }
                    ),
                    401,
                )
            if provided != expected_app:
                return None, (
                    jsonify(
                        {
                            "error": {
                                "message": "AppId does not match this API key",
                                "type": "auth_error",
                                "code": "app_id_mismatch",
                            }
                        }
                    ),
                    403,
                )
        return key, None

    def _resolve_service(key: dict, model_name: str):
        if not model_name:
            return None, (jsonify({"error": {"message": "model is required", "type": "invalid_request"}}), 400)
        svc = store.get_service(by_name=model_name)
        if not svc or svc.get("enabled") is False:
            return None, (jsonify({"error": {"message": f"Unknown model service: {model_name}", "type": "invalid_request"}}), 404)
        refs = key.get("serviceRefs") or []
        if refs and svc["id"] not in refs and svc.get("serviceId") not in refs:
            # also allow if refs contain serviceId strings
            allowed = set(refs)
            if svc["id"] not in allowed and svc.get("serviceId") not in allowed:
                return None, (
                    jsonify(
                        {
                            "error": {
                                "message": f"API key is not authorized for model {model_name}",
                                "type": "authorization_error",
                            }
                        }
                    ),
                    403,
                )
        return svc, None

    def _record_chat_call(
        key,
        svc,
        source,
        *,
        audience,
        status,
        streaming,
        usage,
        attempts,
        latency_ms=None,
        request_body=None,
        response_body=None,
        route="/v1/chat/completions",
    ):
        return store.record_invocation(
            key_id=key["id"],
            source_id=(source or {}).get("id") or "",
            service_ref=svc.get("id") or "",
            service_id=svc.get("serviceId") or "",
            audience=audience,
            env=app.config["GATEWAY_ENV"],
            status=status,
            stream=bool(streaming),
            routing=svc.get("strategy") or "fixed",
            user_id=request.headers.get("X-User-Id") or "",
            usage=usage,
            latency_ms=latency_ms,
            failover_attempts=attempts or [],
            request_body=request_body,
            response_body=response_body,
            route=route,
        )

    def _handle_chat(audience: str, key=None, body=None):
        if key is None:
            key, err = _auth_key(audience)
            if err:
                return err
        if body is None:
            body = request.get_json(force=True, silent=True) or {}
        if not isinstance(body, dict):
            body = {}
        svc, err = _resolve_service(key, body.get("model") or "")
        if err:
            # 鉴权通过但未授权模型：仍写入审计请求正文，便于追溯
            status_code = err[1] if isinstance(err, tuple) and len(err) == 2 else 0
            if key and status_code == 403:
                store.record_invocation(
                    key_id=key["id"],
                    service_id=str(body.get("model") or ""),
                    audience=audience,
                    env=app.config["GATEWAY_ENV"],
                    status=403,
                    stream=bool(body.get("stream")),
                    user_id=request.headers.get("X-User-Id") or "",
                    request_body=body,
                    response_body={
                        "error": {
                            "message": f"API key is not authorized for model {body.get('model') or ''}",
                            "type": "authorization_error",
                        }
                    },
                    route="/v1/chat/completions",
                )
            return err
        started = time.perf_counter()
        status, data, source, streaming, usage_box, attempts = forward_chat_with_failover(body, svc)
        if not source:
            _record_chat_call(
                key,
                svc,
                {},
                audience=audience,
                status=status,
                streaming=False,
                usage=None,
                attempts=attempts,
                latency_ms=int((time.perf_counter() - started) * 1000),
                request_body=body,
                response_body=data if isinstance(data, dict) else None,
            )
            return jsonify(data), status
        if use_mock(source):
            msg = {
                "error": {
                    "message": f"Upstream for {svc['serviceId']} is not verified (missing baseUrl/apiKey)",
                    "type": "misconfigured",
                }
            }
            _record_chat_call(
                key,
                svc,
                source,
                audience=audience,
                status=503,
                streaming=False,
                usage=None,
                attempts=attempts,
                latency_ms=int((time.perf_counter() - started) * 1000),
                request_body=body,
                response_body=msg,
            )
            return jsonify(msg), 503
        if streaming:
            def generate():
                try:
                    yield from data
                finally:
                    latency_ms = int((time.perf_counter() - started) * 1000)
                    _record_chat_call(
                        key,
                        svc,
                        source,
                        audience=audience,
                        status=status,
                        streaming=True,
                        usage=(usage_box or {}).get("usage"),
                        attempts=attempts,
                        latency_ms=latency_ms,
                        request_body=body,
                        response_body={"usage": (usage_box or {}).get("usage"), "stream": True},
                    )

            return Response(
                stream_with_context(generate()),
                status=status,
                mimetype="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )

        latency_ms = int((time.perf_counter() - started) * 1000)
        usage = (usage_box or {}).get("usage")
        if not usage and isinstance(data, dict):
            usage = data.get("usage")
        _record_chat_call(
            key,
            svc,
            source,
            audience=audience,
            status=status,
            streaming=False,
            usage=usage,
            attempts=attempts,
            latency_ms=latency_ms,
            request_body=body,
            response_body=data if isinstance(data, dict) else None,
        )
        return jsonify(data), status

    def _handle_embeddings(audience: str):
        key, err = _auth_key(audience)
        if err:
            return err
        body = request.get_json(force=True, silent=True) or {}
        svc, err = _resolve_service(key, body.get("model") or "")
        if err:
            return err
        source = pick_source(svc)
        if not source or use_mock(source):
            return jsonify({"error": {"message": f"No verified upstream for model {svc['serviceId']}", "type": "misconfigured"}}), 503
        status, data = forward_embeddings(body, source, service_id=svc["serviceId"])
        usage = data.get("usage") if isinstance(data, dict) else None
        store.record_invocation(
            key_id=key["id"],
            source_id=source.get("id") or "",
            service_ref=svc.get("id") or "",
            service_id=svc.get("serviceId") or "",
            audience=audience,
            env=app.config["GATEWAY_ENV"],
            status=status,
            stream=False,
            routing=svc.get("strategy") or "fixed",
            user_id=request.headers.get("X-User-Id") or "",
            usage=usage,
            request_body=body,
            response_body=data if isinstance(data, dict) else None,
            route="/v1/embeddings",
        )
        return jsonify(data), status

    def _handle_responses(audience: str):
        key, err = _auth_key(audience)
        if err:
            return err
        body = request.get_json(force=True, silent=True) or {}
        svc, err = _resolve_service(key, body.get("model") or "")
        if err:
            return err
        source = pick_source(svc)
        if not source or use_mock(source):
            return jsonify({"error": {"message": f"No verified upstream for model {svc['serviceId']}", "type": "misconfigured"}}), 503
        status, data = forward_responses(body, source, service_id=svc["serviceId"])
        usage = None
        if isinstance(data, dict):
            usage = data.get("usage")
            gw = data.get("gateway") if isinstance(data.get("gateway"), dict) else {}
            # mapped responses may only have chat usage nested
            if not usage and isinstance(gw, dict):
                usage = gw.get("usage")
        store.record_invocation(
            key_id=key["id"],
            source_id=source.get("id") or "",
            service_ref=svc.get("id") or "",
            service_id=svc.get("serviceId") or "",
            audience=audience,
            env=app.config["GATEWAY_ENV"],
            status=status,
            stream=False,
            routing=svc.get("strategy") or "fixed",
            user_id=request.headers.get("X-User-Id") or "",
            usage=usage,
            request_body=body,
            response_body=data if isinstance(data, dict) else None,
            route="/v1/responses",
        )
        return jsonify(data), status

    def _handle_models(audience: str):
        key, err = _auth_key(audience)
        if err:
            return err
        refs = key.get("serviceRefs") or []
        services = store.list_services()
        if refs:
            services = [s for s in services if s["id"] in refs or s.get("serviceId") in refs]
        services = [s for s in services if s.get("enabled") is not False]
        data = {
            "object": "list",
            "data": [
                {
                    "id": s["serviceId"],
                    "object": "model",
                    "created": 0,
                    "owned_by": "aegis-gateway",
                    "hosting": s.get("hosting"),
                    "name": s.get("name"),
                }
                for s in services
            ],
        }
        return jsonify(data)

    for audience, prefix in (("personal", "/personal/v1"), ("app", "/app/v1")):
        app.add_url_rule(
            f"{prefix}/chat/completions",
            f"{audience}_chat",
            lambda a=audience: _handle_chat(a),
            methods=["POST"],
        )
        app.add_url_rule(
            f"{prefix}/embeddings",
            f"{audience}_emb",
            lambda a=audience: _handle_embeddings(a),
            methods=["POST"],
        )
        app.add_url_rule(
            f"{prefix}/responses",
            f"{audience}_resp",
            lambda a=audience: _handle_responses(a),
            methods=["POST"],
        )
        app.add_url_rule(
            f"{prefix}/models",
            f"{audience}_models",
            lambda a=audience: _handle_models(a),
            methods=["GET"],
        )

    @app.get("/")
    def root():
        return jsonify(
            {
                "name": "Aegis Model Gateway",
                "env": app.config["GATEWAY_ENV"],
                "admin": "/admin/health",
                "personal": "/personal/v1/chat/completions",
                "app": "/app/v1/chat/completions",
            }
        )

    return app


def _load_dotenv():
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main():
    _load_dotenv()
    store.ensure_store()
    prod_port = int(os.environ.get("PROD_PORT", "8787"))
    test_port = int(os.environ.get("TEST_PORT", "8788"))

    prod_app = create_app("prod")
    test_app = create_app("test")

    def run(app: Flask, port: int, label: str):
        print(f"[gateway:{label}] http://127.0.0.1:{port}")
        app.run(host="0.0.0.0", port=port, threaded=True, use_reloader=False)

    t = threading.Thread(target=run, args=(test_app, test_port, "test"), daemon=True)
    t.start()
    run(prod_app, prod_port, "prod")


if __name__ == "__main__":
    main()
