# -*- coding: utf-8 -*-
"""Recapture FRD console screenshots at a full, uncropped viewport."""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765/index.html?v=20261118b"
OUT = Path(r"D:\Project_folder\模型网关\docs\frd-shots")
VIEW_W = 1920
VIEW_H = 1200

PAGES = [
    ("frd-01-overview.png", "overview"),
    ("frd-02-model-services.png", "model-services"),
    ("frd-03-model-sources.png", "model-sources"),
    ("frd-04-security-api.png", "security-api"),
    ("frd-05-routes.png", "routes"),
    ("frd-06-members.png", "members"),
    ("frd-07-access.png", "access"),
    ("frd-08-usage.png", "usage"),
    ("frd-09-usage-detail.png", "usage-detail"),
    ("frd-10-integration.png", "integration"),
    ("frd-11-security-policies.png", "security-policies"),
    ("frd-12-audit-platform.png", "audit-platform"),
    ("frd-13-audit-policy.png", "audit-policy"),
    ("frd-14-audit-request.png", "audit-request"),
    ("frd-15-alerts.png", "alerts"),
    ("frd-16-assistant.png", "assistant"),
]

HIDE_SCROLLBARS = """
html, body { scrollbar-width: none !important; }
::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
"""

FIT_JS = """
() => {
  const main = document.querySelector('main');
  if (main) {
    main.querySelectorAll('.providers-table, .security-detail-table, .usage-detail-table, .source-table, .x-logical-table, .x-route-table, .x-matrix-scroll').forEach(el => {
      if (el.scrollWidth > el.clientWidth + 6) {
        el.style.overflow = 'visible';
        el.style.maxWidth = 'none';
        el.style.width = 'max-content';
      }
    });
    const pc = main.querySelector('.page-content');
    if (pc && pc.scrollWidth > pc.clientWidth + 6) {
      pc.style.maxWidth = 'none';
      pc.style.width = 'max-content';
    }
  }
  const doc = document.documentElement;
  const body = document.body;
  const w = Math.max(doc.scrollWidth, body ? body.scrollWidth : 0, doc.clientWidth);
  const h = Math.max(doc.scrollHeight, body ? body.scrollHeight : 0, doc.clientHeight);
  return { w, h };
}
"""

EXPAND_MODAL_JS = """
() => {
  const layer = document.querySelector('#x-modal-layer');
  const dlg = layer && layer.querySelector('.x-dialog');
  if (!dlg) return null;
  const body = dlg.querySelector('.x-dialog-body');
  dlg.style.maxHeight = 'none';
  dlg.style.height = 'auto';
  dlg.style.overflow = 'visible';
  dlg.style.top = '28px';
  dlg.style.transform = 'translate(-50%, 0) scale(1)';
  if (body) {
    body.style.maxHeight = 'none';
    body.style.overflow = 'visible';
  }
  dlg.querySelectorAll('.x-matrix-scroll, .x-model-pick-list, .x-batch-price-table-wrap, .x-dialog-body').forEach(el => {
    el.style.maxHeight = 'none';
    el.style.overflow = 'visible';
  });
  const rect = dlg.getBoundingClientRect();
  const foot = dlg.querySelector('.x-dialog-foot');
  const footRect = foot ? foot.getBoundingClientRect() : null;
  return {
    top: rect.top,
    bottom: Math.max(rect.bottom, footRect ? footRect.bottom : 0),
    height: rect.height,
    width: rect.width,
    title: (document.querySelector('#x-modal-title') || {}).textContent || ''
  };
}
"""


def pause(page, ms=2000):
    page.wait_for_timeout(ms)


def ensure_role(page):
    page.wait_for_selector("#role-user-name", timeout=15000)
    name = page.locator("#role-user-name").inner_text().strip()
    title = page.locator("#role-title").inner_text().strip()
    if name == "李晨" and "超级管理员" in title:
        return
    page.evaluate(
        """() => {
          localStorage.setItem('aegis-identity', 'm-lichen');
          localStorage.setItem('aegis-role', 'm-lichen');
        }"""
    )
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#role-user-name", timeout=15000)
    pause(page, 1200)
    name = page.locator("#role-user-name").inner_text().strip()
    title = page.locator("#role-title").inner_text().strip()
    if name == "李晨" and "超级管理员" in title:
        return
    page.locator("#role-switcher").click()
    page.wait_for_timeout(400)
    option = page.locator("#role-menu-options [data-role-id]").filter(has_text="李晨").first
    option.click()
    pause(page, 1500)


def goto_page(page, route):
    page.set_viewport_size({"width": VIEW_W, "height": VIEW_H})
    page.goto(f"{BASE}#{route}", wait_until="domcontentloaded")
    page.wait_for_function("() => typeof window.render === 'function'", timeout=15000)
    ensure_role(page)
    # Initial catalog paint fills the page. Re-render only when the hash or
    # detail view is not already the list we need — an early render races the
    # catalog request and leaves an empty panel.
    page.wait_for_function(
        """(route) => {
          const enhanced = document.getElementById('page-content')?.dataset.enhanced || '';
          return enhanced === route || enhanced.startsWith('detail-') || enhanced.length > 0;
        }""",
        arg=route,
        timeout=15000,
    )
    state = page.evaluate(
        """(route) => {
          const enhanced = document.getElementById('page-content')?.dataset.enhanced || '';
          const hash = (location.hash || '').replace(/^#\\/?/, '');
          return { enhanced, hash, ok: hash === route && enhanced === route };
        }""",
        route,
    )
    if not state["ok"]:
        page.locator(f'.main-nav [data-page="{route}"]').click()
        page.wait_for_function(
            """(route) => (document.getElementById('page-content')?.dataset.enhanced || '') === route""",
            arg=route,
            timeout=10000,
        )
    close_layers(page)
    pause(page, 2000)
    page.evaluate(
        """async () => {
          const step = Math.max(500, Math.floor(window.innerHeight * 0.75));
          const h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
          for (let y = 0; y <= h; y += step) {
            window.scrollTo(0, y);
            await new Promise(r => setTimeout(r, 90));
          }
          window.scrollTo(0, 0);
          document.getElementById('toast')?.classList.remove('show');
        }"""
    )
    pause(page, 600)


def fit_viewport(page, min_h=VIEW_H):
    page.evaluate("window.scrollTo(0,0)")
    size = page.evaluate(FIT_JS)
    width = max(VIEW_W, int(size["w"]) + 2)
    height = max(min_h, int(size["h"]) + 4)
    height = min(height, 14000)
    page.set_viewport_size({"width": width, "height": height})
    page.evaluate("window.dispatchEvent(new Event('resize'))")
    pause(page, 700)
    size2 = page.evaluate(FIT_JS)
    width2 = max(VIEW_W, int(size2["w"]) + 2)
    height2 = max(min_h, int(size2["h"]) + 4)
    height2 = min(height2, 14000)
    if abs(width2 - width) > 8 or abs(height2 - height) > 8:
        page.set_viewport_size({"width": width2, "height": height2})
        pause(page, 400)
    page.evaluate("() => { document.getElementById('toast')?.classList.remove('show'); window.scrollTo(0,0); }")


def shoot_page(page, path):
    fit_viewport(page)
    pause(page, 900)
    overflow = page.evaluate(
        """() => ({
          x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          y: document.documentElement.scrollHeight - document.documentElement.clientHeight
        })"""
    )
    page.evaluate("() => { document.getElementById('toast')?.classList.remove('show'); window.scrollTo(0,0); }")
    page.screenshot(path=str(path), full_page=overflow["y"] > 24 or overflow["x"] > 24, animations="disabled")
    print("page", path.name, page.viewport_size, "overflow", overflow)


def close_layers(page):
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)
    page.evaluate(
        """() => {
          document.querySelectorAll('.x-overlay.open').forEach(el => {
            el.classList.remove('open');
            el.setAttribute('aria-hidden', 'true');
          });
          const drawer = document.querySelector('#x-drawer-layer');
          if (drawer) { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); }
        }"""
    )


def shoot_modal(page, path, opener, title_substr):
    page.set_viewport_size({"width": VIEW_W, "height": VIEW_H})
    page.evaluate("window.scrollTo(0,0)")
    pause(page, 400)
    close_layers(page)
    opener()
    page.wait_for_selector("#x-modal-layer.open #x-modal-title", timeout=10000)
    page.wait_for_function(
        """(needle) => {
          const t = document.querySelector('#x-modal-title');
          return !!(t && t.textContent && t.textContent.includes(needle));
        }""",
        arg=title_substr,
        timeout=8000,
    )
    pause(page, 1800)
    info = page.evaluate(EXPAND_MODAL_JS)
    if not info:
        raise RuntimeError(f"modal missing for {path.name}")
    needed = int(info["bottom"] + 36)
    height = max(VIEW_H, needed)
    if height != VIEW_H:
        page.set_viewport_size({"width": VIEW_W, "height": min(height, 14000)})
        pause(page, 400)
        info = page.evaluate(EXPAND_MODAL_JS)
        needed = int(info["bottom"] + 36)
        if needed > page.viewport_size["height"]:
            page.set_viewport_size({"width": VIEW_W, "height": min(needed, 14000)})
            pause(page, 300)
            page.evaluate(EXPAND_MODAL_JS)
    # If still overflowing the viewport, split is a last resort — try one more grow.
    info = page.evaluate(EXPAND_MODAL_JS)
    if info["bottom"] > page.viewport_size["height"] - 8:
        page.set_viewport_size({"width": VIEW_W, "height": min(int(info["bottom"] + 48), 14000)})
        pause(page, 300)
        page.evaluate(EXPAND_MODAL_JS)
    page.evaluate("() => document.getElementById('toast')?.classList.remove('show')")
    page.screenshot(path=str(path), full_page=False, animations="disabled")
    print("modal", path.name, page.viewport_size, "title=", info.get("title"))


def click_text_button(page, text):
    btn = page.locator("#page-content button, .head-actions button").filter(has_text=text).first
    btn.click()


def capture_details(page):
    print("DETAIL service", flush=True)
    goto_page(page, "model-services")
    page.locator('[data-x-detail^="service:"] [data-x="row-menu"]').first.click()
    page.wait_for_selector("text=智能路由拓扑", timeout=10000)
    pause(page, 2200)
    page.add_style_tag(content=HIDE_SCROLLBARS)
    shoot_page(page, OUT / "frd-s06-service-detail.png")

    print("DETAIL distribution", flush=True)
    goto_page(page, "model-services")
    shoot_modal(
        page,
        OUT / "frd-s07-distribution.png",
        lambda: page.locator('[data-x="configure-distribution"]').first.click(),
        "分发策略",
    )

    print("DETAIL key", flush=True)
    goto_page(page, "security-api")
    page.locator('[data-x="open-key-detail"]').first.click()
    page.wait_for_selector("#page-content h1", timeout=10000)
    pause(page, 2200)
    page.add_style_tag(content=HIDE_SCROLLBARS)
    shoot_page(page, OUT / "frd-s14-key-detail.png")


def main():
    print("start", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        print("launch", flush=True)
        browser = p.chromium.launch(headless=True)
        print("launched", flush=True)
        page = browser.new_page(viewport={"width": VIEW_W, "height": VIEW_H}, device_scale_factor=1)
        page.add_init_script(
            """() => {
              try {
                localStorage.setItem('aegis-identity', 'm-lichen');
                localStorage.setItem('aegis-role', 'm-lichen');
                localStorage.removeItem('aegis-nav-collapsed');
              } catch (e) {}
            }"""
        )
        page.add_style_tag(content=HIDE_SCROLLBARS)
        # Style tag before navigation can be lost; re-add after first load.
        goto_page(page, "overview")
        page.add_style_tag(content=HIDE_SCROLLBARS)

        for name, route in PAGES:
            print("GOTO", route)
            goto_page(page, route)
            page.add_style_tag(content=HIDE_SCROLLBARS)
            shoot_page(page, OUT / name)

        def shot(name, route, opener, title):
            print("MODAL", name, route)
            goto_page(page, route)
            page.add_style_tag(content=HIDE_SCROLLBARS)
            shoot_modal(page, OUT / name, opener, title)

        shot("frd-s01-create-service.png", "model-services",
             lambda: click_text_button(page, "创建模型服务"), "创建模型服务")
        shot("frd-s02-provider-form.png", "model-sources",
             lambda: page.locator('[data-x="new-provider"]').first.click(), "添加厂商")
        shot("frd-s03-append-models-s1.png", "model-sources",
             lambda: page.locator('[data-x="append-models"]').first.click(), "追加模型能力")
        shot("frd-s04-key-scene.png", "security-api",
             lambda: open_key_scene(page), "选择开通场景")
        shot("frd-s05-issue-key.png", "security-api",
             lambda: page.locator('[data-x="new-personal-key"]').first.click(), "开通个人 Key")
        shot("frd-s08-policy-form.png", "security-policies",
             lambda: page.locator('[data-x="new-policy"]').first.click(), "新建安全策略")
        shot("frd-s09-alert-form.png", "alerts",
             lambda: page.locator('[data-x="new-alert-rule"]').first.click(), "新建告警规则")
        shot("frd-s10-member-add.png", "members",
             lambda: click_text_button(page, "添加成员"), "添加成员")
        shot("frd-s11-role-form.png", "access",
             lambda: click_text_button(page, "新建角色"), "新建角色")
        shot("frd-s12-route-append.png", "routes",
             lambda: page.locator('[data-x="new-route"]').first.click(), "追加路径")
        shot("frd-s13-export.png", "overview",
             lambda: page.locator('[data-x="ov-export"]').first.click(), "导出")
        shot("frd-s15-matrix.png", "access",
             lambda: click_text_button(page, "权限矩阵"), "角色权限矩阵")

        # Detail views are full pages, not dialogs.
        capture_details(page)

        browser.close()


def open_key_scene(page):
    page.keyboard.press("Control+k")
    page.wait_for_selector("#x-command-layer.open", timeout=5000)
    page.locator('#x-command-results [data-command-action="keyScene"]').click()


def main_details():
    print("details-only", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": VIEW_W, "height": VIEW_H}, device_scale_factor=1)
        page.add_init_script(
            """() => {
              try {
                localStorage.setItem('aegis-identity', 'm-lichen');
                localStorage.setItem('aegis-role', 'm-lichen');
                localStorage.removeItem('aegis-nav-collapsed');
              } catch (e) {}
            }"""
        )
        capture_details(page)
        browser.close()


if __name__ == "__main__":
    if "--details" in sys.argv:
        main_details()
    else:
        main()
