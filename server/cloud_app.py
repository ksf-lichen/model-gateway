# -*- coding: utf-8 -*-
"""Cloud entry: single PORT, serve console (dist/) + gateway API."""
from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, send_from_directory

from app import _load_dotenv, create_app
import store

ROOT = Path(__file__).resolve().parent
DIST = ROOT.parent / "dist"


def create_cloud_app() -> Flask:
    _load_dotenv()
    store.ensure_store()
    env = os.environ.get("GATEWAY_ENV", "prod")
    app = create_app(env)

    # create_app() 已占用 "/" 返回 JSON；云上改为打开控制台
    @app.endpoint("root")
    def index():
        return send_from_directory(DIST, "index.html")

    # 覆盖同名 endpoint 的视图（Flask 以 endpoint 名为准）
    app.view_functions["root"] = index

    @app.get("/gateway")
    def gateway_info():
        return {
            "name": "Aegis Model Gateway",
            "env": app.config["GATEWAY_ENV"],
            "admin": "/admin/health",
            "personal": "/personal/v1/chat/completions",
            "app": "/app/v1/chat/completions",
            "console": "/",
        }

    @app.get("/<path:path>")
    def static_files(path: str):
        # Do not swallow API prefixes if unmatched
        if path.startswith(("admin/", "personal/", "app/", "gateway")):
            return ("Not Found", 404)
        target = DIST / path
        if target.is_file():
            return send_from_directory(DIST, path)
        return ("Not Found", 404)

    return app


app = create_cloud_app()


def main():
    port = int(os.environ.get("PORT", os.environ.get("PROD_PORT", "8787")))
    print(f"[cloud] http://0.0.0.0:{port}  (console + gateway, env={os.environ.get('GATEWAY_ENV', 'prod')})")
    app.run(host="0.0.0.0", port=port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
