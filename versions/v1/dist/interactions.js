(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const icon = id => `<svg><use href="#${id}"/></svg>`;
  const load = (key, fallback) => { try { const value=JSON.parse(localStorage.getItem(key)); return Array.isArray(value) ? value : fallback; } catch { return fallback; } };
  // 审批流暂时隐藏：成员直接开通个人 Key，管理员侧不展示待审批队列
  const KEY_APPROVAL_ENABLED = false;
  const CATALOG_SCHEMA = '3-empty-real-only';
  if (localStorage.getItem('aegis-catalog-schema') !== CATALOG_SCHEMA) {
    ['aegis-models', 'aegis-services', 'aegis-keys', 'aegis-key-applications', 'aegis-key-secrets', 'aegis-policies'].forEach(k => {
      try { localStorage.removeItem(k); } catch {}
    });
    try { localStorage.setItem('aegis-catalog-schema', CATALOG_SCHEMA); } catch {}
  }
  const GATEWAY_API = (localStorage.getItem('aegis-gateway-api') || 'http://127.0.0.1:8787').replace(/\/$/, '');
  const GATEWAY_TEST_API = (localStorage.getItem('aegis-gateway-test-api') || 'http://127.0.0.1:8788').replace(/\/$/, '');
  const ADMIN_TOKEN = localStorage.getItem('aegis-admin-token') || 'local-dev-token';
  async function adminFetch(path, opts = {}) {
    const res = await fetch(`${GATEWAY_API}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN,
        ...(opts.headers || {})
      }
    });
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    return data;
  }
  async function deleteGatewayKey(keyId) {
    // 与 suspend/resume 同风格使用 POST，避免部分环境下 DELETE 405
    return adminFetch(`/admin/keys/${keyId}/delete`, { method: 'POST', body: '{}' });
  }
  function formatProbeCostHint(probe) {
    if (!probe || !probe.recorded) return '';
    const cost = Number(probe.cost);
    const pin = Number(probe.promptTokens || 0);
    const pout = Number(probe.completionTokens || 0);
    const costText = Number.isFinite(cost) ? `¥${cost.toFixed(6)}` : '';
    const tokenText = (pin || pout) ? `${pin}/${pout} Token` : '';
    if (costText && tokenText) return `已记费用 ${costText} · ${tokenText}`;
    if (costText) return `已记费用 ${costText}`;
    if (tokenText) return `已记用量 ${tokenText}`;
    return '已记入用量';
  }

  function showConnectResult(ok, message, latencyMs, probe) {
    const box = $('#x-connect-result');
    if (!box) return;
    box.classList.add('show');
    box.classList.toggle('is-error', !ok);
    box.style.borderColor = ok ? '' : '#efc4c7';
    box.style.background = ok ? '' : '#fff7f7';
    box.style.color = ok ? '' : '#b55056';
    const span = box.querySelector('span');
    const b = box.querySelector('b');
    const costHint = ok ? formatProbeCostHint(probe) : '';
    if (span) span.textContent = [message || (ok ? '连接成功' : '连接失败'), costHint].filter(Boolean).join(' · ');
    if (b) b.textContent = latencyMs != null ? `${latencyMs} ms` : (ok ? '通过' : '失败');
  }
  function readSourceProbeFields() {
    return {
      protocol: $('[name="protocolType"]', modalLayer)?.value || '',
      provider: $('[name="providerName"]', modalLayer)?.value || '',
      baseUrl: ($('[name="baseUrl"]', modalLayer)?.value || '').trim(),
      sourceModel: ($('[name="sourceModelName"]', modalLayer)?.value || '').trim(),
      apiKey: ($('[name="upstreamApiKey"]', modalLayer)?.value || '').trim(),
      timeout: Number($('[name="timeout"]', modalLayer)?.value || 30)
    };
  }
  function readProbePricesHint(fields, editing) {
    try {
      const raw = sessionStorage.getItem('modelPrices');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch { /* ignore */ }
    if (editing?.prices && typeof editing.prices === 'object') return editing.prices;
    if (fields?.prices && typeof fields.prices === 'object') return fields.prices;
    return null;
  }

  async function probeUpstreamLive(fields, editing) {
    if (!fields.baseUrl || !fields.apiKey || !fields.sourceModel) {
      const err = new Error('请填写 Base URL、上游 API Key 与源模型名称后再探测');
      err.code = 'validation';
      throw err;
    }
    const prices = readProbePricesHint(fields, editing);
    const payload = {
      baseUrl: fields.baseUrl,
      apiKey: fields.apiKey,
      sourceModel: fields.sourceModel,
      provider: fields.provider || '',
      timeout: fields.timeout || 25
    };
    if (prices) payload.prices = prices;
    const res = await fetch(`${GATEWAY_API}/admin/sources/probe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN
      },
      body: JSON.stringify(payload)
    });
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok || !data.ok) {
      const msg = data?.error?.message || data?.message || `探测失败 HTTP ${res.status}`;
      const err = new Error(msg);
      err.probe = data;
      throw err;
    }
    return data;
  }
  function sourceHasStoredCredential(model) {
    return !!(model && (model.hasApiKey || (model.gatewaySynced && model.baseUrl && model.sourceModel)));
  }
  function seedEditModelSession(model) {
    if (!model?.id) return;
    const bound = state.services.find(s => s.id === model.serviceRef)
      || state.services.find(s => s.serviceId === model.serviceId);
    sessionStorage.setItem('modelDraft', JSON.stringify({
      protocol: model.protocol || '',
      provider: model.provider || '',
      baseUrl: model.baseUrl || '',
      sourceModel: model.sourceModel || model.name || '',
      proxyServiceRef: model.serviceRef || bound?.id || '',
      proxyService: bound ? `${bound.name} · ${bound.serviceId}` : '',
      serviceId: bound?.serviceId || model.serviceId || '',
      serviceName: bound?.name || model.name || '',
      upstreamApiKey: '',
      reuseStoredApiKey: sourceHasStoredCredential(model),
      region: model.region || '华东（上海）',
      healthCheck: model.healthCheck || '每 30 秒',
      timeout: model.timeout || 30,
      concurrency: model.concurrency || 500,
      retries: model.retries || 2,
      circuit: model.circuit || 5,
      probe: model.lastProbe || null
    }));
    const caps = model.capabilities && typeof model.capabilities === 'object' ? model.capabilities : {};
    sessionStorage.setItem('modelCapabilities', JSON.stringify(caps));
    const counts = { supported: 0, limited: 0, unsupported: 0 };
    Object.values(caps).forEach(v => { if (counts[v] != null) counts[v] += 1; });
    sessionStorage.setItem('modelCapabilityCounts', JSON.stringify(counts));
    sessionStorage.setItem('modelCustomCapabilities', model.customCapabilities || '');
    if (hasConfiguredPrices(model.prices)) {
      sessionStorage.setItem('modelPrices', JSON.stringify(model.prices));
    } else {
      sessionStorage.removeItem('modelPrices');
    }
  }
  function connectionFieldsChanged(editing, fields) {
    if (!editing) return true;
    const sameBase = (fields.baseUrl || '') === (editing.baseUrl || '');
    const sameModel = (fields.sourceModel || '') === (editing.sourceModel || editing.name || '');
    return !sameBase || !sameModel || !!fields.apiKey;
  }
  async function probeWizardSource(fields, editing) {
    const prices = readProbePricesHint(fields, editing);
    if (editing?.gatewaySynced && editing.id && !fields.apiKey && sourceHasStoredCredential(editing)) {
      const body = {
        baseUrl: fields.baseUrl || editing.baseUrl || '',
        sourceModel: fields.sourceModel || editing.sourceModel || '',
        provider: fields.provider || editing.provider || '',
        timeout: fields.timeout || 25
      };
      if (prices) body.prices = prices;
      return adminFetch(`/admin/sources/${editing.id}/probe`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
    }
    return probeUpstreamLive(fields, editing);
  }

  function afterProbeRecorded(probe) {
    if (!probe?.recorded) return;
    // 探测已写入网关 callLogs，刷新用量与源计数
    syncGatewayCatalog?.().catch?.(() => {});
    refreshUsageIfVisible?.();
  }
  async function syncGatewayCatalog() {

    try {
      const health = await fetch(`${GATEWAY_API}/admin/health`).then(r => r.json());
      if (!health?.ok) throw new Error('offline');
      const [svcs, srcs, keysRes, logsRes] = await Promise.all([
        adminFetch('/admin/services'),
        adminFetch('/admin/sources'),
        adminFetch('/admin/keys'),
        adminFetch('/admin/call-logs?limit=1000')
      ]);
      const remoteServices = Array.isArray(svcs.items) ? svcs.items : [];
      const remoteSources = Array.isArray(srcs.items) ? srcs.items : [];
      const remoteKeys = Array.isArray(keysRes.items) ? keysRes.items : [];
      const remoteLogs = Array.isArray(logsRes.items) ? logsRes.items : [];
      // 网关在线时以后端为准；本地已配置的计费/能力在远端缺失时回填，避免列表丢字段
      const localById = Object.fromEntries((state.models || []).map(m => [m.id, m]));
      state.services = remoteServices.map(normalizeService);
      state.models = remoteSources.map(s => {
        const local = localById[s.id] || {};
        const recalled = recallSourceExtras({
          id: s.id,
          baseUrl: s.baseUrl || local.baseUrl || '',
          sourceModel: s.sourceModel || local.sourceModel || s.name || ''
        }) || {};
        const remotePrices = (s.prices && typeof s.prices === 'object' && hasConfiguredPrices(s.prices)) ? s.prices : null;
        const prices = remotePrices
          || (hasConfiguredPrices(local.prices) ? local.prices : null)
          || (hasConfiguredPrices(recalled.prices) ? recalled.prices : {})
          || {};
        const capabilities = (s.capabilities && typeof s.capabilities === 'object' && Object.keys(s.capabilities).length)
          ? s.capabilities
          : (local.capabilities || recalled.capabilities || {});
        const model = {
          id: s.id,
          serviceRef: s.serviceRef,
          name: s.name,
          serviceId: (state.services.find(x => x.id === s.serviceRef) || {}).serviceId || '',
          provider: s.provider,
          region: s.region,
          protocol: s.protocol || local.protocol || '',
          baseUrl: s.baseUrl || '',
          sourceModel: s.sourceModel || '',
          kmsKeyId: '',
          status: s.status || '运行中',
          latency: (s.lastProbe && s.lastProbe.latencyMs != null) ? `${s.lastProbe.latencyMs} ms` : (s.hasApiKey ? '已校验' : (local.latency || '未校验')),
          verifiedAt: s.verifiedAt || '',
          lastProbe: s.lastProbe || null,
          sla: local.sla || '—',
          share: local.share || 0,
          timeout: s.timeout ?? local.timeout ?? recalled.timeout,
          concurrency: s.concurrency ?? local.concurrency ?? recalled.concurrency,
          retries: s.retries ?? local.retries ?? recalled.retries,
          circuit: s.circuit ?? local.circuit ?? recalled.circuit,
          healthCheck: s.healthCheck || local.healthCheck || recalled.healthCheck || '',
          prices,
          capabilities,
          customCapabilities: s.customCapabilities || local.customCapabilities || recalled.customCapabilities || '',
          usedIn: s.usedIn ?? local.usedIn ?? '0',
          usedOut: s.usedOut ?? local.usedOut ?? '0',
          usedCache: s.usedCache ?? local.usedCache ?? '0',
          usedSpend: s.usedSpend ?? local.usedSpend ?? '0.00',
          callCount: s.callCount ?? local.callCount ?? 0,
          lastUsed: s.lastUsed || local.lastUsed || '',
          gatewaySynced: true,
          hasApiKey: !!s.hasApiKey
        };
        if (hasConfiguredPrices(model.prices)) rememberSourceExtras(model);
        return model;
      });
      const kmsOnly = (state.keys || []).filter(k => k.type === 'kms');
      const apiKeys = remoteKeys.map(k => normalizeStoredKey({
        ...k,
        type: 'api',
        services: (k.serviceRefs || []).map(id => {
          const svc = state.services.find(s => s.id === id);
          return svc ? `${svc.name} · ${svc.serviceId}` : id;
        }).join('、') || '—'
      }));
      state.keys = [...apiKeys, ...kmsOnly];
      state.callLogs = remoteLogs;
      state.gatewayOnline = true;
      persist();
      refreshOverviewIfVisible();
      refreshUsageIfVisible();
      refreshAuditIfVisible();
      refreshServiceDetailIfVisible();
      return true;
    } catch {
      state.gatewayOnline = false;
      refreshOverviewIfVisible();
      return false;
    }
  }

  function refreshOverviewIfVisible() {
    if (typeof currentPage === 'function' && currentPage() === 'overview' && $('#x-overview-panel') && typeof renderOverviewPage === 'function') {
      renderOverviewPage();
    }
  }

  function refreshUsageIfVisible() {
    if (typeof currentPage === 'function' && (currentPage() === 'usage' || currentPage() === 'usage-detail' || currentPage() === 'billing') && $('#usage-page-body')) {
      refreshUsageViews();
    }
  }

  function refreshAuditIfVisible() {
    if (typeof isAuditPage === 'function' && isAuditPage() && $('#audit-page-body') && typeof renderAuditPage === 'function') {
      renderAuditPage();
    }
  }

  function refreshServiceDetailIfVisible() {
    if (state.currentDetailKind !== 'service' || !state.currentDetailId) return;
    const root = $('#page-content');
    if (!root || !String(root.dataset.enhanced || '').startsWith('detail-service')) return;
    const panel = $('#x-detail-panel');
    if (!panel || typeof serviceDetailPanel !== 'function') return;
    // 只更新详情内面板，避免重绘整页触发 enhanceView 退出详情
    panel.innerHTML = serviceDetailPanel(state.serviceDetailTab || 'routing');
  }

  async function refreshServiceRoutingData() {
    try {
      const [logsRes, keysRes, srcsRes] = await Promise.all([
        adminFetch('/admin/call-logs?limit=1000'),
        adminFetch('/admin/keys'),
        adminFetch('/admin/sources')
      ]);
      state.callLogs = Array.isArray(logsRes.items) ? logsRes.items : [];
      const remoteKeys = Array.isArray(keysRes.items) ? keysRes.items : [];
      const usageById = Object.fromEntries(remoteKeys.map(k => [k.id, k]));
      state.keys = (state.keys || []).map(k => {
        if (k.type === 'kms') return k;
        const remote = usageById[k.id];
        if (!remote) return k;
        return normalizeStoredKey({
          ...k,
          usedIn: remote.usedIn ?? k.usedIn,
          usedOut: remote.usedOut ?? k.usedOut,
          usedCache: remote.usedCache ?? k.usedCache,
          usedSpend: remote.usedSpend ?? k.usedSpend,
          lastUsed: remote.lastUsed || k.lastUsed
        });
      });
      const remoteSources = Array.isArray(srcsRes.items) ? srcsRes.items : [];
      const srcUsage = Object.fromEntries(remoteSources.map(s => [s.id, s]));
      state.models = (state.models || []).map(m => {
        const remote = srcUsage[m.id];
        if (!remote) return m;
        return {
          ...m,
          usedIn: remote.usedIn ?? m.usedIn,
          usedOut: remote.usedOut ?? m.usedOut,
          usedCache: remote.usedCache ?? m.usedCache,
          usedSpend: remote.usedSpend ?? m.usedSpend,
          callCount: remote.callCount ?? m.callCount,
          lastUsed: remote.lastUsed || m.lastUsed
        };
      });
      state.gatewayOnline = true;
      refreshServiceDetailIfVisible();
      return true;
    } catch {
      state.gatewayOnline = false;
      return false;
    }
  }

  function parseCallLogTime(value) {
    if (!value) return NaN;
    const t = Date.parse(String(value).replace(/-/g, '/'));
    return Number.isFinite(t) ? t : NaN;
  }

  function callLogsForService(service, { withinMs = 0, limit = 80 } = {}) {
    if (!service) return [];
    const now = Date.now();
    const sid = service.serviceId;
    const ref = service.id;
    return (state.callLogs || []).filter(log => {
      const hit = log.model === sid || log.serviceId === sid || log.serviceRef === ref;
      if (!hit) return false;
      if (!withinMs) return true;
      const t = parseCallLogTime(log.time);
      return !Number.isFinite(t) || (now - t) <= withinMs;
    }).slice(0, limit);
  }

  function formatTokenTriple(log) {
    const inn = Number(log.promptTokens || 0);
    const out = Number(log.completionTokens || 0);
    const cache = Number(log.cachedTokens || 0);
    return `上行 ${inn} · 下行 ${out} · 缓存 ${cache}`;
  }
  function gatewayCurlForKey(key, plain) {
    const kind = key.keyKind === 'personal' ? 'personal' : 'app';
    const path = kind === 'personal' ? '/personal/v1/chat/completions' : '/app/v1/chat/completions';
    const model = (() => {
      const ref = (key.serviceRefs || [])[0];
      const svc = state.services.find(s => s.id === ref || s.serviceId === ref);
      return svc?.serviceId || 'your-service-id';
    })();
    const userHeader = kind === 'personal' ? ' -H "X-User-Id: u_demo"' : '';
    return `curl -s ${GATEWAY_API}${path} -H "Authorization: Bearer ${plain}"${userHeader} -H "Content-Type: application/json" -d "{\\"model\\":\\"${model}\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"你好\\"}]}"`;
  }
  function normalizeStoredKey(key) {
    const fillApiFields = base => {
      const keyKind = base.keyKind === 'personal' ? 'personal' : 'app';
      const filled = {
        ...base,
        type: 'api',
        keyKind,
        owner: base.owner || '',
        callerId: keyKind === 'personal' ? '' : (base.callerId || ''),
        orgLevel: base.orgLevel === 'workspace' ? 'dept' : (base.orgLevel || ''),
        orgId: base.orgLevel === 'workspace' ? (base.billingDept || base.dept || '') : (base.orgId || ''),
        orgName: base.orgLevel === 'workspace' ? (base.billingDept || base.dept || base.orgName || '') : (base.orgName || ''),
        billingDept: base.billingDept || '',
        serviceRefs: Array.isArray(base.serviceRefs)
          ? base.serviceRefs
          : (base.serviceRef && base.serviceRef !== '*' ? [base.serviceRef] : (base.serviceRefs || [])),
        services: base.services || '全部已授权服务',
        limitMode: base.limitMode || 'token',
        window: base.window || '每天',
        maxInTokens: base.maxInTokens || '',
        maxOutTokens: base.maxOutTokens || '',
        maxSpend: base.maxSpend || '',
        overLimit: base.overLimit || '硬限阻断 · 立即拒绝并返回 429',
        expirePreset: base.expirePreset || (base.expiresAt ? 'custom' : 'never'),
        expiresAt: base.expiresAt || '',
        usedIn: base.usedIn || '0',
        usedOut: base.usedOut || '0',
        usedCache: base.usedCache || '0',
        usedSpend: base.usedSpend || '0.00',
        lastUsed: base.lastUsed || '—',
        rotated: base.rotated || '—',
        created: base.created || '2026-10-01 00:00:00',
        status: base.status || '健康'
      };
      delete filled.workspaceId;
      delete filled.workspaceName;
      return filled;
    };
    if (key.type === 'api') return fillApiFields(key);
    if (key.type === 'kms') return key;
    const isApi = /业务|应用|访问|assistant|marketing|customer/i.test(`${key.purpose || ''}${key.name || ''}`) && !/上游|主密钥|KMS|加密/i.test(key.purpose || '');
    if (isApi || key.purpose === '业务应用访问') return fillApiFields(key);
    const kind = key.kind || (/主密钥|HSM|数据加密/i.test(`${key.purpose || ''}${key.name || ''}`) ? 'master' : 'upstream');
    return { ...key, type: 'kms', kind, purpose: key.purpose || '上游模型凭证', algorithm: key.algorithm || 'AES-256-GCM', provider: key.provider || '', created: key.created || '' };
  }

  function keyKindLabel(kind) {
    if (kind === 'personal') return '个人';
    if (kind === 'probe') return '探测';
    return '应用';
  }

  function orgLevelLabel(level) {
    if (level === 'enterprise') return '企业';
    if (level === 'dept') return '部门';
    return '—';
  }

  const ENTERPRISE_ORG = { id: 'org-enterprise', name: '企业 / 总部', dept: '总部 / 平台中心' };

  function resolveOrgUnit(level, orgId) {
    if (level === 'enterprise') return { ...ENTERPRISE_ORG, level: 'enterprise' };
    const dept = orgId || '';
    return { id: dept, name: dept || '未分配', dept: dept || '未分配', level: 'dept' };
  }

  function orgUnitsForLevel(level) {
    if (level === 'enterprise') return [{ id: ENTERPRISE_ORG.id, label: ENTERPRISE_ORG.name }];
    return (typeof memberDepartments !== 'undefined' ? memberDepartments : [])
      .filter(d => d && d !== '未分配')
      .map(d => ({ id: d, label: d }));
  }

  function applyKeyBillingFields(key, preferred = {}) {
    if (!key || key.type === 'kms') return key;
    const member = preferred.member
      || state.members.find(m => m.id === (preferred.memberId || key.ownerMemberId || key.applicantId))
      || state.members.find(m => m.name === (preferred.name || key.applicantName));
    const caller = resolveCaller(key);
    let orgLevel = preferred.orgLevel || key.orgLevel || '';
    if (orgLevel === 'workspace') orgLevel = 'dept';
    let org = preferred.org && preferred.org.level !== 'workspace' ? preferred.org : null;
    const rawOrgId = preferred.orgId || key.orgId || '';
    const orgIdLooksLikeDept = rawOrgId && !/^ws-/.test(rawOrgId) && rawOrgId !== ENTERPRISE_ORG.id;
    if (!org && rawOrgId && orgLevel === 'enterprise') org = resolveOrgUnit('enterprise', ENTERPRISE_ORG.id);
    if (!org && orgLevel === 'dept' && orgIdLooksLikeDept) org = resolveOrgUnit('dept', rawOrgId);
    if (!orgLevel && !org) orgLevel = 'dept';
    const dept = preferred.billingDept
      || (org?.level === 'dept' ? org.dept : '')
      || key.billingDept
      || (key.keyKind === 'personal' ? (member?.dept || '') : (caller?.ownerDept || member?.dept || ''))
      || '未分配';
    if (!org || org.level === 'workspace') {
      if (orgLevel === 'enterprise') org = resolveOrgUnit('enterprise', ENTERPRISE_ORG.id);
      else org = resolveOrgUnit('dept', dept);
    }
    key.keyKind = key.keyKind === 'personal' ? 'personal' : 'app';
    key.orgLevel = org?.level === 'enterprise' ? 'enterprise' : 'dept';
    key.orgId = org?.id || (key.orgLevel === 'dept' ? dept : ENTERPRISE_ORG.id);
    key.orgName = org?.name || (key.orgLevel === 'dept' ? dept : ENTERPRISE_ORG.name);
    key.billingDept = key.orgLevel === 'enterprise' ? (preferred.billingDept || key.billingDept || org?.dept || dept) : (org?.dept || dept);
    delete key.workspaceId;
    delete key.workspaceName;
    if (key.keyKind === 'personal') {
      key.ownerMemberId = key.ownerMemberId || member?.id || '';
      key.applicantId = key.applicantId || member?.id || '';
      key.applicantName = key.applicantName || member?.name || '';
      key.callerId = '';
      key.owner = member?.name || key.applicantName || key.owner || '';
    }
    return key;
  }
  const persist = () => {
    localStorage.setItem('aegis-routes',JSON.stringify(state.routes));
    localStorage.setItem('aegis-models',JSON.stringify(state.models));
    localStorage.setItem('aegis-services',JSON.stringify(state.services));
    localStorage.setItem('aegis-callers',JSON.stringify(state.callers));
    try { localStorage.removeItem('aegis-workspaces'); } catch {}
    localStorage.setItem('aegis-policies',JSON.stringify(state.policies || []));
    localStorage.setItem('aegis-alert-rules',JSON.stringify(state.alertRules || []));
    localStorage.setItem('aegis-members',JSON.stringify(state.members));
    localStorage.setItem('aegis-roles',JSON.stringify(state.roles));
    localStorage.setItem('aegis-role-defs',JSON.stringify(state.roleDefs));
    localStorage.setItem('aegis-keys',JSON.stringify(state.keys));
    localStorage.setItem('aegis-key-applications',JSON.stringify(state.keyApplications || []));
    localStorage.setItem('aegis-key-secrets',JSON.stringify(state.keySecrets || {}));
  };
  const syncIdentitySwitcher = (opts = {}) => {
    if (typeof window.rebuildIdentitySwitcher === 'function') {
      window.rebuildIdentitySwitcher({ refreshShell: true, ...opts });
    }
  };

  function resolveCaller(keyOrId) {
    if (!keyOrId) return null;
    if (typeof keyOrId === 'string') {
      return state.callers.find(c => c.id === keyOrId || c.name === keyOrId || c.code === keyOrId) || null;
    }
    if (keyOrId.callerId) {
      const byId = state.callers.find(c => c.id === keyOrId.callerId);
      if (byId) return byId;
    }
    if (keyOrId.owner) return state.callers.find(c => c.name === keyOrId.owner || c.code === keyOrId.owner) || null;
    return null;
  }

  function resolveCallerLabel(key) {
    const caller = resolveCaller(key);
    if (caller) return caller.name;
    if (key?.owner && key.owner !== '未指定调用方') return key.owner;
    return '—';
  }

  function syncKeyCallerLinks() {
    const ownerSeed = {
      'customer-app': { memberId: 'm-dengyanfeng', name: '邓艳峰', keyKind: 'app' },
      'rd-assistant-key': { memberId: 'm-wangyaomin', name: '王耀民', keyKind: 'app' },
      'marketing-batch': { memberId: 'm-zhaoran', name: '赵然', keyKind: 'app' },
      'personal-deng': { memberId: 'm-dengyanfeng', name: '邓艳峰', keyKind: 'personal' },
      'personal-wang': { memberId: 'm-wangyaomin', name: '王耀民', keyKind: 'personal' }
    };
    state.keys.forEach(key => {
      if (key.type !== 'api') return;
      const seed = ownerSeed[key.id];
      if (seed) {
        if (!key.ownerMemberId || key.ownerMemberId === 'm-zhouning') {
          key.ownerMemberId = seed.memberId;
          key.applicantId = seed.memberId;
          key.applicantName = seed.name;
        }
        if (!key.keyKind) key.keyKind = seed.keyKind;
      }
      if (key.keyKind === 'personal') {
        applyKeyBillingFields(key);
        return;
      }
      const caller = resolveCaller(key);
      if (caller) {
        key.callerId = caller.id;
        key.owner = caller.name;
      } else if (key.owner === '未指定调用方') {
        key.owner = '';
        key.callerId = key.callerId || '';
      }
      applyKeyBillingFields(key);
    });
  }
  const GATEWAY_HOSTS = {
    prod: 'https://gateway.corp.cn',
    test: 'https://gateway-test.corp.cn'
  };
  const GATEWAY_HOST = GATEWAY_HOSTS.prod;
  const defaultRouteMethods = [
    { id: 'chat', label: '对话补全', suffix: '/chat/completions', path: '/v1/chat/completions', protocol: 'Chat Completions', desc: '多轮对话与工具调用', on: true },
    { id: 'responses', label: 'Responses', suffix: '/responses', path: '/v1/responses', protocol: 'Responses API', desc: '编排与多模态统一入口', on: true },
    { id: 'embeddings', label: '向量化', suffix: '/embeddings', path: '/v1/embeddings', protocol: 'Embeddings', desc: '检索与语义召回', on: true },
    { id: 'models', label: '模型列表', suffix: '/models', path: '/v1/models', protocol: 'Models', desc: '查询可用模型服务', on: true }
  ];
  function cloneRouteMethods() {
    return defaultRouteMethods.map(m => ({ ...m }));
  }
  function makeGatewayRoute({ id, name, audience, env, endpoint, qps, timeout }) {
    return {
      id,
      name,
      audience,
      env,
      endpoint,
      workspace: '全局',
      qps,
      timeout,
      on: true,
      gateway: true,
      primary: false,
      methods: cloneRouteMethods()
    };
  }
  const defaultGatewayRoutes = [
    makeGatewayRoute({ id: 'route-personal-prod', name: '个人调用 · 生产', audience: 'personal', env: 'prod', endpoint: '/personal/v1', qps: '2000', timeout: '30' }),
    makeGatewayRoute({ id: 'route-personal-test', name: '个人调用 · 测试', audience: 'personal', env: 'test', endpoint: '/personal/v1', qps: '800', timeout: '60' }),
    makeGatewayRoute({ id: 'route-app-prod', name: '应用调用 · 生产', audience: 'app', env: 'prod', endpoint: '/app/v1', qps: '8000', timeout: '30' }),
    makeGatewayRoute({ id: 'route-app-test', name: '应用调用 · 测试', audience: 'app', env: 'test', endpoint: '/app/v1', qps: '1500', timeout: '60' })
  ];
  const defaultRoutes = defaultGatewayRoutes.map(r => ({ ...r, methods: cloneRouteMethods() }));
  function audienceLabel(audience) {
    return audience === 'personal' ? '个人' : '应用';
  }
  function envLabel(env) {
    return env === 'test' ? '测试' : '生产';
  }
  function routeHost(env) {
    return GATEWAY_HOSTS[env === 'test' ? 'test' : 'prod'] || GATEWAY_HOSTS.prod;
  }
  function normalizeRouteMethods(methods) {
    const byId = new Map((Array.isArray(methods) ? methods : []).map(m => [m.id || m.suffix || m.path, m]));
    return defaultRouteMethods.map(base => {
      const hit = byId.get(base.id) || byId.get(base.suffix) || byId.get(base.path) || {};
      const suffix = hit.suffix || (hit.path ? String(hit.path).replace(/^\/v1/, '') : '') || base.suffix;
      return {
        ...base,
        ...hit,
        id: base.id,
        label: hit.label || base.label,
        suffix,
        path: hit.path || `${base.path}`,
        protocol: hit.protocol || base.protocol,
        desc: hit.desc || base.desc,
        on: hit.on !== false
      };
    });
  }
  function routeMethodPath(route, method = {}) {
    const endpoint = (route?.endpoint || '/v1').replace(/\/$/, '') || '/v1';
    const suffix = method.suffix || String(method.path || '/chat/completions').replace(/^\/v1/, '');
    return `${endpoint}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
  }
  function routeFullUrl(route, method) {
    if (!route) return GATEWAY_HOST;
    if (method) return `${routeHost(route.env)}${routeMethodPath(route, method)}`;
    if (route.gateway || route.primary) {
      const first = enabledRouteMethods(route)[0] || (route.methods || [])[0];
      return first ? `${routeHost(route.env)}${routeMethodPath(route, first)}` : `${routeHost(route.env)}${route.endpoint || ''}`;
    }
    return `${routeHost(route.env)}${route.endpoint || ''}`;
  }
  function normalizeRoute(route = {}) {
    let audience = route.audience === 'personal' || route.audience === 'app' ? route.audience : '';
    let env = route.env === 'test' || route.env === 'prod' ? route.env : '';
    let gateway = !!route.gateway;
    let endpoint = route.endpoint || '';
    // 兼容旧版单一主路由
    if (route.primary || route.id === 'route-main' || endpoint === '/v1' || endpoint === '/v1/chat/completions') {
      gateway = true;
      audience = audience || 'app';
      env = env || 'prod';
      endpoint = endpoint === '/v1/chat/completions' || endpoint === '/v1' || !endpoint ? '/app/v1' : endpoint;
    }
    if (!audience) audience = 'app';
    if (!env) env = 'prod';
    if (!endpoint) endpoint = audience === 'personal' ? '/personal/v1' : '/app/v1';
    const normalized = {
      ...route,
      audience,
      env,
      endpoint,
      workspace: route.workspace || '全局',
      qps: String(route.qps || (gateway ? '2000' : '1000')).replace(/,/g, ''),
      timeout: String(route.timeout || (env === 'test' ? '60' : '30')),
      on: route.on !== false,
      gateway,
      primary: false
    };
    if (normalized.gateway) {
      normalized.methods = normalizeRouteMethods(route.methods);
      delete normalized.primary;
    } else {
      delete normalized.methods;
    }
    return normalized;
  }
  function enabledRouteMethods(route) {
    const r = route || gatewayRoutes()[0];
    return (r?.methods || normalizeRouteMethods()).filter(m => m.on !== false);
  }
  function ensureGatewayRoutes() {
    state.routes = (state.routes || []).map(normalizeRoute);
    const extras = state.routes.filter(r => !r.gateway && r.id !== 'route-main');
    const byId = new Map(state.routes.filter(r => r.gateway).map(r => [r.id, r]));
    defaultGatewayRoutes.forEach(seed => {
      if (!byId.has(seed.id)) {
        byId.set(seed.id, normalizeRoute({ ...seed, methods: cloneRouteMethods() }));
      } else {
        const cur = byId.get(seed.id);
        cur.audience = seed.audience;
        cur.env = seed.env;
        cur.endpoint = cur.endpoint || seed.endpoint;
        cur.name = cur.name || seed.name;
        cur.methods = normalizeRouteMethods(cur.methods);
        cur.gateway = true;
        cur.primary = false;
      }
    });
    // 去掉旧单一主路由残留
    state.routes = [...defaultGatewayRoutes.map(seed => byId.get(seed.id)), ...extras.map(normalizeRoute)];
  }
  function ensurePrimaryRoute() { ensureGatewayRoutes(); }
  function gatewayRoutes() {
    ensureGatewayRoutes();
    return state.routes.filter(r => r.gateway);
  }
  function primaryRoute() {
    ensureGatewayRoutes();
    return gatewayRoutes().find(r => r.audience === 'app' && r.env === 'prod') || gatewayRoutes()[0];
  }
  function extraRoutes() {
    ensureGatewayRoutes();
    return state.routes.filter(r => !r.gateway);
  }
  function filteredGatewayRoutes() {
    const audience = state.routeAudienceFilter || '全部';
    const env = state.routeEnvFilter || '全部';
    return gatewayRoutes().filter(r => {
      if (audience === '个人' && r.audience !== 'personal') return false;
      if (audience === '应用' && r.audience !== 'app') return false;
      if (env === '生产' && r.env !== 'prod') return false;
      if (env === '测试' && r.env !== 'test') return false;
      return true;
    });
  }
  function filteredExtraRoutes() {
    const audience = state.routeAudienceFilter || '全部';
    const env = state.routeEnvFilter || '全部';
    return extraRoutes().filter(r => {
      if (audience === '个人' && r.audience !== 'personal') return false;
      if (audience === '应用' && r.audience !== 'app') return false;
      if (env === '生产' && r.env !== 'prod') return false;
      if (env === '测试' && r.env !== 'test') return false;
      return true;
    });
  }
  // 模型服务 / 源以后端为准；无法真实连通的演示上游已全部移除
  const defaultServices = [];
  const defaultModels = [];
  const defaultKeys = [
    {id:'prod-cn-03',type:'kms',kind:'upstream',name:'openai-prod-secret',mask:'•••• 91DF',purpose:'OpenAI 上游访问凭证',algorithm:'AES-256-GCM',provider:'OpenAI',rotated:'2026-11-04 17:30:18',status:'健康',created:'2026-09-12 10:00:00'},
    {id:'anthropic-prod',type:'kms',kind:'upstream',name:'anthropic-prod-secret',mask:'•••• 3F21',purpose:'Anthropic 上游访问凭证',algorithm:'AES-256-GCM',provider:'Anthropic',rotated:'2026-10-29 09:15:42',status:'健康',created:'2026-10-08 14:20:00'},
    {id:'deepseek-prod',type:'kms',kind:'upstream',name:'deepseek-prod-secret',mask:'•••• A902',purpose:'DeepSeek 上游访问凭证',algorithm:'AES-256-GCM',provider:'DeepSeek',rotated:'2026-11-02 11:08:55',status:'健康',created:'2026-10-20 08:45:00'},
    {id:'gemini-prod',type:'kms',kind:'upstream',name:'gemini-prod-secret',mask:'•••• C441',purpose:'Google 上游访问凭证',algorithm:'AES-256-GCM',provider:'Google',rotated:'2026-10-23 16:40:12',status:'健康',created:'2026-09-28 13:10:00'},
    {id:'sm4-master',type:'kms',kind:'master',name:'sm4-master-east',mask:'HSM 托管',purpose:'平台数据加密主密钥',algorithm:'SM4-GCM',provider:'企业 HSM',rotated:'2026-09-19 10:00:00',status:'待轮换',created:'2026-06-01 00:00:00'}
  ];
  const defaultMembers = [
    {id:'m-lichen',name:'李晨',phone:'139****0001',userId:'u_super_01',dept:'总部 / 平台中心',role:'超级管理员',budgetType:'不限制',dayBudget:'',monthBudget:'',status:'已激活',joined:'2026-06-01 09:00:00'},
    {id:'m-linzhou',name:'林舟',phone:'138****1028',userId:'u_8f21a3',dept:'总部 / 平台中心',role:'模型服务接入维护',budgetType:'不限制',dayBudget:'',monthBudget:'',status:'已激活',joined:'2026-07-12 10:30:00'},
    {id:'m-zhaoran',name:'赵然',phone:'139****6631',userId:'u_3c90be',dept:'客户服务',role:'模型key分发审核人',budgetType:'按月',dayBudget:'',monthBudget:'12000',status:'已激活',joined:'2026-08-03 14:15:00'},
    {id:'m-shenyao',name:'沈钥',phone:'136****8801',userId:'u_key_rv_01',dept:'总部 / 平台中心',role:'模型key分发审核人',budgetType:'不限制',dayBudget:'',monthBudget:'',status:'已激活',joined:'2026-11-06 09:30:00'},
    {id:'m-chenyu',name:'陈屿',phone:'136****4472',userId:'u_71d0aa',dept:'安全合规',role:'审计人员',budgetType:'按天',dayBudget:'800',monthBudget:'',status:'已激活',joined:'2026-09-18 11:20:00'},
    {id:'m-dengyanfeng',name:'邓艳峰',phone:'137****8815',userId:'u_55e2cf',dept:'客户服务',role:'普通用户',budgetType:'按月',dayBudget:'',monthBudget:'5000',status:'已激活',joined:'2026-10-02 09:45:00'},
    {id:'m-wangyaomin',name:'王耀民',phone:'135****6620',userId:'u_77c1ab',dept:'研发助手',role:'普通用户',budgetType:'按月',dayBudget:'',monthBudget:'4500',status:'已激活',joined:'2026-10-15 16:08:00'},
    {id:'m-pending',name:'韩澈',phone:'158****2290',userId:'u_pending_09',dept:'未分配',role:'普通用户',budgetType:'不限制',dayBudget:'',monthBudget:'',status:'待激活',joined:'2026-11-03 10:18:05'},
    {id:'m-disabled',name:'顾舟',phone:'186****3301',userId:'u_9ab441',dept:'营销内容',role:'普通用户',budgetType:'按月',dayBudget:'',monthBudget:'3000',status:'已禁用',joined:'2026-06-21 15:30:00'}
  ];
  const LEGACY_ROLE_NAME_MAP = {
    '企业管理员': '模型服务接入维护',
    '模型运维': '模型服务接入维护',
    '部门管理员': '模型key分发审核人',
    '安全审计员': '审计人员',
    '普通成员': '普通用户'
  };
  function mapLegacyRoleName(name) {
    return LEGACY_ROLE_NAME_MAP[name] || name || '普通用户';
  }
  const memberDepartments = ['未分配','总部 / 平台中心','客户服务','研发助手','营销内容','安全合规','数据分析'];
  const permissionCatalog = [
    {group:'页面访问', items:[
      {id:'page.overview', label:'运行总览'},
      {id:'page.model-services', label:'模型服务配置'},
      {id:'page.model-sources', label:'源模型能力接入'},
      {id:'page.routes', label:'业务路由'},
      {id:'page.integration', label:'接入说明'},
      {id:'page.members', label:'成员管理'},
      {id:'page.access', label:'角色权限'},
      {id:'page.security-api', label:'签发 API Key'},
      {id:'page.security-policies', label:'安全策略'},
      {id:'page.audit-platform', label:'平台操作审计'},
      {id:'page.audit-policy', label:'策略命中审计'},
      {id:'page.audit-request', label:'调用日志审计'},
      {id:'page.alerts', label:'告警规则'},
      {id:'page.usage', label:'用量概览'},
      {id:'page.usage-detail', label:'用量明细'},
      {id:'page.billing', label:'费用治理视图（页内深度）'}
    ]},
    {group:'模型与路由', items:[
      {id:'cap.view_models', label:'查看模型'},
      {id:'cap.manage_models', label:'接入 / 管理源模型'},
      {id:'cap.manage_services', label:'创建 / 管理模型服务'},
      {id:'cap.manage_routes', label:'创建 / 管理路由'},
      {id:'cap.configure_distribution', label:'配置分发策略'}
    ]},
    {group:'密钥与安全', items:[
      {id:'cap.apply_keys', label:'申请 API Key'},
      {id:'cap.manage_keys', label:'签发 / 审批 API Key'},
      {id:'cap.manage_policies', label:'配置安全策略'},
      {id:'cap.view_audit', label:'查看审计日志'},
      {id:'cap.export_audit', label:'导出审计报告'}
    ]},
    {group:'组织与费用', items:[
      {id:'cap.manage_members', label:'管理成员'},
      {id:'cap.manage_roles', label:'配置角色权限'},
      {id:'cap.manage_alerts', label:'配置告警规则'},
      {id:'cap.view_usage', label:'查看用量'},
      {id:'cap.export_billing', label:'导出费用账单'},
      {id:'cap.all_features', label:'全部功能（超管）'}
    ]}
  ];
  const allPermissionIds = permissionCatalog.flatMap(g => g.items.map(i => i.id));
  const defaultRoleDefs = [
    {
      id: 'role-superadmin', name: '超级管理员', scope: '全局',
      desc: '拥有平台全部功能与操作权限', builtin: true, locked: true, members: 1,
      perms: allPermissionIds.slice()
    },
    {
      id: 'role-ops', name: '模型服务接入维护', scope: '全局',
      desc: '负责模型服务、源模型接入、业务路由与分发策略维护', builtin: true, members: 2,
      perms: [
        'page.overview', 'page.model-services', 'page.model-sources', 'page.routes', 'page.integration',
        'page.usage', 'page.usage-detail', 'page.alerts', 'page.audit-request',
        'cap.view_models', 'cap.manage_models', 'cap.manage_services', 'cap.manage_routes',
        'cap.configure_distribution', 'cap.view_usage', 'cap.manage_alerts', 'cap.view_audit'
      ]
    },
    {
      id: 'role-key-reviewer', name: '模型key分发审核人', scope: '全局',
      desc: '负责 API Key 签发、申请审批与密钥生命周期治理', builtin: true, members: 2,
      perms: [
        'page.overview', 'page.security-api', 'page.members', 'page.integration',
        'page.usage', 'page.usage-detail', 'page.audit-platform',
        'cap.view_models', 'cap.manage_keys', 'cap.view_usage', 'cap.view_audit'
      ]
    },
    {
      id: 'role-auditor', name: '审计人员', scope: '全局',
      desc: '安全策略核查、审计日志与调用留痕（只读）', builtin: true, members: 2,
      perms: [
        'page.overview', 'page.members', 'page.access', 'page.security-policies', 'page.integration',
        'page.audit-platform', 'page.audit-policy', 'page.audit-request', 'page.alerts',
        'page.usage', 'page.usage-detail', 'page.billing',
        'cap.view_models', 'cap.view_audit', 'cap.export_audit', 'cap.view_usage', 'cap.export_billing'
      ]
    },
    {
      id: 'role-member', name: '普通用户', scope: '所属部门',
      desc: '查看可用模型与路由、申请个人 Key、查看本人用量', builtin: true, members: 21,
      perms: [
        'page.overview', 'page.routes', 'page.integration', 'page.security-api',
        'page.usage', 'page.usage-detail',
        'cap.view_models', 'cap.apply_keys', 'cap.view_usage'
      ]
    }
  ];
  const OBSOLETE_BUILTIN_ROLE_IDS = new Set(['role-admin', 'role-dept']);
  function loadRoleDefs() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('aegis-role-defs')); } catch { stored = null; }
    const normalize = role => {
      const mappedName = mapLegacyRoleName(role.name);
      const base = defaultRoleDefs.find(d => d.id === role.id || d.name === mappedName || d.name === role.name);
      const merged = {
        ...(base || {}),
        ...role,
        name: base?.name || mappedName,
        perms: Array.isArray(role.perms) ? role.perms.filter(Boolean) : (base?.perms || []).slice(),
        builtin: role.builtin ?? !!base,
        locked: role.locked ?? !!base?.locked
      };
      if (merged.id === 'role-superadmin' || merged.name === '超级管理员' || merged.perms.includes('cap.all_features')) {
        if (merged.id === 'role-superadmin' || merged.name === '超级管理员') {
          merged.locked = true;
          merged.builtin = true;
          merged.name = '超级管理员';
          merged.perms = allPermissionIds.slice();
          merged.desc = '拥有平台全部功能与操作权限';
          merged.scope = '全局';
        }
      }
      return merged;
    };
    if (Array.isArray(stored) && stored.length) {
      const list = stored
        .filter(r => !OBSOLETE_BUILTIN_ROLE_IDS.has(r.id))
        .map(normalize)
        .filter((r, idx, arr) => arr.findIndex(x => x.id === r.id || x.name === r.name) === idx);
      defaultRoleDefs.forEach(def => {
        if (!list.some(r => r.id === def.id || r.name === def.name)) {
          list.push({ ...def, perms: [...def.perms] });
        }
      });
      if (!list.some(r => r.id === 'role-superadmin' || r.name === '超级管理员')) {
        list.unshift({ ...defaultRoleDefs[0], perms: allPermissionIds.slice() });
      }
      return list;
    }
    return defaultRoleDefs.map(r => ({ ...r, perms: [...r.perms] }));
  }
  const defaultCallers = [
    {id:'caller-customer',name:'智能客服应用',code:'svc-customer-agent',ownerDept:'客户服务',contact:'赵然',desc:'智能客服生产与预发调用',status:'启用',created:'2026-07-12 09:00:00'},
    {id:'caller-rd',name:'研发助手服务',code:'svc-rd-assistant',ownerDept:'研发助手',contact:'林舟',desc:'代码助手与内部工具链',status:'启用',created:'2026-08-03 10:30:00'},
    {id:'caller-marketing',name:'营销内容批处理',code:'svc-marketing-batch',ownerDept:'营销内容',contact:'赵然',desc:'营销文案与素材批处理',status:'启用',created:'2026-09-02 16:22:41'}
  ];
  function normalizeScopeItem(item) {
    const mapName = name => name === '全部空间' ? '全部部门' : name === '智能客服' ? '客户服务' : name;
    const raw = Array.isArray(item.depts) ? item.depts : (item.workspaces || []);
    const depts = raw.map(mapName);
    const next = { ...item, depts };
    if (next.scope === '指定业务空间') next.scope = '指定部门';
    if (next.name === '业务空间预算预警') next.name = '部门预算预警';
    delete next.workspaces;
    return next;
  }
  function normalizeService(s = {}) {
    const hosting = s.hosting === 'local' ? 'local' : 'saas';
    return { strategy: 'fixed', enabled: true, ...s, hosting, enabled: s.enabled !== false };
  }
  function normalizePolicy(item) {
    const next = normalizeScopeItem(item);
    if (!['all', 'saas', 'local'].includes(next.hostingScope)) {
      const seed = defaultPolicies.find(d => d.id === next.id || d.code === next.code);
      next.hostingScope = seed?.hostingScope || 'all';
    }
    if (next.desc == null) {
      const seed = defaultPolicies.find(d => d.id === next.id || d.code === next.code);
      if (seed?.desc) next.desc = seed.desc;
    }
    return next;
  }
  function hostingLabel(hosting) {
    return hosting === 'local' ? '本地模型' : 'SaaS 模型';
  }
  function hostingChipClass(hosting) {
    return hosting === 'local' ? 'orange' : 'green';
  }
  function hostingScopeLabel(scope) {
    if (scope === 'saas') return '仅 SaaS';
    if (scope === 'local') return '仅本地';
    return '全部类型';
  }
  function policyTypesForHosting(hostingScope = 'all') {
    const shared = ['脱敏', '隐私拦截', '越权防护', '内容安全'];
    if (hostingScope === 'saas') return [...shared, '数据出域管控'];
    if (hostingScope === 'local') return [...shared, '本地端点防护', '推理资源治理'];
    return [...shared, '数据出域管控', '本地端点防护', '推理资源治理'];
  }
  function policyActionsForType(type) {
    if (type === '脱敏' || type === '数据出域管控') return ['脱敏后放行', '立即拦截', '告警并放行'];
    if (type === '隐私拦截') return ['响应侧改写', '立即拦截', '告警并放行'];
    if (type === '越权防护' || type === '本地端点防护') return ['立即拦截', '告警并放行'];
    if (type === '推理资源治理') return ['告警并放行', '立即拦截'];
    return ['告警并放行', '立即拦截', '脱敏后放行', '响应侧改写'];
  }
  const defaultPolicies = [
    {id:'pol-cfg-1', code:'pii-mask-cn-v2', name:'大陆手机号脱敏', type:'脱敏', action:'脱敏后放行', hostingScope:'all', scope:'全局', depts:['客户服务','研发助手','营销内容'], services:['全部服务'], enabled:true, hits:1284, updated:'2026-10-28 14:22:00'},
    {id:'pol-cfg-2', code:'pii-block-id-v1', name:'身份证号输出改写', type:'隐私拦截', action:'响应侧改写', hostingScope:'all', scope:'全局', depts:['全部部门'], services:['全部服务'], enabled:true, hits:96, updated:'2026-10-12 09:40:00'},
    {id:'pol-cfg-3', code:'pci-mask-card-v3', name:'银行卡号脱敏', type:'脱敏', action:'脱敏后放行', hostingScope:'saas', scope:'指定部门', depts:['营销内容'], services:['全部 SaaS 服务'], enabled:true, hits:0, updated:'2026-09-18 16:05:00'},
    {id:'pol-cfg-4', code:'scope-guard-v2', name:'服务越权防护', type:'越权防护', action:'立即拦截', hostingScope:'all', scope:'全局', depts:['全部部门'], services:['全部服务'], enabled:true, hits:0, updated:'2026-11-01 10:15:00'},
    {id:'pol-cfg-5', code:'prompt-inject-v1', name:'提示词注入告警', type:'内容安全', action:'告警并放行', hostingScope:'saas', scope:'指定部门', depts:['客户服务'], services:['全部 SaaS 服务'], enabled:true, hits:0, updated:'2026-10-30 11:28:00'},
    {id:'pol-cfg-6', code:'pii-mask-email-v2', name:'邮箱地址脱敏', type:'脱敏', action:'脱敏后放行', hostingScope:'saas', scope:'指定部门', depts:['研发助手'], services:['全部 SaaS 服务'], enabled:false, hits:0, updated:'2026-09-05 13:50:00'},
    {id:'pol-cfg-7', code:'egress-block-secret-v1', name:'出域密钥/凭证拦截', type:'数据出域管控', action:'立即拦截', hostingScope:'saas', scope:'全局', depts:['全部部门'], services:['全部 SaaS 服务'], enabled:true, hits:0, updated:'2026-11-02 16:20:00', desc:'请求发往公有云前扫描 API Key、私钥、连接串，命中则拒绝出域'},
    {id:'pol-cfg-8', code:'egress-mask-customer-v2', name:'客户主数据出域脱敏', type:'数据出域管控', action:'脱敏后放行', hostingScope:'saas', scope:'指定部门', depts:['客户服务'], services:['全部 SaaS 服务'], enabled:true, hits:0, updated:'2026-10-25 11:08:00', desc:'客户姓名/订单号等出域前掩码，降低 SaaS 侧留存风险'},
    {id:'pol-cfg-9', code:'local-endpoint-acl-v1', name:'本地推理端点访问控制', type:'本地端点防护', action:'立即拦截', hostingScope:'local', scope:'全局', depts:['全部部门'], services:['全部本地服务'], enabled:true, hits:0, updated:'2026-11-01 09:40:00', desc:'仅允许登记过的内网调用方访问本地推理 Base URL'},
    {id:'pol-cfg-10', code:'local-rag-scope-v1', name:'本地知识库越权防护', type:'越权防护', action:'立即拦截', hostingScope:'local', scope:'指定部门', depts:['总部 / 平台中心','安全合规'], services:['全部本地服务'], enabled:true, hits:0, updated:'2026-10-29 15:12:00', desc:'禁止跨部门检索财务本地知识库分片'},
    {id:'pol-cfg-11', code:'local-gpu-abuse-v1', name:'本地推理资源滥用防护', type:'推理资源治理', action:'告警并放行', hostingScope:'local', scope:'全局', depts:['全部部门'], services:['全部本地服务'], enabled:true, hits:0, updated:'2026-11-03 18:05:00', desc:'单 Key 突发 QPS / 超长上下文触发告警，保护 GPU 集群'}
  ];
  const defaultAlertRules = [
    {id:'al-1', name:'上游 P95 延迟超阈', metric:'延迟', threshold:'1500 ms', window:'5 分钟', severity:'严重', depts:['全部部门'], channels:['通知中心','邮件'], enabled:true, lastFired:'2026-11-04 17:36:18'},
    {id:'al-2', name:'网关错误率超阈', metric:'错误率', threshold:'1.5%', window:'10 分钟', severity:'警告', depts:['全部部门'], channels:['通知中心'], enabled:true, lastFired:'—'},
    {id:'al-3', name:'部门预算预警', metric:'预算', threshold:'80%', window:'按天', severity:'提醒', depts:['客户服务','营销内容'], channels:['通知中心','邮件'], enabled:true, lastFired:'2026-11-04 15:48:00'},
    {id:'al-4', name:'上游配额耗尽', metric:'上游配额', threshold:'95%', window:'即时', severity:'严重', depts:['全部部门'], channels:['通知中心'], enabled:false, lastFired:'2026-11-03 22:10:44'}
  ];
  const state = {
    routes: load('aegis-routes', defaultRoutes).map(normalizeRoute),
    models: load('aegis-models', defaultModels),
    services: load('aegis-services', defaultServices).map(normalizeService),
    callers: load('aegis-callers',defaultCallers),
    policies: (() => {
      const loaded = load('aegis-policies', defaultPolicies).map(normalizePolicy);
      const ids = new Set(loaded.map(p => p.id));
      defaultPolicies.forEach(d => { if (!ids.has(d.id)) loaded.push(normalizePolicy(d)); });
      return loaded;
    })(),
    alertRules: load('aegis-alert-rules', defaultAlertRules).map(normalizeScopeItem),
    members: load('aegis-members',defaultMembers),
    memberQuery: '',
    memberFilter: '全部',
    serviceHostingFilter: '全部',
    policyHostingFilter: '全部',
    routeAudienceFilter: '全部',
    routeEnvFilter: '全部',
    routeFocus: { audience: 'app', env: 'prod' },
    roles: load('aegis-roles',[]),
    roleDefs: loadRoleDefs(),
    editingRoleId: null,
    keys: load('aegis-keys',defaultKeys).map(normalizeStoredKey),
    callLogs: [],
    keyApplications: load('aegis-key-applications', []),
    keySecrets: load('aegis-key-secrets', {}),
    calendarOverrides: load('aegis-calendar-overrides',[]),
    notifications: 3,
    modalStep: 1,
    returnPage: 'overview',
    usageFilters: { period: '近 7 天', grain: 'day', key: '', service: '', source: '', keyKind: '', dept: '', orgLevel: '', app: '', customStart: '', customEnd: '' },
    usageDetailFilters: { query: '', keyKind: '', service: '', dept: '' },
    usageDetailPager: { page: 1, pageSize: 50 },
    costDim: 'org',
    billingFilters: { period: '近 7 天', grain: 'day', customStart: '', customEnd: '' },
    usageTab: (() => {
      try { return sessionStorage.getItem('aegis-usage-tab') === 'cost' ? 'cost' : 'usage'; } catch { return 'usage'; }
    })(),
    auditFilters: { period: '最近 24 小时', result: '', keyword: '', customStart: '', customEnd: '' },
    listFilters: load('aegis-list-filters', {
      statuses: ['运行中', '观察中', '已停用', '异常'],
      providers: ['OpenAI', 'Anthropic', 'Google', 'DeepSeek', '阿里云', '腾讯云', '火山引擎', '百度智能云', '华为云', '世纪互联', '私有集群', '其他'],
      region: '全部区域',
      query: '',
      serviceId: '',
      deploy: '全部',
      capability: '全部',
      billing: '全部'
    }),
    serviceDetailFilters: load('aegis-service-detail-filters', {
      health: ['healthy', 'unhealthy', 'removed'],
      roles: ['primary', 'backup'],
      providers: []
    }),
    budgetAlertThreshold: (() => {
      const raw = Number(localStorage.getItem('aegis-budget-alert'));
      return Number.isFinite(raw) ? Math.min(100, Math.max(50, raw)) : 80;
    })(),
    overviewPeriod: '今日',
    overviewChartRange: '24H',
    overviewAutoRefresh: true,
    overviewRefreshedAt: Date.now(),
    overviewRankMetric: 'cost',
    securityTab: 'api',
    securityKeyScene: 'all',
    issueKeyScene: 'app',
    auditView: 'platform',
    selectedAuditId: null,
    auditPayloadTab: 'downReq',
    selectedKeyId: null,
    selectedKeyIds: [],
    securityDetailTab: 'overview',
    batchKeyMode: 'single',
    distributionMode: 'cost',
    deepseekStrategy: 'cost',
    deepseekSources: [
      {id:'aliyun-ds-v4', provider:'阿里云百炼', source:'deepseek-v4', region:'华东-上海', busyIn:2.00, busyOut:8.00, idleIn:1.20, idleOut:4.80, holidayIn:1.00, holidayOut:4.00, latency:684, sla:99.98, quota:72, enabled:true},
      {id:'deepseek-direct-v4', provider:'DeepSeek 直连', source:'deepseek-v4', region:'华北-北京', busyIn:2.10, busyOut:8.40, idleIn:1.40, idleOut:5.60, holidayIn:1.20, holidayOut:4.80, latency:612, sla:99.96, quota:48, enabled:true},
      {id:'tencent-ds-v4', provider:'腾讯云 TI', source:'deepseek-v4', region:'华南-广州', busyIn:2.30, busyOut:8.00, idleIn:1.10, idleOut:4.20, holidayIn:0.90, holidayOut:3.80, latency:731, sla:99.99, quota:81, enabled:true}
    ]
  };
  syncKeyCallerLinks();
  ensurePrimaryRoute();

  // 校正本地缓存：五类内置角色权限与名称
  (function ensureRolePermissionDefaults() {
    const ROLE_SCHEMA = 'roles-v5-usage-pages';
    const forceSync = localStorage.getItem('aegis-role-schema') !== ROLE_SCHEMA;
    state.roleDefs = (state.roleDefs || [])
      .filter(r => !OBSOLETE_BUILTIN_ROLE_IDS.has(r.id))
      .map(r => {
        const mapped = mapLegacyRoleName(r.name);
        const base = defaultRoleDefs.find(d => d.id === r.id || d.name === mapped);
        if (!base) return { ...r, name: mapped };
        return {
          ...r,
          id: base.id,
          name: base.name,
          scope: forceSync ? base.scope : (r.scope || base.scope),
          desc: forceSync ? base.desc : (r.desc || base.desc),
          builtin: true,
          locked: !!base.locked,
          perms: forceSync || base.locked ? [...base.perms] : (Array.isArray(r.perms) && r.perms.length ? r.perms : [...base.perms])
        };
      });
    defaultRoleDefs.forEach(def => {
      if (!state.roleDefs.some(r => r.id === def.id || r.name === def.name)) {
        state.roleDefs.push({ ...def, perms: [...def.perms] });
      }
    });
    // 去重：同 id / 同名只保留一份
    const seen = new Set();
    state.roleDefs = state.roleDefs.filter(r => {
      const key = r.id || r.name;
      if (seen.has(key) || seen.has(r.name)) return false;
      seen.add(r.id);
      seen.add(r.name);
      return true;
    });
    const order = defaultRoleDefs.map(d => d.id);
    state.roleDefs.sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    state.roleDefs.forEach(role => {
      role.perms = (role.perms || []).filter(id => id !== 'page.workspaces');
      if (role.scope === '指定业务空间') role.scope = '指定部门';
      if (role.scope === '所属业务空间') role.scope = '所属部门';
    });
    localStorage.setItem('aegis-role-defs', JSON.stringify(state.roleDefs));
    try { localStorage.setItem('aegis-role-schema', ROLE_SCHEMA); } catch {}
  })();

  // 演示身份：超管→李晨；并迁移旧角色名到五类角色
  (function migrateDemoIdentities() {
    state.members = state.members.map(m => {
      const role = mapLegacyRoleName(m.role);
      if (m.role === '超级管理员' || m.id === 'm-lichen' || m.id === 'm-guheng' || m.name === '顾衡' || m.name === '李晨') {
        return {
          ...m,
          id: 'm-lichen',
          name: '李晨',
          phone: m.phone || '139****0001',
          userId: m.userId || 'u_super_01',
          dept: m.dept || '总部 / 平台中心',
          role: '超级管理员',
          status: m.status || '已激活'
        };
      }
      if (m.name === '林舟' || m.id === 'm-linzhou') {
        return { ...m, id: 'm-linzhou', name: '林舟', role: '模型服务接入维护', dept: m.dept || '总部 / 平台中心', status: m.status || '已激活' };
      }
      if (m.name === '赵然' || m.id === 'm-zhaoran') {
        return { ...m, id: 'm-zhaoran', name: '赵然', role: '模型key分发审核人', dept: m.dept || '客户服务', status: m.status || '已激活' };
      }
      if (m.name === '沈钥' || m.id === 'm-shenyao') {
        return {
          ...m,
          id: 'm-shenyao',
          name: '沈钥',
          phone: m.phone || '136****8801',
          userId: m.userId || 'u_key_rv_01',
          dept: m.dept || '总部 / 平台中心',
          role: '模型key分发审核人',
          budgetType: m.budgetType || '不限制',
          status: '已激活'
        };
      }
      if (m.name === '陈屿' || m.id === 'm-chenyu') {
        return { ...m, id: 'm-chenyu', name: '陈屿', role: '审计人员', dept: m.dept || '安全合规', status: m.status || '已激活' };
      }
      if (m.name === '周宁' || m.id === 'm-zhouning' || m.name === '邓艳峰' || m.id === 'm-dengyanfeng') {
        return {
          ...m,
          id: 'm-dengyanfeng',
          name: '邓艳峰',
          phone: m.phone || '137****8815',
          userId: m.userId || 'u_55e2cf',
          dept: m.dept || '客户服务',
          role: '普通用户',
          status: m.status || '已激活'
        };
      }
      if (m.name === '王耀民' || m.id === 'm-wangyaomin') {
        return {
          ...m,
          id: 'm-wangyaomin',
          name: '王耀民',
          phone: m.phone || '135****6620',
          userId: m.userId || 'u_77c1ab',
          dept: m.dept || '研发助手',
          role: '普通用户',
          status: m.status || '已激活'
        };
      }
      return { ...m, role };
    });
    const seen = new Set();
    state.members = state.members.filter(m => {
      if (!m?.id || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    if (!state.members.some(m => m.id === 'm-lichen')) {
      state.members.unshift({
        id: 'm-lichen', name: '李晨', phone: '139****0001', userId: 'u_super_01',
        dept: '总部 / 平台中心', role: '超级管理员', budgetType: '不限制', dayBudget: '', monthBudget: '',
        status: '已激活', joined: '2026-06-01 09:00:00'
      });
    }
    if (!state.members.some(m => m.id === 'm-shenyao')) {
      state.members.push({
        id: 'm-shenyao', name: '沈钥', phone: '136****8801', userId: 'u_key_rv_01',
        dept: '总部 / 平台中心', role: '模型key分发审核人', budgetType: '不限制', dayBudget: '', monthBudget: '',
        status: '已激活', joined: '2026-11-06 09:30:00'
      });
    }
    if (!state.members.some(m => m.id === 'm-dengyanfeng')) {
      state.members.push({
        id: 'm-dengyanfeng', name: '邓艳峰', phone: '137****8815', userId: 'u_55e2cf',
        dept: '客户服务', role: '普通用户', budgetType: '按月', dayBudget: '', monthBudget: '5000',
        status: '已激活', joined: '2026-10-02 09:45:00'
      });
    }
    if (!state.members.some(m => m.id === 'm-wangyaomin')) {
      state.members.push({
        id: 'm-wangyaomin', name: '王耀民', phone: '135****6620', userId: 'u_77c1ab',
        dept: '研发助手', role: '普通用户', budgetType: '按月', dayBudget: '', monthBudget: '4500',
        status: '已激活', joined: '2026-10-15 16:08:00'
      });
    }
    (state.keyApplications || []).forEach(app => {
      if (app.applicantId === 'm-zhouning' || app.applicantName === '周宁') {
        app.applicantId = 'm-dengyanfeng';
        app.applicantName = '邓艳峰';
      }
    });
    (state.callers || []).forEach(c => {
      if (c.contact === '周宁') c.contact = '邓艳峰';
    });
    (state.keys || []).forEach(k => {
      if (k.ownerMemberId === 'm-zhouning' || k.ownerMemberId === 'm-guheng') {
        k.ownerMemberId = k.ownerMemberId === 'm-guheng' ? 'm-lichen' : 'm-dengyanfeng';
      }
      if (k.applicantId === 'm-zhouning') k.applicantId = 'm-dengyanfeng';
      if (k.applicantName === '周宁') k.applicantName = '邓艳峰';
    });
    // 补齐应用/个人主体与付款归属；确保演示用个人 Key 存在
    const ensurePersonalSeed = [
      defaultKeys.find(k => k.id === 'personal-deng'),
      defaultKeys.find(k => k.id === 'personal-wang')
    ].filter(Boolean);
    ensurePersonalSeed.forEach(seed => {
      if (!(state.keys || []).some(k => k.id === seed.id)) {
        state.keys.push(normalizeStoredKey({ ...seed }));
      }
    });
    (state.keys || []).forEach(k => {
      if (k.type !== 'api') return;
      k.keyKind = k.keyKind === 'personal' ? 'personal' : 'app';
      if (k.orgLevel === 'workspace') {
        const dept = k.billingDept || k.dept || '';
        k.orgLevel = 'dept';
        k.orgId = dept;
        k.orgName = dept || k.orgName || '';
      }
      applyKeyBillingFields(k);
      if (!k.orgLevel) {
        if (k.billingDept) { k.orgLevel = 'dept'; k.orgId = k.billingDept; k.orgName = k.billingDept; }
        else { k.orgLevel = 'enterprise'; k.orgId = ENTERPRISE_ORG.id; k.orgName = ENTERPRISE_ORG.name; }
      }
      if (k.expirePreset == null && k.expiresAt == null) {
        const seed = defaultKeys.find(s => s.id === k.id && s.type === 'api');
        if (seed) {
          k.expirePreset = seed.expirePreset || 'never';
          k.expiresAt = seed.expiresAt || '';
        } else {
          k.expirePreset = k.expiresAt ? 'custom' : 'never';
          k.expiresAt = k.expiresAt || '';
        }
      }
    });
    (state.keyApplications || []).forEach(app => {
      if (!app.keyKind) app.keyKind = app.callerCode || app.callerName ? 'app' : 'personal';
      if (!app.billingDept) app.billingDept = app.dept || '';
      if (app.expirePreset == null && app.expiresAt == null) {
        app.expirePreset = app.keyKind === 'personal' ? '90d' : '180d';
        app.expiresAt = addDaysDateTime(app.keyKind === 'personal' ? 90 : 180, parseKeyDate(app.created) || new Date());
      }
      delete app.workspaceId;
      delete app.workspaceName;
      if (!app.orgLevel || app.orgLevel === 'workspace' || /^ws-/.test(app.orgId || '')) {
        const dept = app.billingDept || app.dept || '';
        app.orgLevel = 'dept';
        app.orgId = dept;
        app.orgName = dept;
      }
    });
    const identity = localStorage.getItem('aegis-identity');
    if (identity === 'm-zhouning' || identity === 'developer') localStorage.setItem('aegis-identity', 'm-dengyanfeng');
    if (identity === 'm-guheng' || identity === 'superadmin') localStorage.setItem('aegis-identity', 'm-lichen');
    localStorage.setItem('aegis-members', JSON.stringify(state.members));
    localStorage.setItem('aegis-key-applications', JSON.stringify(state.keyApplications || []));
    localStorage.setItem('aegis-callers', JSON.stringify(state.callers || []));
    localStorage.setItem('aegis-keys', JSON.stringify(state.keys || []));
    localStorage.setItem('aegis-identity-v', '4');
    if (window.rebuildIdentitySwitcher) window.rebuildIdentitySwitcher({ forceShell: true, preferId: localStorage.getItem('aegis-identity') || 'm-lichen' });
  })();

  (function decoupleKmsFromProduct() {
    // 产品面暂不纳入 KMS：清理源模型上的托管引用，密钥数据保留但不参与接入与展示
    state.models.forEach(m => {
      if (m.kmsKeyId || m.kmsKeyName) {
        m.kmsKeyId = '';
        m.kmsKeyName = '';
      }
    });
    state.securityTab = 'api';
  })();

  (function purgeInventedBillingSnapshots() {
    // 清除此前误写入的示例计费（非用户真实填写），避免列表/详情继续展示错误价格
    const isInvented = p => p && String(p.flatInput ?? p.busyInput) === '1.7'
      && String(p.flatOutput ?? p.busyOutput) === '6.8'
      && String(p.discount) === '85';
    let changed = false;
    (state.models || []).forEach(m => {
      if (isInvented(m.prices)) {
        m.prices = {};
        changed = true;
      }
    });
    try {
      const map = JSON.parse(localStorage.getItem('aegis-source-extras') || '{}') || {};
      Object.keys(map).forEach(k => {
        if (isInvented(map[k]?.prices)) {
          delete map[k];
          changed = true;
        }
      });
      localStorage.setItem('aegis-source-extras', JSON.stringify(map));
    } catch {}
    if (changed) {
      try { localStorage.setItem('aegis-models', JSON.stringify(state.models)); } catch {}
    }
  })();

  (function migrateLegacyRoles() {
    if (!state.roles.length) return;
    const existing = new Set(state.roleDefs.map(r => r.name));
    state.roles.forEach(r => {
      if (existing.has(r.name)) return;
      state.roleDefs.push({
        id: r.id || `role-${Date.now()}`,
        name: r.name,
        scope: r.scope || '全局',
        desc: r.desc || '',
        builtin: false,
        locked: false,
        members: 0,
        perms: Array.isArray(r.permIds) ? r.permIds : []
      });
    });
    state.roles = [];
  })();

  function roleDefsList() { return state.roleDefs; }
  function memberRoles() {
    const names = roleDefsList().map(r => r.name);
    return names.length ? names : ['超级管理员','模型服务接入维护','模型key分发审核人','审计人员','普通用户'];
  }
  function findRoleDef(id) { return state.roleDefs.find(r => r.id === id); }
  function isSuperAdminRole(role) {
    if (!role) return false;
    return !!role.locked
      || role.id === 'role-superadmin'
      || role.name === '超级管理员';
  }
  function rolePermChecksHtml(selected = [], locked = false) {
    const set = new Set(selected);
    return permissionCatalog.map(group => {
      const ids = group.items.map(i => i.id);
      const allOn = ids.every(id => set.has(id));
      return `<div class="x-perm-group" data-perm-group="${group.group}">
        <div class="x-perm-group-head">
          <strong>${group.group}</strong>
          <button type="button" class="x-link-btn" data-x="toggle-perm-group" data-group="${group.group}" ${locked ? 'disabled' : ''}>${allOn ? '取消本组' : '全选本组'}</button>
        </div>
        <div class="x-checks x-perm-checks">${group.items.map(item => `
          <label class="x-check${locked ? ' is-locked' : ''}">
            <input type="checkbox" name="rolePerm" value="${item.id}" ${set.has(item.id) ? 'checked' : ''} ${locked ? 'disabled' : ''}>
            <span>${item.label}</span>
          </label>`).join('')}</div>
      </div>`;
    }).join('');
  }
  function collectRolePerms(root = modalLayer) {
    return $$('input[name="rolePerm"]:checked', root).map(el => el.value);
  }
  function countRoleMembers(roleName) {
    return state.members.filter(m => m.role === roleName).length;
  }
  function refreshAccessPage() {
    if (currentPage() !== 'access') return;
    if (window.render) window.render('access');
    setTimeout(enhanceView, 0);
  }

  persist();
  syncIdentitySwitcher({ forceShell: true, rerender: true });

  document.body.insertAdjacentHTML('beforeend', `
    <div class="x-overlay" id="x-modal-layer" aria-hidden="true"><div class="x-dialog" role="dialog" aria-modal="true" aria-labelledby="x-modal-title"><div id="x-modal-content"></div></div></div>
    <div class="x-drawer-layer" id="x-drawer-layer" aria-hidden="true"><aside class="x-drawer" role="dialog" aria-modal="true" aria-labelledby="x-drawer-title"><div id="x-drawer-content" style="display:contents"></div></aside></div>
    <div class="x-overlay" id="x-command-layer" aria-hidden="true"><div class="x-dialog x-command" role="dialog" aria-modal="true"><div class="x-command-search">${icon('i-search')}<input id="x-command-input" placeholder="搜索功能、模型、路由或日志…" autocomplete="off"><kbd>ESC</kbd></div><div class="x-command-results" id="x-command-results"></div></div></div>`);

  const modalLayer = $('#x-modal-layer');
  const drawerLayer = $('#x-drawer-layer');
  const commandLayer = $('#x-command-layer');

  const currentPage = () => window.getActivePage?.() || $('.nav-item.active[data-page]')?.dataset.page || 'overview';
  const toast = message => window.showToast ? window.showToast(message) : null;
  const closeLayers = () => {
    const shouldRefreshSecurity = state.refreshSecurityOnClose;
    [modalLayer, drawerLayer, commandLayer].forEach(layer => { layer.classList.remove('open'); layer.setAttribute('aria-hidden','true'); });
    state.editingModelId = null;
    state.editingApiKeyId = null;
    state.revealingKeyId = null;
    state.refreshSecurityOnClose = false;
    if (shouldRefreshSecurity && window.render && (isSecurityPage() || currentPage() === 'security-api')) {
      window.render(currentSecurityPage());
      setTimeout(enhanceView, 0);
    }
  };

  function isSecurityPage(page = currentPage()) {
    return page === 'security-api' || page === 'security-kms';
  }

  function currentSecurityPage() {
    return 'security-api';
  }

  function syncSecurityTabFromPage(page = currentPage()) {
    const next = 'api';
    if (next !== state.securityTab) {
      state.securityTab = next;
      state.selectedKeyId = null;
      state.selectedKeyIds = [];
      state.securityDetailTab = 'overview';
      state.batchKeyMode = 'single';
    } else {
      state.securityTab = next;
    }
  }

  function openModal(type, payload = {}) {
    if (type === 'kms') {
      toast('当前版本暂不开放密钥托管能力');
      return;
    }
    state.modalStep = Number(payload.focusStep) > 0 ? Number(payload.focusStep) : 1;
    state.pendingDelete = type === 'delete' ? payload : null;
    if (type === 'editModel') {
      state.editingModelId = payload.id || null;
      const editing = getEditingModel() || payload;
      seedEditModelSession(editing);
    } else if (type === 'model') {
      state.editingModelId = null;
      state.modalStep = 1;
    }
    const content = $('#x-modal-content');
    const templates = {
      route: () => routeWizard(),
      model: () => modelWizard(false),
      service: () => serviceForm(payload.id || ''),
      editService: () => serviceForm(payload.id || ''),
      role: () => roleForm(),
      editRole: () => roleForm(payload.id),
      keyScene: () => keyScenePickerForm(),
      key: () => keyForm(payload.scene || state.issueKeyScene || 'app'),
      applyKey: () => applyApiKeyForm(payload.scene || 'personal'),
      reviewKeyApply: () => keyApplyDetailForm(payload.id),
      kms: () => kmsForm(),
      member: () => memberForm(payload),
      memberImport: () => memberImportForm(),
      editMember: () => editMemberForm(payload),
      policy: () => policyForm(payload.id || ''),
      alertRule: () => alertRuleForm(payload.id || ''),
      export: () => exportForm(payload.kind || '审计报告'),
      matrix: () => permissionMatrix(),
      editModel: () => editModelForm(payload),
      editApiKey: () => editApiKeyForm(payload),
      distribution: () => distributionModal(payload),
      delete: () => deleteConfirm(payload)
    };
    content.innerHTML = (templates[type] || templates.route)();
    $('.x-dialog', modalLayer).classList.toggle('x-wide', type === 'matrix' || type === 'model' || type === 'editModel' || type === 'distribution' || type === 'key' || type === 'editApiKey' || type === 'applyKey' || type === 'reviewKeyApply' || type === 'role' || type === 'editRole' || type === 'kms');
    if (type === 'key' || type === 'applyKey' || type === 'editApiKey' || type === 'reviewKeyApply') setTimeout(() => { updateKeyQuotaPanel(); updateKeyExpirePanel(); }, 0);
    modalLayer.classList.add('open'); modalLayer.setAttribute('aria-hidden','false');
    if (type === 'model' || type === 'editModel') {
      setTimeout(() => {
        updateModelStepUI();
        if (state.modalStep === 2) updateCapabilityCount();
        if (state.modalStep === 3) refreshPricingPreview();
      }, 0);
    }
    setTimeout(() => {
      syncCustomRangeVisibility(content);
      $('.x-input, .x-select', content)?.focus();
    }, 60);
  }

  function getEditingModel() {
    return state.editingModelId ? state.models.find(m => m.id === state.editingModelId) : null;
  }

  function selectOptions(list, current = '', placeholder = '') {
    const items = placeholder ? [`<option value="">${placeholder}</option>`] : [];
    return items.concat(list.map(item => {
      const value = typeof item === 'string' ? item : item.value;
      const label = typeof item === 'string' ? item : item.label;
      return `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`;
    })).join('');
  }

  const CUSTOM_TIME_RANGE = '自定义时间范围';

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toDateInputValue(date = new Date()) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  /** 展示用：统一到秒 YYYY-MM-DD HH:mm:ss */
  function formatDateTime(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  function nowDateTime() {
    return formatDateTime(new Date());
  }

  function addDaysDateTime(days, from = new Date()) {
    const d = new Date(from);
    d.setDate(d.getDate() + Number(days || 0));
    d.setHours(23, 59, 59, 0);
    return formatDateTime(d);
  }

  function toDateInputValueFromDateTime(value) {
    const s = displayDateTime(value);
    if (!s || s === '—') return '';
    return s.slice(0, 10);
  }

  function parseKeyDate(value) {
    if (!value || value === '—') return null;
    const s = String(value).trim().replace(' ', 'T');
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function isKeyExpired(key) {
    if (!key?.expiresAt || key.expirePreset === 'never') return false;
    const d = parseKeyDate(key.expiresAt);
    return !!(d && d.getTime() < Date.now());
  }

  function keyExpiryLabel(key) {
    if (!key || !key.expiresAt || key.expirePreset === 'never') return '永不过期';
    return displayDateTime(key.expiresAt);
  }

  function keyStatusLabel(key) {
    if (!key) return '健康';
    if (key.status === '已吊销' || key.status === '已禁用' || key.status === '已撤销') return '已吊销';
    if (key.status === '已暂停' || key.status === '暂停' || key.status === '已停用' || key.status === '停用') return '已停用';
    if (isKeyExpired(key)) return '已过期';
    return key.status || '健康';
  }
  function keyLifecycleHint() {
    return '虚拟 Key 生命周期：创建 → 轮换 → 启用/停用 → 删除 / 过期';
  }

  function keyEnableToggleHtml(key, { compact = false } = {}) {
    if (!key || keyStatusLabel(key) === '已吊销') return '';
    const on = keyStatusLabel(key) !== '已停用';
    const label = on ? '启用中，点击停用' : '已停用，点击启用';
    return `<span class="x-key-enable${compact ? ' is-compact' : ''}" title="${label}">
      <em>${on ? '启用' : '停用'}</em>
      <button type="button" class="x-toggle ${on ? 'on' : ''}" data-x="toggle-key" data-id="${key.id}" aria-label="${label}" aria-pressed="${on ? 'true' : 'false'}"></button>
    </span>`;
  }

  function keyExpirePresetOptionsHtml(selected = '90d') {
    const opts = [
      ['7d', '7 天'],
      ['30d', '30 天'],
      ['90d', '90 天'],
      ['180d', '180 天'],
      ['365d', '1 年'],
      ['custom', '自定义到期日'],
      ['never', '永不过期']
    ];
    return opts.map(([id, label]) => `<option value="${id}" ${selected === id ? 'selected' : ''}>${label}</option>`).join('');
  }

  function keyExpireFieldsHtml({ preset = '90d', expiresAt = '', required = true } = {}) {
    const cur = preset || (expiresAt ? 'custom' : '90d');
    const dateVal = toDateInputValueFromDateTime(expiresAt) || (() => {
      const d = new Date();
      d.setDate(d.getDate() + 90);
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    })();
    return `<div class="x-field"><label ${required ? 'class="x-required"' : ''}>有效期</label>
      <select class="x-select" name="keyExpirePreset" data-x="key-expire-preset">${keyExpirePresetOptionsHtml(cur)}</select>
      <span class="x-help">到期后拒绝调用；可在更新时延期</span>
    </div>
    <div class="x-field" data-key-expire-custom ${cur === 'custom' ? '' : 'hidden'}>
      <label ${required ? 'class="x-required"' : ''}>到期日</label>
      <input class="x-input x-date-input" name="keyExpiresAt" type="date" value="${dateVal}">
      <span class="x-help">当天 23:59:59 失效</span>
    </div>`;
  }

  function readKeyExpiryFromForm(fallback = {}) {
    const preset = $('[name="keyExpirePreset"]', modalLayer)?.value || fallback.expirePreset || '90d';
    if (preset === 'never') return { expirePreset: 'never', expiresAt: '' };
    if (preset === 'custom') {
      const date = $('[name="keyExpiresAt"]', modalLayer)?.value || '';
      if (!date) return { expirePreset: 'custom', expiresAt: '', invalid: true };
      return { expirePreset: 'custom', expiresAt: `${date} 23:59:59` };
    }
    const days = Number(String(preset).replace('d', ''));
    if (!Number.isFinite(days) || days <= 0) return { expirePreset: '90d', expiresAt: addDaysDateTime(90) };
    return { expirePreset: preset, expiresAt: addDaysDateTime(days) };
  }

  function updateKeyExpirePanel() {
    const preset = $('[name="keyExpirePreset"]', modalLayer)?.value || '90d';
    const custom = $('[data-key-expire-custom]', modalLayer);
    if (custom) custom.hidden = preset !== 'custom';
  }

  /** 任意存量时间字段规范化到秒级展示 */
  function displayDateTime(value) {
    if (value == null || value === '' || value === '—') return '—';
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s)) {
      const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
      return Number.isNaN(d.getTime()) ? s.slice(0, 19) : formatDateTime(d);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00`;
    if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return `2026-11-04 ${s}`;
    const parsed = new Date(s.replace(/-/g, '/'));
    if (!Number.isNaN(parsed.getTime())) return formatDateTime(parsed);
    return s;
  }

  function ensureCustomRangeDefaults(target = state.usageFilters) {
    if (!target.customEnd) target.customEnd = toDateInputValue();
    if (!target.customStart) {
      const start = new Date();
      start.setDate(start.getDate() - 6);
      target.customStart = toDateInputValue(start);
    }
  }

  function grainPresets(grain = 'day') {
    if (grain === 'week') return ['本周', '近 4 周', '近 12 周'];
    if (grain === 'month') return ['本月', '近 3 月', '近 12 月'];
    return ['今日', '近 7 天', '近 30 天'];
  }

  function defaultPeriodForGrain(grain = 'day') {
    if (grain === 'week') return '近 12 周';
    if (grain === 'month') return '近 12 月';
    return '近 7 天';
  }

  function filtersForTimeName(name) {
    // billing 已并入 usage，时间控件统一写 usageFilters
    if (name === 'audit') {
      if (!state.auditFilters) state.auditFilters = { period: '最近 24 小时', result: '', keyword: '', customStart: '', customEnd: '' };
      return state.auditFilters;
    }
    return state.usageFilters;
  }

  function timeRangeSelectHtml({
    name = 'default',
    selected = '近 7 天',
    selectClass = 'x-select',
    start = '',
    end = '',
    extras = [],
    grain = 'day'
  } = {}) {
    const filter = filtersForTimeName(name);
    ensureCustomRangeDefaults(filter);
    const current = selected || defaultPeriodForGrain(grain);
    const startValue = start || filter.customStart;
    const endValue = end || filter.customEnd;
    const presets = grainPresets(grain);
    const middle = extras.filter(item => !presets.includes(item) && item !== CUSTOM_TIME_RANGE);
    const unique = [...presets, ...middle, CUSTOM_TIME_RANGE];
    return `<select class="${selectClass}" data-time-range="${name}">${unique.map(item => `<option value="${item}" ${item === current ? 'selected' : ''}>${item}</option>`).join('')}</select>
      <div class="x-custom-range" data-custom-range="${name}" ${current === CUSTOM_TIME_RANGE ? '' : 'hidden'}>
        <input class="x-input x-date-input" type="date" data-time-start="${name}" value="${startValue}">
        <em>至</em>
        <input class="x-input x-date-input" type="date" data-time-end="${name}" value="${endValue}">
      </div>`;
  }

  function syncCustomRangeVisibility(scope = document) {
    $$('[data-time-range]', scope).forEach(select => {
      const panel = scope.querySelector?.(`[data-custom-range="${select.dataset.timeRange}"]`) || $(`[data-custom-range="${select.dataset.timeRange}"]`);
      if (panel) panel.hidden = select.value !== CUSTOM_TIME_RANGE;
    });
  }

  function resolvePeriodRange(period, customStart, customEnd) {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (period === CUSTOM_TIME_RANGE) {
      const s = customStart ? new Date(`${customStart}T00:00:00`) : new Date(start);
      const e = customEnd ? new Date(`${customEnd}T23:59:59`) : new Date(end);
      return { start: s, end: e };
    }
    if (period === '今日' || period === '最近 24 小时') return { start, end };
    if (period === '近 7 天') { start.setDate(start.getDate() - 6); return { start, end }; }
    if (period === '近 30 天') { start.setDate(start.getDate() - 29); return { start, end }; }
    if (period === '本周') {
      const day = start.getDay() || 7;
      start.setDate(start.getDate() - (day - 1));
      return { start, end };
    }
    if (period === '近 4 周' || period === '近 12 周') {
      const weeks = period === '近 12 周' ? 12 : 4;
      const day = start.getDay() || 7;
      start.setDate(start.getDate() - (day - 1) - (weeks - 1) * 7);
      return { start, end };
    }
    if (period === '本月') { start.setDate(1); return { start, end }; }
    if (period === '近 3 月' || period === '近 12 月') {
      const months = period === '近 12 月' ? 12 : 3;
      start.setMonth(start.getMonth() - (months - 1), 1);
      return { start, end };
    }
    // 兼容旧默认
    start.setDate(start.getDate() - 6);
    return { start, end };
  }

  function formatShortDate(date) {
    const d = new Date(date);
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function formatFullDate(date) {
    return formatDateTime(date);
  }

  function periodLabelText(period, start, end) {
    const range = resolvePeriodRange(period, start, end);
    return `${formatDateTime(range.start)} ~ ${formatDateTime(range.end)}`;
  }

  function periodLabelShort(period, start, end) {
    const range = resolvePeriodRange(period, start, end);
    return `${formatShortDate(range.start)} ~ ${formatShortDate(range.end)}`;
  }

  function grainSwitchHtml(name, grain = 'day') {
    const items = [
      { id: 'day', label: '日' },
      { id: 'week', label: '周' },
      { id: 'month', label: '月' }
    ];
    return `<div class="x-grain-switch" data-grain-group="${name}">${items.map(item => `
      <button type="button" class="${grain === item.id ? 'active' : ''}" data-x="set-grain" data-grain-target="${name}" data-grain="${item.id}">${item.label}</button>
    `).join('')}</div>`;
  }

  function deleteConfirm(payload) {
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">删除${payload.label || '配置'}</h2><p>此操作会立即从当前列表移除，并写入本地配置。</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div><div class="x-dialog-body"><div class="x-delete-warning"><strong>${payload.name || '所选项目'}</strong><span>删除后无法从页面恢复；生产环境应由后端执行依赖检查并保留审计记录。</span></div></div><div class="x-dialog-foot"><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn x-danger" data-x="confirm-delete">确认删除</button></div></div>`;
  }

  function openDrawer(type) {
    const templates = {
      filter: filterDrawer(),
      'usage-filter': usageFilterDrawer(),
      'service-detail-filter': serviceDetailFilterDrawer(),
      'model-detail-more': modelDetailMoreDrawer(),
      notifications: notificationDrawer(),
      costs: costDrawer(),
      audit: auditDrawer()
    };
    $('#x-drawer-content').innerHTML = templates[type] || templates.filter;
    drawerLayer.classList.add('open'); drawerLayer.setAttribute('aria-hidden','false');
    syncCustomRangeVisibility(drawerLayer);
  }

  function routeWizard() {
    const focus = ensureRouteFocus();
    const prefix = focus.audience === 'personal' ? '/personal/v1' : '/app/v1';
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">追加路径</h2><p>默认挂到当前选中的「${audienceLabel(focus.audience)} · ${envLabel(focus.env)}」入口下</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body">
        <div class="x-form-grid">
          <div class="x-field full"><label class="x-required">名称</label><input class="x-input" name="routeName" placeholder="例如：批处理入口"><span class="x-error">请输入名称</span></div>
          <div class="x-field"><label class="x-required">开放对象</label><select class="x-select" name="routeAudience"><option value="app" ${focus.audience === 'app' ? 'selected' : ''}>应用</option><option value="personal" ${focus.audience === 'personal' ? 'selected' : ''}>个人</option></select></div>
          <div class="x-field"><label class="x-required">环境</label><select class="x-select" name="routeEnv"><option value="prod" ${focus.env === 'prod' ? 'selected' : ''}>生产</option><option value="test" ${focus.env === 'test' ? 'selected' : ''}>测试</option></select></div>
          <div class="x-field full"><label class="x-required">路径</label><input class="x-input" name="routePath" value="${prefix}/batch" placeholder="${prefix}/..."><span class="x-help">完整地址 = 对应环境域名 + 路径；不可与同环境已有路径重复</span><span class="x-error">请输入以 / 开头的路径</span></div>
          <div class="x-field"><label>所属部门</label><select class="x-select" name="routeWorkspace">${memberDepartments.filter(d => d && d !== '未分配').map(d => `<option>${d}</option>`).join('')}</select></div>
          <div class="x-field"><label>最大 QPS</label><input class="x-input" name="routeQps" type="number" value="500" min="1"></div>
          <div class="x-field"><label>超时（秒）</label><input class="x-input" name="routeTimeout" type="number" value="${focus.env === 'test' ? 60 : 30}" min="1"></div>
        </div>
      </div>
      <div class="x-dialog-foot"><span class="x-muted">标准四类网关入口保持不变</span><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn primary" data-x="save-route">追加</button></div></div>`;
  }

  const modelCapabilities = [
    ['输入模态','文本输入'],['输入模态','图片输入'],['输入模态','音频输入'],['输入模态','视频输入'],['输入模态','文件输入'],
    ['输出模态','文本输出'],['输出模态','图片生成'],['输出模态','语音输出'],['输出模态','视频生成'],
    ['生成能力','流式输出'],['生成能力','深度思考 / 推理'],['生成能力','工具 / Function Calling'],['生成能力','JSON 结构化输出'],['生成能力','Logprobs'],
    ['平台能力','上下文缓存'],['平台能力','批量推理'],['平台能力','Embedding 向量化'],['平台能力','Rerank 重排序'],['平台能力','模型微调'],['平台能力','系统提示词']
  ];

  function proxyServiceOptions(selected = '') {
    if (!state.services.length) return '<option value="">暂无模型服务，请先创建</option>';
    return `<option value="">请选择对外模型服务</option>${state.services.map(s => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${s.name} · ${s.serviceId}</option>`).join('')}`;
  }

  function serviceForm(serviceId = '') {
    const service = serviceId ? state.services.find(s => s.id === serviceId) : null;
    const modalities = ['对话 / 推理','对话 / 多模态','对话 / 检索增强','向量化','重排序','图像生成','语音','其他'];
    const protocols = ['OpenAI · Chat Completions','OpenAI · Responses API','OpenAI · Embeddings','Anthropic · Messages API','Ollama API','vLLM / TGI','自定义'];
    const hosting = service?.hosting === 'local' ? 'local' : 'saas';
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">${service ? '编辑模型服务' : '创建模型服务'}</h2><p>先区分 SaaS / 本地，再定义对外统一服务名；源模型需稍后绑定</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body"><div class="x-form-grid">
        <div class="x-field full"><label class="x-required">模型部署类型</label>
          <div class="x-scene-cards" style="grid-template-columns:1fr 1fr;gap:10px">
            <label class="x-scene-card ${hosting === 'saas' ? 'active' : ''}" style="cursor:pointer">
              <input type="radio" name="serviceHosting" value="saas" ${hosting === 'saas' ? 'checked' : ''} hidden>
              <strong>SaaS 模型</strong>
              <p class="x-muted" style="margin:6px 0 0;font-size:12px;line-height:1.5">公有云 / 厂商托管 API，请求可能出域，需配数据出域与内容安全策略</p>
            </label>
            <label class="x-scene-card ${hosting === 'local' ? 'active' : ''}" style="cursor:pointer">
              <input type="radio" name="serviceHosting" value="local" ${hosting === 'local' ? 'checked' : ''} hidden>
              <strong>本地模型</strong>
              <p class="x-muted" style="margin:6px 0 0;font-size:12px;line-height:1.5">VPC / 机房自建推理（vLLM、Ollama 等），侧重端点访问与资源治理</p>
            </label>
          </div>
        </div>
        <div class="x-field"><label class="x-required">服务显示名称</label><input class="x-input" name="serviceName" value="${service?.name || ''}" placeholder="例如：DeepSeek V4 / 通义千问 · 本地"><span class="x-error">请输入服务显示名称</span></div>
        <div class="x-field"><label class="x-required">服务标识</label><input class="x-input" name="serviceId" value="${service?.serviceId || ''}" placeholder="例如：deepseek-v4" ${service ? 'readonly' : ''}><span class="x-help">${service ? '标识创建后不可修改' : '调用方请求中的 model 字段'}</span><span class="x-error">请输入服务标识</span></div>
        <div class="x-field"><label class="x-required">能力类型</label><select class="x-select" name="serviceModality">${modalities.map(m => `<option ${ (service?.modality || '对话 / 推理') === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="x-field"><label>对外协议偏好</label><select class="x-select" name="serviceProtocol">${protocols.map(p => `<option ${ (service?.protocol || protocols[0]) === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="x-field full"><label>服务说明</label><textarea class="x-textarea" name="serviceDesc" placeholder="说明该服务面向的业务场景、能力边界…">${service?.desc || ''}</textarea></div>
        ${service ? `<div class="x-field"><label>启用状态</label><select class="x-select" name="serviceEnabled"><option value="1" ${service.enabled !== false ? 'selected' : ''}>启用</option><option value="0" ${service.enabled === false ? 'selected' : ''}>停用</option></select></div>` : ''}
      </div><div class="x-test-result show" style="margin-top:14px"><span>SaaS 与本地服务可共用对外服务名体系，但安全策略按部署类型分别生效</span><b>分类治理</b></div></div>
      <div class="x-dialog-foot"><span class="x-muted">一个服务可绑定多个同类源模型，由分发策略选择</span><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn primary" data-x="save-service" data-service-id="${service?.id || ''}">${service ? '保存修改' : '创建服务'}</button></div></div>`;
  }

  function memberForm() {
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">添加成员</h2><p>加入企业成员池后，可再分配到部门并设置角色</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body"><div class="x-form-grid">
        <div class="x-field"><label class="x-required">姓名</label><input class="x-input" name="memberName" placeholder="企业内部展示名"><span class="x-error">请输入姓名</span></div>
        <div class="x-field"><label class="x-required">手机号</label><input class="x-input" name="memberPhone" placeholder="11 位手机号"><span class="x-help">用于登录与身份识别</span><span class="x-error">请输入手机号</span></div>
        <div class="x-field"><label>所属部门</label><select class="x-select" name="memberDept">${memberDepartments.map(d=>`<option>${d}</option>`).join('')}</select></div>
        <div class="x-field"><label>角色</label><select class="x-select" name="memberRole">${memberRoles().map(r=>`<option ${r==='普通用户'?'selected':''}>${r}</option>`).join('')}</select></div>
        <div class="x-field"><label>预算类型</label><select class="x-select" name="memberBudgetType" data-x="budget-type"><option>不限制</option><option>按天</option><option>按月</option></select></div>
        <div class="x-field" id="x-budget-field"><label>预算额度（元）</label><input class="x-input" name="memberBudget" type="number" placeholder="留空表示跟随部门预算" disabled><span class="x-help">不包含 Token Plan 席位，仅控制调用消耗上限</span></div>
      </div></div>
      <div class="x-dialog-foot"><span class="x-muted">新成员默认状态为待激活，首次登录后自动激活</span><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn primary" data-x="save-member">添加成员</button></div></div>`;
  }

  function memberImportForm() {
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">批量导入成员</h2><p>下载模板填写后上传，单次最多 500 条</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body">
        <div class="x-import-steps">
          <div><strong>1. 下载模板</strong><p>按姓名、手机号、部门、角色列填写</p><button class="btn" data-x="download-member-template">下载 CSV 模板</button></div>
          <div><strong>2. 上传文件</strong><p>支持 CSV，系统校验后写入成员池</p><label class="x-upload"><input type="file" accept=".csv,text/csv" id="x-member-file" hidden><span>选择文件</span></label><small id="x-member-file-name" class="x-muted">未选择文件</small></div>
        </div>
        <div class="x-test-result show" style="margin-top:14px"><span>不会导入 Token Plan 席位信息，仅同步成员与部门角色</span><b>企业成员池</b></div>
      </div>
      <div class="x-dialog-foot"><span class="x-muted">重复手机号会自动跳过</span><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn primary" data-x="confirm-member-import">开始导入</button></div></div>`;
  }

  function editMemberForm(payload = {}) {
    const member = state.members.find(m => m.id === payload.id) || payload;
    state.editingMemberId = member.id || null;
    const budgetValue = member.budgetType === '按天' ? (member.dayBudget || '') : member.budgetType === '按月' ? (member.monthBudget || '') : '';
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">编辑成员</h2><p>${member.name || ''} · ${member.userId || ''}</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body"><div class="x-form-grid">
        <div class="x-field"><label class="x-required">姓名</label><input class="x-input" name="memberName" value="${member.name || ''}"><span class="x-error">请输入姓名</span></div>
        <div class="x-field"><label>手机号</label><input class="x-input" value="${member.phone || ''}" disabled><span class="x-help">手机号创建后不可修改</span></div>
        <div class="x-field"><label>所属部门</label><select class="x-select" name="memberDept">${memberDepartments.map(d=>`<option ${d===(member.dept||'')?'selected':''}>${d}</option>`).join('')}</select></div>
        <div class="x-field"><label>角色</label><select class="x-select" name="memberRole">${memberRoles().map(r=>`<option ${r===(member.role||'')?'selected':''}>${r}</option>`).join('')}</select></div>
        <div class="x-field"><label>预算类型</label><select class="x-select" name="memberBudgetType" data-x="budget-type"><option ${member.budgetType==='不限制'?'selected':''}>不限制</option><option ${member.budgetType==='按天'?'selected':''}>按天</option><option ${member.budgetType==='按月'?'selected':''}>按月</option></select></div>
        <div class="x-field" id="x-budget-field"><label>预算额度（元）</label><input class="x-input" name="memberBudget" type="number" value="${budgetValue}" ${member.budgetType==='不限制'?'disabled':''}><span class="x-help">按天/按月消耗上限，用完即止</span></div>
        <div class="x-field"><label>状态</label><select class="x-select" name="memberStatus"><option ${member.status==='已激活'?'selected':''}>已激活</option><option ${member.status==='待激活'?'selected':''}>待激活</option><option ${member.status==='已禁用'?'selected':''}>已禁用</option></select></div>
      </div></div>
      <div class="x-dialog-foot"><span class="x-muted">禁用后 API Key 将停止调用，成员仍保留在企业中</span><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn primary" data-x="update-member">保存更改</button></div></div>`;
  }

  function modelWizard(isEdit = false) {
    const editing = isEdit ? getEditingModel() : null;
    const startStep = Math.min(Math.max(state.modalStep || 1, 1), 4);
    const subtitle = isEdit
      ? (startStep === 3
        ? `${editing?.sourceModel || editing?.name || '源模型'} · 已缓存的服务信息与 Key 将自动沿用，此处只需补计费`
        : `${editing?.sourceModel || editing?.name || '源模型'} · 未改动的项自动沿用系统已存配置`)
      : '绑定对外服务，填写上游凭证，并声明能力与计费价格';
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">${isEdit ? (startStep === 3 ? '编辑计费' : '编辑源模型') : '接入源模型能力'}</h2><p>${subtitle}</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body"><div class="x-steps four"><div class="x-step active" data-model-step="1"><span>1</span>服务信息</div><div class="x-step" data-model-step="2"><span>2</span>能力声明</div><div class="x-step" data-model-step="3"><span>3</span>计费配置</div><div class="x-step" data-model-step="4"><span>4</span>${isEdit ? '确认保存' : '确认接入'}</div></div><div id="x-model-panel">${modelStep(startStep)}</div></div>
      <div class="x-dialog-foot"><span class="x-muted" id="x-model-hint">第 ${startStep} 步，共 4 步</span><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn" data-x="model-prev" style="${startStep === 1 ? 'display:none' : ''}">上一步</button><button class="btn" data-x="model-next" style="${startStep === 4 ? 'display:none' : ''}">下一步</button><button class="btn primary" data-x="model-save" style="${isEdit || startStep >= 3 ? '' : 'display:none'}">保存</button></div></div>`;
  }

  function modelStep(step) {
    const editing = getEditingModel();
    let sessionPrices = null;
    try { sessionPrices = JSON.parse(sessionStorage.getItem('modelPrices') || 'null'); } catch { sessionPrices = null; }
    const prices = hasConfiguredPrices(sessionPrices) ? sessionPrices : (editing?.prices || {});
    let sessionCaps = null;
    try { sessionCaps = JSON.parse(sessionStorage.getItem('modelCapabilities') || 'null'); } catch { sessionCaps = null; }
    const caps = (sessionCaps && typeof sessionCaps === 'object' && Object.keys(sessionCaps).length)
      ? sessionCaps
      : (editing?.capabilities || {});
    const reuseKey = !!(editing && sourceHasStoredCredential(editing));
    const protocols = ['OpenAI · Chat Completions','OpenAI · Responses API','Anthropic · Messages API','Google · GenerateContent','Azure OpenAI','Ollama API','vLLM / TGI','自定义 HTTP 协议'];
    const providers = ['腾讯云','阿里云','世纪互联','火山引擎','百度智能云','华为云','OpenAI','Anthropic','Google Cloud','Azure OpenAI','自建集群 / 其他','DeepSeek','Google'];
    const regions = ['华东（上海）','华北（北京）','华南（深圳）','亚太','北美'];
    const healthChecks = ['每 30 秒','每 60 秒','每 5 分钟'];
    if (step === 1) return `<div class="x-form-grid">
      <div class="x-field"><label class="x-required">协议类型</label><select class="x-select" name="protocolType">${selectOptions(protocols, editing?.protocol || '', '请选择协议')}</select><span class="x-error">请选择协议类型</span></div>
      <div class="x-field"><label class="x-required">服务商名称</label><select class="x-select" name="providerName">${selectOptions(providers, editing?.provider || '', '请选择服务商')}</select><span class="x-error">请选择服务商</span></div>
      <div class="x-field full"><label class="x-required">Base URL</label><input class="x-input" name="baseUrl" value="${editing?.baseUrl || ''}" placeholder="https://api.deepseek.com/v1"><span class="x-help">OpenAI 兼容上游地址（须真实可达）。接入前会探测 /models 与 chat/completions</span><span class="x-error">请输入 Base URL</span></div>
      <div class="x-field full"><label class="${reuseKey ? '' : 'x-required'}">上游 API Key</label><input class="x-input" name="upstreamApiKey" type="password" value="" placeholder="${reuseKey ? '已保存在网关，留空则沿用原 Key' : '服务商签发的真实 API Key'}" autocomplete="off"><span class="x-help">${reuseKey ? '网关已缓存该源的上游凭证；仅在轮换 Key 时重新填写。留空将沿用原值。' : '仅提交给本地网关做连通性校验与转发，不会明文落在列表页'}</span><span class="x-error">请输入上游 API Key</span></div>
      <div class="x-field"><label class="x-required">源模型名称</label><input class="x-input" name="sourceModelName" value="${editing?.sourceModel || ''}" placeholder="例如：deepseek-chat"><span class="x-help">服务商接口中真实使用的 model 参数</span><span class="x-error">请输入源模型名称</span></div>
      <div class="x-field"><label class="x-required">绑定模型服务</label><select class="x-select" name="proxyServiceRef">${proxyServiceOptions(editing?.serviceRef || sessionStorage.getItem('preselectService') || '')}</select><span class="x-help">选择平台对外提供的服务名；若无可选项，请先创建模型服务。</span><span class="x-error">请选择要绑定的模型服务</span></div>
      ${state.services.length ? '' : `<div class="x-field full"><div class="x-empty-service"><strong>暂无可用模型服务</strong><p>源模型必须绑定一个已创建的对外服务名，请先完成「模型服务配置」。</p><button class="btn primary" type="button" data-x="goto-create-service">去创建模型服务</button></div></div>`}
      <div class="x-field"><label>部署区域</label><select class="x-select" name="region">${selectOptions(regions, editing?.region || '华东（上海）')}</select></div>
      <div class="x-field"><label>健康检查</label><select class="x-select" name="healthCheck">${selectOptions(healthChecks, editing?.healthCheck || '每 30 秒')}</select></div>
      <div class="x-field"><label>请求超时（秒）</label><input class="x-input" name="timeout" type="number" value="${editing?.timeout || 30}"></div>
      <div class="x-field"><label>最大并发</label><input class="x-input" name="concurrency" type="number" value="${editing?.concurrency || 500}"></div>
      <div class="x-field"><label>重试次数</label><input class="x-input" name="retries" type="number" value="${editing?.retries || 2}"></div>
      <div class="x-field"><label>熔断阈值（%）</label><input class="x-input" name="circuit" type="number" value="${editing?.circuit || 5}"></div>
      <div class="x-field full"><button class="btn" data-x="test-model">测试连接并校验上游</button><div class="x-test-result" id="x-connect-result" style="margin-top:9px"><span>${reuseKey ? '已缓存上游凭证；未改连接信息时可直接下一步，系统将沿用原配置' : '请先填写 Base URL / API Key / 源模型，再点击测试'}</span><b>${reuseKey ? '可沿用' : '未探测'}</b></div><span class="x-help">${reuseKey ? '仅当修改 Base URL、源模型或 Key 时才需要重新探测；真实 chat 探测会产生下游费用并记入用量' : '下一步与最终接入都会强制真实探测；探测失败不可接入，成功探测的 Token/费用会计入用量明细'}</span></div>
    </div>`;
    if (step === 2) {
      const customCap = sessionStorage.getItem('modelCustomCapabilities');
      const customText = customCap != null ? customCap : (editing?.customCapabilities || '');
      return `<div class="x-cap-head"><div><strong>完整模型能力清单</strong><p>每项能力都必须明确标记，避免网关错误路由不受支持的请求。</p></div><div class="x-cap-template"><label>套用模板</label><select class="x-select" data-x="cap-template"><option value="">请选择</option><option value="text">纯文本对话</option><option value="vision">多模态理解</option><option value="embedding">Embedding / Rerank</option></select></div></div><div class="x-cap-status"><span id="x-cap-count">已声明 0 / ${modelCapabilities.length}</span><b>所有项目必须完成</b></div><div class="x-capability-grid">${modelCapabilities.map(([group,name],i)=>`<div class="x-cap-row"><span>${group}</span><strong>${name}</strong><select class="x-select x-cap-select" data-capability="${name}" data-index="${i}"><option value="">请选择状态</option><option value="supported" ${caps[name]==='supported'?'selected':''}>支持</option><option value="limited" ${caps[name]==='limited'?'selected':''}>受限支持</option><option value="unsupported" ${caps[name]==='unsupported'?'selected':''}>不支持</option></select></div>`).join('')}</div><div class="x-field full" style="margin-top:14px"><label>自定义能力补充</label><textarea class="x-textarea" name="customCapabilities" placeholder="可填写厂商特有能力、限制条件、最大图片尺寸、音频时长等…">${customText}</textarea></div><div class="x-test-result" id="x-cap-error" style="margin-top:10px;border-color:#efc4c7;background:#fff7f7;color:#b55056"><span>请完成所有能力声明后继续</span><b>未完成</b></div>`;
    }
    if (step === 3) {
      const configured = hasConfiguredPrices(prices);
      let timePricing = prices.timePricing === true || prices.timePricing === 'true';
      if (prices.timePricing == null && (Array.isArray(prices.timeSegments) || prices.busyInput != null || prices.idleInput != null)) timePricing = true;
      const holidaySeparate = prices.holidaySeparate === true || prices.holidaySeparate === 'true'
        || (prices.holidaySeparate == null && prices.holidayPolicyCode === 'custom');
      const blank = v => (v == null || v === '' ? '' : v);
      const flatInput = configured ? blank(prices.flatInput ?? prices.busyInput) : '';
      const flatOutput = configured ? blank(prices.flatOutput ?? prices.busyOutput) : '';
      const flatCache = configured ? blank(prices.flatCache ?? prices.busyCache) : '';
      const segments = normalizeTimeSegments(prices);
      const p = {
        discount: configured ? (blank(prices.discount) || '100') : '100',
        flatInput,
        flatOutput,
        flatCache,
        holidayInput: configured ? blank(prices.holidayInput ?? flatInput) : '',
        holidayOutput: configured ? blank(prices.holidayOutput ?? flatOutput) : '',
        holidayCache: configured ? blank(prices.holidayCache ?? flatCache) : '',
        currency: prices.currency || 'CNY · 人民币',
        billingUnit: prices.billingUnit || '每 1M Tokens',
        priceNote: prices.priceNote || '',
        holidayPolicy: prices.holidayPolicyCode || (holidaySeparate ? 'custom' : 'time'),
        timePricing,
        holidaySeparate,
        timeSegments: segments
      };
      return `<div class="x-form-grid">
        <div class="x-field"><label class="x-required">计费币种</label><select class="x-select" name="currency">${selectOptions(['CNY · 人民币','USD · 美元'], p.currency)}</select></div>
        <div class="x-field"><label class="x-required">计费单位</label><select class="x-select" name="billingUnit">${selectOptions(['每 1M Tokens','每 1K Tokens'], p.billingUnit)}</select></div>
        <div class="x-field"><label class="x-required">采购折扣</label><input class="x-input x-price-input" name="discount" type="number" min="0" max="100" value="${p.discount}"><span class="x-help">默认 100%（不打折）；85 表示按标价的 85% 结算</span><span class="x-error">请输入折扣</span></div>
        <div class="x-field full"><label>单价说明</label><input class="x-input" name="priceNote" value="${p.priceNote}"></div>
      </div>
      <div class="x-price-mode">
        <div class="x-price-mode-head"><strong>结算价模式</strong><span>分时段为可选项；可用断点组合任意时段</span></div>
        <div class="x-price-mode-tabs">
          <button type="button" class="${!p.timePricing ? 'active' : ''}" data-x="pricing-mode" data-mode="flat"><b>统一价格</b><span>不考虑时段，一处填写即可</span></button>
          <button type="button" class="${p.timePricing ? 'active' : ''}" data-x="pricing-mode" data-mode="timed"><b>分时段计价</b><span>按断点切分全天，每段单独定价</span></button>
        </div>
        <input type="hidden" name="timePricing" value="${p.timePricing ? 'true' : 'false'}">
      </div>
      <section class="x-price-period flat" data-price-panel="flat" ${p.timePricing ? 'hidden' : ''}>
        <div class="x-price-title"><div><span>FLAT</span><strong>统一结算价</strong></div><span class="event-chip green">全天适用</span></div>
        <div class="x-form-grid three">
          <div class="x-field"><label class="x-required">输入 Token</label><input class="x-input x-price-input" name="flatInputPrice" type="number" step="0.01" value="${p.flatInput}"><span class="x-error">请输入</span></div>
          <div class="x-field"><label class="x-required">输出 Token</label><input class="x-input x-price-input" name="flatOutputPrice" type="number" step="0.01" value="${p.flatOutput}"><span class="x-error">请输入</span></div>
          <div class="x-field"><label class="x-required">缓存命中</label><input class="x-input x-price-input" name="flatCachePrice" type="number" step="0.01" value="${p.flatCache}"><span class="x-error">请输入</span></div>
        </div>
      </section>
      <div class="x-price-periods x-price-segments" data-price-panel="timed" ${p.timePricing ? '' : 'hidden'}>
        ${timeSegmentsEditorHtml(segments)}
      </div>
      <section class="x-holiday-pricing">
        <div class="x-price-title">
          <div><span>HOLIDAY</span><strong>法定节假日与调休</strong></div>
          <label class="ov-switch"><input type="checkbox" name="holidaySeparate" data-x="holiday-separate" ${p.holidaySeparate ? 'checked' : ''}> 使用独立节假日价</label>
        </div>
        <div data-holiday-fields ${p.holidaySeparate ? '' : 'hidden'}>
          <div class="x-form-grid">
            <div class="x-field"><label>日历来源</label><select class="x-select" name="holidayCalendar"><option>国务院办公厅节假日与调休日历</option><option>企业自定义日历</option><option>不使用节假日日历</option></select></div>
            <div class="x-field"><label>节假日策略</label><select class="x-select" name="holidayPolicy">
              <option value="custom" ${p.holidayPolicy==='custom'?'selected':''}>法定节假日使用独立价格</option>
              <option value="idle" ${p.holidayPolicy==='idle'?'selected':''}>法定节假日全天按闲时 / 统一价</option>
              <option value="time" ${p.holidayPolicy==='time'?'selected':''}>仍按分时段 / 统一价</option>
            </select></div>
          </div>
          <div class="x-form-grid three" style="margin-top:12px">
            <div class="x-field"><label class="x-required">输入 Token</label><input class="x-input x-price-input" name="holidayInputPrice" type="number" step="0.01" value="${p.holidayInput}"></div>
            <div class="x-field"><label class="x-required">输出 Token</label><input class="x-input x-price-input" name="holidayOutputPrice" type="number" step="0.01" value="${p.holidayOutput}"></div>
            <div class="x-field"><label class="x-required">缓存命中</label><input class="x-input x-price-input" name="holidayCachePrice" type="number" step="0.01" value="${p.holidayCache}"></div>
          </div>
        </div>
        <p class="x-help" data-holiday-hint ${p.holidaySeparate ? 'hidden' : ''}>未开启独立节假日价时，节假日沿用上方结算价，无需重复填写。</p>
      </section>
      <div class="x-price-preview" id="x-price-preview">${pricingPreview(p)}</div>`;
    }
    const draft = JSON.parse(sessionStorage.getItem('modelDraft') || '{}');
    const savedPrices = JSON.parse(sessionStorage.getItem('modelPrices') || '{}');
    const counts = JSON.parse(sessionStorage.getItem('modelCapabilityCounts') || '{"supported":0,"limited":0,"unsupported":0}');
    const bound = state.services.find(s => s.id === draft.proxyServiceRef);
    const priceTri = (inp, out, cache) => `输入 ¥${inp || 0} · 输出 ¥${out || 0} · 缓存 ¥${cache || 0}`;
    const timed = savedPrices.timePricing === true || savedPrices.timePricing === 'true';
    const holidayOn = savedPrices.holidaySeparate === true || savedPrices.holidaySeparate === 'true';
    const reviewSegments = timed ? normalizeTimeSegments(savedPrices) : [];
    const segmentRows = reviewSegments.map(seg =>
      `<div class="x-summary-row"><span>${seg.name} ${seg.start}–${seg.end}</span><b>${priceTri(seg.input, seg.output, seg.cache)}</b></div>`
    ).join('');
    const priceRows = timed
      ? `<div class="x-summary-row"><span>模式</span><b>分时段计价 · ${reviewSegments.length} 段</b></div>
         <div class="x-summary-row"><span>采购折扣</span><b>${savedPrices.discount || 100}%</b></div>
         ${segmentRows}
         <div class="x-summary-row"><span>法定节假日</span><b>${holidayOn ? `${savedPrices.holidayPolicy || '独立价格'} · ${priceTri(savedPrices.holidayInput, savedPrices.holidayOutput, savedPrices.holidayCache)}` : '沿用分时段结算价'}</b></div>`
      : `<div class="x-summary-row"><span>模式</span><b>统一价格</b></div>
         <div class="x-summary-row"><span>采购折扣</span><b>${savedPrices.discount || 100}%</b></div>
         <div class="x-summary-row"><span>统一结算价</span><b>${priceTri(savedPrices.flatInput || savedPrices.busyInput, savedPrices.flatOutput || savedPrices.busyOutput, savedPrices.flatCache || savedPrices.busyCache)}</b></div>
         <div class="x-summary-row"><span>法定节假日</span><b>${holidayOn ? `${savedPrices.holidayPolicy || '独立价格'} · ${priceTri(savedPrices.holidayInput, savedPrices.holidayOutput, savedPrices.holidayCache)}` : '沿用统一结算价'}</b></div>`;
    return `<div class="x-review-banner"><div>${icon('i-shield')}</div><div><strong>${editing ? '配置已更新，可保存生效' : '配置完整，可接入网关'}</strong><p>${editing ? '保存后将覆盖当前源模型配置，并继续健康检查。' : '保存后开始健康检查，并挂载到已选定的对外模型服务。'}</p></div></div><div class="x-review-grid"><section><h3>服务映射</h3><div class="x-summary"><div class="x-summary-row"><span>服务商 / 协议</span><b>${draft.provider || '—'} · ${draft.protocol || '—'}</b></div><div class="x-summary-row"><span>源模型</span><b>${draft.sourceModel || '—'}</b></div><div class="x-summary-row"><span>绑定模型服务</span><b>${bound ? `${bound.name} · ${bound.serviceId}` : (draft.proxyService || '—')}</b></div><div class="x-summary-row"><span>Base URL</span><b>${draft.baseUrl || '—'}</b></div><div class="x-summary-row"><span>超时 / 并发 / 重试</span><b>${draft.timeout || 30}s · ${draft.concurrency || 500} · ${draft.retries || 2} 次</b></div></div></section><section><h3>能力声明</h3><div class="x-cap-summary"><div><strong>${counts.supported || 0}</strong><span>支持</span></div><div><strong>${counts.limited || 0}</strong><span>受限</span></div><div><strong>${counts.unsupported || 0}</strong><span>不支持</span></div></div><h3 style="margin-top:16px">计费价格</h3><div class="x-summary">${priceRows}</div></section></div><div class="x-test-result show" style="margin-top:14px"><span>接入字段、能力声明与计费规则已通过完整性检查</span><b>${editing ? '可保存' : '可发布'}</b></div>`;
  }

  function editModelForm(payload) {
    const model = state.models.find(m => m.id === payload.id) || payload;
    state.editingModelId = model.id || null;
    return modelWizard(true);
  }

  function toMinutes(hhmm) {
    const raw = String(hhmm || '').trim();
    if (raw === '24:00') return 24 * 60;
    const m = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return NaN;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function fromMinutes(mins) {
    if (mins >= 24 * 60) return '24:00';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function normalizeTimeLabel(kind, name) {
    if (name) return name;
    if (kind === 'busy') return '忙时';
    if (kind === 'idle') return '闲时';
    return '时段';
  }

  function defaultTimeSegments() {
    return [
      { id: 'seg-0', start: '00:00', end: '09:00', kind: 'idle', name: '闲时', input: '', output: '', cache: '' },
      { id: 'seg-1', start: '09:00', end: '22:00', kind: 'busy', name: '忙时', input: '', output: '', cache: '' },
      { id: 'seg-2', start: '22:00', end: '24:00', kind: 'idle', name: '闲时', input: '', output: '', cache: '' }
    ];
  }

  function normalizeTimeSegments(prices = {}) {
    if (Array.isArray(prices.timeSegments) && prices.timeSegments.length) {
      return prices.timeSegments.map((seg, i) => ({
        id: seg.id || `seg-${i}`,
        start: seg.start || '00:00',
        end: seg.end || '24:00',
        kind: seg.kind || (seg.name === '忙时' ? 'busy' : seg.name === '闲时' ? 'idle' : 'custom'),
        name: normalizeTimeLabel(seg.kind, seg.name),
        input: seg.input ?? '',
        output: seg.output ?? '',
        cache: seg.cache ?? ''
      }));
    }
    // 兼容旧版忙/闲单段
    if (prices.busyInput != null || prices.idleInput != null || prices.busyTime || prices.idleTime) {
      const busyStart = (prices.busyTime || '09:00–22:00').split('–')[0] || '09:00';
      const busyEnd = (prices.busyTime || '09:00–22:00').split('–')[1] || '22:00';
      const segs = [];
      if (busyStart !== '00:00') {
        segs.push({
          id: 'seg-idle-am', start: '00:00', end: busyStart, kind: 'idle', name: '闲时',
          input: prices.idleInput ?? '', output: prices.idleOutput ?? '', cache: prices.idleCache ?? ''
        });
      }
      segs.push({
        id: 'seg-busy', start: busyStart, end: busyEnd === '00:00' ? '24:00' : busyEnd, kind: 'busy', name: '忙时',
        input: prices.busyInput ?? '', output: prices.busyOutput ?? '', cache: prices.busyCache ?? ''
      });
      const end = busyEnd === '00:00' ? '24:00' : busyEnd;
      if (end !== '24:00') {
        segs.push({
          id: 'seg-idle-pm', start: end, end: '24:00', kind: 'idle', name: '闲时',
          input: prices.idleInput ?? '', output: prices.idleOutput ?? '', cache: prices.idleCache ?? ''
        });
      }
      return segs;
    }
    return defaultTimeSegments();
  }

  function rebuildSegmentsFromBreaks(breaks, prevSegments = []) {
    const unique = [...new Set(breaks.map(t => String(t).trim()).filter(Boolean))];
    if (!unique.includes('00:00')) unique.push('00:00');
    if (!unique.includes('24:00')) unique.push('24:00');
    unique.sort((a, b) => toMinutes(a) - toMinutes(b));
    const cleaned = unique.filter((t, i, arr) => i === 0 || t !== arr[i - 1]);
    return cleaned.slice(0, -1).map((start, i) => {
      const end = cleaned[i + 1];
      const prev = prevSegments.find(s => s.start === start)
        || prevSegments.find(s => toMinutes(s.start) <= toMinutes(start) && toMinutes(start) < toMinutes(s.end))
        || {};
      const kind = prev.kind || (i % 2 === 1 ? 'busy' : 'idle');
      return {
        id: prev.id || `seg-${i}-${start}`,
        start,
        end,
        kind,
        name: normalizeTimeLabel(kind, prev.name),
        input: prev.input ?? '',
        output: prev.output ?? '',
        cache: prev.cache ?? ''
      };
    });
  }

  function timeSegmentsEditorHtml(segments) {
    const breaks = ['00:00', ...segments.map(s => s.end).filter(t => t !== '24:00'), '24:00'];
    const uniqueBreaks = [...new Set(breaks)];
    const breakChips = uniqueBreaks.map((t, i) => {
      const fixed = t === '00:00' || t === '24:00';
      return `<span class="x-break-chip ${fixed ? 'fixed' : ''}">
        <b>${t}</b>
        ${fixed ? '' : `<button type="button" class="x-break-remove" data-x="remove-time-break" data-time="${t}" title="删除断点">×</button>`}
      </span>${i < uniqueBreaks.length - 1 ? '<i class="x-break-rail"></i>' : ''}`;
    }).join('');
    const cards = segments.map((seg, i) => {
      const tone = seg.kind === 'busy' ? 'busy' : seg.kind === 'idle' ? 'idle' : 'custom';
      return `<section class="x-price-period ${tone}" data-segment-index="${i}">
        <div class="x-price-title">
          <div><span>${String(i + 1).padStart(2, '0')}</span><strong>${seg.start} – ${seg.end}</strong></div>
          <div class="x-segment-meta">
            <select class="x-select" data-segment-field="kind" data-index="${i}">
              <option value="busy" ${seg.kind === 'busy' ? 'selected' : ''}>忙时</option>
              <option value="idle" ${seg.kind === 'idle' ? 'selected' : ''}>闲时</option>
              <option value="custom" ${seg.kind === 'custom' ? 'selected' : ''}>自定义</option>
            </select>
            <input class="x-input" data-segment-field="name" data-index="${i}" value="${seg.name || ''}" placeholder="时段名称" style="width:88px">
          </div>
        </div>
        <div class="x-form-grid three">
          <div class="x-field"><label class="x-required">输入 Token</label><input class="x-input x-price-input" data-segment-field="input" data-index="${i}" type="number" step="0.01" value="${seg.input}"><span class="x-error">请输入</span></div>
          <div class="x-field"><label class="x-required">输出 Token</label><input class="x-input x-price-input" data-segment-field="output" data-index="${i}" type="number" step="0.01" value="${seg.output}"><span class="x-error">请输入</span></div>
          <div class="x-field"><label class="x-required">缓存命中</label><input class="x-input x-price-input" data-segment-field="cache" data-index="${i}" type="number" step="0.01" value="${seg.cache}"><span class="x-error">请输入</span></div>
        </div>
        <div class="x-segment-split">
          <span class="x-help">在本段内插入断点以拆分</span>
          <input class="x-input" type="time" data-split-for="${i}" value="">
          <button type="button" class="btn" data-x="split-time-segment" data-index="${i}">拆分</button>
        </div>
      </section>`;
    }).join('');
    return `<div class="x-break-board">
        <div class="x-break-head"><strong>时段断点</strong><span>00:00 至 24:00 连续覆盖；插入断点即可组合忙闲等多段价格</span></div>
        <div class="x-break-track">${breakChips}</div>
        <div class="x-break-add">
          <input class="x-input" type="time" name="newBreakTime" value="12:00">
          <button type="button" class="btn" data-x="add-time-break">添加断点</button>
        </div>
      </div>
      <div class="x-segment-list">${cards}</div>`;
  }

  function readTimeSegmentsFromDom() {
    const cards = $$('[data-segment-index]', modalLayer);
    if (!cards.length) return [];
    return cards.map((card, i) => {
      const kind = card.querySelector('[data-segment-field="kind"]')?.value || 'custom';
      const nameRaw = (card.querySelector('[data-segment-field="name"]')?.value || '').trim();
      const title = card.querySelector('.x-price-title strong')?.textContent || '';
      const [start, end] = title.split('–').map(s => s.trim());
      return {
        id: `seg-${i}`,
        start: start || '00:00',
        end: end || '24:00',
        kind,
        name: nameRaw || normalizeTimeLabel(kind),
        input: card.querySelector('[data-segment-field="input"]')?.value ?? '',
        output: card.querySelector('[data-segment-field="output"]')?.value ?? '',
        cache: card.querySelector('[data-segment-field="cache"]')?.value ?? ''
      };
    });
  }

  function deriveLegacyBusyIdle(segments) {
    const busy = segments.find(s => s.kind === 'busy') || segments[0] || {};
    const idle = segments.find(s => s.kind === 'idle') || segments[segments.length - 1] || busy;
    const busyRanges = segments.filter(s => s.kind === 'busy').map(s => `${s.start}–${s.end}`).join('、');
    const idleRanges = segments.filter(s => s.kind === 'idle').map(s => `${s.start}–${s.end}`).join('、');
    return {
      busyInput: busy.input ?? '',
      busyOutput: busy.output ?? '',
      busyCache: busy.cache ?? '',
      idleInput: idle.input ?? '',
      idleOutput: idle.output ?? '',
      idleCache: idle.cache ?? '',
      busyTime: busyRanges || `${busy.start || '09:00'}–${busy.end || '22:00'}`,
      idleTime: idleRanges || `${idle.start || '22:00'}–${idle.end || '24:00'}`
    };
  }

  function collectPricingFromWizard() {
    const value = name => $(`[name="${name}"]`, modalLayer)?.value || '';
    const timePricing = value('timePricing') === 'true';
    const holidaySeparate = !!$('[name="holidaySeparate"]', modalLayer)?.checked;
    if (timePricing) {
      const segments = readTimeSegmentsFromDom();
      if (!segments.length) { toast('请至少配置一个时段'); return null; }
      for (const seg of segments) {
        if (seg.input === '' || seg.output === '' || seg.cache === '') {
          toast(`请完善 ${seg.name}（${seg.start}–${seg.end}）的结算价`);
          return null;
        }
      }
      for (let i = 0; i < segments.length; i++) {
        if (toMinutes(segments[i].end) <= toMinutes(segments[i].start)) {
          toast(`时段 ${segments[i].start}–${segments[i].end} 无效`);
          return null;
        }
        if (i > 0 && segments[i].start !== segments[i - 1].end) {
          toast('时段断点未连续覆盖全天，请检查');
          return null;
        }
      }
      if (segments[0].start !== '00:00' || segments[segments.length - 1].end !== '24:00') {
        toast('时段须从 00:00 覆盖至 24:00');
        return null;
      }
      if (!validate(['discount'])) return null;
      const holidayFields = holidaySeparate ? ['holidayInputPrice','holidayOutputPrice','holidayCachePrice'] : [];
      if (holidayFields.length && !validate(holidayFields)) return null;
      const legacy = deriveLegacyBusyIdle(segments);
      const holidayInput = holidaySeparate ? value('holidayInputPrice') : (legacy.idleInput || legacy.busyInput);
      const holidayOutput = holidaySeparate ? value('holidayOutputPrice') : (legacy.idleOutput || legacy.busyOutput);
      const holidayCache = holidaySeparate ? value('holidayCachePrice') : (legacy.idleCache || legacy.busyCache);
      const policyCode = holidaySeparate ? (value('holidayPolicy') || 'custom') : 'time';
      const policy = { custom: '独立节假日价', idle: '全天按闲时 / 统一价', time: '沿用结算价' }[policyCode] || '沿用结算价';
      return {
        timePricing: true,
        holidaySeparate,
        discount: value('discount') || '100',
        flatInput: legacy.busyInput,
        flatOutput: legacy.busyOutput,
        flatCache: legacy.busyCache,
        ...legacy,
        timeSegments: segments,
        holidayInput,
        holidayOutput,
        holidayCache,
        holidayPolicy: policy,
        holidayPolicyCode: policyCode,
        currency: value('currency'),
        billingUnit: value('billingUnit'),
        priceNote: value('priceNote')
      };
    }
    const settleFields = ['flatInputPrice','flatOutputPrice','flatCachePrice'];
    if (!validate(['discount', ...settleFields])) return null;
    const holidayFields = holidaySeparate ? ['holidayInputPrice','holidayOutputPrice','holidayCachePrice'] : [];
    if (holidayFields.length && !validate(holidayFields)) return null;
    const flatInput = value('flatInputPrice');
    const flatOutput = value('flatOutputPrice');
    const flatCache = value('flatCachePrice');
    const holidayInput = holidaySeparate ? value('holidayInputPrice') : flatInput;
    const holidayOutput = holidaySeparate ? value('holidayOutputPrice') : flatOutput;
    const holidayCache = holidaySeparate ? value('holidayCachePrice') : flatCache;
    const policyCode = holidaySeparate ? (value('holidayPolicy') || 'custom') : 'time';
    const policy = { custom: '独立节假日价', idle: '全天按闲时 / 统一价', time: '沿用结算价' }[policyCode] || '沿用结算价';
    return {
      timePricing: false,
      holidaySeparate,
      discount: value('discount') || '100',
      flatInput,
      flatOutput,
      flatCache,
      busyInput: flatInput,
      busyOutput: flatOutput,
      busyCache: flatCache,
      idleInput: flatInput,
      idleOutput: flatOutput,
      idleCache: flatCache,
      timeSegments: [],
      holidayInput,
      holidayOutput,
      holidayCache,
      holidayPolicy: policy,
      holidayPolicyCode: policyCode,
      busyTime: '00:00–24:00',
      idleTime: '00:00–24:00',
      currency: value('currency'),
      billingUnit: value('billingUnit'),
      priceNote: value('priceNote')
    };
  }

  function refreshTimeSegmentsEditor(segments) {
    const panel = $('[data-price-panel="timed"]', modalLayer);
    if (!panel) return;
    panel.innerHTML = timeSegmentsEditorHtml(segments);
    refreshPricingPreview();
  }

  function pricingPreview(p) {
    const money = value => Number(value || 0).toFixed(2);
    const tri = (inp, out, cache) => `输入 ¥${money(inp)} · 输出 ¥${money(out)} · 缓存 ¥${money(cache)}`;
    const discount = Number(p.discount || 100);
    const discountRow = `<div><span>采购折扣</span><strong>${discount}%</strong></div>`;
    if (!p.timePricing) {
      const flat = `<div><span>统一结算价</span><strong>${tri(p.flatInput ?? p.busyInput, p.flatOutput ?? p.busyOutput, p.flatCache ?? p.busyCache)}</strong></div>`;
      const holiday = p.holidaySeparate
        ? `<div><span>法定节假日结算</span><strong>${tri(p.holidayInput, p.holidayOutput, p.holidayCache)}</strong></div>`
        : '';
      return `${discountRow}${flat}${holiday}`;
    }
    const segs = Array.isArray(p.timeSegments) && p.timeSegments.length
      ? p.timeSegments
      : (typeof readTimeSegmentsFromDom === 'function' ? readTimeSegmentsFromDom() : []);
    const segRows = segs.map(seg =>
      `<div><span>${seg.name || '时段'} ${seg.start}–${seg.end}</span><strong>${tri(seg.input, seg.output, seg.cache)}</strong></div>`
    ).join('');
    const holiday = p.holidaySeparate
      ? `<div><span>法定节假日结算</span><strong>${tri(p.holidayInput, p.holidayOutput, p.holidayCache)}</strong></div>`
      : '';
    return `${discountRow}${segRows}${holiday}`;
  }

  function syncPricingModeUI(mode) {
    const timed = mode === 'timed';
    const hidden = $('[name="timePricing"]', modalLayer);
    if (hidden) hidden.value = timed ? 'true' : 'false';
    $$('[data-x="pricing-mode"]', modalLayer).forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    $$('[data-price-panel]', modalLayer).forEach(panel => {
      const show = panel.dataset.pricePanel === mode;
      panel.hidden = !show;
      panel.setAttribute('aria-hidden', show ? 'false' : 'true');
    });
    if (timed) {
      const segs = readTimeSegmentsFromDom();
      const flatIn = $('[name="flatInputPrice"]', modalLayer)?.value || '';
      const flatOut = $('[name="flatOutputPrice"]', modalLayer)?.value || '';
      const flatCache = $('[name="flatCachePrice"]', modalLayer)?.value || '';
      const next = (segs.length ? segs : defaultTimeSegments()).map(seg => ({
        ...seg,
        input: seg.input || flatIn,
        output: seg.output || flatOut,
        cache: seg.cache || flatCache
      }));
      refreshTimeSegmentsEditor(next);
    } else {
      const segs = readTimeSegmentsFromDom();
      const busy = segs.find(s => s.kind === 'busy') || segs[0];
      const flatInput = $('[name="flatInputPrice"]', modalLayer);
      const flatOutput = $('[name="flatOutputPrice"]', modalLayer);
      const flatCache = $('[name="flatCachePrice"]', modalLayer);
      if (flatInput && !flatInput.value && busy) flatInput.value = busy.input || '';
      if (flatOutput && !flatOutput.value && busy) flatOutput.value = busy.output || '';
      if (flatCache && !flatCache.value && busy) flatCache.value = busy.cache || '';
    }
    refreshPricingPreview();
  }

  function syncHolidayPricingUI(on) {
    const fields = $('[data-holiday-fields]', modalLayer);
    const hint = $('[data-holiday-hint]', modalLayer);
    if (fields) fields.hidden = !on;
    if (hint) hint.hidden = !!on;
    const policy = $('[name="holidayPolicy"]', modalLayer);
    if (policy && on && !policy.value) policy.value = 'custom';
    refreshPricingPreview();
  }

  function updateModelStepUI() {
    const editing = !!getEditingModel();
    $$('[data-model-step]').forEach((s,i)=>{s.classList.toggle('active',i===state.modalStep-1);s.classList.toggle('done',i<state.modalStep-1);});
    const prevBtn = $('[data-x="model-prev"]');
    const nextBtn = $('[data-x="model-next"]');
    const saveBtn = $('[data-x="model-save"]');
    if (prevBtn) prevBtn.style.display = state.modalStep === 1 ? 'none' : 'inline-flex';
    if (nextBtn) {
      nextBtn.style.display = state.modalStep === 4 ? 'none' : 'inline-flex';
      nextBtn.textContent = '下一步';
      nextBtn.classList.toggle('primary', false);
    }
    if (saveBtn) {
      // 编辑任意步可直接保存；新建从第 3 步起可保存
      saveBtn.style.display = (editing || state.modalStep >= 3) ? 'inline-flex' : 'none';
      saveBtn.textContent = state.modalStep === 4
        ? (editing ? '确认保存' : '确认接入')
        : '保存';
    }
    $('#x-model-hint').textContent = `第 ${state.modalStep} 步，共 4 步`;
  }

  function captureModelWizardStep() {
    const editing = getEditingModel();
    if (state.modalStep === 1) {
      if (!state.services.length) { toast('请先创建模型服务'); return false; }
      const fields = readSourceProbeFields();
      const required = ['protocolType','providerName','sourceModelName','proxyServiceRef','baseUrl'];
      if (!(editing && sourceHasStoredCredential(editing) && !fields.apiKey)) required.push('upstreamApiKey');
      if (!validate(required)) return false;
      const serviceRef = $('[name="proxyServiceRef"]', modalLayer).value;
      const bound = state.services.find(s => s.id === serviceRef);
      const canReuse = editing && sourceHasStoredCredential(editing) && !connectionFieldsChanged(editing, fields);
      if (!canReuse && !fields.apiKey && !(editing && sourceHasStoredCredential(editing))) {
        toast('请填写上游 API Key 并完成探测后再保存');
        return false;
      }
      if (!canReuse && fields.apiKey) {
        // 连接有变：先探测再由调用方决定是否继续；此处仅写入草稿，探测在保存链路处理
      }
      sessionStorage.setItem('modelDraft', JSON.stringify({
        protocol: $('[name="protocolType"]', modalLayer).value || editing?.protocol || '',
        provider: $('[name="providerName"]', modalLayer).value || editing?.provider || '',
        baseUrl: fields.baseUrl || editing?.baseUrl || '',
        sourceModel: fields.sourceModel || editing?.sourceModel || '',
        proxyServiceRef: serviceRef || editing?.serviceRef || '',
        proxyService: bound ? `${bound.name} · ${bound.serviceId}` : '',
        serviceId: bound?.serviceId || editing?.serviceId || '',
        serviceName: bound?.name || editing?.name || '',
        upstreamApiKey: fields.apiKey || '',
        reuseStoredApiKey: !!(editing && sourceHasStoredCredential(editing) && !fields.apiKey),
        region: $('[name="region"]', modalLayer)?.value || editing?.region || '华东（上海）',
        healthCheck: $('[name="healthCheck"]', modalLayer)?.value || editing?.healthCheck || '每 30 秒',
        timeout: fields.timeout || editing?.timeout || 30,
        concurrency: Number($('[name="concurrency"]', modalLayer)?.value || editing?.concurrency || 500),
        retries: Number($('[name="retries"]', modalLayer)?.value || editing?.retries || 2),
        circuit: Number($('[name="circuit"]', modalLayer)?.value || editing?.circuit || 5),
        probe: canReuse ? (editing.lastProbe || state.lastSourceProbe?.probe || null) : (state.lastSourceProbe?.probe || null)
      }));
      return true;
    }
    if (state.modalStep === 2) {
      const selects = $$('.x-cap-select', modalLayer);
      if (selects.length && selects.some(x => !x.value)) {
        $('#x-cap-error')?.classList.add('show');
        updateCapabilityCount();
        toast('请完成能力声明后再保存');
        return false;
      }
      if (selects.length) {
        const counts = { supported: 0, limited: 0, unsupported: 0 };
        selects.forEach(x => counts[x.value]++);
        sessionStorage.setItem('modelCapabilityCounts', JSON.stringify(counts));
        sessionStorage.setItem('modelCapabilities', JSON.stringify(Object.fromEntries(selects.map(x => [x.dataset.capability, x.value]))));
        sessionStorage.setItem('modelCustomCapabilities', $('[name="customCapabilities"]', modalLayer)?.value || '');
      }
      return true;
    }
    if (state.modalStep === 3) {
      const packed = collectPricingFromWizard();
      if (!packed) return false;
      sessionStorage.setItem('modelPrices', JSON.stringify(packed));
      return true;
    }
    return true;
  }

  function runModelWizardSave(el) {
    const editing = getEditingModel();
    const draft = JSON.parse(sessionStorage.getItem('modelDraft') || '{}');
    const prices = JSON.parse(sessionStorage.getItem('modelPrices') || '{}');
    const capabilities = JSON.parse(sessionStorage.getItem('modelCapabilities') || '{}');
    const customCapabilities = sessionStorage.getItem('modelCustomCapabilities') || '';
    const bound = state.services.find(s => s.id === draft.proxyServiceRef)
      || state.services.find(s => s.id === editing?.serviceRef);
    if (!bound) { toast('绑定的模型服务已不存在，请重新选择'); return; }
    if (!editing && (!draft.baseUrl || !draft.upstreamApiKey || !draft.sourceModel)) {
      toast('请先完成服务信息与上游探测');
      return;
    }
    if (!editing && !hasConfiguredPrices(prices)) {
      toast('请先完成计费配置');
      return;
    }
    const mergedCaps = (capabilities && Object.keys(capabilities).length)
      ? capabilities
      : (editing?.capabilities || {});
    const mergedPrices = hasConfiguredPrices(prices) ? prices : (editing?.prices || {});
    if (editing && !hasConfiguredPrices(mergedPrices) && state.modalStep === 3) {
      toast('请填写结算价格后再保存');
      return;
    }
    const payload = {
      serviceRef: bound.id,
      serviceId: bound.serviceId,
      name: bound.name,
      provider: draft.provider || editing?.provider || '其他',
      region: draft.region || editing?.region || '华东（上海）',
      protocol: draft.protocol || editing?.protocol || '',
      baseUrl: draft.baseUrl || editing?.baseUrl || '',
      sourceModel: draft.sourceModel || editing?.sourceModel || bound.name,
      kmsKeyId: '',
      kmsKeyName: '',
      healthCheck: draft.healthCheck || editing?.healthCheck || '每 30 秒',
      timeout: draft.timeout || editing?.timeout || 30,
      concurrency: draft.concurrency || editing?.concurrency || 500,
      retries: draft.retries ?? editing?.retries ?? 2,
      circuit: draft.circuit ?? editing?.circuit ?? 5,
      prices: mergedPrices,
      capabilities: mergedCaps,
      customCapabilities: customCapabilities || editing?.customCapabilities || ''
    };
    if (editing) {
      const hasKeyInput = !!(draft.upstreamApiKey);
      const canReuseKey = sourceHasStoredCredential(editing) && !hasKeyInput;
      if (!payload.baseUrl || !payload.sourceModel) {
        toast('缺少 Base URL 或源模型，请返回第 1 步检查');
        return;
      }
      if (!hasKeyInput && !canReuseKey) {
        toast('请填写上游 API Key，或确认网关中已保存该源凭证');
        return;
      }
      const saveBtn = el;
      saveBtn.classList.add('x-loading');
      saveBtn.disabled = true;
      const patchBody = {
        baseUrl: payload.baseUrl,
        sourceModel: payload.sourceModel,
        provider: payload.provider,
        region: payload.region,
        protocol: payload.protocol,
        timeout: payload.timeout,
        concurrency: payload.concurrency,
        retries: payload.retries,
        circuit: payload.circuit,
        healthCheck: payload.healthCheck,
        serviceRef: payload.serviceRef,
        prices: payload.prices || {},
        capabilities: payload.capabilities || {},
        customCapabilities: payload.customCapabilities || ''
      };
      if (hasKeyInput) patchBody.apiKey = draft.upstreamApiKey;
      const needProbe = hasKeyInput || connectionFieldsChanged(editing, {
        baseUrl: payload.baseUrl,
        sourceModel: payload.sourceModel,
        apiKey: draft.upstreamApiKey || ''
      });
      const persistLocal = (probe) => {
        Object.assign(editing, payload, {
          latency: probe?.latencyMs != null ? `${probe.latencyMs} ms` : (editing.latency || '已校验'),
          status: '运行中',
          lastProbe: probe || editing.lastProbe || null,
          gatewaySynced: !!editing.gatewaySynced,
          hasApiKey: true
        });
        rememberSourceExtras(editing);
        persist();
      };
      const finish = (msg) => {
        closeLayers();
        state.editingModelId = null;
        toast(msg);
        if (state.currentDetailId) openDetail('model', state.currentDetailId);
        else if (window.render) { window.render('model-sources'); setTimeout(enhanceView, 0); }
      };
      const afterSync = () => syncGatewayCatalog();
      const run = editing.gatewaySynced
        ? (needProbe
          ? adminFetch(`/admin/sources/${editing.id}/probe`, {
              method: 'POST',
              body: JSON.stringify(patchBody)
            }).then(probe => {
              persistLocal(probe);
              return afterSync().then(() => finish(`源模型 ${payload.sourceModel} 已更新（探测 ${probe.latencyMs || '—'} ms）`));
            })
          : adminFetch(`/admin/sources/${editing.id}`, {
              method: 'PATCH',
              body: JSON.stringify(patchBody)
            }).then(() => {
              persistLocal(editing.lastProbe);
              return afterSync().then(() => finish(`源模型 ${payload.sourceModel} 已保存`));
            }))
        : Promise.resolve().then(() => {
            if (needProbe && draft.upstreamApiKey) {
              return probeUpstreamLive({
                baseUrl: payload.baseUrl,
                apiKey: draft.upstreamApiKey,
                sourceModel: payload.sourceModel,
                timeout: payload.timeout || 25
              }).then(probe => {
                persistLocal(probe);
                finish(`源模型 ${payload.sourceModel} 已更新（探测 ${probe.latencyMs || '—'} ms）`);
              });
            }
            persistLocal(editing.lastProbe);
            finish(`源模型 ${payload.sourceModel} 已保存`);
          });
      Promise.resolve(run).catch(err => {
        toast(err.message || '保存失败');
      }).finally(() => {
        saveBtn.classList.remove('x-loading');
        saveBtn.disabled = false;
      });
      return;
    }
    const saveBtn = el;
    saveBtn.classList.add('x-loading');
    saveBtn.disabled = true;
    toast('正在向网关提交并二次校验上游…');
    adminFetch('/admin/sources', {
      method: 'POST',
      body: JSON.stringify({
        name: payload.sourceModel || bound.name,
        serviceRef: bound.id,
        provider: payload.provider,
        region: payload.region,
        protocol: payload.protocol,
        baseUrl: draft.baseUrl,
        sourceModel: draft.sourceModel,
        apiKey: draft.upstreamApiKey,
        timeout: draft.timeout || 25,
        concurrency: payload.concurrency,
        retries: payload.retries,
        circuit: payload.circuit,
        healthCheck: payload.healthCheck,
        prices: payload.prices || {},
        capabilities: payload.capabilities || {},
        customCapabilities: payload.customCapabilities || ''
      })
    }).then(remote => syncGatewayCatalog().then(() => remote)).then(remote => {
      state.gatewayOnline = true;
      if (remote?.id) {
        const hit = state.models.find(m => m.id === remote.id);
        if (hit) {
          Object.assign(hit, payload, { id: remote.id, gatewaySynced: true });
          rememberSourceExtras(hit);
        } else {
          rememberSourceExtras({ ...payload, id: remote.id, baseUrl: draft.baseUrl, sourceModel: draft.sourceModel });
        }
        persist();
      }
      closeLayers();
      sessionStorage.removeItem('preselectService');
      const latency = remote?.probe?.latencyMs;
      toast(`源模型 ${draft.sourceModel} 已接入（探测 ${latency != null ? latency + ' ms' : '通过'}）· 列表 ${state.models.length} 个源`);
      if (window.render) window.render('model-sources');
      setTimeout(() => {
        enhanceView();
        renderSourcesPage();
      }, 0);
    }).catch(err => {
      toast(err.message || '接入失败：上游校验未通过');
    }).finally(() => {
      saveBtn.classList.remove('x-loading');
      saveBtn.disabled = false;
    });
  }

  function updateCapabilityCount() {
    const selects = $$('.x-cap-select', modalLayer);
    const completed = selects.filter(x=>x.value).length;
    const counter = $('#x-cap-count');
    if (counter) counter.textContent = `已声明 ${completed} / ${modelCapabilities.length}`;
    $('#x-cap-error')?.classList.toggle('show', completed > 0 && completed < modelCapabilities.length);
  }

  function applyCapabilityTemplate(template) {
    const textSupported = ['文本输入','文本输出','流式输出','深度思考 / 推理','工具 / Function Calling','JSON 结构化输出','系统提示词'];
    const visionSupported = [...textSupported,'图片输入','文件输入'];
    const vectorSupported = ['文本输入','Embedding 向量化','Rerank 重排序','批量推理'];
    $$('.x-cap-select', modalLayer).forEach(select => {
      const name = select.dataset.capability;
      const supported = template === 'vision' ? visionSupported : template === 'embedding' ? vectorSupported : textSupported;
      const limited = template === 'text' ? ['上下文缓存','批量推理','Logprobs','模型微调'] : template === 'vision' ? ['音频输入','上下文缓存','批量推理','模型微调'] : ['上下文缓存','模型微调'];
      select.value = supported.includes(name) ? 'supported' : limited.includes(name) ? 'limited' : 'unsupported';
    });
    updateCapabilityCount();
  }

  function refreshPricingPreview() {
    const number = name => Number($(`[name="${name}"]`, modalLayer)?.value || 0);
    const timed = ($('[name="timePricing"]', modalLayer)?.value || 'false') === 'true';
    const holidaySeparate = !!$('[name="holidaySeparate"]', modalLayer)?.checked;
    const flatInput = number('flatInputPrice');
    const flatOutput = number('flatOutputPrice');
    const flatCache = number('flatCachePrice');
    const segs = timed ? readTimeSegmentsFromDom() : [];
    const target = $('#x-price-preview');
    if (target) target.innerHTML = pricingPreview({
      discount: number('discount') || 100,
      timePricing: timed,
      holidaySeparate,
      flatInput,
      flatOutput,
      flatCache,
      timeSegments: segs,
      holidayInput: holidaySeparate ? number('holidayInputPrice') : (timed ? (segs.find(s => s.kind === 'idle')?.input || segs[0]?.input) : flatInput),
      holidayOutput: holidaySeparate ? number('holidayOutputPrice') : (timed ? (segs.find(s => s.kind === 'idle')?.output || segs[0]?.output) : flatOutput),
      holidayCache: holidaySeparate ? number('holidayCachePrice') : (timed ? (segs.find(s => s.kind === 'idle')?.cache || segs[0]?.cache) : flatCache)
    });
  }

  function roleForm(roleId) {
    const role = roleId ? findRoleDef(roleId) : null;
    const locked = isSuperAdminRole(role);
    const scopes = ['全局','指定部门','所属部门','指定模型'];
    const selectedScope = role?.scope || '指定部门';
    const defaultPerms = role ? role.perms : ['page.overview','cap.view_models','cap.view_usage','page.usage'];
    const title = !role ? '新建角色' : locked ? '查看超级管理员权限' : '编辑角色权限';
    const subtitle = locked
      ? '超级管理员拥有全部功能，权限固定不可编辑或删除'
      : '按最小权限原则勾选页面访问与操作能力；保存后立即对成员生效';
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">${title}</h2><p>${subtitle}</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body">
        <div class="x-form-grid">
          <div class="x-field"><label class="x-required">角色名称</label><input class="x-input" name="roleName" value="${role?.name || ''}" placeholder="例如：部门预算管理员" ${role?.builtin || locked ? 'readonly' : ''}><span class="x-error">请输入角色名称</span></div>
          <div class="x-field"><label>生效范围</label><select class="x-select" name="roleScope" ${locked ? 'disabled' : ''}>${scopes.map(s=>`<option ${s===selectedScope?'selected':''}>${s}</option>`).join('')}</select></div>
          <div class="x-field full"><label>角色说明</label><textarea class="x-textarea" name="roleDesc" placeholder="说明该角色的职责边界…" ${locked ? 'readonly' : ''}>${role?.desc || ''}</textarea></div>
        </div>
        <div class="x-filter-group x-role-perms">
          <div class="x-perm-toolbar">
            <h3>权限能力</h3>
            <div class="x-perm-toolbar-actions">
              <button type="button" class="x-link-btn" data-x="perm-select-all" ${locked ? 'disabled' : ''}>全选</button>
              <button type="button" class="x-link-btn" data-x="perm-clear-all" ${locked ? 'disabled' : ''}>清空</button>
            </div>
          </div>
          ${rolePermChecksHtml(defaultPerms, locked)}
        </div>
      </div>
      <div class="x-dialog-foot">
        <span class="x-muted">${locked ? '超级管理员 · 仅可查看，不可编辑' : `已勾选 <b id="x-perm-count">${defaultPerms.length}</b> 项`}</span>
        <div class="x-dialog-foot-right">
          <button class="btn" data-x="close">${locked ? '关闭' : '取消'}</button>
          ${locked ? '' : `<button class="btn primary" data-x="save-role" data-role-id="${role?.id || ''}">${role ? '保存修改' : '创建角色'}</button>`}
        </div>
      </div>`;
  }

  function normalizeKeyServiceRefs(input) {
    if (Array.isArray(input)) return input.filter(Boolean);
    if (typeof input === 'string') {
      if (input === '*') return state.services.map(s => s.id);
      if (!input) return [];
      const matched = state.services.find(s => s.id === input || s.name === input || `${s.name} · ${s.serviceId}` === input);
      return matched ? [matched.id] : [input];
    }
    const key = input;
    if (!key) return [];
    if (Array.isArray(key.serviceRefs) && key.serviceRefs.length) return key.serviceRefs.filter(Boolean);
    if (key.serviceRef === '*' || key.services === '全部已授权服务' || key.services === '全部已创建服务') {
      return state.services.map(s => s.id);
    }
    if (key.serviceRef) {
      const matched = state.services.find(s => s.id === key.serviceRef || s.name === key.serviceRef);
      return [matched?.id || key.serviceRef];
    }
    if (key.services) {
      const matched = state.services.find(s => s.name === key.services || `${s.name} · ${s.serviceId}` === key.services);
      return matched ? [matched.id] : [];
    }
    return [];
  }

  function keyServiceSelectHtml(selected = []) {
    if (!state.services.length) {
      return `<div class="x-service-pick" data-key-services>
          <div class="x-empty-service"><strong>暂无模型服务</strong><p>请先到「模型服务配置」创建对外服务，再签发可调用范围。</p>
          <button class="btn" type="button" data-x="goto-create-service">去创建模型服务</button></div>
        </div>`;
    }
    const selectedIds = new Set(normalizeKeyServiceRefs(selected));
    const allChecked = state.services.length > 0 && state.services.every(s => selectedIds.has(s.id));
    const checkedCount = state.services.filter(s => selectedIds.has(s.id)).length;
    return `<div class="x-service-pick" data-key-services>
        <div class="x-service-pick-bar">
          <label class="x-check"><input type="checkbox" data-x="toggle-all-key-services" ${allChecked ? 'checked' : ''}>一键全选</label>
          <span class="x-muted" data-key-service-count>已选 ${checkedCount} / ${state.services.length}</span>
        </div>
        <div class="x-checks x-service-checks">
          ${state.services.map(s => `<label class="x-check"><input type="checkbox" name="keyServiceRef" value="${s.id}" ${selectedIds.has(s.id) ? 'checked' : ''}><span>${s.name}</span><em>${s.serviceId}</em></label>`).join('')}
        </div>
        <span class="x-help">选项来自「模型服务配置」中已创建的明细，可多选</span>
      </div>`;
  }

  function collectKeyServiceRefs(root = modalLayer) {
    return $$('[name="keyServiceRef"]:checked', root).map(el => el.value).filter(Boolean);
  }

  function syncKeyServicePick(root = modalLayer) {
    const pick = $('[data-key-services]', root);
    if (!pick) return;
    const boxes = $$('[name="keyServiceRef"]', pick);
    const checked = boxes.filter(el => el.checked).length;
    const allBox = $('[data-x="toggle-all-key-services"]', pick);
    if (allBox) {
      allBox.checked = boxes.length > 0 && checked === boxes.length;
      allBox.indeterminate = checked > 0 && checked < boxes.length;
    }
    const count = $('[data-key-service-count]', pick);
    if (count) count.textContent = `已选 ${checked} / ${boxes.length}`;
  }

  function validateKeyServices() {
    const field = $('[data-key-services]', modalLayer)?.closest('.x-field');
    const refs = collectKeyServiceRefs();
    if (!refs.length) {
      field?.classList.add('invalid');
      return false;
    }
    field?.classList.remove('invalid');
    return true;
  }

  function formatKeyServiceRefs(refs) {
    const ids = normalizeKeyServiceRefs(refs);
    if (!ids.length) return '—';
    if (state.services.length && ids.length >= state.services.length && state.services.every(s => ids.includes(s.id))) {
      return '全部已创建服务';
    }
    const labels = ids.map(id => {
      const svc = state.services.find(s => s.id === id);
      return svc ? `${svc.name} · ${svc.serviceId}` : id;
    });
    return labels.join('、') || '—';
  }

  function resolveKeyServiceLabel(key) {
    if (!key) return '—';
    return formatKeyServiceRefs(normalizeKeyServiceRefs(key));
  }

  function applyKeyServiceSelection(target) {
    const refs = collectKeyServiceRefs();
    target.serviceRefs = refs;
    target.serviceRef = refs.length === state.services.length && state.services.length
      ? '*'
      : (refs[0] || '');
    target.services = formatKeyServiceRefs(refs);
  }

  function generateCallerCode(seed = '') {
    const base = String(seed || 'app')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'app';
    let code = '';
    do {
      const suffix = Math.random().toString(16).slice(2, 8);
      code = `svc-${base}-${suffix}`;
    } while ((state.callers || []).some(c => c.code === code));
    return code;
  }

  function keyCallerFieldsHtml(caller = null, { createOnly = false } = {}) {
    const isCreate = createOnly || !caller;
    return `<div class="x-caller-block" data-caller-block>
        <div class="x-caller-block-head">
          <div><strong>调用方信息</strong><p>${isCreate ? '填写调用方名称即可；系统内部标识自动生成' : '可调整调用方名称、部门与对接人'}</p></div>
        </div>
        <div class="x-form-grid">
          <div class="x-field"><label class="x-required">调用方名称</label><input class="x-input" name="callerName" value="${isCreate ? '' : (caller?.name || '')}" placeholder="例如：智能客服应用"><span class="x-error">请输入调用方名称</span></div>
          <div class="x-field"><label>所属部门</label><select class="x-select" name="callerDept">${selectOptions(memberDepartments, isCreate ? '客户服务' : (caller?.ownerDept || '客户服务'))}</select></div>
          <div class="x-field"><label>对接人</label><input class="x-input" name="callerContact" value="${isCreate ? '' : (caller?.contact || '')}" placeholder="例如：赵然"></div>
          <input type="hidden" name="keyCallerId" value="${isCreate ? '' : (caller?.id || '')}">
        </div>
      </div>`;
  }

  function createCallerFromKeyForm() {
    const name = $('[name="callerName"]', modalLayer)?.value.trim() || '';
    const ownerDept = $('[name="callerDept"]', modalLayer)?.value || '未分配';
    const contact = $('[name="callerContact"]', modalLayer)?.value.trim() || '';
    const caller = {
      id: `caller-${Date.now()}`,
      name,
      code: generateCallerCode(name),
      ownerDept,
      contact,
      desc: '',
      status: '启用',
      created: nowDateTime()
    };
    state.callers.unshift(caller);
    return caller;
  }

  function updateCallerFromKeyForm() {
    const existingId = $('[name="keyCallerId"]', modalLayer)?.value || '';
    const caller = state.callers.find(c => c.id === existingId);
    if (!caller) return createCallerFromKeyForm();
    const name = $('[name="callerName"]', modalLayer)?.value.trim() || '';
    const ownerDept = $('[name="callerDept"]', modalLayer)?.value || '未分配';
    const contact = $('[name="callerContact"]', modalLayer)?.value.trim() || '';
    Object.assign(caller, { name, ownerDept, contact, status: caller.status || '启用' });
    state.keys.forEach(key => { if (key.callerId === caller.id) key.owner = name; });
    return caller;
  }

  function applyKeyCallerSelection(target, { createOnly = false } = {}) {
    const caller = createOnly ? createCallerFromKeyForm() : updateCallerFromKeyForm();
    if (!caller) return false;
    target.callerId = caller.id;
    target.owner = caller.name;
    return true;
  }

  function memberSelectOptions(selectedId = '') {
    return (state.members || []).filter(m => m.status !== '已停用' && m.status !== '已禁用').map(m => `<option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>${m.name} · ${m.dept}</option>`).join('');
  }

  function orgUnitSelectOptions(level, selectedId = '') {
    return orgUnitsForLevel(level).map(u => `<option value="${u.id}" ${u.id === selectedId ? 'selected' : ''}>${u.label}</option>`).join('');
  }

  function defaultOrgForMember(member) {
    if (member?.dept && member.dept !== '未分配') return { level: 'dept', id: member.dept, org: resolveOrgUnit('dept', member.dept) };
    return { level: 'enterprise', id: ENTERPRISE_ORG.id, org: resolveOrgUnit('enterprise', ENTERPRISE_ORG.id) };
  }

  function readOrgSelectionFromForm() {
    const level = $('[name="keyOrgLevel"]', modalLayer)?.value === 'enterprise' ? 'enterprise' : 'dept';
    const orgId = $('[name="keyOrgId"]', modalLayer)?.value || '';
    const org = resolveOrgUnit(level, orgId);
    return { level, orgId: org?.id || orgId, org };
  }

  function orgScopeFieldsHtml({ level = 'dept', orgId = '', scene = 'app', member = null } = {}) {
    const hint = scene === 'personal'
      ? '个人 Key 费用归所选组织成本单元，不单独做个人应付'
      : '应用 Key 费用归所选组织成本单元（企业 / 部门）';
    const defaults = member ? defaultOrgForMember(member) : null;
    const curLevel = level === 'enterprise' ? 'enterprise' : (level === 'dept' ? 'dept' : (defaults?.level || 'dept'));
    const deptFallback = (typeof memberDepartments !== 'undefined' ? memberDepartments : []).find(d => d && d !== '未分配') || '';
    const curOrgId = orgId || defaults?.id || (curLevel === 'enterprise' ? ENTERPRISE_ORG.id : deptFallback);
    return `<div class="x-caller-block" data-org-scope>
        <div class="x-caller-block-head">
          <div><strong>组织归属</strong><p>${hint}</p></div>
        </div>
        <div class="x-form-grid">
          <div class="x-field"><label class="x-required">组织层级</label>
            <select class="x-select" name="keyOrgLevel" data-x="key-org-level">
              <option value="enterprise" ${curLevel === 'enterprise' ? 'selected' : ''}>企业 · 总部成本中心</option>
              <option value="dept" ${curLevel === 'dept' ? 'selected' : ''}>部门 · 按部门归集</option>
            </select>
          </div>
          <div class="x-field"><label class="x-required">归属组织</label>
            <select class="x-select" name="keyOrgId" data-x="key-org-id">${orgUnitSelectOptions(curLevel, curOrgId)}</select>
            <span class="x-help">可在企业 / 部门任一层级开通并归集费用</span>
          </div>
        </div>
      </div>`;
  }

  function updateOrgUnitOptions() {
    const level = $('[name="keyOrgLevel"]', modalLayer)?.value === 'enterprise' ? 'enterprise' : 'dept';
    const sel = $('[name="keyOrgId"]', modalLayer);
    if (!sel) return;
    const units = orgUnitsForLevel(level);
    const keep = sel.value;
    sel.innerHTML = orgUnitSelectOptions(level, units.some(u => u.id === keep) ? keep : (units[0]?.id || ''));
    syncCallerDeptFromOrg();
  }

  function syncCallerDeptFromOrg() {
    const { org } = readOrgSelectionFromForm();
    const deptSel = $('[name="callerDept"]', modalLayer);
    if (deptSel && org?.dept) deptSel.value = org.dept;
  }

  function keyPersonalSubjectHtml(memberId = '') {
    const member = state.members.find(m => m.id === memberId) || state.members.find(m => m.status === '已激活') || state.members[0];
    return `<div class="x-caller-block" data-personal-block>
        <div class="x-caller-block-head">
          <div><strong>个人主体</strong><p>场景：个人 Key · 绑定具名员工，明文仅本人可看</p></div>
        </div>
        <div class="x-form-grid">
          <div class="x-field"><label class="x-required">使用员工</label><select class="x-select" name="keyOwnerMemberId" data-x="key-personal-member">${memberSelectOptions(member?.id || '')}</select></div>
          <div class="x-field"><label>员工部门</label><input class="x-input" name="keyMemberDept" value="${member?.dept || ''}" readonly></div>
        </div>
      </div>
      ${orgScopeFieldsHtml({ scene: 'personal', member })}`;
  }

  function keyAppSubjectHtml() {
    const deptFallback = memberDepartments.find(d => d && d !== '未分配') || '';
    return `${orgScopeFieldsHtml({ scene: 'app', level: 'dept', orgId: deptFallback })}
      <div style="margin-top:12px">${keyCallerFieldsHtml(null, { createOnly: true })}</div>`;
  }

  function applyKeyKindQuotaDefaults(kind) {
    const isPersonal = kind === 'personal';
    const maxIn = $('[name="keyMaxIn"]', modalLayer);
    const maxOut = $('[name="keyMaxOut"]', modalLayer);
    const maxSpend = $('[name="keyMaxSpend"]', modalLayer);
    const mode = $('[name="keyLimitMode"]', modalLayer);
    const over = $('[name="keyOverLimit"]', modalLayer);
    if (isPersonal) {
      if (mode && !mode.dataset.touched) mode.value = 'both';
      if (maxIn && !maxIn.dataset.touched) maxIn.value = '200000';
      if (maxOut && !maxOut.dataset.touched) maxOut.value = '80000';
      if (maxSpend && !maxSpend.dataset.touched) maxSpend.value = '200';
      if (over && !over.dataset.touched) over.value = '立即拒绝并返回 429';
    } else {
      if (mode && !mode.dataset.touched) mode.value = 'both';
      if (maxIn && !maxIn.dataset.touched) maxIn.value = '5000000';
      if (maxOut && !maxOut.dataset.touched) maxOut.value = '2000000';
      if (maxSpend && !maxSpend.dataset.touched) maxSpend.value = '2000';
    }
    updateKeyQuotaPanel();
  }

  function keyScenePickerForm() {
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">选择开通场景</h2><p>个人 Key 与应用 Key 是两套独立场景；费用可按企业 / 部门任一组织层级归集</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body">
        <div class="x-detail-grid" style="grid-template-columns:1fr 1fr;gap:14px">
          <button type="button" class="card" data-x="issue-key-scene" data-scene="personal" style="text-align:left;cursor:pointer;border:1px solid #e4ebe8;padding:18px">
            <span class="eyebrow">SCENE A</span>
            <h3 style="margin:8px 0 6px">开通个人 Key</h3>
            <p class="x-muted" style="margin:0;font-size:12px;line-height:1.5">具名员工使用 · 严限额与模型白名单 · 费用归所选组织层级（默认跟员工部门）</p>
          </button>
          <button type="button" class="card" data-x="issue-key-scene" data-scene="app" style="text-align:left;cursor:pointer;border:1px solid #e4ebe8;padding:18px">
            <span class="eyebrow">SCENE B</span>
            <h3 style="margin:8px 0 6px">开通应用 Key</h3>
            <p class="x-muted" style="margin:0;font-size:12px;line-height:1.5">系统/服务调用 · 绑定调用方 · 先选企业/部门，再按应用 SLA 配置限额</p>
          </button>
        </div>
      </div>
      <div class="x-dialog-foot"><span class="x-muted">两套场景不可混用同一把 Key</span><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button></div></div>`;
  }

  function keyQuotaFieldsHtml(scene = 'app') {
    const isPersonal = scene === 'personal';
    const defaultExpire = isPersonal ? '90d' : '365d';
    return `<div class="x-form-grid" style="margin-top:14px">
          <div class="x-field"><label class="x-required">Key 别名</label><input class="x-input" name="keyName" placeholder="${isPersonal ? '例如：deng-personal-try' : '例如：customer-app-prod'}"><span class="x-error">请输入 Key 别名</span></div>
          <div class="x-field"><label>限额周期</label><select class="x-select" name="keyWindow"><option>每小时</option><option selected>每天</option><option>每月</option></select><span class="x-help">限额在周期结束时清零重算</span></div>
          ${keyExpireFieldsHtml({ preset: defaultExpire })}
          <div class="x-field full"><label>限制方式</label><select class="x-select" name="keyLimitMode" data-x="key-limit-mode"><option value="token">仅 Token 用量</option><option value="spend">仅金额消耗</option><option value="both" selected>Token + 金额（任一触达即阻断）</option><option value="none">不限制</option></select></div>
          <div class="x-field full"><label class="x-required">可调用模型服务</label>${keyServiceSelectHtml(isPersonal ? ['svc-deepseek-v4'] : [])}<span class="x-error">请至少勾选一个模型服务</span><span class="x-help">${isPersonal ? '个人场景默认低价模型白名单' : '应用场景可按 SLA 放开多模型'}</span></div>
        </div>
        <div class="x-key-quota" id="x-key-quota-panel">
          <div class="x-form-grid" data-quota-token>
            <div class="x-field"><label>最大上行 Token</label><input class="x-input" name="keyMaxIn" type="number" value="${isPersonal ? '200000' : '5000000'}" placeholder="单位时间内上限"></div>
            <div class="x-field"><label>最大下行 Token</label><input class="x-input" name="keyMaxOut" type="number" value="${isPersonal ? '80000' : '2000000'}" placeholder="单位时间内上限"></div>
          </div>
          <div class="x-form-grid" data-quota-spend style="margin-top:12px">
            <div class="x-field"><label>最大金额消耗（元）</label><input class="x-input" name="keyMaxSpend" type="number" step="0.01" value="${isPersonal ? '200' : '2000'}"></div>
            <div class="x-field"><label>超额策略</label><select class="x-select" name="keyOverLimit"><option>立即拒绝并返回 429</option><option>仅告警，仍允许调用</option>${isPersonal ? '' : '<option>降级到低价模型</option>'}</select></div>
          </div>
        </div>`;
  }

  function keyForm(scene = 'app') {
    const kind = scene === 'personal' ? 'personal' : 'app';
    state.issueKeyScene = kind;
    const me = currentIdentity();
    const personalMemberId = isDeveloperProfile() ? (me.id || '') : '';
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">开通${keyKindLabel(kind)} Key</h2><p>${kind === 'personal' ? '场景 A · 个人使用' : '场景 B · 应用接入'} · 选择组织层级后配置限额</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body">
        <input type="hidden" name="keyKind" value="${kind}">
        ${kind === 'personal' ? keyPersonalSubjectHtml(personalMemberId) : keyAppSubjectHtml()}
        ${keyQuotaFieldsHtml(kind)}
        <div class="x-test-result show" style="margin-top:14px"><span>明文仅所有者可查看；费用归所选组织层级，所有者 ≠ 付款主体</span><b>${keyKindLabel(kind)}场景</b></div>
      </div>
      <div class="x-dialog-foot"><span class="x-muted">${isDeveloperProfile() ? (!KEY_APPROVAL_ENABLED ? '直接开通，无需审批' : '普通用户仅可开通个人 Key') : `<button class="btn" type="button" data-x="back-key-scene" style="margin-right:8px">重选场景</button>当前：${keyKindLabel(kind)} Key`}</span><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn primary" data-x="save-key">确认开通</button></div></div>`;
  }

  function currentIdentity() {
    const cfg = window.getActiveRoleConfig?.() || {};
    return {
      id: cfg.memberId || cfg.id || '',
      name: cfg.name || '当前用户',
      role: cfg.role || '',
      dept: (cfg.scope || '').split(' · ')[0] || '未分配',
      profile: cfg.viewProfile || ''
    };
  }

  function isDeveloperProfile() {
    return currentIdentity().profile === 'developer';
  }

  function pendingKeyApplications() {
    return (state.keyApplications || []).filter(a => a.status === '待审批');
  }

  function myKeyApplications() {
    const me = currentIdentity();
    return (state.keyApplications || []).filter(a => a.applicantId === me.id || a.applicantName === me.name);
  }

  function applyApiKeyForm(scene = 'personal') {
    const me = currentIdentity();
    const member = state.members.find(m => m.id === me.id) || { id: me.id, name: me.name, dept: me.dept };
    const kind = isDeveloperProfile() ? 'personal' : (scene === 'app' ? 'app' : 'personal');
    const title = kind === 'personal' ? '申请个人 Key' : '申请应用 Key';
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">${title}</h2><p>${kind === 'personal' ? '场景 A · 本人使用，严限额' : '场景 B · 应用接入'}；费用归所选组织层级，不产生个人应付</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body">
        <input type="hidden" name="keyKind" value="${kind}">
        <div class="x-form-grid">
          <div class="x-field"><label>申请人</label><input class="x-input" value="${me.name}" readonly></div>
          <div class="x-field"><label>所属部门</label><input class="x-input" value="${me.dept}" readonly></div>
        </div>
        ${kind === 'personal'
          ? orgScopeFieldsHtml({ scene: 'personal', member })
          : `${orgScopeFieldsHtml({ scene: 'app', level: 'dept', orgId: me.dept && me.dept !== '未分配' ? me.dept : '' })}
             <div class="x-form-grid" style="margin-top:12px">
               <div class="x-field"><label class="x-required">调用方名称</label><input class="x-input" name="callerName" placeholder="例如：智能客服预发"><span class="x-error">请输入调用方名称</span></div>
             </div>`}
        ${keyQuotaFieldsHtml(kind)}
        <div class="x-form-grid" style="margin-top:12px">
          <div class="x-field full"><label class="x-required">申请用途</label><input class="x-input" name="keyPurpose" placeholder="说明业务场景与使用期限"><span class="x-error">请填写申请用途</span></div>
        </div>
        <div class="x-test-result show" style="margin-top:14px"><span>审批通过前不会生成明文；费用归所选组织汇总</span><b>需组织管理员审批</b></div>
      </div>
      <div class="x-dialog-foot"><span class="x-muted">${!isDeveloperProfile() ? '<button class="btn" type="button" data-x="switch-apply-scene" data-scene="' + (kind === 'personal' ? 'app' : 'personal') + '">改为申请' + (kind === 'personal' ? '应用' : '个人') + ' Key</button>' : '普通用户仅可申请个人 Key'}</span><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn primary" data-x="save-key-apply">提交申请</button></div></div>`;
  }

  function keyApplyDetailForm(id) {
    const app = (state.keyApplications || []).find(a => a.id === id);
    if (!app) return `<div class="x-dialog-head"><div><h2>申请不存在</h2></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>`;
    const mode = app.limitMode || 'both';
    const kind = app.keyKind === 'app' ? 'app' : 'personal';
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">审批${keyKindLabel(kind)} Key 申请</h2><p>${app.applicantName} · ${app.dept} · ${displayDateTime(app.created)} · ${kind === 'personal' ? '个人限额默认更严' : '应用可按 SLA 提高限额'} · 须逐条确认后开通</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body">
        <div class="x-kv-grid" style="grid-template-columns:repeat(2,1fr)">
          <div class="x-kv"><span>开通场景</span><strong>${keyKindLabel(kind)} Key</strong></div>
          <div class="x-kv"><span>Key 别名</span><strong>${app.name}</strong></div>
          <div class="x-kv"><span>组织层级</span><strong>${orgLevelLabel(app.orgLevel === 'enterprise' ? 'enterprise' : 'dept')}</strong></div>
          <div class="x-kv"><span>费用归属</span><strong>${app.orgName || app.dept || '—'} · ${app.billingDept || app.dept || '—'}</strong></div>
          <div class="x-kv"><span>状态</span><strong>${app.status}</strong></div>
          <div class="x-kv"><span>申请用途</span><strong>${app.purpose || '—'}</strong></div>
          <div class="x-kv"><span>可调用服务</span><strong>${app.services || '—'}</strong></div>
          ${kind === 'app' ? `<div class="x-kv"><span>调用方</span><strong>${app.callerName || '待开通时创建'}</strong></div>` : `<div class="x-kv"><span>使用人 / 所有者</span><strong>${app.applicantName}</strong></div>`}
          <div class="x-kv"><span>申请人期望限额</span><strong>${keyLimitSummary(app)}</strong></div>
          <div class="x-kv"><span>期望周期</span><strong>${app.window || '每天'}</strong></div>
          <div class="x-kv"><span>期望有效期</span><strong>${keyExpiryLabel(app)}</strong></div>
        </div>
        <div style="margin-top:12px">${orgScopeFieldsHtml({ scene: kind, level: app.orgLevel === 'enterprise' ? 'enterprise' : 'dept', orgId: (app.orgLevel === 'enterprise' ? ENTERPRISE_ORG.id : (app.billingDept || app.dept || app.orgId || '')), member: state.members.find(m => m.id === app.applicantId) })}</div>
        <div class="x-filter-group" style="margin-top:16px">
          <h3>限额策略确认（管理员必填）</h3>
          <p class="x-help" style="margin:0 0 10px">请逐项核对并确认后开通；可按治理策略下调申请人期望值。</p>
          <div class="x-form-grid">
            <div class="x-field"><label class="x-required">限额周期</label><select class="x-select" name="keyWindow"><option ${app.window==='每小时'?'selected':''}>每小时</option><option ${!app.window || app.window==='每天'?'selected':''}>每天</option><option ${app.window==='每月'?'selected':''}>每月</option></select></div>
            ${keyExpireFieldsHtml({ preset: app.expirePreset || (app.expiresAt ? 'custom' : '90d'), expiresAt: app.expiresAt || '' })}
            <div class="x-field"><label class="x-required">限制方式</label><select class="x-select" name="keyLimitMode" data-x="key-limit-mode"><option value="token" ${mode==='token'?'selected':''}>仅 Token 用量</option><option value="spend" ${mode==='spend'?'selected':''}>仅金额消耗</option><option value="both" ${mode==='both'?'selected':''}>Token + 金额</option><option value="none" ${mode==='none'?'selected':''}>不限制</option></select></div>
          </div>
          <div class="x-key-quota" id="x-key-quota-panel" style="margin-top:12px">
            <div class="x-form-grid" data-quota-token>
              <div class="x-field"><label>最大上行 Token</label><input class="x-input" name="keyMaxIn" type="number" value="${app.maxInTokens || ''}"></div>
              <div class="x-field"><label>最大下行 Token</label><input class="x-input" name="keyMaxOut" type="number" value="${app.maxOutTokens || ''}"></div>
            </div>
            <div class="x-form-grid" data-quota-spend style="margin-top:12px">
              <div class="x-field"><label>最大金额消耗（元）</label><input class="x-input" name="keyMaxSpend" type="number" step="0.01" value="${app.maxSpend || ''}"></div>
              <div class="x-field"><label>超额策略</label><select class="x-select" name="keyOverLimit">
                <option ${!app.overLimit || app.overLimit==='立即拒绝并返回 429'?'selected':''}>立即拒绝并返回 429</option>
                <option ${app.overLimit==='仅告警，仍允许调用'?'selected':''}>仅告警，仍允许调用</option>
                <option ${app.overLimit==='降级到低价模型'?'selected':''}>降级到低价模型</option>
              </select></div>
            </div>
          </div>
          <label class="x-check" style="margin-top:14px">
            <input type="checkbox" name="quotaConfirmed" value="1">
            <span>我已逐项确认本条申请的限额策略，同意按上述配置开通</span>
          </label>
        </div>
        <div class="x-field full" style="margin-top:14px"><label>审批备注</label><textarea class="x-textarea" name="approveNote" placeholder="可选：通过原因或驳回说明">${app.note || ''}</textarea></div>
      </div>
      <div class="x-dialog-foot"><span class="x-muted">未确认限额策略前不可开通</span><div class="x-dialog-foot-right">
        <button class="btn" data-x="close">取消</button>
        <button class="btn x-danger-outline" data-x="reject-key-apply" data-id="${app.id}">驳回</button>
        <button class="btn primary" data-x="approve-key-apply" data-id="${app.id}">确认限额并开通</button>
      </div></div>`;
  }

  function updateKeyQuotaPanel() {
    const mode = $('[name="keyLimitMode"]', modalLayer)?.value || 'both';
    const panel = $('#x-key-quota-panel', modalLayer);
    if (!panel) return;
    panel.style.display = mode === 'none' ? 'none' : '';
    $$('[data-quota-token]', panel).forEach(el => { el.style.display = mode === 'spend' ? 'none' : ''; });
    $$('[data-quota-spend]', panel).forEach(el => { el.style.display = mode === 'token' ? 'none' : ''; });
  }

  function formatTokenLimit(value) {
    const n = Number(value);
    if (!value && value !== 0) return '不限制';
    if (!Number.isFinite(n)) return String(value);
    if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 ? 1 : 0)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K`;
    return String(n);
  }

  function keyLimitSummary(key) {
    if (!key || key.limitMode === 'none') return '不限制';
    const parts = [];
    if (key.limitMode !== 'spend') parts.push(`上行 ${formatTokenLimit(key.maxInTokens)} / 下行 ${formatTokenLimit(key.maxOutTokens)}`);
    if (key.limitMode !== 'token' && key.maxSpend) parts.push(`金额 ¥${key.maxSpend}`);
    return `${key.window || '每天'} · ${parts.join(' · ') || '已配置'}`;
  }

  function exportForm(kind) {
    ensureCustomRangeDefaults();
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">导出${kind}</h2><p>生成可下载文件，并记录本次导出操作</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div><div class="x-dialog-body"><div class="x-form-grid"><div class="x-field full"><label>时间范围</label><div class="x-time-range-field">${timeRangeSelectHtml({ name: 'export', selected: '本月', selectClass: 'x-select' })}</div></div><div class="x-field"><label>文件格式</label><select class="x-select" id="x-export-format"><option value="csv">CSV</option><option value="json">JSON</option></select></div><div class="x-field full"><label>包含字段</label><div class="x-checks"><label class="x-check"><input type="checkbox" checked>基础信息</label><label class="x-check"><input type="checkbox" checked>资源标识</label><label class="x-check"><input type="checkbox" checked>结果与耗时</label><label class="x-check"><input type="checkbox">完整请求体</label></div></div></div></div><div class="x-dialog-foot"><span class="x-muted">预计 2,864 条记录，约 1.2 MB</span><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn primary" data-x="download" data-kind="${kind}">生成并下载</button></div></div>`;
  }

  function permissionMatrix() {
    const roles = roleDefsList();
    const caps = [
      {id:'cap.view_models', label:'模型查看'},
      {id:'cap.manage_models', label:'模型接入'},
      {id:'cap.manage_routes', label:'路由管理'},
      {id:'cap.manage_keys', label:'密钥管理'},
      {id:'cap.view_audit', label:'审计查看'},
      {id:'cap.manage_roles', label:'权限管理'},
      {id:'cap.export_billing', label:'费用导出'},
      {id:'cap.all_features', label:'全部功能'}
    ];
    const cell = (role, capId) => {
      const on = role.locked || role.perms.includes(capId) || role.perms.includes('cap.all_features');
      return on ? '允许' : '—';
    };
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">角色权限矩阵</h2><p>对比当前已配置角色的能力范围</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body x-matrix-scroll"><table class="x-matrix"><thead><tr><th>权限能力</th>${roles.map(r=>`<th>${r.name}</th>`).join('')}</tr></thead>
      <tbody>${caps.map(cap => `<tr><td>${cap.label}</td>${roles.map(r => { const v = cell(r, cap.id); return `<td class="${v==='允许'?'x-permission-yes':'x-permission-no'}">${v}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="x-dialog-foot"><span class="x-muted">矩阵随角色权限配置实时更新</span><div class="x-dialog-foot-right"><button class="btn primary" data-x="close">完成</button></div></div>`;
  }

  function currentPricePeriod(date = new Date()) {
    const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const override = state.calendarOverrides.find(item=>item.date===key);
    if (override?.type === 'holiday') return 'holiday';
    const isAdjustedWorkday = override?.type === 'workday';
    if (!isAdjustedWorkday && [0,6].includes(date.getDay())) return 'holiday';
    const hour = date.getHours();
    return hour >= 9 && hour < 22 ? 'busy' : 'idle';
  }

  const periodLabel = period => period === 'holiday' ? '法定节假日 / 周末' : period === 'busy' ? '忙时' : '闲时';

  function projectedSourceCost(source, inputTokens = 1000000, outputTokens = 350000) {
    const period = currentPricePeriod();
    const inputPrice = period === 'holiday' ? source.holidayIn : period === 'busy' ? source.busyIn : source.idleIn;
    const outputPrice = period === 'holiday' ? source.holidayOut : period === 'busy' ? source.busyOut : source.idleOut;
    return inputPrice * inputTokens / 1000000 + outputPrice * outputTokens / 1000000;
  }

  function boundModelsForService(service) {
    if (!service) return [];
    return state.models
      .filter(m => m.serviceRef === service.id || m.serviceId === service.serviceId)
      .sort((a, b) => (a.distOrder ?? 999) - (b.distOrder ?? 999));
  }

  function availableModelsToBind(service) {
    if (!service) return [];
    return state.models.filter(m => {
      const boundHere = m.serviceRef === service.id || m.serviceId === service.serviceId;
      return !boundHere;
    });
  }

  function modelToDistSource(m, i = 0) {
    return {
      id: m.id,
      provider: m.provider,
      source: m.sourceModel || m.name,
      region: m.region,
      busyIn: Number(m.prices?.busyInput || 2 + i),
      busyOut: Number(m.prices?.busyOutput || 8 + i * 2),
      idleIn: Number(m.prices?.idleInput || 1.2 + i * 0.2),
      idleOut: Number(m.prices?.idleOutput || 4.8 + i),
      holidayIn: Number(m.prices?.holidayInput || 1 + i * 0.1),
      holidayOut: Number(m.prices?.holidayOutput || 4 + i),
      latency: parseInt(String(m.latency).replace(/[^\d]/g, ''), 10) || 700 + i * 40,
      sla: parseFloat(m.sla) || 99.9,
      quota: Math.max(20, 90 - i * 12),
      enabled: m.status !== '已停用' && m.distEnabled !== false
    };
  }

  function activeDistributionSources() {
    const service = state.services.find(s => s.id === state.editingDistributionId);
    // 不再回落到默认 deepseek 源；策略里只展示用户手动绑定的源
    return boundModelsForService(service).map((m, i) => modelToDistSource(m, i));
  }

  function distAddSourcePickerHtml(service) {
    const candidates = availableModelsToBind(service);
    if (!candidates.length) {
      return `<div class="x-empty-panel" style="margin:12px 0 0"><strong>没有可添加的源模型</strong><p>请先到「源模型能力接入」接入源，再回到此处手动添加。</p><button class="btn" data-x="goto-bind-source">去接入源模型</button></div>`;
    }
    return `<div class="x-dist-add-source">
      <div class="x-field"><label>手动添加源模型</label>
        <select class="x-select" name="distAddSourceId">
          <option value="">选择要加入本策略的源…</option>
          ${candidates.map(m => `<option value="${m.id}">${m.provider} · ${m.sourceModel || m.name}${m.serviceRef ? '（将改绑到本服务）' : ''}</option>`).join('')}
        </select>
      </div>
      <button class="btn primary" data-x="dist-add-source">添加到策略</button>
    </div>`;
  }

  function distributionModal(payload = {}) {
    const service = state.services.find(s => s.id === payload.id || s.serviceId === payload.model) || state.services[0];
    state.editingDistributionId = service?.id || null;
    const strategy = service?.strategy || 'fixed';
    state.distributionMode = strategy;
    const sources = activeDistributionSources();
    const selected = strategy === 'fixed' ? sources.find(s => s.enabled) : [...sources].filter(s => s.enabled).sort((a, b) => projectedSourceCost(a) - projectedSourceCost(b))[0];
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">${service?.name || '模型服务'} · 底层分发策略</h2><p>统一服务标识 ${service?.serviceId || '—'}，关联 ${sources.length} 个源模型</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div><div class="x-dialog-body"><div class="x-dist-overview"><div><span>用户调用名称</span><strong>${service?.name || '—'}</strong></div><div><span>统一服务标识</span><strong>${service?.serviceId || '—'}</strong></div><div><span>当前实际源</span><strong id="x-current-source">${selected?.provider || '无可用源'}</strong></div><div><span>生效策略</span><strong id="x-current-strategy">${strategy === 'cost' ? '实时费用最低' : '固定顺序'}</strong></div></div><div class="x-strategy-switch"><button class="${strategy === 'cost' ? 'active' : ''}" data-x="strategy-mode" data-mode="cost"><b>实时费用最低优先</b><span>结合当前时段、折扣和 Token 构成动态选择</span></button><button class="${strategy === 'fixed' ? 'active' : ''}" data-x="strategy-mode" data-mode="fixed"><b>固定顺序</b><span>按人工优先级调用，失败后顺序降级</span></button></div><div id="x-distribution-panel">${distributionPanel(strategy)}</div></div><div class="x-dialog-foot"><span class="x-muted">分发策略归属模型服务配置，业务路由只引用统一服务名</span><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn primary" data-x="save-distribution">保存并生效</button></div></div>`;
  }

  function distributionPanel(mode) {
    const service = state.services.find(s => s.id === state.editingDistributionId);
    const sources = activeDistributionSources();
    const addPicker = distAddSourcePickerHtml(service);
    if (!sources.length) {
      return `<div class="x-empty-panel" style="margin:0"><strong>尚未添加源模型</strong><p>策略不会预置默认源，请手动添加后再保存生效。</p></div>${addPicker}`;
    }
    if (mode === 'fixed') return `<div class="x-dist-hint"><div>${icon('i-route')}</div><div><strong>固定优先级与自动降级</strong><p>始终尝试序号最小且健康的源服务；异常、限流或配额耗尽时自动进入下一项。</p></div></div><div class="x-source-list fixed" id="x-fixed-source-list">${sources.map((s,i)=>fixedSourceRow(s,i,sources)).join('')}</div>${addPicker}<div class="x-dist-settings"><div class="x-field"><label>单次失败重试</label><select class="x-select"><option>1 次后切换</option><option>2 次后切换</option><option>立即切换</option></select></div><div class="x-field"><label>恢复主源</label><select class="x-select"><option>健康后自动恢复</option><option>保持当前源</option></select></div><div class="x-field"><label>会话一致性</label><select class="x-select"><option>同一会话固定源</option><option>每次请求重新选择</option></select></div></div>`;
    const period = currentPricePeriod();
    const sorted = [...sources].filter(s=>s.enabled).sort((a,b)=>projectedSourceCost(a)-projectedSourceCost(b));
    return `<div class="x-dist-hint cost"><div>${icon('i-wallet')}</div><div><strong>实时成本评估 · 当前${periodLabel(period)}</strong><p>日历规则优先于时段：法定节假日使用节假日价，调休工作日恢复忙闲时；再结合 Token 构成、健康和配额选择。</p></div></div><div class="x-token-profile"><div class="x-field"><label>典型输入 Token</label><input class="x-input" id="x-dist-input" type="number" value="1000000"></div><div class="x-field"><label>典型输出 Token</label><input class="x-input" id="x-dist-output" type="number" value="350000"></div><div class="x-field"><label>价格刷新周期</label><select class="x-select"><option>每 30 秒</option><option>每 1 分钟</option><option>每 5 分钟</option></select></div><button class="btn" data-x="recalculate-cost">重新计算</button></div><div class="x-source-list" id="x-cost-source-list">${sorted.map((s,i)=>costSourceRow(s,i,1000000,350000)).join('')}</div>${addPicker}<div class="x-dist-settings"><div class="x-field"><label>最大 P95 延迟</label><select class="x-select"><option>1,500 ms</option><option>1,000 ms</option><option>不限制</option></select></div><div class="x-field"><label>最低 SLA</label><select class="x-select"><option>99.9%</option><option>99.95%</option><option>99.99%</option></select></div><div class="x-field"><label>配额保护</label><select class="x-select"><option>剩余低于 10% 时排除</option><option>剩余低于 5% 时排除</option><option>关闭</option></select></div></div>`;
  }

  function costSourceRow(source, index, inputTokens, outputTokens) {
    const period = currentPricePeriod();
    const inputPrice = period === 'holiday' ? source.holidayIn : period === 'busy' ? source.busyIn : source.idleIn;
    const outputPrice = period === 'holiday' ? source.holidayOut : period === 'busy' ? source.busyOut : source.idleOut;
    const cost = projectedSourceCost(source,inputTokens,outputTokens);
    return `<div class="x-source-row ${index===0?'selected':''}" data-source-id="${source.id}"><div class="x-rank">${index+1}</div><div class="x-source-name"><strong>${source.provider}</strong><span>${source.source || source.id} · ${source.region || ''}</span></div><div class="x-source-price"><span>输入 / 输出</span><b>¥${inputPrice.toFixed(2)} / ¥${outputPrice.toFixed(2)}</b></div><div class="x-source-cost"><span>预计单次成本</span><b>¥${cost.toFixed(3)}</b></div><div class="x-source-health"><span class="event-chip green">健康</span><small>${source.latency} ms · 配额 ${source.quota}%</small></div><div class="x-order-actions"><button class="x-delete-btn" data-x="dist-remove-source" data-id="${source.id}" title="从策略移除">移除</button></div><button class="x-toggle ${source.enabled?'on':''}" data-x="source-toggle" data-id="${source.id}" aria-label="启用源服务"></button>${index===0?'<em>当前最优</em>':''}</div>`;
  }

  function fixedSourceRow(source, index, list = activeDistributionSources()) {
    return `<div class="x-source-row" data-source-id="${source.id}"><div class="x-rank">${index+1}</div><div class="x-source-name"><strong>${source.provider}</strong><span>${source.source || source.id} · ${source.region || ''}</span></div><div class="x-source-price"><span>忙时输入 / 输出</span><b>¥${Number(source.busyIn).toFixed(2)} / ¥${Number(source.busyOut).toFixed(2)}</b></div><div class="x-source-health"><span class="event-chip green">健康</span><small>${source.latency} ms · SLA ${source.sla}%</small></div><div class="x-order-actions"><button class="x-mini-btn" data-x="source-up" data-id="${source.id}" ${index===0?'disabled':''}>↑</button><button class="x-mini-btn" data-x="source-down" data-id="${source.id}" ${index===list.length-1?'disabled':''}>↓</button><button class="x-delete-btn" data-x="dist-remove-source" data-id="${source.id}" title="从策略移除">移除</button></div><button class="x-toggle ${source.enabled?'on':''}" data-x="source-toggle" data-id="${source.id}" aria-label="启用源服务"></button></div>`;
  }

  const SOURCE_PROVIDER_FILTERS = ['OpenAI', 'Anthropic', 'Google', 'DeepSeek', '阿里云', '腾讯云', '火山引擎', '百度智能云', '华为云', '世纪互联', '私有集群', '其他'];

  function ensureListFilters() {
    if (!state.listFilters) {
      state.listFilters = {
        statuses: ['运行中', '观察中', '已停用', '异常'],
        providers: [...SOURCE_PROVIDER_FILTERS],
        region: '全部区域',
        query: '',
        serviceId: '',
        deploy: '全部',
        capability: '全部',
        billing: '全部'
      };
    }
    const f = state.listFilters;
    let changed = false;
    if (!Array.isArray(f.statuses)) { f.statuses = ['运行中', '观察中', '已停用', '异常']; changed = true; }
    if (!Array.isArray(f.providers)) { f.providers = [...SOURCE_PROVIDER_FILTERS]; changed = true; }
    // 兼容旧缓存：自动勾选新增提供商，避免新接入源被静默隐藏
    SOURCE_PROVIDER_FILTERS.forEach(p => {
      if (!f.providers.includes(p)) {
        f.providers.push(p);
        changed = true;
      }
    });
    if (!f.region) { f.region = '全部区域'; changed = true; }
    if (typeof f.query !== 'string') { f.query = ''; changed = true; }
    if (typeof f.serviceId !== 'string') { f.serviceId = ''; changed = true; }
    if (!['全部', '公有云', '私有化'].includes(f.deploy)) { f.deploy = '全部'; changed = true; }
    if (!['全部', '已声明', '未声明'].includes(f.capability)) { f.capability = '全部'; changed = true; }
    if (!['全部', '已配置', '待配置'].includes(f.billing)) { f.billing = '全部'; changed = true; }
    if (changed) {
      try { localStorage.setItem('aegis-list-filters', JSON.stringify(f)); } catch {}
    }
    return f;
  }

  function filterDrawer() {
    const f = ensureListFilters();
    const statusOpts = ['运行中', '观察中', '已停用', '异常'];
    const providerOpts = SOURCE_PROVIDER_FILTERS;
    const regions = ['全部区域', '中国大陆', '亚太', '北美'];
    return `<div class="x-drawer-head"><div><h2 id="x-drawer-title">源模型筛选</h2><p>作用于「源模型能力接入」列表</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-drawer-body">
        <div class="x-filter-group"><h3>运行状态</h3><div class="x-checks">${statusOpts.map(s => `<label class="x-check"><input type="checkbox" name="listStatus" value="${s}" ${f.statuses.includes(s) ? 'checked' : ''}>${s}</label>`).join('')}</div></div>
        <div class="x-filter-group"><h3>提供商 / 来源</h3><div class="x-checks">${providerOpts.map(p => `<label class="x-check"><input type="checkbox" name="listProvider" value="${p}" ${f.providers.includes(p) ? 'checked' : ''}>${p}</label>`).join('')}</div></div>
        <div class="x-filter-group"><h3>区域</h3><select class="x-select" name="listRegion">${regions.map(r => `<option value="${r}" ${f.region === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      </div>
      <div class="x-drawer-foot"><button class="btn" data-x="reset-filter">重置</button><button class="btn primary" data-x="close">完成</button></div>`;
  }

  function ensureServiceDetailFilters(service) {
    if (!state.serviceDetailFilters || typeof state.serviceDetailFilters !== 'object') {
      state.serviceDetailFilters = { health: ['healthy', 'unhealthy', 'removed'], roles: ['primary', 'backup'], providers: [] };
    }
    const f = state.serviceDetailFilters;
    if (!Array.isArray(f.health) || !f.health.length) f.health = ['healthy', 'unhealthy', 'removed'];
    if (!Array.isArray(f.roles) || !f.roles.length) f.roles = ['primary', 'backup'];
    if (!Array.isArray(f.providers)) f.providers = [];
    const bound = service ? boundModelsForService(service) : [];
    const available = [...new Set(bound.map(m => m.provider || '其他').filter(Boolean))];
    // 提供商选项随当前服务绑定源变化；空数组表示全选
    f._availableProviders = available;
    return f;
  }

  function serviceDetailFilterDrawer() {
    const service = state.services.find(s => s.id === state.currentDetailId) || state.services[0];
    const f = ensureServiceDetailFilters(service);
    const providers = f._availableProviders || [];
    const selectedProviders = f.providers.length ? f.providers : providers;
    const healthOpts = [
      ['healthy', '健康（参与调度）'],
      ['unhealthy', '异常'],
      ['removed', '已摘除 / 未启用']
    ];
    const roleOpts = [
      ['primary', '主优先级'],
      ['backup', '备用优先级']
    ];
    const boundCount = providers.length ? boundModelsForService(service).length : 0;
    return `<div class="x-drawer-head"><div><h2 id="x-drawer-title">本服务通道筛选</h2><p>仅影响当前服务明细中的拓扑 / 绑定源 / 调度展示 · ${service?.name || '—'}</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-drawer-body">
        <div class="x-config-note" style="margin:0 0 14px">${icon('i-route')}<span>筛选项来自本服务已绑定的 ${boundCount} 个源通道，与「源模型能力接入」全局列表筛选相互独立。</span></div>
        <div class="x-filter-group"><h3>通道健康</h3><div class="x-checks">${healthOpts.map(([id, label]) => `<label class="x-check"><input type="checkbox" name="svcDetailHealth" value="${id}" ${f.health.includes(id) ? 'checked' : ''}>${label}</label>`).join('')}</div></div>
        <div class="x-filter-group"><h3>调度角色</h3><div class="x-checks">${roleOpts.map(([id, label]) => `<label class="x-check"><input type="checkbox" name="svcDetailRole" value="${id}" ${f.roles.includes(id) ? 'checked' : ''}>${label}</label>`).join('')}</div></div>
        <div class="x-filter-group"><h3>提供商（本服务已绑定）</h3>
          ${providers.length
            ? `<div class="x-checks">${providers.map(p => `<label class="x-check"><input type="checkbox" name="svcDetailProvider" value="${p}" ${selectedProviders.includes(p) ? 'checked' : ''}>${p}</label>`).join('')}</div>`
            : `<div class="empty-note" style="margin:0">当前服务尚未绑定源模型，绑定后可按提供商筛选通道。</div>`}
        </div>
      </div>
      <div class="x-drawer-foot"><button class="btn" data-x="reset-service-detail-filter">重置</button><button class="btn primary" data-x="apply-service-detail-filter">应用</button></div>`;
  }

  function modelDetailMoreDrawer() {
    const model = state.models.find(m => m.id === state.currentDetailId);
    if (!model) {
      return `<div class="x-drawer-head"><div><h2 id="x-drawer-title">更多</h2><p>未找到源模型</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
        <div class="x-drawer-body"><div class="empty-note">请返回列表重试</div></div>`;
    }
    const service = state.services.find(s => s.id === model.serviceRef) || state.services.find(s => s.serviceId === model.serviceId);
    return `<div class="x-drawer-head"><div><h2 id="x-drawer-title">源模型操作</h2><p>${model.sourceModel || model.name} · 与当前明细页相关</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-drawer-body">
        <div class="x-kv-grid" style="grid-template-columns:1fr;margin-bottom:14px">
          <div class="x-kv"><span>提供商</span><strong>${model.provider || '—'}</strong></div>
          <div class="x-kv"><span>区域</span><strong>${model.region || '—'}</strong></div>
          <div class="x-kv"><span>状态</span><strong>${model.status || '—'}</strong></div>
          <div class="x-kv"><span>绑定服务</span><strong>${service ? `${service.name} · ${service.serviceId}` : '未绑定'}</strong></div>
        </div>
        <div class="x-stack" style="gap:8px">
          <button class="btn" data-x="test-current">连接测试</button>
          <button class="btn" data-x="edit-current">编辑配置</button>
          ${service ? `<button class="btn" data-x="open-service-detail" data-id="${service.id}">查看所属模型服务</button>` : ''}
          <button class="btn x-danger-outline" data-x="delete-entity" data-kind="models" data-id="${model.id}" data-name="${model.sourceModel || model.name}" data-label="源模型">删除源模型</button>
        </div>
      </div>
      <div class="x-drawer-foot"><button class="btn" data-x="close">关闭</button></div>`;
  }

  function channelHealthKey(ch) {
    if (!ch.enabled) return 'removed';
    return ch.healthy ? 'healthy' : 'unhealthy';
  }

  function filterServiceChannels(channels, service = null) {
    const f = ensureServiceDetailFilters(service);
    const healthSet = new Set(f.health || []);
    const roleSet = new Set(f.roles || []);
    const providers = f.providers || [];
    const providerSet = new Set(providers.length ? providers : (f._availableProviders || []));
    return (channels || []).filter(ch => {
      if (healthSet.size && !healthSet.has(channelHealthKey(ch))) return false;
      const role = ch.isBackup ? 'backup' : 'primary';
      if (roleSet.size && !roleSet.has(role)) return false;
      if (providerSet.size && !providerSet.has(ch.provider || '其他')) return false;
      return true;
    });
  }

  function filterBoundModelsForService(service, models = null) {
    const list = models || boundModelsForService(service);
    const f = ensureServiceDetailFilters(service);
    const healthSet = new Set(f.health || []);
    const providers = f.providers || [];
    const available = f._availableProviders || [...new Set(list.map(m => m.provider || '其他'))];
    const providerSet = new Set(providers.length ? providers : available);
    return list.filter(m => {
      const enabled = m.distEnabled !== false && m.status !== '已停用';
      const healthy = m.status !== '异常' && !(m.lastProbe && m.lastProbe.ok === false);
      const health = !enabled ? 'removed' : (healthy ? 'healthy' : 'unhealthy');
      if (healthSet.size && !healthSet.has(health)) return false;
      if (providerSet.size && !providerSet.has(m.provider || '其他')) return false;
      return true;
    });
  }

  function applyServiceDetailFilters({ toastMsg = false } = {}) {
    if ($('[name="svcDetailHealth"]', drawerLayer) || $('[name="svcDetailRole"]', drawerLayer)) {
      const health = $$('input[name="svcDetailHealth"]:checked', drawerLayer).map(i => i.value);
      const roles = $$('input[name="svcDetailRole"]:checked', drawerLayer).map(i => i.value);
      const providers = $$('input[name="svcDetailProvider"]:checked', drawerLayer).map(i => i.value);
      if (!health.length) { toast('请至少保留一种通道健康状态'); return false; }
      if (!roles.length) { toast('请至少保留一种调度角色'); return false; }
      const service = state.services.find(s => s.id === state.currentDetailId);
      const available = ensureServiceDetailFilters(service)._availableProviders || [];
      if (available.length && !providers.length) { toast('请至少保留一个提供商'); return false; }
      state.serviceDetailFilters = { health, roles, providers };
      try { localStorage.setItem('aegis-service-detail-filters', JSON.stringify(state.serviceDetailFilters)); } catch {}
    }
    if (state.currentDetailKind === 'service' && state.currentDetailId) {
      openDetail('service', state.currentDetailId);
    }
    if (toastMsg) toast('已按本服务通道条件刷新明细');
    closeLayers();
    return true;
  }

  function readListFiltersFromDrawer() {
    const cur = ensureListFilters();
    const statuses = $$('input[name="listStatus"]:checked', drawerLayer).map(i => i.value);
    const providers = $$('input[name="listProvider"]:checked', drawerLayer).map(i => i.value);
    const region = $('[name="listRegion"]', drawerLayer)?.value || '全部区域';
    return {
      ...cur,
      statuses,
      providers,
      region
    };
  }

  function modelHasCapabilityDeclared(m) {
    const caps = m?.capabilities || {};
    return Object.values(caps).some(v => v === 'supported' || v === 'limited' || v === 'unsupported');
  }

  function persistListFilters() {
    try { localStorage.setItem('aegis-list-filters', JSON.stringify(ensureListFilters())); } catch {}
  }

  function providerMatchesFilter(provider, selected) {
    if (!selected.length) return true;
    const p = String(provider || '');
    const named = {
      'OpenAI': /OpenAI|Azure OpenAI/i,
      'Anthropic': /Anthropic/i,
      'Google': /Google|Gemini/i,
      'DeepSeek': /DeepSeek|深度求索/i,
      '阿里云': /阿里云|Aliyun|通义|DashScope/i,
      '腾讯云': /腾讯|Tencent/i,
      '火山引擎': /火山|豆包|Volc/i,
      '百度智能云': /百度|Baidu|文心/i,
      '华为云': /华为|Huawei/i,
      '世纪互联': /世纪互联/i,
      '私有集群': /自建|私有|Ollama|vLLM|集群/i
    };
    const hitNamed = selected.some(key => {
      if (named[key]) return named[key].test(p);
      if (key === '其他') return false;
      return p.includes(key);
    });
    if (hitNamed) return true;
    const covered = Object.values(named).some(re => re.test(p));
    // 「其他」或筛选项未覆盖的提供商：默认展示，避免接入后从明细消失
    if (selected.includes('其他') && !covered) return true;
    if (!covered) return true;
    return false;
  }

  function regionMatchesFilter(region, selected) {
    if (!selected || selected === '全部区域') return true;
    const r = String(region || '');
    if (selected === '中国大陆') return /华东|华北|华南|中国|上海|北京|深圳|广州/i.test(r);
    if (selected === '亚太') return /亚太|新加坡|东京|香港/i.test(r);
    if (selected === '北美') return /北美|弗吉尼亚|俄勒冈|美国/i.test(r);
    return r.includes(selected);
  }

  function filteredModels(list = state.models) {
    const f = ensureListFilters();
    const statusSet = new Set(f.statuses || []);
    const q = String(f.query || '').trim().toLowerCase();
    return list.filter(m => {
      if (statusSet.size && !statusSet.has(m.status || '运行中')) return false;
      if (!providerMatchesFilter(m.provider, f.providers || [])) return false;
      if (!regionMatchesFilter(m.region, f.region)) return false;
      if (f.serviceId) {
        const svc = state.services.find(s => s.id === m.serviceRef) || state.services.find(s => s.serviceId === m.serviceId);
        if ((svc?.id || m.serviceRef || '') !== f.serviceId && (svc?.serviceId || m.serviceId || '') !== f.serviceId) return false;
      }
      if (f.deploy === '公有云' && isPrivateSourceModel(m)) return false;
      if (f.deploy === '私有化' && !isPrivateSourceModel(m)) return false;
      if (f.capability === '已声明' && !modelHasCapabilityDeclared(m)) return false;
      if (f.capability === '未声明' && modelHasCapabilityDeclared(m)) return false;
      if (f.billing === '已配置' && !modelPriceSnapshot(m).configured) return false;
      if (f.billing === '待配置' && modelPriceSnapshot(m).configured) return false;
      if (q) {
        const svc = state.services.find(s => s.id === m.serviceRef) || state.services.find(s => s.serviceId === m.serviceId);
        const hay = [
          m.sourceModel, m.name, m.provider, m.region, m.protocol, m.baseUrl, m.status,
          svc?.name, svc?.serviceId, m.serviceId
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function sourceListToolbarHtml() {
    const f = ensureListFilters();
    const serviceOpts = (state.services || []).map(s =>
      `<option value="${s.id}" ${f.serviceId === s.id || f.serviceId === s.serviceId ? 'selected' : ''}>${s.name}</option>`
    ).join('');
    const statusQuick = ['全部状态', '运行中', '观察中', '已停用', '异常'];
    const activeStatus = (f.statuses || []).length === 1 ? f.statuses[0] : '全部状态';
    return `<div class="source-toolbar">
      <label class="member-search source-search">${icon('i-search')}<input id="x-source-search" type="search" placeholder="搜索源模型 / 提供商 / Base URL / 服务" value="${f.query || ''}"></label>
      <select class="mini-select" data-source-filter="statusQuick">
        ${statusQuick.map(s => `<option value="${s}" ${activeStatus === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <select class="mini-select" data-source-filter="serviceId">
        <option value="">全部服务</option>
        ${serviceOpts}
      </select>
      <select class="mini-select" data-source-filter="deploy">
        ${['全部', '公有云', '私有化'].map(v => `<option value="${v}" ${f.deploy === v ? 'selected' : ''}>${v === '全部' ? '部署类型' : v}</option>`).join('')}
      </select>
      <select class="mini-select" data-source-filter="capability">
        ${['全部', '已声明', '未声明'].map(v => `<option value="${v}" ${f.capability === v ? 'selected' : ''}>${v === '全部' ? '能力声明' : v}</option>`).join('')}
      </select>
      <select class="mini-select" data-source-filter="billing">
        ${['全部', '已配置', '待配置'].map(v => `<option value="${v}" ${f.billing === v ? 'selected' : ''}>${v === '全部' ? '计费配置' : v}</option>`).join('')}
      </select>
      <button class="btn" type="button" data-x="open-filter">更多筛选</button>
      <button class="btn" type="button" data-x="reset-source-filters">重置</button>
    </div>`;
  }

  function applyListFilters({ toastMsg = false } = {}) {
    if ($('[name="listStatus"]', drawerLayer) || $('[name="listProvider"]', drawerLayer)) {
      const next = readListFiltersFromDrawer();
      if (!next.statuses.length) {
        toast('请至少保留一个运行状态');
        // 回滚刚才取消的勾选：恢复上一次有效筛选到 UI
        const f = ensureListFilters();
        $$('input[name="listStatus"]', drawerLayer).forEach(i => { i.checked = f.statuses.includes(i.value); });
        return false;
      }
      if (!next.providers.length) {
        toast('请至少保留一个提供商');
        const f = ensureListFilters();
        $$('input[name="listProvider"]', drawerLayer).forEach(i => { i.checked = f.providers.includes(i.value); });
        return false;
      }
      state.listFilters = next;
      localStorage.setItem('aegis-list-filters', JSON.stringify(state.listFilters));
    }
    const page = currentPage();
    if (page === 'model-sources') renderSourcesPage();
    else if (page === 'overview') renderOverviewPage();
    else if (page === 'model-services') renderServicesPage();
    if (toastMsg) toast(`已匹配 ${filteredModels().length} 个源模型`);
    return true;
  }

  function refreshAuditTableOnly() {
    const body = $('#audit-page-body');
    if (!body || !isAuditPage()) {
      renderAuditPage();
      return;
    }
    const view = state.auditView || 'platform';
    const label = auditViewLabel(view);
    const source = auditEventsForView(view);
    const matched = filteredAuditEvents(source).length;
    const total = source.length;
    const count = $('.security-count', body);
    if (count) count.innerHTML = `${label} · 匹配 <strong>${matched}</strong> / ${total} 条<span>${auditScopeHint()} · 保留 365 天</span>`;
    const hint = $('.audit-filter-panel .usage-filter-hint', body);
    const af = state.auditFilters || {};
    if (hint) hint.textContent = `${periodLabelText(af.period, af.customStart, af.customEnd)} · 已匹配 ${matched} 条`;
    const tbody = $('.providers-table tbody', body);
    if (tbody) tbody.innerHTML = auditRowsHtml(view);
  }

  function notificationDrawer() {
    const enabledRules = (state.alertRules || []).filter(r => r.enabled).length;
    const items = [
      {icon:'!', tone:'', title:'DeepSeek V3.2 延迟超过阈值', desc:'P95 延迟达到 1.86 秒，已降低路由权重。', time:'2026-11-04 17:36:18', rule:'上游 P95 延迟超阈'},
      {icon:'已', tone:'background:#e9f8f3;color:#178c70', title:'生产密钥自动轮换完成', desc:'key-prod-cn-03 已更新，调用方无需操作。', time:'2026-11-04 17:20:33', rule:''},
      {icon:'预', tone:'background:#edf3ff;color:#477ee6', title:'月度预算使用达到阈值', desc:`客户服务部门预算使用 66%，规则阈值 ${(state.alertRules||[]).find(r=>r.metric==='预算')?.threshold || '80%'}。`, time:'2026-11-04 15:48:00', rule:'部门预算预警'},
      {icon:'拒', tone:'background:#ffedef;color:#be565b', title:'越权模型调用已拦截', desc:'svc-marketing-test 尝试访问 finance-rag。', time:'2026-11-04 10:58:02', rule:'服务越权防护'}
    ];
    return `<div class="x-drawer-head"><div><h2 id="x-drawer-title">通知中心</h2><p>${state.notifications || 3} 条未读 · ${enabledRules} 条告警规则生效</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-drawer-body">${items.map(n => `<div class="x-notification"><i style="${n.tone}">${n.icon}</i><div><strong>${n.title}</strong><p>${n.desc}${n.rule ? `<br><span class="x-muted">规则 · ${n.rule}</span>` : ''}</p></div><time>${displayDateTime(n.time)}</time></div>`).join('')}</div>
      <div class="x-drawer-foot"><button class="btn" data-x="mark-read">全部标为已读</button><button class="btn" data-x="goto-alerts">告警规则</button><button class="btn primary" data-x="goto-audit">查看审计日志</button></div>`;
  }

  function syncBudgetThresholdUI(value = state.budgetAlertThreshold, scope = drawerLayer) {
    const v = Math.min(100, Math.max(50, Number(value) || 80));
    state.budgetAlertThreshold = v;
    const input = $('[data-x="budget-threshold"]', scope);
    const valueEl = $('[data-budget-threshold-value]', scope);
    const helpEl = $('[data-budget-threshold-help]', scope);
    if (input) {
      input.value = String(v);
      input.setAttribute('aria-valuenow', String(v));
      input.setAttribute('aria-valuetext', `${v}%`);
      input.style.setProperty('--range-progress', `${((v - 50) / 50) * 100}%`);
    }
    if (valueEl) valueEl.textContent = `${v}%`;
    if (helpEl) helpEl.textContent = `预算使用达到 ${v}% 时通知管理员`;
  }

  function costDrawer() {
    const threshold = state.budgetAlertThreshold || 80;
    const progress = ((threshold - 50) / 50) * 100;
    return `<div class="x-drawer-head"><div><h2 id="x-drawer-title">成本分摊规则</h2><p>按 Key 绑定的组织层级或应用归集；调用方无需登录平台</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-drawer-body">
        <div class="x-stack">
          <div class="x-recommendation"><i>01</i><div><strong>按组织层级归集</strong><p>企业 / 部门，以开通时费用归属为准</p></div><button class="x-toggle on" data-x="toggle"></button></div>
          <div class="x-recommendation"><i>02</i><div><strong>按应用归集</strong><p>应用 Key 开放给多方时，费用统一计入该应用</p></div><button class="x-toggle on" data-x="toggle"></button></div>
          <div class="x-recommendation"><i>03</i><div><strong>个人 Key 计入组织</strong><p>只统计具名消耗，不单独出个人应付账单</p></div><button class="x-toggle on" data-x="toggle"></button></div>
          <div class="x-recommendation"><i>04</i><div><strong>缓存命中费用减免</strong><p>命中语义缓存时按实际费用计价</p></div><button class="x-toggle on" data-x="toggle"></button></div>
        </div>
        <div class="x-filter-group x-budget-threshold">
          <div class="x-budget-threshold-head">
            <div><h3>预算预警阈值</h3><p>拖动滑块实时调整通知触发点</p></div>
            <strong data-budget-threshold-value>${threshold}%</strong>
          </div>
          <input class="x-range" type="range" min="50" max="100" step="1" value="${threshold}" data-x="budget-threshold" aria-label="预算预警阈值" aria-valuemin="50" aria-valuemax="100" aria-valuenow="${threshold}" aria-valuetext="${threshold}%" style="--range-progress:${progress}%">
          <div class="x-budget-threshold-scale"><span>50%</span><span>75%</span><span>100%</span></div>
          <span class="x-help" data-budget-threshold-help>预算使用达到 ${threshold}% 时通知管理员</span>
        </div>
      </div>
      <div class="x-drawer-foot"><button class="btn primary" data-x="save-costs">保存规则</button></div>`;
  }

  const auditPlatformEvents = [
    {id:'ap-1',time:'2026-11-04 11:37:09',chip:'配置变更',chipClass:'',title:'路由权重调整',opType:'update',actor:'赵然',actorType:'用户',workspace:'数据分析',target:'route / data-analysis',result:'成功',trace:'tr_a813…1bb0',detail:'将 data-analysis 主权重由 70% 调整为 55%，备用链路提升。',before:{primaryWeight:'70%',backupWeight:'30%'},after:{primaryWeight:'55%',backupWeight:'45%'}},
    {id:'ap-2',time:'2026-11-04 11:24:33',chip:'密钥轮换',chipClass:'orange',title:'自动更新凭证',opType:'update',actor:'system',actorType:'系统',workspace:'全局',target:'customer-app-prod',result:'成功',trace:'tr_c908…31e7',detail:'虚拟 Key customer-app-prod 完成轮换，旧版本宽限 24 小时。',before:{version:'v12',status:'active'},after:{version:'v13',status:'active',graceHours:24}},
    {id:'ap-3',time:'2026-11-04 10:43:27',chip:'权限审批',chipClass:'',title:'临时角色授权',opType:'approve',actor:'林舟',actorType:'审批单',workspace:'数据分析',target:'group / data-insight',result:'成功',trace:'tr_6f31…aa09',detail:'批准数据分析组临时管理员权限，有效期 4 小时。',before:{role:'观察员',expires:null},after:{role:'临时管理员',expires:'4h'}},
    {id:'ap-4',time:'2026-11-04 10:18:05',chip:'成员变更',chipClass:'',title:'添加成员',opType:'create',actor:'赵然',actorType:'用户',workspace:'智能客服',target:'member / 韩澈',result:'成功',trace:'tr_b221…90ae',detail:'新成员韩澈加入企业成员池，状态待激活。',before:null,after:{name:'韩澈',dept:'未分配',status:'待激活'}},
    {id:'ap-5',time:'2026-11-04 09:52:41',chip:'服务发布',chipClass:'green',title:'模型服务更新',opType:'update',actor:'林舟',actorType:'用户',workspace:'全局',target:'service / deepseek-v4',result:'成功',trace:'tr_e014…55c2',detail:'DeepSeek V4 分发策略切换为实时费用最低。',before:{strategy:'fixed'},after:{strategy:'cost'}},
    {id:'ap-6',time:'2026-11-04 09:11:16',chip:'密钥签发',chipClass:'',title:'签发 API Key',opType:'create',actor:'赵然',actorType:'审批单',workspace:'智能客服',target:'key / customer-app-prod',result:'成功',trace:'tr_771c…d3f8',detail:'为智能客服应用签发生产 Key，并绑定 DeepSeek / GPT 服务。',before:null,after:{name:'customer-app-prod',owner:'邓艳峰',services:['deepseek-v4','gpt-5-1']}},
    {id:'ap-7',time:'2026-11-04 08:44:02',chip:'高敏操作',chipClass:'orange',title:'查看 API Key 明文',opType:'reveal',actor:'邓艳峰',actorType:'用户',workspace:'智能客服',target:'key / customer-app-prod',result:'成功',trace:'tr_rveal…9c21',detail:'所有者在控制台查看并复制明文 Key。',before:{revealCount:3},after:{revealCount:4}}
  ];

  const auditPolicyEvents = [
    {id:'pol-1',time:'2026-11-04 11:42:16',chip:'脱敏命中',chipClass:'green',title:'敏感数据脱敏',actor:'svc-customer-agent',workspace:'智能客服',keyName:'customer-app-prod',ownerMemberId:'m-dengyanfeng',target:'route / customer-prod',result:'已脱敏',trace:'tr_4f9a…82c1',policy:'pii-mask-cn-v2',hits:'手机号 ×2',model:'GPT-5.1',detail:'请求正文识别 2 个大陆手机号，按策略替换为掩码后继续上游调用。'},
    {id:'pol-2',time:'2026-11-04 11:31:48',chip:'隐私拦截',chipClass:'orange',title:'身份证号阻断输出',actor:'svc-rd-assistant',workspace:'研发助手',keyName:'rd-assistant-key',ownerMemberId:'m-wangyaomin',target:'service / claude-sonnet-4-5',result:'已改写',trace:'tr_88c1…2aa0',policy:'pii-block-id-v1',hits:'身份证号 ×1',model:'Claude Sonnet 4.5',detail:'模型输出含身份证号，网关在响应侧脱敏后返回调用方。'},
    {id:'pol-3',time:'2026-11-04 11:08:22',chip:'策略命中',chipClass:'green',title:'银行卡号脱敏',actor:'svc-marketing-batch',workspace:'营销内容',keyName:'marketing-batch',ownerMemberId:'m-zhaoran',target:'service / gemini-2-5-pro',result:'已脱敏',trace:'tr_12af…91d4',policy:'pci-mask-card-v3',hits:'银行卡号 ×3',model:'Gemini 2.5 Pro',detail:'批处理提示词中检出 3 个银行卡号，全部掩码后放行。'},
    {id:'pol-4',time:'2026-11-04 10:58:02',chip:'访问拒绝',chipClass:'red',title:'越权模型调用',actor:'svc-marketing-test',workspace:'营销内容',keyName:'marketing-batch',ownerMemberId:'m-zhaoran',target:'model / finance-rag',result:'已拦截',trace:'tr_9d11…43f2',policy:'scope-guard-v2',hits:'未授权服务',model:'finance-rag',detail:'调用方未授权 finance-rag，策略在鉴权后立即拒绝，未触达上游。'},
    {id:'pol-5',time:'2026-11-04 10:21:37',chip:'内容安全',chipClass:'orange',title:'提示词注入告警',actor:'svc-customer-agent',workspace:'智能客服',keyName:'customer-app-prod',ownerMemberId:'m-dengyanfeng',target:'route / customer-prod',result:'已标记',trace:'tr_c44e…7b19',policy:'prompt-inject-v1',hits:'注入模式 ×1',model:'DeepSeek V4',detail:'检测到疑似提示词注入片段，按告警策略记录并继续调用。'},
    {id:'pol-6',time:'2026-11-04 09:46:09',chip:'脱敏命中',chipClass:'green',title:'邮箱地址脱敏',actor:'svc-rd-assistant',workspace:'研发助手',keyName:'rd-assistant-key',ownerMemberId:'m-wangyaomin',target:'service / gpt-5-1',result:'已脱敏',trace:'tr_90dd…4412',policy:'pii-mask-email-v2',hits:'邮箱 ×4',model:'GPT-5.1',hosting:'saas',detail:'用户消息中 4 个邮箱地址被替换为哈希掩码后送入 SaaS 上游。'},
    {id:'pol-7',time:'2026-11-04 09:12:44',chip:'出域拦截',chipClass:'red',title:'出域密钥/凭证拦截',actor:'svc-customer-agent',workspace:'客户服务',keyName:'customer-app-prod',ownerMemberId:'m-dengyanfeng',target:'service / deepseek-v4',result:'已拦截',trace:'tr_e21a…09cf',policy:'egress-block-secret-v1',hits:'疑似私钥 ×1',model:'DeepSeek V4',hosting:'saas',detail:'请求正文检出 PEM 私钥片段，SaaS 出域策略拒绝转发。'},
    {id:'pol-8',time:'2026-11-04 08:55:18',chip:'端点防护',chipClass:'red',title:'本地推理端点拒绝外网调用方',actor:'svc-marketing-test',workspace:'营销内容',keyName:'marketing-batch',ownerMemberId:'m-zhaoran',target:'service / qwen-local-72b',result:'已拦截',trace:'tr_77b0…c1aa',policy:'local-endpoint-acl-v1',hits:'非登记调用方',model:'通义千问 · 本地',hosting:'local',detail:'调用方未在本地端点 ACL 白名单，网关未转发至 VPC 推理节点。'},
    {id:'pol-9',time:'2026-11-04 08:41:02',chip:'资源治理',chipClass:'orange',title:'本地推理突发 QPS 告警',actor:'svc-rd-assistant',workspace:'研发助手',keyName:'rd-assistant-key',ownerMemberId:'m-wangyaomin',target:'service / finance-rag-local',result:'已标记',trace:'tr_55fe…8812',policy:'local-gpu-abuse-v1',hits:'QPS 峰值 3.2×',model:'财务知识库 · 本地',hosting:'local',detail:'单 Key 5 分钟窗口突发超过本地集群基线，告警并继续放行。'}
  ];

  const auditRequestPayloads = {
    'req-1': {
      downReq: { model: 'deepseek-v4', messages: [{ role: 'system', content: '你是智能客服助手。' }, { role: 'user', content: '帮我查一下订单 OD-88219 的物流状态，联系电话是 138****8815。' }], temperature: 0.2, stream: false },
      upReq: { model: 'deepseek-v4', messages: [{ role: 'system', content: '你是智能客服助手。' }, { role: 'user', content: '帮我查一下订单 OD-88219 的物流状态，联系电话是 138********。' }], temperature: 0.2, stream: false },
      upRes: { id: 'chatcmpl-ds-91a2', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: '订单 OD-88219 当前在转运中，预计明日送达。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1820, completion_tokens: 460 } },
      downRes: { id: 'chatcmpl-ds-91a2', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: '订单 OD-88219 当前在转运中，预计明日送达。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1820, completion_tokens: 460 } }
    },
    'req-2': {
      downReq: { model: 'deepseek-v4', messages: [{ role: 'user', content: '请把这段售后话术改得更礼貌一些。' }], temperature: 0.4 },
      upReq: { model: 'gpt-5.1', messages: [{ role: 'user', content: '请把这段售后话术改得更礼貌一些。' }], temperature: 0.4 },
      upRes: { id: 'chatcmpl-gpt-77aa', choices: [{ message: { role: 'assistant', content: '您好，非常抱歉给您带来不便。我们已为您优先处理该售后问题……' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2400, completion_tokens: 810 } },
      downRes: { id: 'chatcmpl-gpt-77aa', choices: [{ message: { role: 'assistant', content: '您好，非常抱歉给您带来不便。我们已为您优先处理该售后问题……' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2400, completion_tokens: 810 }, gateway: { degraded: true, from: 'deepseek-v4', to: 'gpt-5.1' } }
    },
    'req-3': {
      downReq: { model: 'gemini-2-5-pro', messages: [{ role: 'user', content: '生成 20 条双十一促销短文案。' }] },
      upReq: { model: 'gemini-2.5-pro', contents: [{ role: 'user', parts: [{ text: '生成 20 条双十一促销短文案。' }] }] },
      upRes: { error: { code: 429, message: 'Resource exhausted: upstream quota exceeded', status: 'RESOURCE_EXHAUSTED' } },
      downRes: { error: { code: 429, message: 'Upstream quota exhausted', type: 'rate_limit_error', request_id: 'req_12cd…e02' } }
    },
    'req-4': {
      downReq: {
        model: 'claude-sonnet-4-5',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '请审查这段 TypeScript 并给出重构建议。' },
            { type: 'file', file: { filename: 'hooks/useOrderList.ts', mime_type: 'text/typescript', excerpt: 'export function useOrderList() {\n  useEffect(() => { fetchOrders(); }, []);\n  ...\n}' } }
          ]
        }],
        stream: true
      },
      upReq: {
        model: 'claude-sonnet-4-5',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '请审查这段 TypeScript 并给出重构建议。' },
            { type: 'file', file: { filename: 'hooks/useOrderList.ts', mime_type: 'text/typescript', excerpt: 'export function useOrderList() {\n  useEffect(() => { fetchOrders(); }, []);\n  ...\n}' } }
          ]
        }],
        stream: true,
        max_tokens: 2048
      },
      upRes: { type: 'message', role: 'assistant', content: [{ type: 'text', text: '建议将副作用抽离到自定义 hook，并补充边界条件测试……' }], stop_reason: 'end_turn', usage: { input_tokens: 3200, output_tokens: 1100 } },
      downRes: { object: 'chat.completion.chunk', choices: [{ delta: { content: '建议将副作用抽离到自定义 hook，并补充边界条件测试……' }, finish_reason: 'stop' }] },
      files: [
        { kind: 'file', name: 'hooks/useOrderList.ts', mime: 'text/typescript', size: 4820, truncated: false, excerpt: 'export function useOrderList() {\n  useEffect(() => { fetchOrders(); }, []);\n  ...\n}' }
      ]
    },
    'req-5': {
      downReq: { model: 'finance-rag', messages: [{ role: 'user', content: '查询本月财务科目余额。' }] },
      upReq: null,
      upRes: null,
      downRes: { error: { code: 403, message: 'Forbidden: service finance-rag is not authorized for this API key', type: 'authorization_error', policy: 'scope-guard-v2' } },
      files: []
    },
    'req-6': {
      downReq: {
        model: 'claude-sonnet-4-5',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '请对这份 80 页设计文档做摘要。' },
            { type: 'file', file: { filename: 'Aegis-Design-Spec-v3.pdf', mime_type: 'application/pdf', size: 12457890 } }
          ]
        }]
      },
      upReq: {
        model: 'claude-sonnet-4-5',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '请对这份 80 页设计文档做摘要。' },
            { type: 'file', file: { filename: 'Aegis-Design-Spec-v3.pdf', mime_type: 'application/pdf', size: 12457890 } }
          ]
        }],
        max_tokens: 4096
      },
      upRes: null,
      downRes: { error: { code: 504, message: 'Upstream timeout after 30000ms', type: 'timeout_error', request_id: 'req_to…881' } },
      files: [
        { kind: 'file', name: 'Aegis-Design-Spec-v3.pdf', mime: 'application/pdf', size: 12457890, truncated: true, note: '二进制内容已省略，仅保留元数据' }
      ]
    },
    'req-7': {
      downReq: { model: 'deepseek-v4', messages: [{ role: 'user', content: '批量改写以下 50 条商品卖点，保持品牌语气。' }], n: 1 },
      upReq: { model: 'deepseek-v4', messages: [{ role: 'user', content: '批量改写以下 50 条商品卖点，保持品牌语气。' }] },
      upRes: { id: 'chatcmpl-batch-33', choices: [{ message: { role: 'assistant', content: '1. ……\n2. ……\n（共 50 条改写结果）' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5400, completion_tokens: 1900 } },
      downRes: { id: 'chatcmpl-batch-33', choices: [{ message: { role: 'assistant', content: '1. ……\n2. ……\n（共 50 条改写结果）' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5400, completion_tokens: 1900 } }
    }
  };

  const auditRequestEvents = [
    {id:'req-1',time:'2026-11-04 11:44:02',chip:'成功',chipClass:'green',title:'聊天补全',result:'成功',status:200,trace:'tr_req1…a01',requestId:'req_8f21…c10',workspace:'智能客服',keyName:'customer-app-prod',ownerMemberId:'m-dengyanfeng',caller:'svc-customer-agent',service:'DeepSeek V4',source:'阿里云百炼 · deepseek-v4',route:'/v1/chat/completions',latency:642,inTokens:1820,outTokens:460,cost:0.086,retried:false,degraded:false,sampled:true,contentNote:'下行请求已脱敏手机号后转发上游'},
    {id:'req-2',time:'2026-11-04 11:41:18',chip:'降级',chipClass:'orange',title:'聊天补全 · 源切换',result:'成功',status:200,trace:'tr_req2…b22',requestId:'req_77aa…d91',workspace:'智能客服',keyName:'customer-app-prod',ownerMemberId:'m-dengyanfeng',caller:'svc-customer-agent',service:'GPT-5.1',source:'OpenAI · gpt-5.1',route:'/v1/chat/completions',latency:1184,inTokens:2400,outTokens:810,cost:1.24,retried:true,degraded:true,sampled:false,detail:'主源 DeepSeek 超时后切换至 GPT-5.1'},
    {id:'req-3',time:'2026-11-04 11:38:55',chip:'失败',chipClass:'red',title:'上游 429',result:'失败',status:429,trace:'tr_req3…c33',requestId:'req_12cd…e02',workspace:'营销内容',keyName:'marketing-batch',ownerMemberId:'m-zhaoran',caller:'svc-marketing-batch',service:'Gemini 2.5 Pro',source:'Google · gemini-2.5-pro',route:'/v1/chat/completions',latency:210,inTokens:960,outTokens:0,cost:0,retried:true,degraded:false,sampled:false,detail:'上游配额耗尽，网关返回 429'},
    {id:'req-4',time:'2026-11-04 11:36:40',chip:'成功',chipClass:'green',title:'流式补全',result:'成功',status:200,trace:'tr_req4…d44',requestId:'req_90fe…a77',workspace:'研发助手',keyName:'rd-assistant-key',ownerMemberId:'m-wangyaomin',caller:'svc-rd-assistant',service:'Claude Sonnet 4.5',source:'Anthropic · claude-sonnet-4-5',route:'/v1/chat/completions',latency:890,inTokens:3200,outTokens:1100,cost:0.92,retried:false,degraded:false,sampled:true,fileCount:1},
    {id:'req-5',time:'2026-11-04 11:22:11',chip:'拦截',chipClass:'red',title:'越权调用',result:'已拦截',status:403,trace:'tr_9d11…43f2',requestId:'req_forbid…01',workspace:'营销内容',keyName:'marketing-batch',ownerMemberId:'m-zhaoran',caller:'svc-marketing-test',service:'finance-rag',source:'—',route:'/v1/chat/completions',latency:18,inTokens:120,outTokens:0,cost:0,retried:false,degraded:false,sampled:false,detail:'策略 scope-guard-v2 拦截，未触达上游'},
    {id:'req-6',time:'2026-11-04 11:05:33',chip:'超时',chipClass:'orange',title:'上游超时',result:'失败',status:504,trace:'tr_req6…e66',requestId:'req_to…881',workspace:'研发助手',keyName:'rd-assistant-key',ownerMemberId:'m-wangyaomin',caller:'svc-rd-assistant',service:'Claude Sonnet 4.5',source:'Anthropic · claude-sonnet-4-5',route:'/v1/chat/completions',latency:30020,inTokens:1500,outTokens:0,cost:0,retried:true,degraded:false,sampled:false,detail:'上游超过 30s 未返回',fileCount:1},
    {id:'req-7',time:'2026-11-04 10:48:09',chip:'成功',chipClass:'green',title:'批量补全',result:'成功',status:200,trace:'tr_req7…f77',requestId:'req_batch…33',workspace:'营销内容',keyName:'marketing-batch',ownerMemberId:'m-zhaoran',caller:'svc-marketing-batch',service:'DeepSeek V4',source:'腾讯云 TI · deepseek-v4',route:'/v1/chat/completions',latency:760,inTokens:5400,outTokens:1900,cost:0.31,retried:false,degraded:false,sampled:true}
  ];

  function formatAuditFileSize(size) {
    const n = Number(size);
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function extractTextFromPayload(payload) {
    if (payload == null) return '';
    if (typeof payload === 'string') return payload;
    const parts = [];
    const walk = (node) => {
      if (node == null) return;
      if (typeof node === 'string') { parts.push(node); return; }
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node !== 'object') return;
      if (typeof node.text === 'string') parts.push(node.text);
      if (typeof node.content === 'string') parts.push(node.content);
      if (typeof node.excerpt === 'string') parts.push(node.excerpt);
      if (typeof node.input === 'string') parts.push(node.input);
      if (typeof node.prompt === 'string') parts.push(node.prompt);
      if (node.content != null && typeof node.content !== 'string') walk(node.content);
      if (Array.isArray(node.messages)) node.messages.forEach(walk);
      if (Array.isArray(node.choices)) node.choices.forEach(walk);
      if (node.message) walk(node.message);
    };
    walk(payload);
    return parts.join('\n');
  }

  function callLogToAuditEvent(log, index = 0) {
    const status = Number(log.status) || 0;
    const ok = status >= 200 && status < 400;
    const degraded = Array.isArray(log.failoverAttempts) && log.failoverAttempts.length > 1;
    const key = (state.keys || []).find(k => k.id === log.keyId || k.name === log.keyName) || null;
    const service = (state.services || []).find(s => s.serviceId === log.serviceId || s.id === log.serviceRef) || null;
    const files = Array.isArray(log.files) ? log.files : [];
    const requestPayload = log.requestPayload || null;
    const responsePayload = log.responsePayload || null;
    const isProbe = log.audience === 'probe' || log.mode === 'probe' || log.purpose === 'upstream_connectivity_probe';
    let chip = '成功';
    let chipClass = 'green';
    let result = '成功';
    let title = isProbe
      ? '连通性探测'
      : (log.stream ? '流式补全' : (log.route && String(log.route).includes('embed') ? '向量化' : '聊天补全'));
    if (!ok) {
      if (status === 403) { chip = '拦截'; chipClass = 'red'; result = '已拦截'; title = '越权 / 拒绝'; }
      else if (status === 429) { chip = '失败'; chipClass = 'red'; result = '失败'; title = '限流 / 配额'; }
      else if (status === 504 || status === 408) { chip = '超时'; chipClass = 'orange'; result = '失败'; title = '上游超时'; }
      else { chip = '失败'; chipClass = 'red'; result = '失败'; title = `上游 ${status || '错误'}`; }
    } else if (isProbe) {
      chip = '探测'; chipClass = '';
    } else if (degraded) {
      chip = '降级'; chipClass = 'orange'; title = '聊天补全 · 源切换';
    } else if (log.stream) {
      chip = '流式'; chipClass = 'green';
    }
    const id = log.id || `clog-${String(log.time || '').replace(/\D/g, '')}-${index}`;
    const sourceLabel = [log.provider, log.sourceModel || log.sourceName].filter(Boolean).join(' · ') || log.sourceName || '—';
    return {
      id,
      time: log.time || '—',
      chip,
      chipClass,
      title,
      result,
      status,
      trace: log.traceId || id,
      requestId: log.requestId || id,
      workspace: key?.dept || key?.org || '全局',
      dept: key?.dept || '',
      keyName: log.keyName || key?.name || log.keyId || '—',
      ownerMemberId: key?.ownerMemberId || key?.memberId || '',
      caller: log.userId || log.audience || '—',
      service: service?.name || log.serviceId || log.model || '—',
      source: sourceLabel,
      route: log.route || '/v1/chat/completions',
      latency: log.latencyMs,
      inTokens: log.promptTokens || 0,
      outTokens: log.completionTokens || 0,
      cost: log.cost || 0,
      retried: degraded,
      degraded,
      sampled: false,
      fileCount: files.length,
      files,
      detail: ok
        ? `${service?.name || log.serviceId || ''} → ${sourceLabel}`
        : (responsePayload?.error?.message || responsePayload?.note || ''),
      payloads: {
        downReq: requestPayload,
        upReq: requestPayload,
        upRes: responsePayload,
        downRes: responsePayload,
        files
      },
      live: true
    };
  }

  function liveAuditRequestEvents() {
    const logs = Array.isArray(state.callLogs) ? state.callLogs : [];
    return logs.map((log, i) => callLogToAuditEvent(log, i));
  }

  function allAuditRequestEvents() {
    const live = liveAuditRequestEvents();
    return live.length ? live : auditRequestEvents;
  }

  function canViewGlobalAudit() {
    const cfg = window.getActiveRoleConfig?.() || {};
    if (cfg.fullAccess || (cfg.perms || []).includes('cap.all_features')) return true;
    if (cfg.viewProfile === 'auditor') return true;
    const role = cfg.role || '';
    // 超管 / 全局职责角色看全量；其余按部门隔离
    if (/超级管理员|模型服务接入维护|模型key分发审核人|审计人员/.test(role)) return true;
    return false;
  }

  function identityDeptNames() {
    if (canViewGlobalAudit()) return null;
    const me = currentIdentity();
    const dept = me.dept || '';
    if (!dept || dept === '未分配') return new Set();
    if (dept === '安全合规' || dept === '总部 / 平台中心') {
      return new Set(memberDepartments.filter(d => d && d !== '未分配'));
    }
    return new Set([dept]);
  }

  function auditDeptOf(ev) {
    const raw = ev?.dept || ev?.workspace || '';
    if (raw === '智能客服') return '客户服务';
    return raw;
  }

  function auditScopeHint() {
    if (canViewGlobalAudit()) return '全平台可见';
    const names = [...(identityDeptNames() || [])];
    return names.length ? `范围 · ${names.join('、')}` : '范围受限';
  }

  function eventInAuditScope(ev) {
    if (canViewGlobalAudit()) return true;
    const allowed = identityDeptNames();
    if (!allowed || !allowed.size) return false;
    const dept = auditDeptOf(ev);
    if (!dept || dept === '全局') return false;
    if (allowed.has(dept)) return true;
    if (ev.ownerMemberId && ev.ownerMemberId === currentIdentity().id) return true;
    if (ev.keyName) {
      const key = apiKeys().find(k => k.name === ev.keyName || k.id === ev.keyName);
      if (key && isApiKeyOwner(key)) return true;
    }
    return false;
  }

  function auditViewLabel(view = state.auditView) {
    if (view === 'policy') return '策略命中';
    if (view === 'request') return '调用日志';
    return '平台操作';
  }

  function auditEventsForView(view = state.auditView) {
    const raw = view === 'policy' ? auditPolicyEvents : view === 'request' ? allAuditRequestEvents() : auditPlatformEvents;
    return raw.filter(eventInAuditScope);
  }

  function auditEventById(id) {
    return [...auditPlatformEvents, ...auditPolicyEvents, ...auditRequestEvents, ...liveAuditRequestEvents()].find(e => e.id === id) || null;
  }

  function auditChip(ev) {
    return `<span class="event-chip ${ev.chipClass || ''}">${ev.chip}</span>`;
  }

  function auditOpTypeLabel(op) {
    return ({create:'创建', update:'更新', delete:'删除', approve:'审批', reveal:'高敏查看'}[op] || op || '—');
  }

  function auditActorBadge(ev) {
    const type = ev.actorType || '用户';
    const cls = type === '系统' ? 'orange' : type === '审批单' ? '' : 'green';
    return `<span class="event-chip ${cls}">${type}</span> ${ev.actor || '—'}`;
  }

  function formatAuditDiff(obj) {
    if (obj == null) return '—';
    try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
  }

  function resolveAuditPayloads(ev) {
    if (!ev) return null;
    if (ev.payloads) return ev.payloads;
    return auditRequestPayloads[ev.id] || null;
  }

  function auditFilesOf(ev) {
    if (!ev) return [];
    if (Array.isArray(ev.files) && ev.files.length) return ev.files;
    const payloads = resolveAuditPayloads(ev);
    if (Array.isArray(payloads?.files) && payloads.files.length) return payloads.files;
    return [];
  }

  function auditPayloadTabLabel(tab) {
    return ({
      downReq: '下行请求',
      upReq: '上行请求',
      upRes: '上行响应',
      downRes: '下行响应'
    })[tab] || tab;
  }

  function auditPayloadEmptyHint(tab, ev) {
    if (tab === 'upReq' || tab === 'upRes') {
      if (ev?.status === 403 || /拦截/.test(ev?.result || '')) return '请求在网关侧被拦截，未转发上游，故无上行内容。';
      if (tab === 'upRes' && (ev?.status === 504 || /超时/.test(ev?.chip || ''))) return '上游超时未返回正文。';
    }
    return '本条未保留该方向内容（可能未采样或链路未产生）。';
  }

  function auditFilesPanelHtml(ev) {
    const files = auditFilesOf(ev);
    if (!files.length) {
      return `<div class="x-audit-files">
        <div class="x-section-intro" style="padding:0;margin:0 0 10px">
          <div><h3 style="font-size:11px;margin:0">请求文件</h3><p style="margin:4px 0 0;font-size:10px;color:#8c9aa2">多模态图片、文档与附件会随调用日志一并留存（二进制仅保留元数据）</p></div>
          <span class="event-chip">无附件</span>
        </div>
        <div class="x-empty-panel" style="margin:0"><strong>本条无文件</strong><p>请求正文未携带 file / image_url / attachments。</p></div>
      </div>`;
    }
    return `<div class="x-audit-files">
      <div class="x-section-intro" style="padding:0;margin:0 0 10px">
        <div><h3 style="font-size:11px;margin:0">请求文件</h3><p style="margin:4px 0 0;font-size:10px;color:#8c9aa2">共 ${files.length} 个附件 · 文本摘录可直接查看，二进制仅保留元数据</p></div>
        <span class="event-chip green">${files.length} 个文件</span>
      </div>
      <div class="x-audit-file-list">${files.map((f, i) => {
        const kind = f.kind === 'image' ? '图片' : '文件';
        const note = f.note || (f.truncated ? '二进制内容已省略' : '');
        const excerpt = f.excerpt ? `<pre class="x-code x-audit-file-excerpt">${String(f.excerpt).replace(/</g, '&lt;')}</pre>` : '';
        return `<div class="x-audit-file-row">
          <div class="x-audit-file-main">
            <strong>${(f.name || `附件 ${i + 1}`).replace(/</g, '&lt;')}</strong>
            <span>${kind} · ${(f.mime || '未知类型').replace(/</g, '&lt;')} · ${formatAuditFileSize(f.size)}</span>
            ${note ? `<em>${note.replace(/</g, '&lt;')}</em>` : ''}
          </div>
          ${excerpt}
        </div>`;
      }).join('')}</div>
    </div>`;
  }

  function auditPayloadPanelHtml(ev) {
    const payloads = resolveAuditPayloads(ev);
    const tabs = [
      ['downReq', '下行请求', '客户端 → 网关'],
      ['upReq', '上行请求', '网关 → 上游'],
      ['upRes', '上行响应', '上游 → 网关'],
      ['downRes', '下行响应', '网关 → 客户端']
    ];
    let tab = state.auditPayloadTab || 'downReq';
    if (!tabs.some(([id]) => id === tab)) tab = 'downReq';
    const body = payloads ? payloads[tab] : null;
    const pretty = body == null ? null : formatAuditDiff(body);
    const meta = tabs.find(([id]) => id === tab)?.[2] || '';
    const textPreview = extractTextFromPayload(body);
    return `<div class="x-audit-payload" data-audit-payload>
      <div class="x-section-intro" style="padding:0;margin:0 0 10px">
        <div><h3 style="font-size:11px;margin:0">上下行文本</h3><p style="margin:4px 0 0;font-size:10px;color:#8c9aa2">全量保留请求与响应中的文本内容；文件见下方附件区</p></div>
        ${ev?.contentNote ? `<span class="event-chip orange">${ev.contentNote}</span>` : (ev?.sampled ? '<span class="event-chip">采样保留</span>' : '<span class="event-chip green">全量保留</span>')}
      </div>
      <div class="x-subnav x-audit-payload-tabs">${tabs.map(([id, label]) => `<button type="button" class="${tab === id ? 'active' : ''}" data-x="audit-payload-tab" data-tab="${id}">${label}</button>`).join('')}</div>
      <div class="x-audit-payload-meta"><span>${auditPayloadTabLabel(tab)}</span><em>${meta}${textPreview ? ` · 文本 ${textPreview.length} 字` : ''}</em></div>
      ${pretty == null
        ? `<div class="x-empty-panel" style="margin:8px 0"><strong>无${auditPayloadTabLabel(tab)}</strong><p>${auditPayloadEmptyHint(tab, ev)}</p></div>`
        : `<pre class="x-code x-audit-payload-code" data-payload-body>${pretty.replace(/</g, '&lt;')}</pre>`}
      <div class="x-row-actions" style="margin-top:10px">
        <button class="btn" data-x="copy-audit-payload" ${pretty == null ? 'disabled' : ''}>复制当前内容</button>
      </div>
      ${auditFilesPanelHtml(ev)}
    </div>`;
  }

  function auditResultMatches(result, filter) {
    if (!filter) return true;
    const r = String(result || '');
    if (filter === '成功') return /成功|已放行|已脱敏|已标记/.test(r) && !/拦截|拒绝|失败/.test(r);
    if (filter === '拦截') return /拦截|拒绝|失败|超时/.test(r) || /4\d\d|5\d\d/.test(r);
    if (filter === '改写') return /脱敏|改写|降级/.test(r);
    return r.includes(filter);
  }

  function filteredAuditEvents(list) {
    if (!state.auditFilters) state.auditFilters = { period: '最近 24 小时', result: '', keyword: '', customStart: '', customEnd: '' };
    const af = state.auditFilters;
    const kw = (af.keyword || '').trim().toLowerCase();
    return list.filter(ev => {
      if (!auditResultMatches(ev.result, af.result)) return false;
      if (kw) {
        const payloads = resolveAuditPayloads(ev);
        const textBlob = [
          extractTextFromPayload(payloads?.downReq),
          extractTextFromPayload(payloads?.upReq),
          extractTextFromPayload(payloads?.upRes),
          extractTextFromPayload(payloads?.downRes),
          ...(auditFilesOf(ev).map(f => [f.name, f.mime, f.excerpt, f.note].filter(Boolean).join(' ')))
        ].join(' ');
        const hay = [ev.title, ev.actor, ev.target, ev.trace, ev.policy, ev.model, ev.result, ev.hits, ev.workspace, ev.keyName, ev.service, ev.source, ev.requestId, textBlob].join(' ').toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }

  function auditRowsHtml(view = state.auditView) {
    const rows = filteredAuditEvents(auditEventsForView(view));
    if (view === 'request') {
      if (!rows.length) return `<tr><td colspan="10"><div class="empty-note">没有符合筛选条件的调用日志</div></td></tr>`;
      return rows.map(ev => {
        const fileN = Number(ev.fileCount) || auditFilesOf(ev).length || 0;
        return `<tr class="x-clickable" data-x="audit-row" data-id="${ev.id}" data-kind="request">
        <td>${displayDateTime(ev.time)}</td>
        <td>${auditChip(ev)} ${ev.title}</td>
        <td><strong>${ev.keyName || '—'}</strong><br><span class="x-muted">${auditDeptOf(ev) || '—'}</span></td>
        <td><strong>${ev.service || '—'}</strong><br><span class="x-muted">${ev.source || '—'}</span></td>
        <td>${ev.status || '—'}</td>
        <td>${ev.latency != null ? `${ev.latency} ms` : '—'}</td>
        <td>${ev.inTokens || 0} / ${ev.outTokens || 0}</td>
        <td>${fileN ? `<span class="event-chip">${fileN}</span>` : '<span class="x-muted">0</span>'}</td>
        <td>${ev.cost != null ? `¥${Number(ev.cost).toFixed(3)}` : '—'}</td>
        <td>${ev.trace}</td>
      </tr>`;
      }).join('');
    }
    if (view === 'policy') {
      if (!rows.length) return `<tr><td colspan="7"><div class="empty-note">没有符合筛选条件的策略命中</div></td></tr>`;
      return rows.map(ev => `<tr class="x-clickable" data-x="audit-row" data-id="${ev.id}" data-kind="policy">
        <td>${displayDateTime(ev.time)}</td>
        <td>${auditChip(ev)} ${ev.title}</td>
        <td>${ev.actor}<br><span class="x-muted">${ev.model || '—'} · ${auditDeptOf(ev) || '—'}</span></td>
        <td><strong>${ev.policy || '—'}</strong><br><span class="x-muted">${ev.hits || '—'}</span></td>
        <td>${ev.target}</td>
        <td>${ev.result}</td>
        <td>${ev.trace}</td>
      </tr>`).join('');
    }
    if (!rows.length) return `<tr><td colspan="7"><div class="empty-note">没有符合筛选条件的平台操作</div></td></tr>`;
    return rows.map(ev => `<tr class="x-clickable" data-x="audit-row" data-id="${ev.id}" data-kind="platform">
      <td>${displayDateTime(ev.time)}</td>
      <td>${auditChip(ev)} ${ev.title}<br><span class="x-muted">${auditOpTypeLabel(ev.opType)}</span></td>
      <td>${auditActorBadge(ev)}</td>
      <td>${ev.target}<br><span class="x-muted">${auditDeptOf(ev) || '—'}</span></td>
      <td>${ev.result}</td>
      <td>${ev.trace}</td>
    </tr>`).join('');
  }

  function isAuditPage(page = currentPage()) {
    return page === 'audit-platform' || page === 'audit-policy' || page === 'audit-request' || page === 'audit';
  }

  function currentAuditPage() {
    if (state.auditView === 'policy') return 'audit-policy';
    if (state.auditView === 'request') return 'audit-request';
    return 'audit-platform';
  }

  function syncAuditViewFromPage(page = currentPage()) {
    const next = page === 'audit-policy' ? 'policy' : page === 'audit-request' ? 'request' : page === 'audit-platform' ? 'platform' : state.auditView;
    if (next !== state.auditView) {
      state.auditView = next;
      state.selectedAuditId = null;
    } else {
      state.auditView = next;
    }
  }

  function auditNoteForView(view) {
    if (view === 'policy') return '记录模型调用链路中隐私识别、脱敏改写、内容安全与越权拦截等策略命中；规则本体见「安全策略」。';
    if (view === 'request') {
      const live = liveAuditRequestEvents().length;
      return live
        ? `已接入网关真实请求记录 ${live} 条：详情含完整文本与文件元数据（二进制仅留存摘要）。`
        : '全链路调用留痕：详情含请求/响应文本与附件；接入网关后自动展示真实请求记录。';
    }
    return '记录控制台内的配置变更、权限审批、成员与密钥等管理操作；详情含变更前后差异。';
  }

  function auditTableHead(view) {
    if (view === 'request') {
      return `<tr><th>时间</th><th>事件</th><th>密钥 / 部门</th><th>服务 / 上游源</th><th>状态</th><th>延迟</th><th>Token 上/下</th><th>附件</th><th>费用</th><th>追踪 ID</th></tr>`;
    }
    if (view === 'policy') {
      return `<tr><th>时间</th><th>事件</th><th>调用方 / 模型</th><th>策略 / 命中</th><th>目标资源</th><th>结果</th><th>追踪 ID</th></tr>`;
    }
    return `<tr><th>时间</th><th>事件</th><th>操作者</th><th>目标资源</th><th>结果</th><th>追踪 ID</th></tr>`;
  }

  function auditWorkspaceHtml() {
    ensureCustomRangeDefaults();
    syncAuditViewFromPage();
    if (!state.auditFilters) state.auditFilters = { period: '最近 24 小时', result: '', keyword: '', customStart: '', customEnd: '' };
    const view = state.auditView || 'platform';
    const af = state.auditFilters;
    const rangeText = periodLabelText(af.period, af.customStart, af.customEnd);
    const source = auditEventsForView(view);
    const matched = filteredAuditEvents(source).length;
    const exportKind = view === 'policy' ? '策略命中报告' : view === 'request' ? '调用日志报告' : '平台操作报告';
    return `<div id="audit-page-body" class="security-workspace">
      <section class="security-sheet">
        <div class="security-toolbar audit-filter-toolbar">
          <div class="security-count">${auditViewLabel(view)} · 匹配 <strong>${matched}</strong> / ${source.length} 条<span>${auditScopeHint()} · 保留 365 天</span></div>
          <div class="security-toolbar-actions">
            <button class="btn primary" data-x="export-audit" data-kind="${exportKind}">导出报告</button>
          </div>
        </div>
        <div class="usage-filter-panel audit-filter-panel">
          <div class="usage-filter-panel-head">
            <div><h2>筛选条件</h2><p>条件变更后列表实时刷新 · ${auditScopeHint()}</p></div>
            <span class="usage-filter-hint">${rangeText} · 已匹配 ${matched} 条</span>
          </div>
          <div class="usage-filter-bar">
            <div class="usage-filter-group">
              <span class="usage-filter-group-label">时间</span>
              <div class="usage-filter-group-body">
                <label>时间范围<div class="x-time-range-field inline">${timeRangeSelectHtml({ name: 'audit', selected: af.period, selectClass: 'mini-select', extras: ['最近 24 小时', '近 7 天', '近 30 天'], start: af.customStart, end: af.customEnd })}</div></label>
              </div>
            </div>
            <div class="usage-filter-group">
              <span class="usage-filter-group-label">条件</span>
              <div class="usage-filter-group-body">
                <label>结果<select class="mini-select" data-audit-filter="result">
                  <option value="">全部结果</option>
                  <option value="成功" ${af.result === '成功' ? 'selected' : ''}>成功 / 已放行</option>
                  <option value="拦截" ${af.result === '拦截' ? 'selected' : ''}>拦截 / 失败</option>
                  <option value="改写" ${af.result === '改写' ? 'selected' : ''}>脱敏 / 改写 / 降级</option>
                </select></label>
                <label>关键词<input class="x-input mini-select" type="search" data-audit-filter="keyword" placeholder="文本 / 文件名 / Key / 追踪 ID" value="${af.keyword || ''}"></label>
                <div class="usage-filter-actions">
                  <button class="btn" data-x="reset-audit-filter">重置</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="x-config-note" style="margin:12px 16px">${icon('i-log')}<span>${auditNoteForView(view)}</span></div>
        <div class="providers-table security-detail-table">
          <table>
            <thead>${auditTableHead(view)}</thead>
            <tbody>${auditRowsHtml(view)}</tbody>
          </table>
        </div>
      </section>
    </div>`;
  }

  function renderAuditPage() {
    const root = $('#page-content');
    if (!root || !isAuditPage()) return;
    syncAuditViewFromPage();
    let body = $('#audit-page-body', root);
    const html = auditWorkspaceHtml();
    if (!body) root.insertAdjacentHTML('beforeend', html);
    else body.outerHTML = html;
  }

  function auditDrawer() {
    const view = state.auditView || 'platform';
    const ev = auditEventById(state.selectedAuditId) || auditEventsForView(view)[0] || null;
    if (view === 'request' || ev?.requestId) {
      const fileN = Number(ev?.fileCount) || auditFilesOf(ev).length || 0;
      return `<div class="x-drawer-head"><div><h2 id="x-drawer-title">调用日志详情</h2><p>trace_id: ${ev?.trace || '—'} · 含上下行文本与 ${fileN} 个文件</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
        <div class="x-drawer-body">
          <div class="x-kv-grid" style="grid-template-columns:repeat(2,1fr);padding:0">
            <div class="x-kv"><span>结果</span><strong>${ev?.result || '—'}</strong></div>
            <div class="x-kv"><span>HTTP</span><strong>${ev?.status || '—'}</strong></div>
            <div class="x-kv"><span>部门</span><strong>${auditDeptOf(ev) || '—'}</strong></div>
            <div class="x-kv"><span>API Key</span><strong>${ev?.keyName || '—'}</strong></div>
            <div class="x-kv"><span>模型服务</span><strong>${ev?.service || '—'}</strong></div>
            <div class="x-kv"><span>上游源</span><strong>${ev?.source || '—'}</strong></div>
            <div class="x-kv"><span>路由</span><strong>${ev?.route || '—'}</strong></div>
            <div class="x-kv"><span>延迟</span><strong>${ev?.latency != null ? `${ev.latency} ms` : '—'}</strong></div>
            <div class="x-kv"><span>Token 上/下</span><strong>${ev?.inTokens || 0} / ${ev?.outTokens || 0}</strong></div>
            <div class="x-kv"><span>费用</span><strong>${ev?.cost != null ? `¥${Number(ev.cost).toFixed(3)}` : '—'}</strong></div>
            <div class="x-kv"><span>重试 / 降级</span><strong>${ev?.retried ? '是' : '否'} / ${ev?.degraded ? '是' : '否'}</strong></div>
            <div class="x-kv"><span>文本 / 文件</span><strong>全量文本 · ${fileN} 个附件</strong></div>
          </div>
          <h3 style="font-size:11px;margin:22px 0 13px">链路摘要</h3>
          <div class="x-timeline">
            <div class="x-timeline-item"><strong>下行请求进入网关</strong><p>${ev?.caller || '调用方'} · ${ev?.route || '—'}</p></div>
            <div class="x-timeline-item"><strong>${ev?.chip || '调用'} · ${ev?.title || ''}</strong><p>${ev?.detail || `${ev?.service || ''} → ${ev?.source || ''}`}</p></div>
            <div class="x-timeline-item"><strong>下行响应回写</strong><p>${ev?.result || '—'} · request_id ${ev?.requestId || '—'}</p></div>
          </div>
          ${auditPayloadPanelHtml(ev)}
          <h3 style="font-size:11px;margin:20px 0 10px">审计上下文</h3>
          <div class="x-code">trace_id: ${ev?.trace || '—'}\nrequest_id: ${ev?.requestId || '—'}\nkey: ${ev?.keyName || '—'}\nservice: ${ev?.service || '—'}\nsource: ${ev?.source || '—'}\nstatus: ${ev?.status || '—'}\nlatency_ms: ${ev?.latency ?? '—'}</div>
        </div>
        <div class="x-drawer-foot"><button class="btn" data-x="copy-trace">复制追踪 ID</button><button class="btn" data-x="copy-audit-payload">复制当前上下行内容</button><button class="btn primary" data-x="close">完成</button></div>`;
    }
    if (view === 'policy' || ev?.policy) {
      return `<div class="x-drawer-head"><div><h2 id="x-drawer-title">策略命中详情</h2><p>trace_id: ${ev?.trace || '—'}</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
        <div class="x-drawer-body">
          <div class="x-kv-grid" style="grid-template-columns:repeat(2,1fr);padding:0">
            <div class="x-kv"><span>结果</span><strong>${ev?.result || '—'}</strong></div>
            <div class="x-kv"><span>策略</span><strong>${ev?.policy || '—'}</strong></div>
            <div class="x-kv"><span>调用方</span><strong>${ev?.actor || '—'}</strong></div>
            <div class="x-kv"><span>模型</span><strong>${ev?.model || '—'}</strong></div>
            <div class="x-kv"><span>部门</span><strong>${auditDeptOf(ev) || '—'}</strong></div>
            <div class="x-kv"><span>命中项</span><strong>${ev?.hits || '—'}</strong></div>
            <div class="x-kv"><span>目标</span><strong>${ev?.target || '—'}</strong></div>
            <div class="x-kv"><span>API Key</span><strong>${ev?.keyName || '—'}</strong></div>
          </div>
          <h3 style="font-size:11px;margin:22px 0 13px">处理链路</h3>
          <div class="x-timeline">
            <div class="x-timeline-item"><strong>请求进入网关</strong><p>${ev?.actor || '调用方'} · 鉴权通过</p></div>
            <div class="x-timeline-item"><strong>${ev?.chip || '策略命中'} · ${ev?.title || ''}</strong><p>${ev?.detail || '—'}</p></div>
            <div class="x-timeline-item"><strong>结果回写审计</strong><p>${ev?.result || '—'} · 已保留证据字段</p></div>
          </div>
          <h3 style="font-size:11px;margin:20px 0 10px">审计上下文</h3>
          <div class="x-code">trace_id: ${ev?.trace || '—'}\npolicy: ${ev?.policy || '—'}\nhits: ${ev?.hits || '—'}\nmodel: ${ev?.model || '—'}\nresult: ${ev?.result || '—'}</div>
        </div>
        <div class="x-drawer-foot"><button class="btn" data-x="copy-trace">复制追踪 ID</button><button class="btn" data-x="goto-policies">查看策略配置</button><button class="btn primary" data-x="close">完成</button></div>`;
    }
    return `<div class="x-drawer-head"><div><h2 id="x-drawer-title">平台操作详情</h2><p>trace_id: ${ev?.trace || '—'}</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-drawer-body">
        <div class="x-kv-grid" style="grid-template-columns:repeat(2,1fr);padding:0">
          <div class="x-kv"><span>结果</span><strong style="color:#168c70">${ev?.result || '—'}</strong></div>
          <div class="x-kv"><span>操作类型</span><strong>${auditOpTypeLabel(ev?.opType)}</strong></div>
          <div class="x-kv"><span>操作者</span><strong>${ev?.actor || '—'}</strong></div>
          <div class="x-kv"><span>身份</span><strong>${ev?.actorType || '用户'}</strong></div>
          <div class="x-kv"><span>目标资源</span><strong>${ev?.target || '—'}</strong></div>
          <div class="x-kv"><span>部门</span><strong>${auditDeptOf(ev) || '—'}</strong></div>
          <div class="x-kv"><span>时间</span><strong>${displayDateTime(ev?.time)}</strong></div>
          <div class="x-kv"><span>事件</span><strong>${ev?.title || '—'}</strong></div>
        </div>
        <h3 style="font-size:11px;margin:22px 0 13px">操作摘要</h3>
        <div class="x-timeline">
          <div class="x-timeline-item"><strong>${ev?.title || '平台操作'}</strong><p>${ev?.detail || '—'}</p></div>
          <div class="x-timeline-item"><strong>审计落库</strong><p>已写入平台操作日志，可导出合规材料</p></div>
        </div>
        <h3 style="font-size:11px;margin:20px 0 10px">变更前后</h3>
        <div class="x-diff-grid">
          <div><span>变更前</span><pre class="x-code">${formatAuditDiff(ev?.before)}</pre></div>
          <div><span>变更后</span><pre class="x-code">${formatAuditDiff(ev?.after)}</pre></div>
        </div>
        <h3 style="font-size:11px;margin:20px 0 10px">审计上下文</h3>
        <div class="x-code">trace_id: ${ev?.trace || '—'}\nop_type: ${ev?.opType || '—'}\nactor: ${ev?.actor || '—'}\nactor_type: ${ev?.actorType || '—'}\ntarget: ${ev?.target || '—'}\nresult: ${ev?.result || '—'}</div>
      </div>
      <div class="x-drawer-foot"><button class="btn" data-x="copy-trace">复制追踪 ID</button><button class="btn primary" data-x="close">完成</button></div>`;
  }

  function ensureRouteFocus() {
    const focus = state.routeFocus || {};
    const audience = focus.audience === 'personal' ? 'personal' : 'app';
    const env = focus.env === 'test' ? 'test' : 'prod';
    state.routeFocus = { audience, env };
    return state.routeFocus;
  }

  function findGatewayRoute(audience, env) {
    return gatewayRoutes().find(r => r.audience === audience && r.env === env) || null;
  }

  function extrasForFocus(focus = ensureRouteFocus()) {
    return extraRoutes().filter(r => r.audience === focus.audience && r.env === focus.env);
  }

  function routeMethodRowsHtml(route) {
    const methods = route.methods || normalizeRouteMethods();
    return methods.map(m => {
      const path = routeMethodPath(route, m);
      const url = routeFullUrl(route, m);
      return `<div class="x-route-method ${m.on ? '' : 'is-off'}">
        <div class="x-route-method-main">
          <strong>${m.label}</strong>
          <span>${m.protocol} · ${m.desc}</span>
          <code>${path}</code>
        </div>
        <div class="x-route-method-actions">
          <button class="x-mini-btn" data-x="copy-route-url" data-url="${url}">复制</button>
          <button class="x-toggle ${m.on ? 'on' : ''}" data-x="route-method-toggle" data-route-id="${route.id}" data-method-id="${m.id}" aria-label="启用${m.label}"></button>
        </div>
      </div>`;
    }).join('');
  }

  function routeMatrixCellHtml(audience, env, selected) {
    const route = findGatewayRoute(audience, env);
    if (!route) {
      return `<button type="button" class="x-route-matrix-cell is-empty" disabled>
        <span>${audienceLabel(audience)} · ${envLabel(env)}</span>
        <strong>未配置</strong>
      </button>`;
    }
    const methods = route.methods || normalizeRouteMethods();
    const enabled = methods.filter(m => m.on !== false).length;
    const extrasCount = extrasForFocus({ audience, env }).length;
    return `<button type="button" class="x-route-matrix-cell ${selected ? 'is-active' : ''} ${route.on ? '' : 'is-off'}"
        data-x="route-focus" data-audience="${audience}" data-env="${env}">
      <div class="x-route-matrix-top">
        <span class="event-chip ${audience === 'personal' ? 'orange' : 'green'}">${audienceLabel(audience)}</span>
        <span class="event-chip ${env === 'test' ? 'orange' : ''}">${envLabel(env)}</span>
        <em class="${route.on ? 'on' : ''}">${route.on ? '启用' : '停用'}</em>
      </div>
      <strong>${route.endpoint}</strong>
      <span>${routeHost(env).replace(/^https?:\/\//, '')}</span>
      <b>${enabled}/${methods.length} 调用方式${extrasCount ? ` · ${extrasCount} 追加` : ''}</b>
    </button>`;
  }

  function focusedGatewayPanelHtml(route, focus) {
    if (!route) return `<article class="card"><div class="empty-note">未找到对应标准入口</div></article>`;
    const methods = route.methods || normalizeRouteMethods();
    const enabled = methods.filter(m => m.on !== false).length;
    const host = routeHost(route.env);
    const authHint = route.audience === 'personal'
      ? '个人 Key + 企业用户身份头（X-User-Id）'
      : '应用 Key（Bearer），面向系统调用';
    return `<article class="card x-route-focus-card">
      <div class="x-route-focus-head">
        <div>
          <div class="x-route-focus-chips">
            <span class="event-chip ${route.audience === 'personal' ? 'orange' : 'green'}">${audienceLabel(route.audience)}</span>
            <span class="event-chip ${route.env === 'test' ? 'orange' : ''}">${envLabel(route.env)}</span>
            <span class="event-chip ${route.on ? 'green' : ''}">${route.on ? '启用中' : '已停用'}</span>
          </div>
          <h2>${route.name}</h2>
          <p>${authHint} · 上游模型由请求体 <code>model</code> 指定</p>
        </div>
        <div class="x-route-focus-actions">
          <button class="btn" data-x="copy-route-url" data-url="${routeFullUrl(route)}">复制默认地址</button>
          <button class="btn" data-x-detail="route:${route.id}">查看详情</button>
          <label class="x-route-switch">
            <span>${route.on ? '入口启用' : '入口停用'}</span>
            <button class="x-toggle ${route.on ? 'on' : ''}" data-x="route-toggle" data-id="${route.id}" aria-label="启停网关入口"></button>
          </label>
        </div>
      </div>
      <div class="x-kv-grid x-route-focus-kvs">
        <div class="x-kv"><span>环境域名</span><strong>${host.replace(/^https?:\/\//, '')}</strong></div>
        <div class="x-kv"><span>入口前缀</span><strong>${route.endpoint}</strong></div>
        <div class="x-kv"><span>调用方式</span><strong>${enabled} / ${methods.length}</strong></div>
        <div class="x-kv"><span>QPS / 超时</span><strong>${Number(route.qps).toLocaleString('en-US')} · ${route.timeout}s</strong></div>
      </div>
      <div class="x-route-methods">
        <div class="x-route-methods-head">
          <strong>标准调用方式</strong>
          <span>共享该入口的 QPS 与超时 · 至少保留一种启用</span>
        </div>
        ${routeMethodRowsHtml(route)}
      </div>
    </article>`;
  }

  function focusedExtrasHtml(focus, extras) {
    const label = `${audienceLabel(focus.audience)} · ${envLabel(focus.env)}`;
    return `<article class="card x-secondary-card">
      <div class="x-section-intro">
        <div>
          <h2>追加路径</h2>
          <p>仅显示挂在 <strong>${label}</strong> 下的独立 URL · 当前 ${extras.length} 条</p>
        </div>
        <button class="btn primary" data-x="new-route">${icon('i-plus')}追加到此处</button>
      </div>
      ${extras.length ? `<div class="x-route-table">
        <div class="x-route-row x-head x-route-extra-head"><span>名称 / 完整地址</span><span>所属部门</span><span>QPS</span><span>超时</span><span>操作</span></div>
        ${extras.map(r => {
          const url = routeFullUrl(r);
          return `<div class="x-route-row x-route-extra-row">
            <div class="x-route-extra-main" data-x-detail="route:${r.id}">
              <strong>${r.name}</strong>
              <code>${url.replace(/^https?:\/\//, '')}</code>
            </div>
            <span>${r.workspace === '智能客服' ? '客户服务' : (r.workspace || '—')}</span>
            <span>${Number(r.qps).toLocaleString('en-US')}</span>
            <span>${r.timeout} 秒</span>
            <div class="x-row-actions">
              <button class="x-mini-btn" data-x="copy-route-url" data-url="${url}">复制</button>
              <button class="x-toggle ${r.on ? 'on' : ''}" data-x="route-toggle" data-id="${r.id}" aria-label="切换路由状态"></button>
              <button class="x-delete-btn" data-x="delete-entity" data-kind="routes" data-id="${r.id}" data-name="${r.name}" data-label="追加路径">删除</button>
            </div>
          </div>`;
        }).join('')}
      </div>` : `<div class="x-route-extra-empty">该入口下暂无追加路径。日常调用走上方标准调用方式；需要批处理、灰度或固定旧 URL 时可追加。</div>`}
    </article>`;
  }

  function routeRows() {
    ensureGatewayRoutes();
    const focus = ensureRouteFocus();
    const focused = findGatewayRoute(focus.audience, focus.env);
    const extras = extrasForFocus(focus);
    return `<div class="x-route-page">
      <div class="x-config-note">${icon('i-route')}<span>先选 <strong>开放对象 × 环境</strong> 查看对应标准入口；调用方式与追加路径都挂在该入口下。个人入口校验用户身份，应用入口只认应用 Key；生产 / 测试域名隔离。</span></div>
      <section class="x-route-matrix-wrap">
        <div class="x-route-matrix-head">
          <div><strong>标准入口</strong><span>四类固定入口，点选后在下方配置</span></div>
        </div>
        <div class="x-route-matrix" role="tablist" aria-label="标准入口矩阵">
          <div class="x-route-matrix-corner"></div>
          <div class="x-route-matrix-col">生产</div>
          <div class="x-route-matrix-col">测试</div>
          <div class="x-route-matrix-row">个人</div>
          ${routeMatrixCellHtml('personal', 'prod', focus.audience === 'personal' && focus.env === 'prod')}
          ${routeMatrixCellHtml('personal', 'test', focus.audience === 'personal' && focus.env === 'test')}
          <div class="x-route-matrix-row">应用</div>
          ${routeMatrixCellHtml('app', 'prod', focus.audience === 'app' && focus.env === 'prod')}
          ${routeMatrixCellHtml('app', 'test', focus.audience === 'app' && focus.env === 'test')}
        </div>
      </section>
      ${focusedGatewayPanelHtml(focused, focus)}
      ${focusedExtrasHtml(focus, extras)}
    </div>`;
  }

  function sourceExtrasKey(m) {
    return `${m?.id || ''}|${m?.baseUrl || ''}|${m?.sourceModel || m?.name || ''}`;
  }

  function loadSourceExtrasMap() {
    try { return JSON.parse(localStorage.getItem('aegis-source-extras') || '{}') || {}; }
    catch { return {}; }
  }

  function rememberSourceExtras(model) {
    if (!model?.id) return;
    const map = loadSourceExtrasMap();
    const payload = {
      prices: model.prices || {},
      capabilities: model.capabilities || {},
      customCapabilities: model.customCapabilities || '',
      timeout: model.timeout,
      concurrency: model.concurrency,
      retries: model.retries,
      circuit: model.circuit,
      healthCheck: model.healthCheck || ''
    };
    map[model.id] = payload;
    map[sourceExtrasKey(model)] = payload;
    try { localStorage.setItem('aegis-source-extras', JSON.stringify(map)); } catch {}
  }

  function recallSourceExtras(modelLike) {
    const map = loadSourceExtrasMap();
    return map[modelLike?.id] || map[sourceExtrasKey(modelLike)] || null;
  }

  function hasConfiguredPrices(prices) {
    if (!prices || typeof prices !== 'object') return false;
    if (Array.isArray(prices.timeSegments) && prices.timeSegments.some(s => s?.input != null && s.input !== '')) return true;
    return ['busyInput', 'flatInput', 'busyOutput', 'flatOutput', 'busyCache', 'flatCache']
      .some(k => prices[k] != null && prices[k] !== '');
  }

  function modelPriceSnapshot(m) {
    const p = m?.prices || {};
    const timed = p.timePricing === true || p.timePricing === 'true';
    const num = v => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const segments = timed ? normalizeTimeSegments(p) : [];
    const primary = segments.find(s => s.kind === 'busy') || segments[0] || {};
    return {
      configured: hasConfiguredPrices(p),
      timed,
      discount: num(p.discount ?? 100),
      input: num(primary.input ?? p.busyInput ?? p.flatInput),
      output: num(primary.output ?? p.busyOutput ?? p.flatOutput),
      cache: num(primary.cache ?? p.busyCache ?? p.flatCache),
      segments,
      idleIn: num(p.idleInput),
      idleOut: num(p.idleOutput),
      idleCache: num(p.idleCache),
      holidayIn: num(p.holidayInput),
      holidayOut: num(p.holidayOutput),
      holidayCache: num(p.holidayCache),
      unit: p.billingUnit || '每 1M Tokens',
      currency: String(p.currency || 'CNY').split('·')[0].trim() || 'CNY',
      note: p.priceNote || '',
      busyTime: p.busyTime || '',
      idleTime: p.idleTime || ''
    };
  }

  function formatPriceMoney(n) {
    return n == null ? '—' : `¥${Number(n).toFixed(2)}`;
  }

  const SOURCE_BUSY_IDLE_PRICE_HEADERS = [
    '输入（忙/闲时）价格',
    '输出（忙/闲时）价格',
    '缓存命中（忙/闲时）价格'
  ];

  function modelBusyIdlePrices(m) {
    const p = m?.prices || {};
    if (!hasConfiguredPrices(p)) {
      return {
        configured: false,
        timed: false,
        busyIn: null, idleIn: null,
        busyOut: null, idleOut: null,
        busyCache: null, idleCache: null
      };
    }
    const timed = p.timePricing === true || p.timePricing === 'true';
    if (!timed) {
      const inn = p.flatInput ?? p.busyInput ?? null;
      const out = p.flatOutput ?? p.busyOutput ?? null;
      const cache = p.flatCache ?? p.busyCache ?? null;
      return {
        configured: true,
        timed: false,
        busyIn: inn, idleIn: inn,
        busyOut: out, idleOut: out,
        busyCache: cache, idleCache: cache
      };
    }
    const segs = normalizeTimeSegments(p);
    const busy = segs.find(s => s.kind === 'busy') || segs.find(s => s.name === '忙时') || null;
    const idle = segs.find(s => s.kind === 'idle') || segs.find(s => s.name === '闲时') || null;
    const numOr = (v, fallback) => (v == null || v === '' ? fallback : v);
    return {
      configured: true,
      timed: true,
      busyIn: numOr(busy?.input, p.busyInput ?? null),
      idleIn: numOr(idle?.input, p.idleInput ?? null),
      busyOut: numOr(busy?.output, p.busyOutput ?? null),
      idleOut: numOr(idle?.output, p.idleOutput ?? null),
      busyCache: numOr(busy?.cache, p.busyCache ?? null),
      idleCache: numOr(idle?.cache, p.idleCache ?? null)
    };
  }

  function formatBusyIdlePair(busy, idle, timed) {
    const b = (busy == null || busy === '') ? null : Number(busy);
    const i = (idle == null || idle === '') ? null : Number(idle);
    if (b == null && i == null) return '';
    if (!timed || b === i) return b != null ? String(b) : String(i);
    return `${b != null ? b : '—'} / ${i != null ? i : '—'}`;
  }

  function sourceExportPriceValues(m) {
    const prices = modelBusyIdlePrices(m);
    if (!prices.configured) return SOURCE_BUSY_IDLE_PRICE_HEADERS.map(() => '');
    return [
      formatBusyIdlePair(prices.busyIn, prices.idleIn, prices.timed),
      formatBusyIdlePair(prices.busyOut, prices.idleOut, prices.timed),
      formatBusyIdlePair(prices.busyCache, prices.idleCache, prices.timed)
    ];
  }

  function modelBusyIdlePriceCellHtml(busy, idle, timed) {
    const b = (busy == null || busy === '') ? null : Number(busy);
    const i = (idle == null || idle === '') ? null : Number(idle);
    if (b == null && i == null) return `<td class="x-source-price"><span class="x-muted">—</span></td>`;
    if (!timed || b === i) {
      return `<td class="x-source-price"><strong>${formatPriceMoney(b != null ? b : i)}</strong></td>`;
    }
    return `<td class="x-source-price">
      <strong>${formatPriceMoney(b)}</strong><span class="x-muted">忙时</span>
      <strong>${formatPriceMoney(i)}</strong><span class="x-muted">闲时</span>
    </td>`;
  }

  function modelBusyIdlePriceCells(m) {
    const prices = modelBusyIdlePrices(m);
    if (!prices.configured) {
      return `<td class="x-source-price" colspan="3"><span class="x-muted">待重新填写</span><br><button class="x-link-btn" type="button" data-x="edit-model" data-id="${m.id}" data-focus="billing">编辑计费</button></td>`;
    }
    return [
      modelBusyIdlePriceCellHtml(prices.busyIn, prices.idleIn, prices.timed),
      modelBusyIdlePriceCellHtml(prices.busyOut, prices.idleOut, prices.timed),
      modelBusyIdlePriceCellHtml(prices.busyCache, prices.idleCache, prices.timed)
    ].join('');
  }

  function exportSourceModelsDetail(models = filteredModels()) {
    const rows = models || [];
    if (!rows.length) {
      toast('当前没有可导出的源模型');
      return;
    }
    const baseHeaders = [
      '源模型名称', '提供商', '区域', '协议', 'Base URL',
      '绑定服务名称', '服务标识', '状态', '实时延迟', '近30日SLA', '流量占比(%)',
      '计费币种', '计费单位', '采购折扣(%)', '计费模式', '单价说明'
    ];
    const headers = [...baseHeaders, ...SOURCE_BUSY_IDLE_PRICE_HEADERS];
    const csvEscape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = rows.map(m => {
      const service = state.services.find(s => s.id === m.serviceRef) || state.services.find(s => s.serviceId === m.serviceId);
      const snap = modelPriceSnapshot(m);
      const mode = !snap.configured
        ? '未配置'
        : (snap.timed ? '分时段计价' : '统一价格');
      const base = [
        m.sourceModel || m.name || '',
        m.provider || '',
        m.region || '',
        m.protocol || '',
        m.baseUrl || '',
        service?.name || m.name || '',
        service?.serviceId || m.serviceId || '',
        m.status || '',
        m.latency || '',
        m.sla || '',
        m.share ?? '',
        snap.currency || '',
        snap.unit || '',
        snap.discount ?? '',
        mode,
        snap.note || ''
      ];
      return [...base, ...sourceExportPriceValues(m)].map(csvEscape).join(',');
    }).join('\n');
    const headerLine = headers.map(csvEscape).join(',');
    const blob = new Blob(['\uFEFF' + headerLine + '\n' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aegis-source-models-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 800);
    toast(`已导出 ${rows.length} 条源模型明细`);
  }

  function modelDiscountCell(m) {
    const s = modelPriceSnapshot(m);
    if (!s.configured || s.discount == null) return `<span class="x-muted">—</span>`;
    return `<strong>${s.discount}%</strong><br><span class="x-muted">采购折扣</span>`;
  }

  function modelBillingDetailHtml(model) {
    const s = modelPriceSnapshot(model);
    if (!s.configured) {
      return `<article class="card"><div class="card-head"><div><h2>计费详情</h2><p>网关中尚无该源的计费快照</p></div>
        <button class="btn primary" data-x="edit-model" data-id="${model.id}" data-focus="billing">重新填写计费</button></div>
        <div class="x-test-result show"><span>此前接入时计费未写入网关。点击后将直达计费步骤；服务信息与上游 Key 若已缓存会自动沿用，无需重填。</span><b>待配置</b></div>
      </article>`;
    }
    const modeLabel = s.timed ? `分时段计价 · ${s.segments?.length || 0} 段` : '统一价格';
    const settleRows = s.timed
      ? `${(s.segments || []).map(seg =>
          `<div class="x-kv"><span>${seg.name || '时段'} ${seg.start}–${seg.end}</span><strong>输入 ${formatPriceMoney(seg.input)} / 输出 ${formatPriceMoney(seg.output)} / 缓存 ${formatPriceMoney(seg.cache)}</strong></div>`
        ).join('')}
         <div class="x-kv"><span>法定节假日</span><strong>输入 ${formatPriceMoney(s.holidayIn)} / 输出 ${formatPriceMoney(s.holidayOut)} / 缓存 ${formatPriceMoney(s.holidayCache)}</strong></div>`
      : `<div class="x-kv"><span>统一结算价</span><strong>输入 ${formatPriceMoney(s.input)} / 输出 ${formatPriceMoney(s.output)} / 缓存 ${formatPriceMoney(s.cache)}</strong></div>`;
    return `<article class="card"><div class="card-head"><div><h2>计费详情</h2><p>${s.currency} · ${s.unit} · ${modeLabel}</p></div>
      <button class="btn" data-x="edit-model" data-id="${model.id}" data-focus="billing">编辑计费</button></div>
      <div class="x-kv-grid">
        <div class="x-kv"><span>采购折扣</span><strong>${s.discount != null ? `${s.discount}%` : '—'}</strong></div>
        <div class="x-kv"><span>计费模式</span><strong>${modeLabel}</strong></div>
        ${settleRows}
        <div class="x-kv"><span>单价说明</span><strong>${s.note || '—'}</strong></div>
      </div>
    </article>`;
  }

  function modelCapabilityBrief(m) {
    const caps = m?.capabilities || {};
    const values = Object.values(caps);
    if (!values.length) return `<span class="x-muted">未声明</span>`;
    const supported = values.filter(v => v === 'supported').length;
    const limited = values.filter(v => v === 'limited').length;
    return `<strong>${supported} 支持</strong><br><span class="x-muted">${limited ? `${limited} 受限 · ` : ''}${values.length} 项已声明</span>`;
  }

  function modelRows(mode = 'sources') {
    const rows = filteredModels();
    if (!rows.length) {
      return mode === 'overview'
        ? ''
        : '';
    }
    return rows.map((m,index)=>{
      const service = state.services.find(s => s.id === m.serviceRef) || state.services.find(s => s.serviceId === m.serviceId);
      const logo = (m.sourceModel || m.name || 'MO').slice(0,2).toUpperCase();
      const title = mode === 'overview' ? (service?.name || m.name) : (m.sourceModel || m.name);
      const protocol = m.protocol ? String(m.protocol).split('·')[0].trim() : '';
      const subtitle = mode === 'overview'
        ? `${m.provider} · ${m.region}`
        : `${m.provider} · ${m.region}${protocol ? ` · ${protocol}` : ''}`;
      if (mode === 'overview') {
        return `<tr class="x-clickable" data-x-detail="model:${m.id}"><td><div class="provider"><div class="provider-logo" style="--logo:${['#101010','#d97858','#3a71df','#6241c7','#14866d'][index%5]}">${logo}</div><div><strong>${title}</strong><span>${subtitle}</span></div></div></td><td><div class="latency ${m.status==='观察中'?'warn':''}"><i></i> ${m.latency}</div></td><td>${m.sla}</td><td><div class="meter"><span style="width:${m.share}%;${m.status==='观察中'?'background:#ef9d4d':''}"></span></div></td><td><span class="event-chip ${m.status==='运行中'?'green':'orange'}">${m.status}</span></td></tr>`;
      }
      return `<tr class="x-clickable" data-x-detail="model:${m.id}">
        <td><div class="provider"><div class="provider-logo" style="--logo:${['#101010','#d97858','#3a71df','#6241c7','#14866d'][index%5]}">${logo}</div><div><strong>${title}</strong><span>${subtitle}</span></div></div></td>
        <td><strong>${service?.name || m.name}</strong><br><span class="x-muted">${service?.serviceId || m.serviceId || '—'}</span></td>
        ${modelBusyIdlePriceCells(m)}
        <td class="x-source-discount">${modelDiscountCell(m)}</td>
        <td>${modelCapabilityBrief(m)}</td>
        <td><div class="latency ${m.status==='观察中'?'warn':''}"><i></i> ${m.latency || '—'}</div></td>
        <td>${m.sla || '—'}</td>
        <td><div class="meter"><span style="width:${m.share || 0}%;${m.status==='观察中'?'background:#ef9d4d':''}"></span></div><span class="x-muted">${m.share || 0}%</span></td>
        <td><div class="x-row-actions"><span class="event-chip ${m.status==='运行中'?'green': m.status==='异常'?'red':'orange'}">${m.status || '—'}</span><button class="x-mini-btn" data-x="row-menu">详情</button><button class="x-delete-btn" data-x="delete-entity" data-kind="models" data-id="${m.id}" data-name="${m.sourceModel || m.name}" data-label="源模型">删除</button></div></td>
      </tr>`;
    }).join('');
  }

  function serviceStrategyLabel(strategy) {
    return strategy === 'cost' ? '实时费用最低' : '固定顺序';
  }

  function serviceCurrentHit(service) {
    const strategy = service.strategy || 'fixed';
    const bound = boundModelsForService(service).map((m, i) => modelToDistSource(m, i));
    if (!bound.length) return '待添加源';
    const selected = strategy === 'fixed'
      ? bound.find(s => s.enabled)
      : [...bound].filter(s => s.enabled).sort((a, b) => projectedSourceCost(a) - projectedSourceCost(b))[0];
    return selected?.provider || selected?.source || '无可用源';
  }

  function serviceChannelPalette(i = 0) {
    return ['#4f7ff0', '#12a984', '#f0a24d', '#6bb7e8', '#8b6fe8', '#d97858'][i % 6];
  }

  function buildServiceRoutingSnapshot(service) {
    const models = boundModelsForService(service);
    const strategy = service?.strategy || 'fixed';
    const sources = models.map((m, i) => modelToDistSource(m, i));
    const enabled = sources.filter(s => s.enabled);
    const ordered = strategy === 'cost'
      ? [...enabled].sort((a, b) => projectedSourceCost(a) - projectedSourceCost(b))
      : enabled;
    const primaryCount = Math.max(1, ordered.length > 1 ? ordered.length - 1 : ordered.length);
    const primaries = ordered.slice(0, primaryCount);
    const backup = ordered.length > 1 ? ordered[ordered.length - 1] : null;
    const primaryPool = backup && primaries[primaries.length - 1]?.id === backup.id
      ? primaries.slice(0, -1)
      : primaries;
    const finalPrimaries = primaryPool.length ? primaryPool : primaries;

    let weights = [];
    if (strategy === 'cost' && finalPrimaries.length) {
      const inv = finalPrimaries.map(s => 1 / Math.max(projectedSourceCost(s), 0.01));
      const sum = inv.reduce((a, b) => a + b, 0) || 1;
      weights = inv.map(v => Math.round(v / sum * 100));
    } else if (finalPrimaries.length) {
      const base = Array.from({ length: finalPrimaries.length }, (_, i) => Math.max(1, finalPrimaries.length - i));
      const sum = base.reduce((a, b) => a + b, 0) || 1;
      weights = base.map(v => Math.round(v / sum * 100));
    }
    if (weights.length) {
      const drift = 100 - weights.reduce((a, b) => a + b, 0);
      weights[0] = Math.max(1, weights[0] + drift);
    }

    const keyRefs = apiKeys().filter(k => {
      const refs = k.serviceRefs || [];
      return !refs.length || refs.includes(service.id) || refs.includes(service.serviceId) || refs.includes('*');
    });
    const channels = ordered.map((s, i) => {
      const model = models.find(m => m.id === s.id);
      const isBackup = backup && s.id === backup.id && ordered.length > 1;
      const primaryIdx = finalPrimaries.findIndex(p => p.id === s.id);
      const weight = isBackup ? 0 : (weights[primaryIdx] || 0);
      const healthy = model?.status !== '异常' && model?.status !== '已停用' && !(model?.lastProbe && model.lastProbe.ok === false);
      const keyTotal = Math.max(1, 2 + (i % 3));
      const keyOk = healthy ? keyTotal : Math.max(0, keyTotal - 1);
      const pick = strategy === 'cost' ? '成本优先' : (isBackup ? '顺序降级' : '权重分流');
      return {
        id: s.id,
        provider: s.provider,
        source: s.source,
        region: s.region || '—',
        latency: s.latency,
        sla: s.sla,
        enabled: s.enabled,
        healthy,
        isBackup,
        weight,
        priority: isBackup ? 50 : 100,
        keysLabel: `${keyOk}/${keyTotal} keys`,
        pick,
        color: serviceChannelPalette(i),
        cost: projectedSourceCost(s)
      };
    });

    const recentWindow = callLogsForService(service, { withinMs: 60_000, limit: 60 });
    const recentAll = recentWindow.length ? recentWindow : callLogsForService(service, { withinMs: 0, limit: 30 });
    const channelById = Object.fromEntries(channels.map(c => [c.id, c]));
    const bars = [...recentAll].reverse().map((log, i) => {
      const ch = channelById[log.sourceId] || channels.find(c => c.source === log.sourceModel) || channels[0];
      const attempts = Array.isArray(log.failoverAttempts) ? log.failoverAttempts : [];
      const retried = attempts.length > 1 || Number(log.status) >= 500;
      return {
        t: i,
        channelId: ch?.id || log.sourceId,
        color: ch?.color || (Number(log.status) >= 400 ? '#e35d6a' : '#4f7ff0'),
        provider: ch?.provider || log.provider || '—',
        retried,
        tokens: formatTokenTriple(log),
        status: log.status
      };
    });
    const retries = bars.filter(b => b.retried).length;
    const timelineMode = recentWindow.length ? '60s' : (bars.length ? 'recent' : 'empty');

    const events = recentAll.slice(0, 12).map(log => {
      const ch = channelById[log.sourceId];
      const channelLabel = ch
        ? `${ch.provider} · ${ch.source}`
        : `${log.provider || '上游'} · ${log.sourceModel || log.sourceName || '—'}`;
      const attempts = Array.isArray(log.failoverAttempts) ? log.failoverAttempts : [];
      const failed = Number(log.status) >= 400;
      const failover = attempts.length > 1;
      let type = 'hit';
      let label = '调度命中';
      if (failed) { type = 'auto-off'; label = '调用失败'; }
      else if (failover) { type = 'failover'; label = '故障转移'; }
      const impact = failed
        ? `HTTP ${log.status}`
        : `${formatTokenTriple(log)}${log.cost != null ? ` · ¥${Number(log.cost).toFixed(4)}` : ''}${log.stream ? ' · 流式' : ''}`;
      return {
        time: (log.time || '—').slice(11) || log.time || '—',
        type,
        label,
        channel: channelLabel,
        impact,
        keyName: log.keyName || '—'
      };
    });
    if (!events.length) {
      events.push({ time: '—', type: 'idle', label: '暂无调用', channel: '—', impact: '使用代理 Key 调用后将显示真实调度与 Token' });
    }

    const totals = recentAll.reduce((acc, log) => {
      acc.prompt += Number(log.promptTokens || 0);
      acc.completion += Number(log.completionTokens || 0);
      acc.cached += Number(log.cachedTokens || 0);
      acc.cost += Number(log.cost || 0);
      return acc;
    }, { prompt: 0, completion: 0, cached: 0, cost: 0 });

    return {
      service,
      strategy,
      channels,
      candidateCount: channels.length,
      primaryCount: channels.filter(c => !c.isBackup).length,
      backupCount: channels.filter(c => c.isBackup).length,
      currentHit: (() => {
        const last = recentAll[0];
        if (last?.sourceId && channelById[last.sourceId]) return channelById[last.sourceId];
        return channels.find(c => !c.isBackup && c.enabled && c.healthy) || channels[0] || null;
      })(),
      bars,
      retries,
      totalRequests: bars.length,
      timelineMode,
      tokenTotals: totals,
      events: events.slice(0, 10),
      keyCount: keyRefs.length
    };
  }

  function filteredServices() {
    const filter = state.serviceHostingFilter || '全部';
    return state.services.filter(s => {
      if (filter === 'SaaS') return s.hosting !== 'local';
      if (filter === '本地') return s.hosting === 'local';
      return true;
    });
  }

  function serviceRows() {
    const list = filteredServices();
    if (!state.services.length) {
      return `<div class="x-empty-panel"><strong>还没有对外模型服务</strong><p>先创建平台对外提供的服务名称，再手动添加源模型并配置分发策略。</p><button class="btn primary" data-x="new-service">${icon('i-plus')}创建第一个模型服务</button></div>`;
    }
    if (!list.length) {
      return `<div class="empty-note" style="margin:16px">当前筛选下没有服务，请切换「全部 / SaaS / 本地」</div>`;
    }
    return `<div class="providers-table"><table><thead><tr><th>服务名称 / 标识</th><th>部署类型</th><th>已绑源</th><th>分发策略</th><th>当前命中</th><th>启用</th><th>状态</th><th>操作</th></tr></thead><tbody>${list.map((s,index)=>{
      const count = boundModelsForService(s).length;
      const enabled = s.enabled !== false;
      const statusLabel = !enabled ? '已停用' : (count ? '生效中' : '待添加源');
      const hosting = s.hosting === 'local' ? 'local' : 'saas';
      return `<tr class="x-clickable ${enabled ? '' : 'is-disabled'}" data-x-detail="service:${s.id}">
        <td><div class="provider"><div class="provider-logo" style="--logo:${['#273f96','#18333e','#d97858','#3a71df','#14866d'][index%5]}">${s.name.slice(0,2).toUpperCase()}</div><div><strong>${s.name}</strong><span>${s.serviceId} · ${s.modality}</span></div></div></td>
        <td><span class="event-chip ${hostingChipClass(hosting)}">${hostingLabel(hosting)}</span></td>
        <td><strong>${count}</strong> 个源</td>
        <td><span class="event-chip ${s.strategy==='cost'?'green':''}">${serviceStrategyLabel(s.strategy)}</span><br><span class="x-muted">${count ? '异常自动降级' : '需手动添加源'}</span></td>
        <td><strong>${serviceCurrentHit(s)}</strong><br><span class="x-muted">${count ? '已可分发' : '策略为空'}</span></td>
        <td><button class="x-toggle ${enabled ? 'on' : ''}" data-x="service-toggle" data-id="${s.id}" aria-label="启用模型服务"></button></td>
        <td><span class="event-chip ${statusLabel==='生效中'?'green': statusLabel==='已停用'?'':'orange'}">${statusLabel}</span></td>
        <td><div class="x-row-actions">
          <button class="x-mini-btn" data-x="row-menu">详情</button>
          <button class="x-mini-btn" data-x="edit-service" data-id="${s.id}">编辑</button>
          <button class="btn" data-x="configure-distribution" data-id="${s.id}" data-model="${s.serviceId}">配置策略</button>
          <button class="x-mini-btn" data-x="bind-source" data-service="${s.id}">接入源</button>
          <button class="x-delete-btn" data-x="delete-entity" data-kind="services" data-id="${s.id}" data-name="${s.name}" data-label="模型服务">删除</button>
        </div></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function serviceCornerStats() {
    const services = state.services || [];
    const group = (list) => {
      const enabled = list.filter(s => s.enabled !== false);
      const disabled = list.filter(s => s.enabled === false).length;
      const active = enabled.filter(s => boundModelsForService(s).length > 0).length;
      const pending = enabled.filter(s => !boundModelsForService(s).length).length;
      const bound = list.reduce((n, s) => n + boundModelsForService(s).length, 0);
      return { total: list.length, active, pending, disabled, bound };
    };
    const saas = group(services.filter(s => s.hosting !== 'local'));
    const local = group(services.filter(s => s.hosting === 'local'));
    const all = group(services);
    return { all, saas, local };
  }

  function servicesPanel() {
    const stats = serviceCornerStats();
    const filters = ['全部', 'SaaS', '本地'];
    return `<section class="ov-kpi-grid source-kpi-grid service-kpi-grid">
      <article class="card ov-kpi">
        <div class="ov-kpi-top"><span>对外服务</span>${sourceKpiHelp('平台对外统一服务名数量；调用方只感知服务标识，底层源可切换。')}</div>
        <strong>${stats.all.total}</strong>
        <div class="ov-status-row">
          <span class="ok">生效 ${stats.all.active}</span>
          <span class="mute">待添源 ${stats.all.pending}</span>
          <span class="bad">停用 ${stats.all.disabled}</span>
        </div>
      </article>
      <article class="card ov-kpi">
        <div class="ov-kpi-top"><span>SaaS 服务</span>${sourceKpiHelp('托管类型为公有云 / SaaS 的对外服务；安全策略按部署类型分别生效。')}</div>
        <strong>${stats.saas.total}</strong>
        <div class="ov-status-row">
          <span class="ok">生效 ${stats.saas.active}</span>
          <span class="mute">待添源 ${stats.saas.pending}</span>
          <span class="warn">已绑源 ${stats.saas.bound}</span>
        </div>
      </article>
      <article class="card ov-kpi">
        <div class="ov-kpi-top"><span>本地服务</span>${sourceKpiHelp('VPC / 内网 / 本地推理部署的对外服务；可与 SaaS 共用服务名体系。')}</div>
        <strong>${stats.local.total}</strong>
        <div class="ov-status-row">
          <span class="ok">生效 ${stats.local.active}</span>
          <span class="mute">待添源 ${stats.local.pending}</span>
          <span class="warn">已绑源 ${stats.local.bound}</span>
        </div>
      </article>
    </section>
    <article class="card wide-card"><div class="card-head"><div><h2>模型服务与分发策略</h2><p>${stats.all.total} 个对外服务 · SaaS ${stats.saas.total} · 本地 ${stats.local.total} · 当前筛选 ${filteredServices().length} 条</p></div>
      <div class="tabs">${filters.map(f => `<button type="button" class="${state.serviceHostingFilter === f ? 'active' : ''}" data-x="service-hosting-filter" data-filter="${f}">${f}</button>`).join('')}</div>
    </div>
      <div class="x-config-note">${icon('i-route')}<span>对齐 OneGateway：对外服务名（如 <code>enterprise-chat</code>）稳定不变，底层源可切换。分发策略支持<strong>成本优先</strong>与<strong>固定顺序</strong>；上游 5xx / 不可达时自动故障转移。</span></div>
      ${serviceRows()}
    </article>`;
  }

  function isPrivateSourceModel(m) {
    const blob = `${m?.provider || ''} ${m?.region || ''} ${m?.baseUrl || ''} ${m?.protocol || ''}`;
    return /自建|私有|Ollama|vLLM|TGI|集群|VPC|内网|本地|on[- ]?prem/i.test(blob);
  }

  function sourceCornerStats() {
    const models = state.models || [];
    const privateCount = models.filter(isPrivateSourceModel).length;
    const publicCount = Math.max(0, models.length - privateCount);
    const declared = models.filter(m => {
      const caps = m?.capabilities || {};
      return Object.values(caps).some(v => v === 'supported' || v === 'limited' || v === 'unsupported');
    }).length;
    return { publicCount, privateCount, declared, total: models.length, services: (state.services || []).length };
  }

  function sourceKpiHelp(tip) {
    return `<button type="button" class="source-kpi-help" aria-label="${tip}">
      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M6.55 6.15a1.55 1.55 0 0 1 2.85.95c0 .95-.75 1.25-1.35 1.55"/><circle cx="8" cy="11.15" r=".7" fill="currentColor" stroke="none"/></svg>
      <em>${tip}</em>
    </button>`;
  }

  function sourceGroupStatus(models = []) {
    const disabled = models.filter(m => m.status === '已停用').length;
    const abnormal = models.filter(m => m.status === '异常' || (m.lastProbe && m.lastProbe.ok === false)).length;
    const enabled = models.filter(m => m.status === '运行中' || m.status === '观察中').length;
    return {
      enabled: Math.max(enabled, models.length - disabled - abnormal),
      disabled,
      abnormal
    };
  }

  function sourcesPanel() {
    const stats = sourceCornerStats();
    const models = state.models || [];
    const publicStatus = sourceGroupStatus(models.filter(m => !isPrivateSourceModel(m)));
    const privateStatus = sourceGroupStatus(models.filter(isPrivateSourceModel));
    const undeclared = Math.max(0, stats.total - stats.declared);
    return `<section class="ov-kpi-grid source-kpi-grid">
      <article class="card ov-kpi">
        <div class="ov-kpi-top"><span>公有云源</span>${sourceKpiHelp('公有云 / SaaS 源模型数量，如 OpenAI、阿里云、火山等。')}</div>
        <strong>${stats.publicCount}</strong>
        <div class="ov-status-row">
          <span class="ok">启用 ${publicStatus.enabled}</span>
          <span class="mute">停用 ${publicStatus.disabled}</span>
          <span class="bad">异常 ${publicStatus.abnormal}</span>
        </div>
      </article>
      <article class="card ov-kpi">
        <div class="ov-kpi-top"><span>私有化源</span>${sourceKpiHelp(`VPC / 内网私有化推理源数量；当前可绑定对外服务 ${stats.services} 个。`)}</div>
        <strong>${stats.privateCount}</strong>
        <div class="ov-status-row">
          <span class="ok">启用 ${privateStatus.enabled}</span>
          <span class="mute">停用 ${privateStatus.disabled}</span>
          <span class="bad">异常 ${privateStatus.abnormal}</span>
        </div>
      </article>
      <article class="card ov-kpi">
        <div class="ov-kpi-top"><span>已声明能力</span>${sourceKpiHelp('已填写能力声明的源 / 全部源。声明模态与工具能力可避免错误路由。')}</div>
        <strong>${stats.declared}<span class="source-kpi-unit"> / ${stats.total || 0}</span></strong>
        <div class="ov-status-row">
          <span class="ok">已声明 ${stats.declared}</span>
          <span class="mute">全部 ${stats.total}</span>
          <span class="warn">未声明 ${undeclared}</span>
        </div>
      </article>
    </section>
      <article class="card wide-card"><div class="card-head"><div><h2>已接入源模型</h2><p>${state.models.length} 个源 · ${state.models.filter(m=>m.status==='运行中').length} 个运行正常 · 当前筛选 ${filteredModels().length} 条</p></div>
        <button class="btn" data-x="export-sources-detail" ${filteredModels().length ? '' : 'disabled'}>导出明细</button></div>
      ${sourceListToolbarHtml()}
      ${state.services.length ? '' : `<div class="x-config-note warn">${icon('i-bell')}<span>当前还没有对外模型服务。请先到左侧「模型服务配置」创建服务，再回来接入源模型。</span><button class="btn" data-x="goto-create-service">去创建服务</button></div>`}
      <div class="providers-table source-table"><table>
        <colgroup>
          <col class="col-source">
          <col class="col-service">
          <col class="col-price"><col class="col-price"><col class="col-price">
          <col class="col-discount">
          <col class="col-cap">
          <col class="col-latency">
          <col class="col-sla">
          <col class="col-share">
          <col class="col-status">
        </colgroup>
        <thead><tr>
        <th>源模型 / 提供商</th>
        <th>绑定服务</th>
        <th class="col-price-head">输入<br>（忙/闲时）</th>
        <th class="col-price-head">输出<br>（忙/闲时）</th>
        <th class="col-price-head">缓存命中<br>（忙/闲时）</th>
        <th>折扣</th>
        <th>能力</th>
        <th>实时延迟</th>
        <th>近 30 日 SLA</th>
        <th>流量占比</th>
        <th>状态</th>
      </tr></thead><tbody>${modelRows() || `<tr><td colspan="11"><div class="empty-note">${state.models.length ? '没有符合筛选条件的源模型，请调整筛选' : '暂无源模型，点击右上角接入'}</div></td></tr>`}</tbody></table></div></article>`;
  }

  function syncModelNavBadge() {
    const badge = $('.nav-group-count');
    if (badge) badge.textContent = String(state.services.length);
  }

  function renderServicesPage() {
    const panel = $('#x-services-panel');
    if (panel) panel.innerHTML = servicesPanel();
    syncModelNavBadge();
  }

  function renderSourcesPage() {
    const panel = $('#x-sources-panel');
    if (panel) panel.innerHTML = sourcesPanel();
    syncModelNavBadge();
  }

  function callerKeyCount(callerId) {
    return apiKeys().filter(k => k.callerId === callerId || resolveCaller(k)?.id === callerId).length;
  }

  function filteredMembers() {
    const q = (state.memberQuery || '').trim().toLowerCase();
    return state.members.filter(m => {
      const matchFilter = state.memberFilter === '全部' || m.status === state.memberFilter || (state.memberFilter === '未分配' && m.dept === '未分配');
      const matchQuery = !q || [m.name, m.phone, m.userId, m.dept, m.role].join(' ').toLowerCase().includes(q);
      return matchFilter && matchQuery;
    });
  }

  function memberStatusChip(status) {
    if (status === '已激活') return 'green';
    if (status === '待激活') return 'orange';
    return 'red';
  }

  function membersPanel() {
    const readonly = window.getActiveRoleConfig?.()?.readonly;
    const list = filteredMembers();
    const total = state.members.length;
    const active = state.members.filter(m => m.status === '已激活').length;
    const pending = state.members.filter(m => m.status === '待激活').length;
    const disabled = state.members.filter(m => m.status === '已禁用').length;
    const unassigned = state.members.filter(m => m.dept === '未分配').length;
    return `
      <section class="metrics member-metrics">
        <div class="metric-card"><div class="metric-top"><span>成员总数</span></div><strong>${total}</strong><small>企业成员池</small></div>
        <div class="metric-card" style="--tone:#edf3ff;--accent:#427cf3"><div class="metric-top"><span>已激活</span></div><strong>${active}</strong><small>可正常调用</small></div>
        <div class="metric-card" style="--tone:#fff3e8;--accent:#ef8c3b"><div class="metric-top"><span>待激活</span></div><strong>${pending}</strong><small>尚未首次登录</small></div>
        <div class="metric-card" style="--tone:#ffedef;--accent:#be565b"><div class="metric-top"><span>已禁用 / 未分配</span></div><strong>${disabled} / ${unassigned}</strong><small>需关注治理项</small></div>
      </section>
      <article class="card wide-card">
        <div class="card-head">
          <div><h2>企业成员列表</h2><p>支持按姓名、手机号、用户 ID 快速检索 · 不含 Token Plan 席位</p></div>
          <div class="toolbar member-toolbar">
            <label class="member-search">${icon('i-search')}<input id="x-member-search" placeholder="搜索姓名 / 手机号 / 用户ID" value="${state.memberQuery || ''}"></label>
            <select class="mini-select" id="x-member-filter">
              ${['全部','已激活','待激活','已禁用','未分配'].map(f=>`<option ${state.memberFilter===f?'selected':''}>${f}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="x-config-note">${icon('i-shield')}<span>先将用户加入成员池，再分配部门与角色。可设置日/月消耗预算；本原型不包含 Token Plan 席位分配与回收。</span></div>
        <div class="providers-table member-table"><table>
          <thead><tr><th>成员</th><th>用户 ID</th><th>所属部门</th><th>角色</th><th>预算限制</th><th>状态</th><th>加入时间</th><th>操作</th></tr></thead>
          <tbody>${list.length ? list.map(m => {
            const budget = m.budgetType === '不限制' ? '不限制' : m.budgetType === '按天' ? `日预算 ¥${m.dayBudget || '—'}` : `月预算 ¥${m.monthBudget || '—'}`;
            return `<tr>
              <td><div class="provider"><div class="provider-logo" style="--logo:#273f96">${(m.name||'成').slice(0,1)}</div><div><strong>${m.name}</strong><span>${m.phone}</span></div></div></td>
              <td><code class="x-code-inline">${m.userId}</code></td>
              <td>${m.dept}</td>
              <td><span class="role-chip">${m.role}</span></td>
              <td>${budget}</td>
              <td><span class="event-chip ${memberStatusChip(m.status)}">${m.status}</span></td>
              <td>${displayDateTime(m.joined)}</td>
              <td>${readonly ? '<span class="x-muted">只读</span>' : `<div class="x-row-actions">
                <button class="x-mini-btn" data-x="edit-member" data-id="${m.id}">编辑</button>
                <button class="x-mini-btn" data-x="toggle-member" data-id="${m.id}">${m.status==='已禁用'?'启用':'禁用'}</button>
                <button class="x-delete-btn" data-x="delete-entity" data-kind="members" data-id="${m.id}" data-name="${m.name}" data-label="成员">移除</button>
              </div>`}</td>
            </tr>`;
          }).join('') : '<tr><td colspan="8"><div class="empty-note">没有匹配的成员，请调整筛选条件或添加成员</div></td></tr>'}
          </tbody>
        </table></div>
      </article>`;
  }

  function renderMembersPage(keepFocus = false) {
    const panel = $('#x-members-panel');
    if (!panel) return;
    const active = document.activeElement;
    const focusId = keepFocus && active?.id ? active.id : '';
    const caret = keepFocus && active?.selectionStart;
    panel.innerHTML = membersPanel();
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus();
        if (typeof caret === 'number' && el.setSelectionRange) el.setSelectionRange(caret, caret);
      }
    }
  }

  function accessPanel() {
    const roles = roleDefsList();
    const builtin = roles.filter(r => r.builtin);
    const custom = roles.filter(r => !r.builtin);
    const roleRow = (r) => {
      const memberCount = countRoleMembers(r.name) || r.members || 0;
      const locked = isSuperAdminRole(r);
      const tags = (r.perms || []).slice(0, 4).map(id => {
        const item = permissionCatalog.flatMap(g => g.items).find(i => i.id === id);
        return item ? `<span class="x-perm-tag">${item.label}</span>` : '';
      }).join('');
      const more = (r.perms || []).length > 4 ? `<span class="x-perm-tag muted">+${r.perms.length - 4}</span>` : '';
      return `<tr class="${locked ? 'is-disabled' : ''}">
        <td><div class="x-role-name"><strong>${r.name}</strong>${r.builtin ? '<span class="event-chip">内置</span>' : '<span class="event-chip green">自定义</span>'}${locked ? '<span class="event-chip orange">不可编辑</span>' : ''}</div></td>
        <td>${r.scope || '—'}</td>
        <td>${memberCount} 人</td>
        <td><div class="x-perm-tags">${tags}${more || (!r.perms?.length ? '<span class="x-muted">未配置</span>' : '')}</div></td>
        <td><div class="x-row-actions">
          <button class="x-mini-btn" data-x="edit-role" data-id="${r.id}">${locked ? '查看' : '编辑'}</button>
          ${locked
            ? '<span class="x-muted" style="font-size:9px">不可删除</span>'
            : `<button class="x-delete-btn" data-x="delete-entity" data-kind="roleDefs" data-id="${r.id}" data-name="${r.name}" data-label="角色">删除</button>`}
        </div></td>
      </tr>`;
    };
    return `<article class="card wide-card">
        <div class="card-head"><div><h2>角色列表</h2><p>共 ${roles.length} 个角色 · 内置 ${builtin.length} · 自定义 ${custom.length} · 支持编辑 / 删除</p></div></div>
        <div class="providers-table"><table><thead><tr><th>角色</th><th>生效范围</th><th>成员</th><th>权限摘要</th><th>操作</th></tr></thead>
        <tbody>${roles.map(roleRow).join('')}</tbody></table></div>
      </article>
      <article class="card x-secondary-card">
        <div class="x-section-intro"><div><h2>配置说明</h2><p>角色权限决定成员可见页面与可执行操作</p></div></div>
        <div class="x-config-note" style="margin:0">超级管理员权限固定为全部能力，不可编辑或删除。其他角色可编辑权限；删除前需先调整仍在使用该角色的成员。</div>
      </article>`;
  }

  function renderAccessPage() {
    const root = $('#page-content');
    const panel = $('#x-access-panel');
    if (!panel) return;
    const matrixBtn = [...$$('button', root)].find(b => b.textContent.includes('权限矩阵'));
    if (matrixBtn) matrixBtn.dataset.x = 'matrix';
    const createBtn = [...$$('button', root)].find(b => b.textContent.includes('新建角色'));
    if (createBtn) createBtn.dataset.x = 'role';
    panel.innerHTML = accessPanel();
  }


  function apiKeys() { return state.keys.filter(k => k.type === 'api'); }
  function kmsKeys() { return state.keys.filter(k => k.type !== 'api'); }
  function upstreamKmsKeys() {
    return kmsKeys().filter(k => (k.kind || 'upstream') === 'upstream' && k.status !== '已吊销');
  }
  function findKmsKey(id) {
    if (!id) return null;
    return kmsKeys().find(k => k.id === id || k.name === id) || null;
  }
  function resolveKmsLabel(modelOrId) {
    const id = typeof modelOrId === 'string' ? modelOrId : modelOrId?.kmsKeyId;
    const key = findKmsKey(id);
    if (!key) return modelOrId?.kmsKeyName || '未启用 KMS';
    return `${key.name} · ${key.mask || '••••'}`;
  }
  function modelsUsingKms(kmsId) {
    return state.models.filter(m => m.kmsKeyId === kmsId);
  }
  function maskSecret(plain) {
    const text = String(plain || '').trim();
    if (!text) return '••••';
    if (text.length <= 4) return `•••• ${text}`;
    return `•••• ${text.slice(-4)}`;
  }
  function kmsSelectHtml(selectedId = '') {
    const keys = upstreamKmsKeys();
    if (!keys.length) {
      return `<div class="x-empty-service"><strong>暂无可用的上游密钥</strong><p>可先到侧栏末尾「KMS 密钥托管」录入，或暂不启用继续接入。</p><button class="btn" type="button" data-x="goto-create-kms">去托管密钥</button></div>`;
    }
    return `<select class="x-select" name="kmsKeyId">
      <option value="">请选择 KMS 托管密钥</option>
      ${keys.map(k => `<option value="${k.id}" ${k.id === selectedId ? 'selected' : ''}>${k.name} · ${k.mask || '••••'} · ${k.provider || k.purpose || '上游凭证'}</option>`).join('')}
    </select>
    <span class="x-help">启用后由 KMS 集中托管与轮换；未启用时仍使用本次填写的上游 API Key。</span>
    <div class="x-inline-actions" style="margin-top:8px"><button class="x-link-btn" type="button" data-x="goto-create-kms">没有合适的密钥？去托管</button></div>`;
  }

  function syncUseKmsUI(on) {
    const fields = $('[data-kms-fields]', modalLayer);
    const hint = $('[data-kms-hint]', modalLayer);
    if (fields) fields.hidden = !on;
    if (hint) hint.hidden = !!on;
    if (!on) {
      const sel = $('[name="kmsKeyId"]', modalLayer);
      if (sel) sel.value = '';
    }
  }

  function kmsForm() {
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">托管上游密钥</h2><p>KMS 作为独立加解密服务保存原始 Key；源模型接入时只引用密钥 ID</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body">
        <div class="x-form-grid">
          <div class="x-field"><label class="x-required">密钥别名</label><input class="x-input" name="kmsName" placeholder="例如：openai-prod-secret"><span class="x-error">请输入密钥别名</span></div>
          <div class="x-field"><label>所属服务商</label><select class="x-select" name="kmsProvider"><option>OpenAI</option><option>Anthropic</option><option>Google</option><option>DeepSeek</option><option>阿里云</option><option>腾讯云</option><option>火山引擎</option><option>其他</option></select></div>
          <div class="x-field full"><label class="x-required">原始访问密钥</label><input class="x-input" name="kmsSecret" type="password" placeholder="粘贴服务商 API Key / Secret"><span class="x-help">提交后由 KMS 使用 AES-256-GCM 加密存储，界面仅保留掩码。</span><span class="x-error">请输入原始密钥</span></div>
          <div class="x-field"><label>加密算法</label><select class="x-select" name="kmsAlgorithm"><option>AES-256-GCM</option><option>SM4-GCM</option></select></div>
          <div class="x-field"><label>用途说明</label><input class="x-input" name="kmsPurpose" placeholder="例如：生产环境上游访问凭证" value="上游模型访问凭证"></div>
        </div>
        <div class="x-test-result show" style="margin-top:14px"><span>明文仅在本次提交时进入 KMS，不会写入源模型配置或审计正文</span><b>加解密服务</b></div>
      </div>
      <div class="x-dialog-foot"><span class="x-muted">托管后可在「源模型能力接入」中选择该密钥</span><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn primary" data-x="save-kms">托管到 KMS</button></div></div>`;
  }
  function securityList() { return filteredSecurityApiKeys(); }
  function selectedSecurityKey() {
    return securityList().find(k => k.id === state.selectedKeyId) || null;
  }
  function checkedSecurityKeys() {
    const ids = new Set(state.selectedKeyIds || []);
    return securityList().filter(k => ids.has(k.id));
  }

  function parseTokenAmount(value) {
    const text = String(value || '0').trim();
    const num = parseFloat(text);
    if (!Number.isFinite(num)) return 0;
    if (/m$/i.test(text)) return num * 1e6;
    if (/k$/i.test(text)) return num * 1e3;
    return num;
  }

  function limitModeLabel(mode) {
    return ({ token: '仅 Token 用量', spend: '仅金额消耗', both: 'Token + 金额', none: '不限制' })[mode] || mode || '—';
  }

  function apiKeyServiceCardsHtml(key) {
    const refs = normalizeKeyServiceRefs(key);
    if (!refs.length) {
      return `<div class="x-empty-panel" style="margin:0"><strong>未绑定模型服务</strong><p>请调整限额时勾选至少一个可调用模型服务。</p></div>`;
    }
    return `<div class="x-kv-grid x-api-service-grid">${refs.map(id => {
      const svc = state.services.find(s => s.id === id);
      return svc
        ? `<div class="x-kv"><span>${svc.name}</span><strong>${svc.serviceId}</strong><em>${svc.modality || '—'} · ${svc.status || '—'}</em></div>`
        : `<div class="x-kv"><span>未知服务</span><strong>${id}</strong><em>配置中已失效</em></div>`;
    }).join('')}</div>
      <div class="x-test-result show" style="margin-top:12px"><span>范围绑定自「模型服务配置」；未授权服务的请求将被拒绝</span><b>已授权 ${refs.length} 项</b></div>`;
  }

  function securityApiDetailPanel(key, tab) {
    const usedIn = parseTokenAmount(key.usedIn);
    const usedOut = parseTokenAmount(key.usedOut);
    const maxIn = Number(key.maxInTokens) || 0;
    const maxOut = Number(key.maxOutTokens) || 0;
    const safeInPct = maxIn ? Math.min(100, Math.max(6, Math.round(usedIn / maxIn * 100))) : 28;
    const safeOutPct = maxOut ? Math.min(100, Math.max(6, Math.round(usedOut / maxOut * 100))) : 18;
    const spendPct = key.maxSpend ? Math.min(100, Math.round(Number(key.usedSpend || 0) / Number(key.maxSpend) * 100)) : 22;
    const caller = resolveCaller(key);
    if (tab === 'services') return apiKeyServiceCardsHtml(key);
    if (tab === 'records') {
      const logs = (state.callLogs || []).filter(l => l.keyId === key.id).slice(0, 20);
      if (!logs.length) {
        return `<div class="x-timeline">
          <div class="x-timeline-item"><strong>暂无调用记录</strong><p>使用该 API Key 请求网关后，将显示上下行 / 缓存 Token 与费用</p></div>
          <div class="x-timeline-item"><strong>签发生效</strong><p>${displayDateTime(key.created)} · 限额 ${keyLimitSummary(key)} · 有效期 ${keyExpiryLabel(key)}</p></div>
        </div>`;
      }
      return `<div class="x-timeline">${logs.map(log => `
          <div class="x-timeline-item"><strong>${Number(log.status) < 400 ? '调用成功' : '调用失败'} · ${log.model || '—'}</strong>
            <p>${formatTokenTriple(log)} · ¥${Number(log.cost || 0).toFixed(4)} · ${log.provider || ''} ${log.sourceModel || ''} · ${log.time || '—'}</p>
          </div>`).join('')}
          <div class="x-timeline-item"><strong>累计用量</strong><p>上行 ${key.usedIn || '0'} · 下行 ${key.usedOut || '0'} · 缓存 ${key.usedCache || '0'} · ¥${key.usedSpend || '0.00'}</p></div>
        </div>`;
    }
    return `<div class="x-api-detail">
      <section class="x-api-detail-section">
        <h3>凭证信息</h3>
        <div class="x-kv-grid" style="grid-template-columns:repeat(3,1fr);padding:0">
          <div class="x-kv"><span>Key ID</span><strong>${key.id || '—'}</strong></div>
          <div class="x-kv"><span>Key 别名</span><strong>${key.name || '—'}</strong></div>
          <div class="x-kv"><span>Key 掩码</span><strong>${key.mask || '—'}</strong></div>
          <div class="x-kv"><span>状态</span><strong>${keyStatusLabel(key)}</strong></div>
          <div class="x-kv"><span>创建时间</span><strong>${displayDateTime(key.created)}</strong></div>
          <div class="x-kv"><span>有效期</span><strong>${keyExpiryLabel(key)}</strong></div>
          <div class="x-kv"><span>最近使用</span><strong>${displayDateTime(key.lastUsed)}</strong></div>
          <div class="x-kv"><span>最近轮换 / 更新</span><strong>${displayDateTime(key.rotated)}</strong></div>
          <div class="x-kv"><span>主体类型</span><strong>${keyKindLabel(key.keyKind)} Key</strong></div>
          <div class="x-kv"><span>鉴权方式</span><strong>Authorization: Bearer</strong></div>
          <div class="x-kv"><span>开通场景</span><strong>${keyKindLabel(key.keyKind)} Key</strong></div>
          <div class="x-kv"><span>组织层级</span><strong>${orgLevelLabel(key.orgLevel || 'dept')} · ${key.orgName || '—'}</strong></div>
          <div class="x-kv"><span>费用归属</span><strong>${key.orgName || key.billingDept || '—'}</strong></div>
          <div class="x-kv"><span>付款部门</span><strong>${key.billingDept || '—'}</strong></div>
          <div class="x-kv"><span>所有者（明文）</span><strong>${resolveKeyOwnerMember(key)?.name || key.applicantName || '—'}</strong></div>
        </div>
      </section>
      <section class="x-api-detail-section">
        <h3>${key.keyKind === 'personal' ? '个人主体' : '调用方信息'}</h3>
        <div class="x-kv-grid" style="grid-template-columns:repeat(3,1fr);padding:0">
          ${key.keyKind === 'personal' ? `
          <div class="x-kv"><span>使用员工</span><strong>${resolveKeyOwnerMember(key)?.name || key.applicantName || '—'}</strong></div>
          <div class="x-kv"><span>员工部门</span><strong>${resolveKeyOwnerMember(key)?.dept || key.billingDept || '—'}</strong></div>
          <div class="x-kv"><span>费用归属</span><strong>${key.orgName || '—'} · ${key.billingDept || '—'}</strong></div>
          <div class="x-kv" style="grid-column:span 3"><span>说明</span><strong>个人 Key 费用计入所属部门，不单独出「个人应付」</strong></div>
          ` : `
          <div class="x-kv"><span>调用方名称</span><strong>${resolveCallerLabel(key)}</strong></div>
          <div class="x-kv"><span>所属部门</span><strong>${caller?.ownerDept || key.billingDept || '—'}</strong></div>
          <div class="x-kv"><span>对接人</span><strong>${caller?.contact || '—'}</strong></div>
          <div class="x-kv"><span>调用方状态</span><strong>${caller?.status || '—'}</strong></div>
          <div class="x-kv"><span>调用方创建</span><strong>${displayDateTime(caller?.created)}</strong></div>
          <div class="x-kv"><span>说明</span><strong>${caller?.desc || '—'}</strong></div>
          `}
        </div>
      </section>
      <section class="x-api-detail-section">
        <h3>限额策略</h3>
        <div class="x-kv-grid" style="grid-template-columns:repeat(3,1fr);padding:0">
          <div class="x-kv"><span>限额周期</span><strong>${key.window || '每天'}</strong></div>
          <div class="x-kv"><span>限制方式</span><strong>${limitModeLabel(key.limitMode)}</strong></div>
          <div class="x-kv"><span>超额策略</span><strong>${key.overLimit || '立即拒绝并返回 429'}</strong></div>
          <div class="x-kv"><span>最大上行 Token</span><strong>${formatTokenLimit(key.maxInTokens)}</strong></div>
          <div class="x-kv"><span>最大下行 Token</span><strong>${formatTokenLimit(key.maxOutTokens)}</strong></div>
          <div class="x-kv"><span>最大金额消耗</span><strong>${key.maxSpend ? `¥${key.maxSpend}` : '不限制'}</strong></div>
          <div class="x-kv"><span>有效期</span><strong>${keyExpiryLabel(key)}</strong></div>
          <div class="x-kv" style="grid-column:1/-1"><span>策略摘要</span><strong>${keyLimitSummary(key)}</strong></div>
        </div>
      </section>
      <section class="x-api-detail-section">
        <h3>本周期用量</h3>
        <div class="x-budget" style="padding:0">
          <div class="x-budget-row"><strong>上行 Token</strong><div class="x-budget-track"><span style="width:${safeInPct}%"></span></div><b>${key.usedIn || '0'} / ${formatTokenLimit(key.maxInTokens)}</b></div>
          <div class="x-budget-row"><strong>下行 Token</strong><div class="x-budget-track"><span style="width:${safeOutPct}%;background:#eca055"></span></div><b>${key.usedOut || '0'} / ${formatTokenLimit(key.maxOutTokens)}</b></div>
          <div class="x-budget-row"><strong>缓存命中</strong><div class="x-budget-track"><span style="width:${Math.min(100, Math.max(6, Number(key.usedIn) ? Math.round(Number(key.usedCache || 0) / Math.max(1, Number(key.usedIn)) * 100) : 8))}%;background:#7aa2f7"></span></div><b>${key.usedCache || '0'} / 上行 ${key.usedIn || '0'}</b></div>
          <div class="x-budget-row"><strong>金额消耗</strong><div class="x-budget-track"><span style="width:${spendPct}%;background:#5f86df"></span></div><b>¥${key.usedSpend || '0.00'} / ${key.maxSpend ? `¥${key.maxSpend}` : '∞'}</b></div>
        </div>
      </section>
      <section class="x-api-detail-section">
        <h3>可调用模型服务</h3>
        ${apiKeyServiceCardsHtml(key)}
      </section>
    </div>`;
  }

  function securityKmsDetailPanel(key, tab) {
    const bound = modelsUsingKms(key.id);
    if (tab === 'records') {
      return `<div class="x-timeline">
        <div class="x-timeline-item"><strong>上游调用解密成功</strong><p>内存解密 · 未落盘 · 2026-11-04 17:42:18</p></div>
        <div class="x-timeline-item"><strong>版本 ${displayDateTime(key.rotated) === '—' ? '当前' : displayDateTime(key.rotated)} 生效</strong><p>旧版本宽限 24 小时 · ${displayDateTime(key.rotated)}</p></div>
        ${bound.slice(0, 2).map(m => `<div class="x-timeline-item"><strong>源模型引用解密</strong><p>${m.sourceModel || m.name} · ${m.provider || '—'}</p></div>`).join('')}
      </div>`;
    }
    if (tab === 'policy') {
      return `<div class="activity-list">
        <div class="activity"><div class="activity-icon">已</div><div><strong>自动轮换</strong><p>定期生成新版本，旧版本短暂并存</p></div><button class="x-toggle on" data-x="toggle"></button></div>
        <div class="activity"><div class="activity-icon">已</div><div><strong>双人审批</strong><p>手动轮换需要二次确认</p></div><button class="x-toggle on" data-x="toggle"></button></div>
        <div class="activity"><div class="activity-icon">已</div><div><strong>明文不可导出</strong><p>仅解密到内存供上游调用</p></div><button class="x-toggle on" data-x="toggle"></button></div>
      </div>`;
    }
    if (tab === 'bindings') {
      if (!bound.length) {
        return `<div class="x-empty-panel" style="margin:0"><strong>尚未被源模型引用</strong><p>在「源模型能力接入」中选择该密钥后，将在此展示绑定关系。</p></div>`;
      }
      return `<div class="providers-table" style="margin:0"><table><thead><tr><th>源模型</th><th>服务商</th><th>绑定服务</th><th>状态</th></tr></thead><tbody>
        ${bound.map(m => `<tr><td><strong>${m.sourceModel || m.name}</strong></td><td>${m.provider || '—'}</td><td>${m.name || m.serviceId || '—'}</td><td><span class="event-chip ${m.status==='运行中'?'green':'orange'}">${m.status || '—'}</span></td></tr>`).join('')}
      </tbody></table></div>`;
    }
    return `<div class="x-kv-grid" style="grid-template-columns:repeat(2,1fr);padding:0">
      <div class="x-kv"><span>密钥 ID</span><strong>${key.id}</strong></div>
      <div class="x-kv"><span>类型</span><strong>${(key.kind || 'upstream') === 'master' ? '平台主密钥' : '上游访问凭证'}</strong></div>
      <div class="x-kv"><span>用途</span><strong>${key.purpose || '—'}</strong></div>
      <div class="x-kv"><span>服务商</span><strong>${key.provider || '—'}</strong></div>
      <div class="x-kv"><span>算法</span><strong>${key.algorithm || '—'}</strong></div>
      <div class="x-kv"><span>掩码</span><strong>${key.mask || '—'}</strong></div>
      <div class="x-kv"><span>最近轮换</span><strong>${displayDateTime(key.rotated)}</strong></div>
      <div class="x-kv"><span>创建时间</span><strong>${displayDateTime(key.created)}</strong></div>
      <div class="x-kv"><span>托管位置</span><strong>企业 KMS / HSM</strong></div>
      <div class="x-kv"><span>引用源模型</span><strong>${bound.length} 个</strong></div>
      <div class="x-kv"><span>状态</span><strong>${key.status || '—'}</strong></div>
    </div>
    <div class="x-test-result show" style="margin-top:14px"><span>原始 Key 仅存 KMS；源模型配置只保存密钥引用，调用时按需解密</span><b>加解密</b></div>`;
  }

  function securityDetailHtml() {
    const key = selectedSecurityKey();
    if (!key) {
      return `<div class="x-key-detail-empty">
        <strong>点击明细行查看详情</strong>
        <p>${state.securityTab === 'api' ? '可勾选多条后批量更新限额，或对全部记录全量更新。' : '托管上游原始密钥后，可在源模型接入时选择引用；支持批量或全量轮换。'}</p>
      </div>`;
    }
    const tab = state.securityDetailTab || 'overview';
    if (key.type === 'api') {
      const tabs = [['overview','完整明细'],['services','可调用服务'],['records','最近调用']];
      return `<div class="x-key-detail-head">
          <div><span class="eyebrow">${key.keyKind === 'personal' ? 'PERSONAL API KEY' : 'APP API KEY'}</span><h3>${key.name}</h3><p>${keyKindLabel(key.keyKind)} · ${key.keyKind === 'personal' ? (resolveKeyOwnerMember(key)?.name || key.applicantName || '—') : resolveCallerLabel(key)} · ${key.orgName || key.billingDept || '—'} · ${key.mask}</p></div>
          <div class="x-key-detail-actions">
            <button class="btn" data-x="edit-api-key" data-id="${key.id}">调整限额</button>
            ${keyEnableToggleHtml(key)}
            <button class="btn x-danger-outline" data-x="delete-key" data-id="${key.id}" data-name="${key.name}">删除</button>
          </div>
        </div>
        <div class="x-subnav x-key-subnav">${tabs.map(([id,label]) => `<button type="button" class="${tab===id?'active':''}" data-x="security-detail-tab" data-tab="${id}">${label}</button>`).join('')}</div>
        <div class="x-key-detail-body">${securityApiDetailPanel(key, tab)}</div>`;
    }
    const tabs = [['overview','基本信息'],['bindings','源模型引用'],['policy','安全策略'],['records','加解密记录']];
    return `<div class="x-key-detail-head">
        <div><span class="eyebrow">KMS CRYPTO</span><h3>${key.name}</h3><p>${key.purpose || 'KMS 加解密'} · ${key.algorithm || ''}</p></div>
        <div class="x-key-detail-actions">
          <button class="btn" data-x="rotate-key" data-id="${key.id}">立即轮换</button>
          <button class="btn x-danger-outline" data-x="delete-entity" data-kind="keys" data-id="${key.id}" data-name="${key.name}" data-label="KMS 密钥">删除</button>
        </div>
      </div>
      <div class="x-subnav x-key-subnav">${tabs.map(([id,label]) => `<button type="button" class="${tab===id?'active':''}" data-x="security-detail-tab" data-tab="${id}">${label}</button>`).join('')}</div>
      <div class="x-key-detail-body">${securityKmsDetailPanel(key, tab)}</div>`;
  }

  function filteredSecurityApiKeys() {
    const scene = state.securityKeyScene || 'all';
    return apiKeys().filter(k => {
      if (scene === 'personal') return k.keyKind === 'personal';
      if (scene === 'app') return k.keyKind !== 'personal';
      return true;
    });
  }

  function securityApiRowsHtml() {
    const apis = filteredSecurityApiKeys();
    const checked = new Set(state.selectedKeyIds || []);
    if (!apis.length) {
      return `<tr><td colspan="12"><div class="x-empty-panel" style="margin:8px 0"><strong>暂无${state.securityKeyScene === 'personal' ? '个人' : state.securityKeyScene === 'app' ? '应用' : ''} API Key</strong><p>个人 / 应用为两套场景；开通时可按企业或部门归集费用。</p></div></td></tr>`;
    }
    return apis.map(k => {
      const caller = resolveCaller(k);
      const owner = resolveKeyOwnerMember(k);
      const subject = k.keyKind === 'personal'
        ? `${owner?.name || k.applicantName || '—'}<br><span class="x-muted">个人</span>`
        : `${resolveCallerLabel(k)}<br><span class="x-muted">应用</span>`;
      return `<tr class="${state.selectedKeyId===k.id?'is-active':''}" data-x="select-key" data-id="${k.id}">
      <td class="x-check-cell" data-stop><label class="x-check"><input type="checkbox" data-x="toggle-key-check" data-id="${k.id}" ${checked.has(k.id)?'checked':''}></label></td>
      <td><strong>${k.name}</strong><br><span class="x-muted">${k.mask}</span></td>
      <td><span class="event-chip ${k.keyKind === 'personal' ? 'orange' : 'green'}">${keyKindLabel(k.keyKind)}</span></td>
      <td>${subject}</td>
      <td>${orgLevelLabel(k.orgLevel || 'dept')}<br><span class="x-muted">${k.orgName || '—'}</span></td>
      <td>${k.billingDept || caller?.ownerDept || '—'}<br><span class="x-muted">${k.orgLevel === 'enterprise' ? '企业成本' : '部门成本'}</span></td>
      <td>${resolveKeyServiceLabel(k)}</td>
      <td>${keyLimitSummary(k)}<br><span class="x-muted">${k.overLimit || '立即拒绝并返回 429'}</span></td>
      <td>上行 ${k.usedIn || '0'} / 下行 ${k.usedOut || '0'}<br><span class="x-muted">缓存 ${k.usedCache || '0'} · ¥${k.usedSpend || '0.00'}</span></td>
      <td><span class="event-chip ${keyStatusLabel(k)==='健康'?'green':(keyStatusLabel(k)==='已过期'||keyStatusLabel(k)==='已吊销')?'red':'orange'}">${keyStatusLabel(k)}</span><br><span class="x-muted">${displayDateTime(k.lastUsed)}</span></td>
      <td>${displayDateTime(k.created)}<br><span class="x-muted">${keyExpiryLabel(k)}</span></td>
      <td data-stop><div class="x-row-actions">
        ${peekKeySecret(k.id)
          ? `<button class="btn" data-x="copy-api-key" data-key-id="${k.id}" title="页面仅显示掩码，点击复制明文">复制明文</button>`
          : `<span class="x-muted" title="本机无明文缓存，无法复制">不可复制</span>`}
        <button class="x-mini-btn" data-x="open-key-detail" data-id="${k.id}">详情</button>
        <button class="x-mini-btn" data-x="edit-api-key" data-id="${k.id}">限额</button>
        <button class="x-mini-btn" data-x="rotate-key" data-id="${k.id}">轮换</button>
        ${keyEnableToggleHtml(k, { compact: true })}
        <button class="x-delete-btn" data-x="delete-key" data-id="${k.id}" data-name="${k.name}">删除</button>
      </div></td>
    </tr>`;
    }).join('');
  }

  function securityKmsRowsHtml() {
    const kms = kmsKeys();
    const checked = new Set(state.selectedKeyIds || []);
    if (!kms.length) {
      return `<tr><td colspan="8"><div class="x-empty-panel" style="margin:8px 0"><strong>暂无 KMS 托管密钥</strong><p>先托管上游原始 Key，再在源模型能力接入时选择。</p><button class="btn primary" data-x="new-kms">${icon('i-plus')}托管密钥</button></div></td></tr>`;
    }
    return kms.map(k => {
      const boundCount = modelsUsingKms(k.id).length;
      const kindLabel = (k.kind || 'upstream') === 'master' ? '主密钥' : '上游凭证';
      return `<tr class="${state.selectedKeyId===k.id?'is-active':''}" data-x="select-key" data-id="${k.id}">
      <td class="x-check-cell" data-stop><label class="x-check"><input type="checkbox" data-x="toggle-key-check" data-id="${k.id}" ${checked.has(k.id)?'checked':''} ${(k.kind||'upstream')==='master'?'disabled':''}></label></td>
      <td><strong>${k.name}</strong><br><span class="x-muted">${k.mask}</span></td>
      <td>${kindLabel}<br><span class="x-muted">${k.provider || k.purpose || '—'}</span></td>
      <td>${k.algorithm || '—'}</td>
      <td>${boundCount ? `${boundCount} 个源模型` : '—'}</td>
      <td>${displayDateTime(k.rotated)}</td>
      <td><span class="event-chip ${k.status==='健康'?'green':'orange'}">${k.status}</span></td>
      <td data-stop><div class="x-row-actions"><button class="x-mini-btn" data-x="open-key-detail" data-id="${k.id}">详情</button><button class="x-mini-btn" data-x="rotate-key" data-id="${k.id}">轮换</button><button class="x-delete-btn" data-x="delete-entity" data-kind="keys" data-id="${k.id}" data-name="${k.name}" data-label="KMS 密钥">删除</button></div></td>
    </tr>`;
    }).join('');
  }

  function securityToolbarHtml() {
    const apiVisible = filteredSecurityApiKeys();
    const checkedCount = checkedSecurityKeys().length;
    const allChecked = apiVisible.length > 0 && checkedCount === apiVisible.length;
    const scene = state.securityKeyScene || 'all';
    const sceneTabs = `<div class="x-subnav" style="margin:0 0 12px">
        <button type="button" class="${scene==='all'?'active':''}" data-x="security-key-scene" data-scene="all">全部场景</button>
        <button type="button" class="${scene==='personal'?'active':''}" data-x="security-key-scene" data-scene="personal">个人 Key</button>
        <button type="button" class="${scene==='app'?'active':''}" data-x="security-key-scene" data-scene="app">应用 Key</button>
      </div>`;
    return `${sceneTabs}<div class="security-toolbar">
      <div class="security-count">虚拟 Key（调用凭证） · 共 <strong>${apiVisible.length}</strong> 条<span>已选 <b data-checked-count>${checkedCount}</b> 条</span></div>
      <div class="x-config-note" style="margin:10px 0 0">${icon('i-shield')}<span>${keyLifecycleHint()}。调用方只持有虚拟 Key，可按服务白名单与限额策略管控。</span></div>
      <div class="security-toolbar-actions">
        <button class="btn" data-x="new-personal-key">创建虚拟 Key·个人</button>
        <button class="btn" data-x="new-app-key">创建虚拟 Key·应用</button>
        <button class="btn" data-x="batch-update-keys" ${checkedCount?'':'disabled'}>批量更新限额</button>
        <button class="btn" data-x="update-all-keys" ${apiVisible.length?'':'disabled'}>全量更新限额</button>
      </div>
    </div>
    <div class="providers-table security-detail-table">
      <table>
        <thead><tr><th class="x-check-cell"><label class="x-check"><input type="checkbox" data-x="toggle-all-keys" ${allChecked?'checked':''}></label></th><th>Key 别名</th><th>场景</th><th>应用 / 个人</th><th>组织层级</th><th>付款部门</th><th>可调用服务</th><th>限额策略</th><th>本周期用量</th><th>状态 / 最近使用</th><th>创建 / 有效期</th><th>操作</th></tr></thead>
        <tbody>${securityApiRowsHtml()}</tbody>
      </table>
    </div>`;
  }

  function keyApplyQueueHtml() {
    if (!KEY_APPROVAL_ENABLED) return '';
    if (state.securityTab !== 'api' || isDeveloperProfile()) return '';
    const pending = pendingKeyApplications();
    return `<article class="card x-key-apply-card">
      <div class="x-section-intro">
        <div><h2>待审批申请</h2><p>须逐条打开并确认限额策略后才能开通；不可批量跳过</p></div>
        <span class="event-chip ${pending.length ? 'orange' : 'green'}">${pending.length ? `${pending.length} 条待处理` : '暂无待办'}</span>
      </div>
      ${pending.length ? `<div class="x-key-apply-list">
        ${pending.map(app => `<div class="x-key-apply-row">
          <div><strong>${app.name}</strong><span><em class="event-chip ${app.keyKind === 'app' ? 'green' : 'orange'}" style="margin-right:6px">${keyKindLabel(app.keyKind || 'personal')}</em>${app.applicantName} · ${app.orgName || app.dept} · ${displayDateTime(app.created)}</span><em>${app.purpose || '未填写用途'}</em><b>期望限额：${keyLimitSummary(app)}</b></div>
          <div class="x-row-actions">
            <button class="btn primary" data-x="view-key-apply" data-id="${app.id}">确认限额并审批</button>
          </div>
        </div>`).join('')}
      </div>` : `<div class="x-route-extra-empty" style="margin-top:0">当前没有待审批申请。</div>`}
    </article>`;
  }

  function openPersonalKeyIssue() {
    state.securityTab = 'api';
    state.issueKeyScene = 'personal';
    state.batchKeyMode = 'single';
    openModal('key', { scene: 'personal' });
    setTimeout(() => { updateKeyQuotaPanel(); updateKeyExpirePanel(); }, 0);
  }

  function securityWorkspaceHtml() {
    syncSecurityTabFromPage();
    state.selectedKeyIds = (state.selectedKeyIds || []).filter(id => securityList().some(k => k.id === id));
    // 列表页仅展示明细；点击行进入独立详情页，不再在下方展开
    return `<div id="security-page-body" class="security-workspace">
      ${keyApplyQueueHtml()}
      <section class="security-sheet">
        ${securityToolbarHtml()}
      </section>
    </div>`;
  }

  function developerSecurityHtml() {
    const myKeys = visibleApiKeys();
    const apps = KEY_APPROVAL_ENABLED ? myKeyApplications() : [];
    const applyCard = KEY_APPROVAL_ENABLED ? `<article class="card x-key-apply-card">
        <div class="x-section-intro">
          <div><h2>我的申请</h2><p>提交后等待管理员审批；通过后仅你本人可随时查看并复制明文</p></div>
        </div>
        ${apps.length ? `<div class="x-key-apply-list">
          ${apps.map(app => `<div class="x-key-apply-row">
            <div><strong>${app.name}</strong><span>${keyKindLabel(app.keyKind || 'personal')} · ${displayDateTime(app.created)} · ${app.purpose || '未填写用途'}</span><em>${app.services || '—'}</em></div>
            <span class="event-chip ${app.status === '待审批' ? 'orange' : app.status === '已通过' ? 'green' : 'red'}">${app.status}</span>
          </div>`).join('')}
        </div>` : `<div class="x-route-extra-empty" style="margin-top:0">还没有申请记录，点击右上角发起申请。</div>`}
      </article>` : '';
    return `<div id="security-page-body" class="security-workspace developer-key-workspace">
      ${applyCard}
      <article class="card">
        <div class="card-head"><div><h2>我的 API Key</h2><p>仅显示你本人名下的 Key；费用计入所属部门，此处只看「我造成的消耗」与明文</p></div></div>
        <div class="providers-table"><table>
          <thead><tr><th>名称</th><th>主体</th><th>所属部门</th><th>可调用服务</th><th>限额</th><th>创建 / 有效期</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>${myKeys.length ? myKeys.map(k => {
            const hasSecret = !!peekKeySecret(k.id);
            const status = keyStatusLabel(k);
            return `<tr>
            <td><strong>${k.name}</strong><br><span class="x-muted">${k.mask}</span></td>
            <td><span class="event-chip ${k.keyKind === 'personal' ? 'orange' : 'green'}">${keyKindLabel(k.keyKind)}</span></td>
            <td>${k.orgName || k.billingDept || '—'}<br><span class="x-muted">${k.billingDept || '—'}</span></td>
            <td>${resolveKeyServiceLabel(k)}</td>
            <td>${keyLimitSummary(k)}</td>
            <td>${displayDateTime(k.created)}<br><span class="x-muted">${keyExpiryLabel(k)}</span></td>
            <td><span class="event-chip ${status === '健康' ? 'green' : status === '已过期' ? 'red' : 'orange'}">${status === '健康' ? '有效' : status}</span></td>
            <td>${hasSecret
              ? `<button class="btn" data-x="copy-api-key" data-key-id="${k.id}" title="页面仅显示掩码，点击复制明文">复制明文</button>`
              : `<span class="x-muted">不可复制</span>`}</td>
          </tr>`;
          }).join('') : `<tr><td colspan="8"><div class="empty-note">暂无属于你的 Key，可点击右上角直接开通个人 Key</div></td></tr>`}</tbody>
        </table></div>
      </article>
    </div>`;
  }

  function apiKeyDetail(id) {
    let key = state.keys.find(k => k.id === id && k.type === 'api') || apiKeys().find(k => k.id === id);
    if (key && !canViewGlobalKeyReports() && !isApiKeyOwner(key)) key = null;
    if (!key) {
      return `<button class="btn" data-x="back" style="margin-bottom:13px">← 返回列表</button><div class="empty-note">未找到该 API Key，或无权查看</div>`;
    }
    state.selectedKeyId = key.id;
    state.currentDetailId = key.id;
    state.currentDetailKind = 'apikey';
    const tab = state.securityDetailTab || 'overview';
    const tabs = [['overview','完整明细'],['services','可调用服务'],['records','最近调用']];
    const status = key.status === '健康' ? '有效' : (key.status || '有效');
    return `<button class="btn" data-x="back" style="margin-bottom:13px">← 返回列表</button>
      <div class="x-detail-head">
        <div class="x-detail-identity">
          <div class="x-detail-logo">AK</div>
          <div><h1>${key.name}</h1><p>${keyKindLabel(key.keyKind)} · ${key.keyKind === 'personal' ? (resolveKeyOwnerMember(key)?.name || key.applicantName || '—') : resolveCallerLabel(key)} · ${key.orgName || key.billingDept || '—'} · ${key.mask}</p></div>
        </div>
        <div class="head-actions">
          <span class="status-pill"><i></i>${status}</span>
          ${peekKeySecret(key.id) ? `<button class="btn primary" data-x="copy-api-key" data-key-id="${key.id}">复制明文</button>` : ''}
          <button class="btn" data-x="edit-api-key" data-id="${key.id}">调整限额</button>
          <button class="btn" data-x="rotate-key" data-id="${key.id}">轮换</button>
          ${keyEnableToggleHtml(key)}
          <button class="btn x-danger-outline" data-x="delete-key" data-id="${key.id}" data-name="${key.name}">删除</button>
        </div>
      </div>
      <div class="x-subnav">${tabs.map(([tid,label]) => `<button type="button" class="${tab===tid?'active':''}" data-x="security-detail-tab" data-tab="${tid}">${label}</button>`).join('')}</div>
      <div id="x-detail-panel">
        <article class="card"><div class="card-head"><div><h2>${tabs.find(t=>t[0]===tab)?.[1] || '详情'}</h2><p>凭证、调用方、限额、用量与可调用服务</p></div></div>
          <div style="padding:0 18px 18px">
            <div class="x-config-note" style="margin:0 0 12px">${icon('i-key')}<span>页面仅展示掩码 <code>${key.mask}</code>。${peekKeySecret(key.id) ? '可点击「复制明文」将真实 Key 写入剪贴板。' : '本机无明文缓存时无法复制，需重新签发。'}</span>
              ${peekKeySecret(key.id) ? `<button class="btn" data-x="copy-api-key" data-key-id="${key.id}">复制明文</button>` : ''}
            </div>
            ${securityApiDetailPanel(key, tab)}
          </div>
        </article>
      </div>`;
  }

  function kmsKeyDetail(id) {
    const key = findKmsKey(id) || kmsKeys()[0];
    if (!key) {
      return `<button class="btn" data-x="back" style="margin-bottom:13px">← 返回列表</button><div class="empty-note">未找到该 KMS 密钥</div>`;
    }
    state.selectedKeyId = key.id;
    state.currentDetailId = key.id;
    state.currentDetailKind = 'kmskey';
    const tab = state.securityDetailTab || 'overview';
    const tabs = [['overview','基本信息'],['bindings','源模型引用'],['policy','安全策略'],['records','加解密记录']];
    return `<button class="btn" data-x="back" style="margin-bottom:13px">← 返回列表</button>
      <div class="x-detail-head">
        <div class="x-detail-identity">
          <div class="x-detail-logo">KM</div>
          <div><h1>${key.name}</h1><p>${key.purpose || 'KMS 加解密'} · ${key.algorithm || ''}</p></div>
        </div>
        <div class="head-actions">
          <span class="status-pill"><i></i>${key.status || '健康'}</span>
          <button class="btn" data-x="rotate-key" data-id="${key.id}">立即轮换</button>
          <button class="btn x-danger-outline" data-x="delete-entity" data-kind="keys" data-id="${key.id}" data-name="${key.name}" data-label="KMS 密钥">删除</button>
        </div>
      </div>
      <div class="x-subnav">${tabs.map(([tid,label]) => `<button type="button" class="${tab===tid?'active':''}" data-x="security-detail-tab" data-tab="${tid}">${label}</button>`).join('')}</div>
      <div id="x-detail-panel">
        <article class="card"><div class="card-head"><div><h2>${tabs.find(t=>t[0]===tab)?.[1] || '详情'}</h2><p>KMS 托管与加解密信息</p></div></div>
          <div style="padding:0 18px 18px">${securityKmsDetailPanel(key, tab)}</div>
        </article>
      </div>`;
  }

  function renderKeyDetailPanel() {
    const key = selectedSecurityKey();
    const panel = $('#x-detail-panel');
    if (!key || !panel) return;
    const tab = state.securityDetailTab || 'overview';
    if (key.type === 'api') {
      const tabs = [['overview','完整明细'],['services','可调用服务'],['records','最近调用']];
      panel.innerHTML = `<article class="card"><div class="card-head"><div><h2>${tabs.find(t=>t[0]===tab)?.[1] || '详情'}</h2><p>凭证、调用方、限额、用量与可调用服务</p></div></div>
        <div style="padding:0 18px 18px">${securityApiDetailPanel(key, tab)}</div></article>`;
    } else {
      const tabs = [['overview','基本信息'],['bindings','源模型引用'],['policy','安全策略'],['records','加解密记录']];
      panel.innerHTML = `<article class="card"><div class="card-head"><div><h2>${tabs.find(t=>t[0]===tab)?.[1] || '详情'}</h2><p>KMS 托管与加解密信息</p></div></div>
        <div style="padding:0 18px 18px">${securityKmsDetailPanel(key, tab)}</div></article>`;
    }
    $$('.x-subnav button', $('#page-content')).forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  }

  function renderSecurityPage() {
    const root = $('#page-content');
    if (!root || !isSecurityPage()) return;
    syncSecurityTabFromPage();
    const mount = (currentPage() === 'security-api' && $('#x-security-api-panel', root)) || root;
    const body = $('#security-page-body', mount) || $('#security-page-body', root);
    if (!body) {
      mount.insertAdjacentHTML('beforeend', securityWorkspaceHtml());
      return;
    }
    body.outerHTML = securityWorkspaceHtml();
  }

  function refreshSecurityChecks() {
    const checkedCount = checkedSecurityKeys().length;
    const list = securityList();
    const counter = $('[data-checked-count]');
    if (counter) counter.textContent = checkedCount;
    $$('[data-x="batch-update-keys"], [data-x="batch-rotate-keys"]').forEach(btn => { btn.disabled = !checkedCount; });
    const allBox = $('[data-x="toggle-all-keys"]');
    if (allBox) {
      allBox.checked = list.length > 0 && checkedCount === list.length;
      allBox.indeterminate = checkedCount > 0 && checkedCount < list.length;
    }
  }

  function refreshSecurityDetail() {
    const pane = $('#security-detail-pane');
    if (pane) pane.innerHTML = securityDetailHtml();
    $$('.security-detail-table tbody tr').forEach(row => row.classList.toggle('is-active', row.dataset.id === state.selectedKeyId));
  }

  function editApiKeyForm(payload = {}) {
    const mode = state.batchKeyMode || 'single';
    const key = mode === 'single'
      ? (state.keys.find(k => k.id === payload.id) || payload)
      : (checkedSecurityKeys()[0] || apiKeys()[0] || {});
    state.editingApiKeyId = mode === 'single' ? (key.id || null) : null;
    const targetLabel = mode === 'all'
      ? `全部 ${apiKeys().length} 条调用方 Key`
      : mode === 'selected'
        ? `已选 ${checkedSecurityKeys().length} 条`
        : `${key.name || 'API Key'} · ${resolveCallerLabel(key)}`;
    const title = mode === 'all' ? '全量更新限额' : mode === 'selected' ? '批量更新限额' : '调整调用限额';
    const caller = resolveCaller(key);
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">${title}</h2><p>${targetLabel}</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body">
        ${mode === 'single' ? keyCallerFieldsHtml(caller) : ''}
        <div class="x-form-grid" style="${mode==='single'?'margin-top:14px':''}">
        <div class="x-field"><label>限额周期</label><select class="x-select" name="keyWindow"><option ${key.window==='每小时'?'selected':''}>每小时</option><option ${!key.window || key.window==='每天'?'selected':''}>每天</option><option ${key.window==='每月'?'selected':''}>每月</option></select></div>
        ${keyExpireFieldsHtml({ preset: key.expirePreset || (key.expiresAt ? 'custom' : 'never'), expiresAt: key.expiresAt || '', required: false })}
        <div class="x-field"><label>限制方式</label><select class="x-select" name="keyLimitMode" data-x="key-limit-mode"><option value="token" ${key.limitMode==='token'?'selected':''}>仅 Token 用量</option><option value="spend" ${key.limitMode==='spend'?'selected':''}>仅金额消耗</option><option value="both" ${!key.limitMode || key.limitMode==='both'?'selected':''}>Token + 金额</option><option value="none" ${key.limitMode==='none'?'selected':''}>不限制</option></select></div>
        ${mode === 'single' ? `<div class="x-field full"><label class="x-required">可调用模型服务</label>${keyServiceSelectHtml(normalizeKeyServiceRefs(key))}<span class="x-error">请至少勾选一个模型服务</span></div>` : ''}
      </div>
      <div class="x-key-quota" id="x-key-quota-panel">
        <div class="x-form-grid" data-quota-token>
          <div class="x-field"><label>最大上行 Token</label><input class="x-input" name="keyMaxIn" type="number" value="${key.maxInTokens || ''}"></div>
          <div class="x-field"><label>最大下行 Token</label><input class="x-input" name="keyMaxOut" type="number" value="${key.maxOutTokens || ''}"></div>
        </div>
        <div class="x-form-grid" data-quota-spend style="margin-top:12px">
          <div class="x-field"><label>最大金额消耗（元）</label><input class="x-input" name="keyMaxSpend" type="number" step="0.01" value="${key.maxSpend || ''}"></div>
          <div class="x-field"><label>超额策略</label><select class="x-select" name="keyOverLimit">
            <option ${!key.overLimit || key.overLimit==='立即拒绝并返回 429'?'selected':''}>立即拒绝并返回 429</option>
            <option ${key.overLimit==='仅告警，仍允许调用'?'selected':''}>仅告警，仍允许调用</option>
            <option ${key.overLimit==='降级到低价模型'?'selected':''}>降级到低价模型</option>
          </select></div>
        </div>
      </div></div>
      <div class="x-dialog-foot"><span class="x-muted">${mode==='single'?'修改后立即对后续请求生效':'将覆盖目标 Key 的限额配置'}</span><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn primary" data-x="update-api-key">${mode==='all'?'全量保存':mode==='selected'?'批量保存':'保存限额'}</button></div></div>`;
  }

  function isApiKeyOwner(key) {
    if (!key) return false;
    const me = currentIdentity();
    if (!me.id && !me.name) return false;
    if (key.ownerMemberId && key.ownerMemberId === me.id) return true;
    if (key.applicantId && key.applicantId === me.id) return true;
    if (key.applicantName && key.applicantName === me.name) return true;
    return false;
  }

  function canViewGlobalKeyReports() {
    const cfg = window.getActiveRoleConfig?.() || {};
    if (cfg.fullAccess || (cfg.perms || []).includes('cap.all_features')) return true;
    if (cfg.viewProfile === 'admin' || cfg.viewProfile === 'auditor' || cfg.viewProfile === 'ops') return true;
    const perms = cfg.perms || [];
    // 可管理密钥 / 导出账单的角色看全局报表；普通用户仅看本人
    return perms.includes('cap.manage_keys') || perms.includes('cap.export_billing');
  }

  function visibleApiKeys() {
    const keys = apiKeys();
    if (canViewGlobalKeyReports()) return keys;
    return keys.filter(k => isApiKeyOwner(k));
  }

  function visibleUsageKeyNames() {
    return new Set(visibleApiKeys().map(k => k.name).filter(Boolean));
  }

  function storeKeySecret(keyId, plain) {
    if (!keyId || !plain) return;
    if (!state.keySecrets) state.keySecrets = {};
    state.keySecrets[keyId] = plain;
    persist();
  }

  function peekKeySecret(keyId) {
    return state.keySecrets?.[keyId] || '';
  }

  function canRevealLocalKey(key) {
    // 本地网关 MVP：本机存有明文即可查看复制（方便签发后立即调用）
    return !!(key && peekKeySecret(key.id));
  }

  async function copyTextToClipboard(text) {
    const value = String(text || '');
    if (!value) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  function consumeKeySecret(keyId) {
    if (!state.keySecrets || !state.keySecrets[keyId]) return '';
    const plain = state.keySecrets[keyId];
    delete state.keySecrets[keyId];
    persist();
    return plain;
  }

  function resolveKeyOwnerMember(key) {
    if (key.ownerMemberId) return state.members.find(m => m.id === key.ownerMemberId) || null;
    if (key.applicantId) return state.members.find(m => m.id === key.applicantId) || null;
    const caller = resolveCaller(key);
    const name = key.applicantName || caller?.contact || '';
    return state.members.find(m => m.name === name) || null;
  }

  function assignKeyOwner(key, preferred = {}) {
    const caller = resolveCaller(key);
    const member = preferred.member
      || state.members.find(m => m.id === preferred.memberId)
      || state.members.find(m => m.name === preferred.name)
      || state.members.find(m => m.name === caller?.contact);
    key.ownerMemberId = member?.id || preferred.memberId || key.ownerMemberId || '';
    key.applicantId = key.applicantId || member?.id || preferred.memberId || '';
    key.applicantName = key.applicantName || member?.name || preferred.name || caller?.contact || '';
    return key;
  }

  function keyIssuedAdminResult(key) {
    const caller = resolveCaller(key);
    const owner = resolveKeyOwnerMember(key);
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">API Key 已签发</h2><p>明文仅所有者可随时查看复制，管理员无法查看</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body">
        <div class="x-test-result show"><span>请通知所有者登录后，在「我的 API Key」中查看并复制明文。管理员侧仅可见掩码。</span><b>所有者专属</b></div>
        <div class="x-kv-grid" style="grid-template-columns:repeat(2,1fr);padding:14px 0 0">
          <div class="x-kv"><span>Key 别名</span><strong>${key.name}</strong></div>
          <div class="x-kv"><span>掩码</span><strong>${key.mask}</strong></div>
          <div class="x-kv"><span>主体类型</span><strong>${keyKindLabel(key.keyKind)} Key</strong></div>
          <div class="x-kv"><span>所有者</span><strong>${owner?.name || key.applicantName || caller?.contact || '—'}</strong></div>
          <div class="x-kv"><span>${key.keyKind === 'personal' ? '使用人' : '调用方'}</span><strong>${key.keyKind === 'personal' ? (owner?.name || key.applicantName || '—') : resolveCallerLabel(key)}</strong></div>
          <div class="x-kv"><span>组织层级</span><strong>${orgLevelLabel(key.orgLevel || 'dept')} · ${key.orgName || '—'}</strong></div>
          <div class="x-kv"><span>费用归属</span><strong>${key.orgName || '—'} · ${key.billingDept || '—'}</strong></div>
          <div class="x-kv"><span>可调用服务</span><strong>${resolveKeyServiceLabel(key)}</strong></div>
          <div class="x-kv"><span>限额</span><strong>${keyLimitSummary(key)}</strong></div>
          <div class="x-kv"><span>有效期</span><strong>${keyExpiryLabel(key)}</strong></div>
        </div>
      </div>
      <div class="x-dialog-foot"><span class="x-muted">明文不会出现在审批或签发记录中；费用归所选组织层级</span><div class="x-dialog-foot-right"><button class="btn primary" data-x="close">完成</button></div></div>`;
  }

  function keyOwnerRevealResult(key, plain, curlExample = '') {
    const displayCurl = gatewayCurlForKey(key, '$API_KEY');
    const fullCurl = curlExample || gatewayCurlForKey(key, plain);
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">API Key 已就绪</h2><p>页面仅展示掩码；点击复制可将明文写入剪贴板</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body">
        <div class="x-field full"><label>API Key（掩码）</label>
          <div class="x-code" id="x-new-api-key" data-key-id="${key.id}">${key.mask || 'ak_live_••••'}</div>
        </div>
        <div class="x-kv-grid" style="grid-template-columns:repeat(2,1fr);padding:14px 0 0">
          <div class="x-kv"><span>别名</span><strong>${key.name}</strong></div>
          <div class="x-kv"><span>主体</span><strong>${keyKindLabel(key.keyKind)} Key</strong></div>
          <div class="x-kv"><span>可调用服务</span><strong>${resolveKeyServiceLabel(key)}</strong></div>
          <div class="x-kv"><span>限额</span><strong>${keyLimitSummary(key)}</strong></div>
          <div class="x-kv"><span>有效期</span><strong>${keyExpiryLabel(key)}</strong></div>
          <div class="x-kv"><span>网关</span><strong>${GATEWAY_API}</strong></div>
        </div>
        <div class="x-field full" style="margin-top:12px"><label>调用示例（curl，页面用占位符）</label><textarea class="x-textarea" id="x-key-curl" data-full-curl="${encodeURIComponent(fullCurl)}" readonly rows="4">${displayCurl}</textarea></div>
        <div class="x-test-result show" style="margin-top:14px"><span>生产 ${GATEWAY_API} · 测试 ${GATEWAY_TEST_API}</span><b>复制得明文</b></div>
      </div>
      <div class="x-dialog-foot"><span class="x-muted">网页不展示明文；复制按钮写入剪贴板</span><div class="x-dialog-foot-right"><button class="btn primary" data-x="copy-api-key" data-key-id="${key.id}">复制明文 Key</button><button class="btn" data-x="copy-key-curl" data-key-id="${key.id}">复制 curl</button><button class="btn" data-x="close">完成</button></div></div>`;
  }

  function usageDetailDataset() {
    // 生产口径：按日 × Key × 模型服务 × 源模型，汇总网关真实 callLogs
    const logs = Array.isArray(state.callLogs) ? state.callLogs : [];
    const apiOnly = apiKeys();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const groups = new Map();

    logs.forEach(log => {
      const ts = parseCallLogTime(log.time);
      if (!Number.isFinite(ts)) return;
      const date = new Date(ts);
      date.setHours(0, 0, 0, 0);
      const dayKey = toDateInputValue(date);
      const keyId = log.keyId || '';
      const serviceId = log.serviceId || log.model || '';
      const sourceId = log.sourceId || '';
      const groupKey = `${dayKey}|${keyId}|${serviceId}|${sourceId}`;
      let g = groups.get(groupKey);
      if (!g) {
        g = {
          date,
          dayKey,
          keyId,
          serviceId,
          sourceId,
          audience: log.audience || '',
          provider: log.provider || '',
          sourceModel: log.sourceModel || '',
          sourceNameHint: log.sourceName || '',
          keyNameHint: log.keyName || '',
          promptTokens: 0,
          completionTokens: 0,
          cachedTokens: 0,
          cost: 0,
          requests: 0,
          successRequests: 0
        };
        groups.set(groupKey, g);
      }
      const ok = Number(log.status || 0) < 400;
      g.requests += 1;
      if (ok) {
        g.successRequests += 1;
        g.promptTokens += Number(log.promptTokens || 0);
        g.completionTokens += Number(log.completionTokens || 0);
        g.cachedTokens += Number(log.cachedTokens || 0);
        g.cost += Number(log.cost || 0);
      }
      if (!g.provider && log.provider) g.provider = log.provider;
      if (!g.sourceModel && log.sourceModel) g.sourceModel = log.sourceModel;
      if (!g.keyNameHint && log.keyName) g.keyNameHint = log.keyName;
    });

    return [...groups.values()].map(g => {
      const key = apiOnly.find(k => k.id === g.keyId) || null;
      const service = state.services.find(s => s.serviceId === g.serviceId || s.id === g.serviceId)
        || state.services.find(s => s.id === key?.serviceRefs?.[0]);
      const model = state.models.find(m => m.id === g.sourceId)
        || state.models.find(m => m.serviceRef === service?.id && (m.sourceModel === g.sourceModel || m.name === g.sourceNameHint));
      const ownerMember = key ? resolveKeyOwnerMember(key) : null;
      const caller = key ? resolveCaller(key) : null;
      const isProbe = g.audience === 'probe' || g.keyNameHint === '连通性探测';
      const keyKind = isProbe
        ? 'probe'
        : (key?.keyKind === 'personal'
          ? 'personal'
          : (g.audience === 'personal' ? 'personal' : 'app'));
      const prices = model?.prices || {};
      const inPrice = Number(prices.flatInput ?? prices.busyInput ?? 0);
      const outPrice = Number(prices.flatOutput ?? prices.busyOutput ?? 0);
      const keyName = isProbe
        ? (g.keyNameHint || '连通性探测')
        : (key?.name || g.keyNameHint || g.keyId || '未知 Key');
      const serviceName = service?.name || g.serviceId || (isProbe ? '源模型探测' : '未知服务');
      const sourceName = model
        ? `${model.provider || '上游'} · ${model.sourceModel || model.name}`
        : (g.provider || g.sourceModel)
          ? `${g.provider || '上游'} · ${g.sourceModel || g.sourceNameHint || '—'}`
          : (g.sourceNameHint || '—');
      const inTokensM = g.promptTokens / 1e6;
      const outTokensM = g.completionTokens / 1e6;
      const cache = g.promptTokens > 0
        ? Math.min(100, +((g.cachedTokens / g.promptTokens) * 100).toFixed(1))
        : 0;
      const cost = Number(g.cost.toFixed(6));
      const daysAgo = Math.max(0, Math.round((today.getTime() - g.date.getTime()) / 86400000));
      const orgLevel = key?.orgLevel === 'enterprise' ? 'enterprise' : 'dept';
      const orgName = key?.orgName || key?.billingDept || '未分配';
      const appName = keyKind === 'app' ? (caller?.name || key?.owner || keyName) : '';
      return {
        daysAgo,
        inTokensM,
        outTokensM,
        cache,
        requests: g.requests,
        successRequests: g.successRequests,
        promptTokens: g.promptTokens,
        completionTokens: g.completionTokens,
        cachedTokens: g.cachedTokens,
        keyId: key?.id || g.keyId || '',
        keyKind,
        keyKindLabel: keyKindLabel(keyKind),
        orgLevel,
        orgLevelLabel: orgLevelLabel(orgLevel),
        orgId: key?.orgId || key?.billingDept || '',
        orgName,
        orgRollupKey: `${orgLevel}:${key?.orgId || orgName}`,
        billingDept: key?.billingDept || '—',
        callerId: keyKind === 'app' ? (key?.callerId || caller?.id || '') : '',
        appName,
        ownerMemberId: key?.ownerMemberId || ownerMember?.id || '',
        ownerName: ownerMember?.name || key?.applicantName || key?.owner || '—',
        userMemberId: keyKind === 'personal' ? (key?.ownerMemberId || ownerMember?.id || '') : '',
        userName: keyKind === 'personal' ? (ownerMember?.name || key?.applicantName || '—') : '',
        subjectLabel: keyKind === 'probe'
          ? '连通性探测'
          : (keyKind === 'personal'
            ? (ownerMember?.name || key?.applicantName || '个人')
            : (appName || keyName)),
        keyName,
        keyAlias: keyKind === 'probe' ? '系统探测' : (key?.mask || keyName),
        serviceName,
        serviceId: service?.serviceId || g.serviceId || '',
        sourceId: g.sourceId || model?.id || '',
        sourceName,
        inPrice,
        outPrice,
        cost,
        date: g.date,
        dateLabel: toDateInputValue(g.date),
        dateShort: formatShortDate(g.date)
      };
    }).sort((a, b) => a.daysAgo - b.daysAgo || String(a.keyName).localeCompare(String(b.keyName)));
  }

  function scopedUsageDataset() {
    const rows = usageDetailDataset();
    if (canViewGlobalKeyReports()) return rows;
    const allowed = visibleUsageKeyNames();
    const me = currentIdentity();
    return rows.filter(row => {
      if (row.keyName && allowed.has(row.keyName)) return true;
      if (row.ownerMemberId && row.ownerMemberId === me.id) return true;
      const key = apiKeys().find(k => k.id === row.keyId || k.name === row.keyName);
      return !!(key && isApiKeyOwner(key));
    });
  }

  function rowDateFromDaysAgo(daysAgo) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - Number(daysAgo || 0));
    return date;
  }

  function startOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - (day - 1));
    return d;
  }

  function startOfMonth(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return d;
  }

  function iteratePeriodBuckets(rangeStart, rangeEnd, grain = 'day') {
    const buckets = [];
    if (grain === 'month') {
      let cur = startOfMonth(rangeStart);
      const last = startOfMonth(rangeEnd);
      while (cur <= last) {
        const next = new Date(cur);
        next.setMonth(next.getMonth() + 1);
        buckets.push({
          key: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`,
          label: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`,
          start: new Date(cur),
          end: new Date(next.getTime() - 1)
        });
        cur = next;
      }
      return buckets;
    }
    if (grain === 'week') {
      let cur = startOfWeek(rangeStart);
      const last = startOfWeek(rangeEnd);
      while (cur <= last) {
        const weekEnd = new Date(cur);
        weekEnd.setDate(weekEnd.getDate() + 6);
        buckets.push({
          key: formatFullDate(cur),
          label: `${formatShortDate(cur)}~${formatShortDate(weekEnd)}`,
          start: new Date(cur),
          end: new Date(weekEnd.getTime() + 86399999)
        });
        cur = new Date(cur);
        cur.setDate(cur.getDate() + 7);
      }
      return buckets;
    }
    let cur = new Date(rangeStart);
    cur.setHours(0, 0, 0, 0);
    const last = new Date(rangeEnd);
    last.setHours(0, 0, 0, 0);
    while (cur <= last) {
      buckets.push({
        key: formatFullDate(cur),
        label: formatShortDate(cur),
        start: new Date(cur),
        end: new Date(cur.getTime() + 86399999)
      });
      cur = new Date(cur);
      cur.setDate(cur.getDate() + 1);
    }
    return buckets;
  }

  function filteredUsageDetails(override) {
    if (!override) ensureCustomRangeDefaults(state.usageFilters);
    const f = { ...state.usageFilters, ...(override || {}) };
    const { period, key, service, source, keyKind, dept, orgLevel, app, customStart, customEnd } = f;
    const range = resolvePeriodRange(period, customStart, customEnd);
    return scopedUsageDataset().filter(row => {
      const rowDate = row.date || rowDateFromDaysAgo(row.daysAgo);
      if (rowDate < range.start || rowDate > range.end) return false;
      if (key && row.keyName !== key) return false;
      if (service && row.serviceName !== service) return false;
      if (source && row.sourceName !== source) return false;
      if (keyKind && row.keyKind !== keyKind) return false;
      if (dept && row.billingDept !== dept && row.orgName !== dept) return false;
      if (orgLevel && row.orgLevel !== orgLevel) return false;
      if (app && row.appName !== app) return false;
      return true;
    }).sort((a, b) => a.daysAgo - b.daysAgo);
  }

  function syncBillingFiltersFromUsage() {
    // 合并页共用一套时间/粒度；费用视图沿用用量筛选中的维度
    const u = state.usageFilters;
    state.billingFilters = {
      period: u.period,
      grain: u.grain,
      customStart: u.customStart,
      customEnd: u.customEnd
    };
  }

  function filteredBillingDetails() {
    syncBillingFiltersFromUsage();
    ensureCustomRangeDefaults(state.usageFilters);
    return filteredUsageDetails({
      period: state.usageFilters.period,
      grain: state.usageFilters.grain,
      customStart: state.usageFilters.customStart,
      customEnd: state.usageFilters.customEnd,
      key: state.usageFilters.key || '',
      service: state.usageFilters.service || '',
      source: state.usageFilters.source || '',
      keyKind: state.usageFilters.keyKind || '',
      dept: state.usageFilters.dept || '',
      orgLevel: state.usageFilters.orgLevel || '',
      app: state.usageFilters.app || ''
    });
  }

  function canViewCostDepth() {
    const cfg = window.getActiveRoleConfig?.() || {};
    if (cfg.fullAccess || (cfg.x || []).includes('*') || (cfg.perms || []).includes('cap.all_features')) return true;
    const perms = cfg.perms || [];
    return perms.includes('page.billing') || perms.includes('cap.export_billing');
  }

  function setUsageTab(tab) {
    const next = tab === 'cost' && canViewCostDepth() ? 'cost' : 'usage';
    state.usageTab = next;
    try { sessionStorage.setItem('aegis-usage-tab', next); } catch {}
  }

  function currentUsageTab() {
    return state.usageTab === 'cost' && canViewCostDepth() ? 'cost' : 'usage';
  }

  function coerceChartDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (value == null || value === '') return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function buildChartSeries(rows, filters, metric = 'tokens') {
    const range = resolvePeriodRange(filters.period, filters.customStart, filters.customEnd);
    let buckets = iteratePeriodBuckets(range.start, range.end, filters.grain || 'day');
    const grain = filters.grain || 'day';
    // 无调用记录时仍按筛选周期铺满时间轴（近 7 天保留 7 个日期刻度）
    if (!buckets.length) {
      buckets = iteratePeriodBuckets(range.start, range.end, grain);
    }
    if (grain === 'day' && buckets.length > 31) buckets = buckets.slice(-31);
    if (grain === 'week' && buckets.length > 12) buckets = buckets.slice(-12);
    if (grain === 'month' && buckets.length > 12) buckets = buckets.slice(-12);
    const series = buckets.map(bucket => {
      const matched = (rows || []).filter(row => {
        const d = coerceChartDate(row.date) || rowDateFromDaysAgo(row.daysAgo);
        if (!d) return false;
        const t = d.getTime();
        return t >= bucket.start.getTime() && t <= bucket.end.getTime();
      });
      const inT = matched.reduce((sum, row) => sum + Number(row.inTokensM || 0), 0);
      const outT = matched.reduce((sum, row) => sum + Number(row.outTokensM || 0), 0);
      const cost = matched.reduce((sum, row) => sum + Number(row.cost || 0), 0);
      const requests = matched.reduce((sum, row) => sum + Number(row.requests || 0), 0);
      return { ...bucket, inT, outT, cost, tokens: inT + outT, requests, empty: !matched.length };
    });
    const max = Math.max(...series.map(item => metric === 'cost' ? item.cost : item.tokens), 0.01);
    return series.map(item => {
      if (metric === 'cost') {
        const h = item.cost ? Math.max(8, Math.round(item.cost / max * 100)) : 0;
        return {
          label: item.label,
          inH: Math.min(h, 100),
          outH: 0,
          inT: item.inT,
          outT: item.outT,
          tokens: item.tokens,
          cost: item.cost,
          requests: item.requests,
          metric,
          empty: item.empty || item.cost <= 0
        };
      }
      return {
        label: item.label,
        inH: item.inT ? Math.min(Math.max(8, Math.round(item.inT / max * 100)), 100) : 0,
        outH: item.outT ? Math.min(Math.max(6, Math.round(item.outT / max * 100)), 100) : 0,
        inT: item.inT,
        outT: item.outT,
        tokens: item.tokens,
        cost: item.cost,
        requests: item.requests,
        metric,
        empty: item.empty || item.tokens <= 0
      };
    });
  }

  function chartBarTipHtml(item) {
    if (item.metric === 'cost') {
      return `<em class="bar-tip"><b>${item.label}</b><span>输入 ${formatTokensM(item.inT)}</span><span>输出 ${formatTokensM(item.outT)}</span><span>合计 ${formatTokensM(item.tokens)}</span><span>费用 ${formatMoney(item.cost)}</span></em>`;
    }
    return `<em class="bar-tip"><b>${item.label}</b><span>输入 ${formatTokensM(item.inT)}</span><span>输出 ${formatTokensM(item.outT)}</span><span>合计 ${formatTokensM(item.tokens)}</span></em>`;
  }

  function formatTokensM(value) {
    const n = Number(value) || 0;
    if (n <= 0) return '0';
    if (n < 0.000001) return `${Math.round(n * 1e6)}`;
    if (n < 0.001) return `${Math.round(n * 1e6).toLocaleString('en-US')}`;
    if (n < 0.01) return `${(n * 1000).toFixed(2).replace(/\.?0+$/, '')}K`;
    return `${n.toFixed(2).replace(/\.?0+$/, '')}M`;
  }

  function formatRequestCount(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-US');
  }

  function formatMoney(value) {
    const n = Number(value || 0);
    if (Math.abs(n) > 0 && Math.abs(n) < 0.01) return `¥${n.toFixed(4)}`;
    return `¥${n.toFixed(2)}`;
  }

  function usageFilterOptions(field) {
    const values = [...new Set(scopedUsageDataset().map(row => row[field]).filter(Boolean))];
    const filterKey = field === 'keyName' ? 'key'
      : field === 'serviceName' ? 'service'
      : field === 'sourceName' ? 'source'
      : field === 'billingDept' ? 'dept'
      : field === 'appName' ? 'app'
      : field;
    return values.map(v => `<option value="${v}" ${state.usageFilters[filterKey] === v ? 'selected' : ''}>${v}</option>`).join('');
  }

  function usageDetailBodyHtml(rows) {
    if (!rows.length) {
      const hasLogs = (state.callLogs || []).length > 0;
      return `<tr class="usage-empty-row"><td colspan="14"><div class="x-empty-panel" style="margin:8px 0"><strong>${hasLogs ? '无匹配明细' : '暂无生产用量'}</strong><p>${hasLogs ? '请调整时间范围、组织层级、部门、应用、主体类型、密钥或模型筛选条件。' : '用量与费用已接入网关真实调用日志。使用代理 API Key 发起调用后，此处将按日汇总上下行 Token、缓存命中与费用。'}</p></div></td></tr>`;
    }
    return rows.map(row => `<tr>
      <td><strong>${row.dateLabel || formatFullDate(row.date || rowDateFromDaysAgo(row.daysAgo))}</strong></td>
      <td>${row.orgLevelLabel || orgLevelLabel(row.orgLevel)}<br><span class="x-muted">${row.orgName || '—'}</span></td>
      <td><span class="event-chip ${row.keyKind === 'personal' ? 'orange' : row.keyKind === 'probe' ? '' : 'green'}">${row.keyKindLabel || keyKindLabel(row.keyKind)}</span></td>
      <td><strong>${row.keyName}</strong><br><span class="x-muted">${row.keyAlias}</span></td>
      <td>${row.subjectLabel || row.appName || row.ownerName || '—'}<br><span class="x-muted">${row.keyKind === 'personal' ? '个人' : '应用'}</span></td>
      <td>${row.ownerName || '—'}</td>
      <td><strong>${row.serviceName}</strong><br><span class="x-muted">${row.serviceId || '—'}</span></td>
      <td>${row.sourceName}</td>
      <td>${formatTokensM(row.inTokensM)}</td>
      <td>${formatMoney(row.inPrice)}</td>
      <td>${formatTokensM(row.outTokensM)}</td>
      <td>${row.outPrice ? formatMoney(row.outPrice) : '—'}</td>
      <td><div class="x-cache-hit"><span style="--hit:${row.cache}"></span><b>${row.cache}%</b></div></td>
      <td><strong>${formatMoney(row.cost)}</strong></td>
    </tr>`).join('');
  }

  function usageDetailFootHtml(rows) {
    const total = rows.reduce((sum, row) => sum + row.cost, 0);
    const inTotal = rows.reduce((sum, row) => sum + row.inTokensM, 0);
    const outTotal = rows.reduce((sum, row) => sum + row.outTokensM, 0);
    return `<tr>
      <td colspan="8"><strong>费用总计</strong><br><span class="x-muted">全部匹配 ${rows.length} 条 · 按 Key 绑定组织/应用归集，不含个人应付</span></td>
      <td>${formatTokensM(inTotal)}</td>
      <td></td>
      <td>${formatTokensM(outTotal)}</td>
      <td></td>
      <td></td>
      <td><strong class="usage-total-cost">${formatMoney(total)}</strong></td>
    </tr>`;
  }

  function usageSummary(rows = filteredUsageDetails()) {
    const inTotal = rows.reduce((sum, row) => sum + row.inTokensM, 0);
    const outTotal = rows.reduce((sum, row) => sum + row.outTokensM, 0);
    const tokenTotal = inTotal + outTotal;
    const cost = rows.reduce((sum, row) => sum + row.cost, 0);
    const promptWeight = rows.reduce((sum, row) => sum + Number(row.promptTokens || row.inTokensM * 1e6 || 0), 0);
    const cachedWeight = rows.reduce((sum, row) => sum + Number(row.cachedTokens || 0), 0);
    const cache = promptWeight > 0
      ? (cachedWeight / promptWeight) * 100
      : (tokenTotal
        ? rows.reduce((sum, row) => sum + row.cache * (row.inTokensM + row.outTokensM), 0) / tokenTotal
        : 0);
    const requests = rows.reduce((sum, row) => sum + Number(row.requests || 0), 0);
    return { rows, inTotal, outTotal, tokenTotal, cost, cache, requests };
  }

  function syncUsageFilterScope() {
    const allowed = visibleUsageKeyNames();
    if (state.usageFilters.key && !allowed.has(state.usageFilters.key)) state.usageFilters.key = '';
    const scoped = scopedUsageDataset();
    const services = new Set(scoped.map(r => r.serviceName).filter(Boolean));
    const sources = new Set(scoped.map(r => r.sourceName).filter(Boolean));
    const depts = new Set(scoped.map(r => r.billingDept).filter(v => v && v !== '—'));
    const apps = new Set(scoped.map(r => r.appName).filter(Boolean));
    if (state.usageFilters.service && !services.has(state.usageFilters.service)) state.usageFilters.service = '';
    if (state.usageFilters.source && !sources.has(state.usageFilters.source)) state.usageFilters.source = '';
    if (state.usageFilters.dept && !depts.has(state.usageFilters.dept)) state.usageFilters.dept = '';
    if (state.usageFilters.app && !apps.has(state.usageFilters.app)) state.usageFilters.app = '';
    if (state.usageFilters.keyKind && state.usageFilters.keyKind !== 'app' && state.usageFilters.keyKind !== 'personal') {
      state.usageFilters.keyKind = '';
    }
    if (state.usageFilters.orgLevel && !['enterprise', 'dept'].includes(state.usageFilters.orgLevel)) {
      state.usageFilters.orgLevel = '';
    }
  }

  function usageAdvancedFilterCount() {
    const f = state.usageFilters || {};
    const grain = f.grain || 'day';
    let n = 0;
    if (f.period && f.period !== defaultPeriodForGrain(grain)) n += 1;
    ['orgLevel', 'dept', 'app', 'keyKind', 'key', 'service', 'source'].forEach(k => {
      if (f[k]) n += 1;
    });
    return n;
  }

  function usageFilterDrawer() {
    ensureCustomRangeDefaults();
    syncUsageFilterScope();
    const f = state.usageFilters;
    const grain = f.grain || 'day';
    const scopeHint = canViewGlobalKeyReports()
      ? '全平台可见 · 应用 Key 费用按归属组织/应用汇总'
      : '仅本人名下 Key · 个人消耗仍计入所属组织';
    return `<div class="x-drawer-head"><div><h2 id="x-drawer-title">高级筛选</h2><p>用量与费用 · ${scopeHint}</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-drawer-body">
        <div class="x-filter-group">
          <h3>时间范围</h3>
          <div class="x-time-range-field">${timeRangeSelectHtml({
            name: 'usage',
            selected: f.period,
            selectClass: 'x-select',
            start: f.customStart,
            end: f.customEnd,
            grain
          })}</div>
          <p class="x-help" style="margin-top:8px">统计力度（日 / 周 / 月）在页面快捷区切换；此处只选时间跨度。</p>
        </div>
        <div class="x-filter-group">
          <h3>组织 / 应用</h3>
          <div class="x-form-grid" style="grid-template-columns:1fr 1fr">
            <div class="x-field"><label>组织层级</label><select class="x-select" data-usage-filter="orgLevel">
              <option value="">全部层级</option>
              <option value="enterprise" ${f.orgLevel === 'enterprise' ? 'selected' : ''}>企业</option>
              <option value="dept" ${f.orgLevel === 'dept' ? 'selected' : ''}>部门</option>
            </select></div>
            <div class="x-field"><label>部门</label><select class="x-select" data-usage-filter="dept">
              <option value="">全部部门</option>${usageFilterOptions('billingDept')}
            </select></div>
            <div class="x-field"><label>应用</label><select class="x-select" data-usage-filter="app">
              <option value="">全部应用</option>${usageFilterOptions('appName')}
            </select></div>
            <div class="x-field"><label>主体类型</label><select class="x-select" data-usage-filter="keyKind">
              <option value="">全部类型</option>
              <option value="app" ${f.keyKind === 'app' ? 'selected' : ''}>应用 Key</option>
              <option value="personal" ${f.keyKind === 'personal' ? 'selected' : ''}>个人 Key</option>
            </select></div>
          </div>
        </div>
        <div class="x-filter-group" style="border-bottom:0">
          <h3>资源</h3>
          <div class="x-form-grid" style="grid-template-columns:1fr 1fr">
            <div class="x-field"><label>密钥名称</label><select class="x-select" data-usage-filter="key">
              <option value="">${canViewGlobalKeyReports() ? '全部密钥' : '我的全部密钥'}</option>${usageFilterOptions('keyName')}
            </select></div>
            <div class="x-field"><label>模型服务</label><select class="x-select" data-usage-filter="service">
              <option value="">全部服务</option>${usageFilterOptions('serviceName')}
            </select></div>
            <div class="x-field full"><label>源模型服务</label><select class="x-select" data-usage-filter="source">
              <option value="">全部源模型</option>${usageFilterOptions('sourceName')}
            </select></div>
          </div>
        </div>
      </div>
      <div class="x-drawer-foot">
        <button class="btn" data-x="reset-usage-filter">重置</button>
        <button class="btn primary" data-x="close">完成</button>
      </div>`;
  }

  function usageFilterBar() {
    ensureCustomRangeDefaults();
    syncUsageFilterScope();
    syncBillingFiltersFromUsage();
    const f = state.usageFilters;
    const summary = usageSummary();
    const rangeShort = periodLabelShort(f.period, f.customStart, f.customEnd);
    const showCost = canViewCostDepth();
    const cfg = window.getActiveRoleConfig?.() || {};
    const canExportBill = cfg.fullAccess || (cfg.perms || []).includes('cap.export_billing') || (cfg.perms || []).includes('cap.all_features');
    const advancedCount = usageAdvancedFilterCount();
    const advancedLabel = advancedCount ? `高级筛选 · ${advancedCount}` : '高级筛选';
    const grainLabel = f.grain === 'week' ? '按周' : f.grain === 'month' ? '按月' : '按日';
    return `<article class="card usage-filter-card">
      <div class="usage-filter-toolbar">
        <div class="usage-filter-toolbar-main">
          <div class="usage-filter-quick">
            <span class="usage-filter-quick-label">统计力度</span>
            ${grainSwitchHtml('usage', f.grain || 'day')}
          </div>
          <div class="usage-filter-actions">
            <button class="btn ${advancedCount ? 'active-filter' : ''}" type="button" data-x="open-usage-filter" data-usage-filter-btn>${advancedLabel}</button>
            <button class="btn" data-x="export-usage-detail">导出明细</button>
            ${showCost ? '<button class="btn" data-x="cost-rules">成本规则</button>' : ''}
            ${canExportBill ? '<button class="btn primary" data-action="导出账单">导出账单</button>' : ''}
          </div>
        </div>
        <div class="usage-filter-toolbar-meta">
          <span data-usage-meta>${rangeShort} · ${grainLabel} · 已筛选 ${summary.rows.length} 条 · ${formatMoney(summary.cost)}</span>
          ${showCost ? '' : '<span class="x-muted">当前角色仅开放用量指标</span>'}
        </div>
      </div>
    </article>`;
  }

  function integrationGuideHtml() {
    return `<div id="integration-page-body" class="usage-call-guide">
    <div class="x-config-note" style="margin-bottom:14px">${icon('i-route')}<span><strong>统一 AI 网关（OneGateway 对齐）</strong>：一个端点 · 一套 OpenAI 兼容协议 · 虚拟 Key 隔离上游凭证。应用只改 Base URL + model（对外服务名），即可接入多源模型，并享受智能路由、配额与审计。</span></div>
      <article class="card">
        <div class="card-head"><div><h2>调用方式总览</h2><p>个人 Key 与应用 Key 鉴权不同：前者必须绑定企业用户身份，后者只需 Key</p></div></div>
        <div class="providers-table" style="padding:0 18px 18px">
          <table>
            <thead><tr><th>类型</th><th>鉴权凭证</th><th>是否需要用户身份</th><th>用量归属</th><th>典型场景</th></tr></thead>
            <tbody>
              <tr>
                <td><span class="event-chip orange">个人 Key</span></td>
                <td>Bearer 个人 Key</td>
                <td><strong>必须</strong> · 关联企业成员与组织信息</td>
                <td>具名员工消耗 · 费用计入开通时所属组织</td>
                <td>试用、联调、内部助手</td>
              </tr>
              <tr>
                <td><span class="event-chip green">应用 Key</span></td>
                <td>Bearer 应用 Key</td>
                <td><strong>不需要</strong> · 终端用户可不必登录平台</td>
                <td>按应用 / 组织层级汇总</td>
                <td>生产应用、批处理、开放接入</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="card">
        <div class="card-head"><div><h2>个人 Key · 需结合用户身份</h2><p>个人 Key 只代表「这把钥匙」；实际调用人必须是企业成员，并带上可核验的个人组织信息，才能落到单人用量</p></div><span class="event-chip orange">必填身份</span></div>
        <div class="usage-guide-body">
          <div class="permission-note" style="margin:0 0 12px">${icon('i-shield')}<span>网关会校验：Key 所有者 / 绑定成员 ↔ Header 中的企业用户标识一致，并读取其部门等组织属性用于限额与账单。</span></div>
          <div class="x-detail-grid" style="grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
            <div class="x-recommendation"><i>1</i><div><strong>企业用户标识</strong><p>成员 userId 或员工工号，须与成员管理中一致</p></div></div>
            <div class="x-recommendation"><i>2</i><div><strong>组织信息</strong><p>部门等，可与成员档案自动关联，也可显式传入核对</p></div></div>
            <div class="x-recommendation"><i>3</i><div><strong>身份来源</strong><p>推荐对接企业 IdP / SSO；演示可用 Header 直传</p></div></div>
            <div class="x-recommendation"><i>4</i><div><strong>失败表现</strong><p>缺身份、身份与 Key 不匹配时拒绝调用（如 401 / 403）</p></div></div>
          </div>
          <pre class="usage-guide-code"><code>POST /personal/v1/chat/completions
Host: 127.0.0.1:8787
Authorization: Bearer &lt;个人_API_Key&gt;
X-User-Id: u_55e2cf
X-Org-Dept: 客户服务

{
  "model": "demo-chat",
  "messages": [{"role":"user","content":"你好"}]
}</code></pre>
          <p class="x-muted" style="margin:10px 0 0;font-size:10px">本地网关：生产 <code>${GATEWAY_API}</code>，测试 <code>${GATEWAY_TEST_API}</code>。须带 <code>X-User-Id</code>；缺身份拒绝。</p>
        </div>
      </article>

      <article class="card">
        <div class="card-head"><div><h2>应用 Key · 无需用户身份</h2><p>应用 Key 代表业务系统本身；不必、也不要求终端用户登录模型网关</p></div><span class="event-chip green">仅 Key</span></div>
        <div class="usage-guide-body">
          <div class="permission-note" style="margin:0 0 12px">${icon('i-shield')}<span>走<strong>应用</strong>入口 <code>/app/v1</code>（测试端口 8788）。只需 Authorization 携带应用 Key。</span></div>
          <pre class="usage-guide-code"><code>POST /app/v1/chat/completions
Host: 127.0.0.1:8787
Authorization: Bearer &lt;应用_API_Key&gt;

{
  "model": "demo-chat",
  "messages": [{"role":"user","content":"你好"}]
}</code></pre>
          <p class="x-muted" style="margin:10px 0 0;font-size:10px">可选：应用若自有账号体系，可自行在业务侧记「哪个终端用户」，但<strong>不作为</strong>网关鉴权与账单拆人的必要条件。</p>
        </div>
      </article>

      <article class="card x-secondary-card">
        <div class="x-section-intro"><div><h2>对接检查清单</h2><p>上线前按 Key 类型核对</p></div><button class="btn" data-x="copy-call-guide">复制个人 Key 示例</button></div>
        <div class="activity-list" style="padding:0 18px 18px">
          <div class="activity"><div class="activity-icon">个</div><div><strong>个人 Key</strong><p>Bearer + 企业用户身份（及可关联的组织信息）→ 才能统计到人</p></div><b>必选身份</b></div>
          <div class="activity"><div class="activity-icon" style="color:#168b70;background:#e8f7f2">应</div><div><strong>应用 Key</strong><p>仅 Bearer 应用 Key → 按应用 / 组织出账</p></div><b>无需身份</b></div>
          <div class="activity"><div class="activity-icon" style="color:#477ee6;background:#edf3ff">模</div><div><strong>model 字段</strong><p>填控制台「模型服务」统一服务名，勿填厂商原始名</p></div><b>共用</b></div>
        </div>
      </article>
    </div>`;
  }

  function usageMetricsHtml(rows = filteredUsageDetails()) {
    const s = usageSummary(rows);
    const f = state.usageFilters;
    const rangeShort = periodLabelShort(f.period, f.customStart, f.customEnd);
    const showCost = canViewCostDepth();
    const inShare = s.tokenTotal ? Math.round(s.inTotal / s.tokenTotal * 100) : 0;
    const outShare = s.tokenTotal ? 100 - inShare : 0;
    if (!showCost) {
      return `<section class="metrics usage-metrics" data-usage-block="metrics">
        <div class="metric-card"><div class="metric-top"><span>筛选请求量</span><span class="metric-icon">${icon('i-chart')}</span></div><strong>${formatRequestCount(s.requests)}</strong><small>${rangeShort} · ${s.rows.length} 条明细</small></div>
        <div class="metric-card" style="--tone:#edf3ff;--accent:#427cf3"><div class="metric-top"><span>输入 Token</span><span class="metric-icon">${icon('i-cpu')}</span></div><strong>${formatTokensM(s.inTotal)}</strong><small>占总量 ${inShare}%</small></div>
        <div class="metric-card" style="--tone:#fff3e8;--accent:#ef8c3b"><div class="metric-top"><span>输出 Token</span><span class="metric-icon">${icon('i-route')}</span></div><strong>${formatTokensM(s.outTotal)}</strong><small>占总量 ${outShare}%</small></div>
        <div class="metric-card" style="--tone:#f3effe;--accent:#7655cb"><div class="metric-top"><span>平均缓存命中</span><span class="metric-icon">${icon('i-route')}</span></div><strong>${s.cache.toFixed(1)}%</strong><small>Token 总量 ${formatTokensM(s.tokenTotal)}</small></div>
      </section>`;
    }
    const budget = Math.max(s.cost * 1.5, 280000 / 4);
    const usageRate = budget ? Math.min(99.9, s.cost / budget * 100) : 0;
    const avg = s.requests ? s.cost / s.requests : 0;
    return `<section class="metrics usage-metrics" data-usage-block="metrics">
      <div class="metric-card"><div class="metric-top"><span>筛选请求量</span><span class="metric-icon">${icon('i-chart')}</span></div><strong>${formatRequestCount(s.requests)}</strong><small>${rangeShort} · ${s.rows.length} 条明细</small></div>
      <div class="metric-card" style="--tone:#edf3ff;--accent:#427cf3"><div class="metric-top"><span>Token 总量</span><span class="metric-icon">${icon('i-cpu')}</span></div><strong>${formatTokensM(s.tokenTotal)}</strong><small>输入 ${formatTokensM(s.inTotal)} · 输出 ${formatTokensM(s.outTotal)}</small></div>
      <div class="metric-card" style="--tone:#e8f7f2;--accent:#168b70"><div class="metric-top"><span>区间总费用</span><span class="metric-icon">${icon('i-wallet')}</span></div><strong>${formatMoney(s.cost)}</strong><small>单次均价 ¥${avg.toFixed(4)} · 缓存 ${s.cache.toFixed(1)}%</small></div>
      <div class="metric-card" style="--tone:#f3effe;--accent:#7655cb"><div class="metric-top"><span>预算使用率</span><span class="metric-icon">${icon('i-shield')}</span></div><strong>${usageRate.toFixed(1)}%</strong><small>预算 ${formatMoney(budget)}</small></div>
    </section>`;
  }

  function usageChartsHtml(rows = filteredUsageDetails()) {
    if (!canViewCostDepth()) return usageChartHtml(rows);
    return `<section class="usage-chart-grid" data-usage-block="charts">${usageChartHtml(rows)}${billingChartHtml(rows)}</section>`;
  }

  function usageChartHtml(rows = filteredUsageDetails()) {
    const f = state.usageFilters;
    const grainLabel = f.grain === 'week' ? '按周' : f.grain === 'month' ? '按月' : '按日';
    const days = buildChartSeries(rows, f, 'tokens');
    const allEmpty = !days.length || days.every(item => item.empty);
    return `<article class="card" data-usage-block="chart"><div class="card-head"><div><h2>模型 Token 用量</h2><p>${periodLabelText(f.period, f.customStart, f.customEnd)} · ${grainLabel} · 单位：百万 Token · 悬停查看明细${allEmpty ? ' · 本期暂无调用，仍保留完整日期轴' : ''}</p></div><div class="chart-labels" style="border:0"><span><b></b>输入</span><span><b></b>输出</span></div></div><div class="bar-chart ${days.length > 14 ? 'dense' : ''} ${allEmpty ? 'is-empty' : ''}">${days.map(item => `<div class="bar-item ${item.empty ? 'is-empty' : ''}" tabindex="0">${chartBarTipHtml(item)}<div class="bar-cols"><i style="height:${item.inH || 0}%"></i><i style="height:${item.outH || 0}%"></i></div><span class="bar-label">${item.label}</span></div>`).join('') || '<div class="bar-empty-note">无法生成日期轴</div>'}</div></article>`;
  }

  function usageDimTabsHtml(prefix = 'usage') {
    const dim = state.costDim || 'org';
    const tabs = [
      ['org', '按组织层级'],
      ['app', '按应用'],
      ['service', '按模型服务']
    ];
    return `<div class="x-subnav" style="margin:0">${tabs.map(([id, label]) => `<button type="button" class="${dim === id ? 'active' : ''}" data-x="cost-dim" data-dim="${id}" data-prefix="${prefix}">${label}</button>`).join('')}</div>`;
  }

  function usageRankingHtml(rows = filteredUsageDetails()) {
    const colors = ['', '#5f86df', '#eca055', '#8f72d1', '#35c29a'];
    const dim = state.costDim || 'org';
    const groups = {};
    rows.forEach(row => {
      let name = row.serviceName || '未命名服务';
      if (dim === 'org') name = `${orgLevelLabel(row.orgLevel)} · ${row.orgName || row.billingDept || '未分配'}`;
      else if (dim === 'app') name = row.keyKind === 'app' ? (row.appName || row.subjectLabel || row.keyName) : `个人 · ${row.userName || row.ownerName || '未命名'}`;
      if (!groups[name]) groups[name] = 0;
      groups[name] += row.inTokensM + row.outTokensM;
    });
    const ranked = Object.entries(groups).sort((a, b) => b[1] - a[1]);
    const max = ranked[0]?.[1] || 1;
    const title = dim === 'org' ? '组织层级用量排行' : dim === 'app' ? '应用 / 个人用量排行' : '模型服务用量排行';
    const desc = dim === 'app'
      ? '应用 Key 按应用汇总（调用方不必登录平台）；个人 Key 按使用人汇总'
      : dim === 'org'
        ? '按 Key 开通时绑定的企业 / 部门归集 Token'
        : '按当前筛选结果汇总 Token';
    const body = ranked.length
      ? ranked.map(([name, tokens], i) => `<div class="x-budget-row"><strong>${name}</strong><div class="x-budget-track"><span style="width:${Math.max(8, Math.round(tokens / max * 100))}%;${i ? `background:${colors[i % colors.length]}` : ''}"></span></div><b>${formatTokensM(tokens)}</b></div>`).join('')
      : `<div class="x-empty-panel" style="margin:8px 0"><strong>无排行数据</strong><p>当前筛选条件下没有可汇总的用量。</p></div>`;
    return `<article class="card x-secondary-card" data-usage-block="ranking"><div class="x-section-intro"><div><h2>${title}</h2><p>${desc}</p></div>${usageDimTabsHtml('usage')}</div><div class="x-budget">${body}</div></article>`;
  }

  function ensureUsageDetailFilters() {
    if (!state.usageDetailFilters || typeof state.usageDetailFilters !== 'object') {
      state.usageDetailFilters = { query: '', keyKind: '', service: '', dept: '' };
    }
    const f = state.usageDetailFilters;
    if (f.query == null) f.query = '';
    if (f.keyKind == null) f.keyKind = '';
    if (f.service == null) f.service = '';
    if (f.dept == null) f.dept = '';
    return f;
  }

  function ensureUsageDetailPager() {
    if (!state.usageDetailPager || typeof state.usageDetailPager !== 'object') {
      state.usageDetailPager = { page: 1, pageSize: 50 };
    }
    const p = state.usageDetailPager;
    const allowed = [50, 100, 300];
    p.pageSize = allowed.includes(Number(p.pageSize)) ? Number(p.pageSize) : 50;
    p.page = Math.max(1, Number(p.page) || 1);
    return p;
  }

  function filteredUsageDetailRows(baseRows = filteredUsageDetails()) {
    const f = ensureUsageDetailFilters();
    const q = String(f.query || '').trim().toLowerCase();
    return baseRows.filter(row => {
      if (f.keyKind && row.keyKind !== f.keyKind) return false;
      if (f.service && row.serviceName !== f.service) return false;
      if (f.dept && row.billingDept !== f.dept && row.orgName !== f.dept) return false;
      if (!q) return true;
      const hay = [
        row.dateLabel, row.orgName, row.billingDept, row.keyName, row.keyAlias,
        row.appName, row.subjectLabel, row.ownerName, row.userName,
        row.serviceName, row.serviceId, row.sourceName, row.keyKindLabel, row.orgLevelLabel
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function paginateUsageDetailRows(rows = filteredUsageDetailRows()) {
    const pager = ensureUsageDetailPager();
    const total = rows.length;
    const pageCount = Math.max(1, Math.ceil(total / pager.pageSize) || 1);
    if (pager.page > pageCount) pager.page = pageCount;
    const start = (pager.page - 1) * pager.pageSize;
    return {
      rows: rows.slice(start, start + pager.pageSize),
      total,
      page: pager.page,
      pageSize: pager.pageSize,
      pageCount,
      start: total ? start + 1 : 0,
      end: Math.min(total, start + pager.pageSize)
    };
  }

  function usageDetailToolbarHtml(matchedRows, baseRows) {
    const f = ensureUsageDetailFilters();
    const uf = state.usageFilters;
    const services = [...new Set((baseRows || []).map(r => r.serviceName).filter(Boolean))].sort();
    const depts = [...new Set((baseRows || []).map(r => r.billingDept || r.orgName).filter(Boolean))].sort();
    const advancedCount = usageAdvancedFilterCount();
    const advancedLabel = advancedCount ? `高级筛选 · ${advancedCount}` : '高级筛选';
    return `<div class="source-toolbar usage-detail-toolbar">
      <label class="member-search source-search">${icon('i-search')}<input id="x-usage-detail-search" type="search" placeholder="搜索密钥 / 应用 / 服务 / 组织 / 所有者" value="${f.query || ''}"></label>
      <select class="mini-select" data-usage-detail-filter="keyKind">
        <option value="">全部主体</option>
        <option value="app" ${f.keyKind === 'app' ? 'selected' : ''}>应用 Key</option>
        <option value="personal" ${f.keyKind === 'personal' ? 'selected' : ''}>个人 Key</option>
      </select>
      <select class="mini-select" data-usage-detail-filter="service">
        <option value="">全部服务</option>
        ${services.map(s => `<option value="${s}" ${f.service === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <select class="mini-select" data-usage-detail-filter="dept">
        <option value="">全部部门</option>
        ${depts.map(d => `<option value="${d}" ${f.dept === d ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
      <div class="x-time-range-field inline">${timeRangeSelectHtml({
        name: 'usage',
        selected: uf.period,
        selectClass: 'mini-select',
        start: uf.customStart,
        end: uf.customEnd,
        grain: uf.grain || 'day'
      })}</div>
      <button class="btn ${advancedCount ? 'active-filter' : ''}" type="button" data-x="open-usage-filter" data-usage-filter-btn>${advancedLabel}</button>
      <button class="btn primary" type="button" data-x="export-usage-detail">导出明细</button>
      <span class="usage-filter-hint">匹配 ${matchedRows.length} 条</span>
    </div>`;
  }

  function usageDetailPagerHtml(pageInfo) {
    const { page, pageSize, pageCount, start, end, total } = pageInfo;
    return `<div class="usage-detail-foot">
      <div class="usage-detail-pager">
        <label>每页
          <select class="mini-select" data-usage-detail-pagesize>
            ${[50, 100, 300].map(n => `<option value="${n}" ${pageSize === n ? 'selected' : ''}>${n} 条</option>`).join('')}
          </select>
        </label>
        <span class="usage-filter-hint">第 ${start}-${end} 条 / 共 ${total} 条</span>
        <div class="usage-detail-pager-btns">
          <button class="btn" type="button" data-x="usage-detail-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
          <span class="usage-detail-page-num">第 ${page} / ${pageCount} 页</span>
          <button class="btn" type="button" data-x="usage-detail-next" ${page >= pageCount ? 'disabled' : ''}>下一页</button>
        </div>
      </div>
    </div>`;
  }

  function usageDetailTable(baseRows = filteredUsageDetails()) {
    const matched = filteredUsageDetailRows(baseRows);
    const pageInfo = paginateUsageDetailRows(matched);
    const rangeText = periodLabelText(state.usageFilters.period, state.usageFilters.customStart, state.usageFilters.customEnd);
    const totalCost = matched.reduce((sum, row) => sum + row.cost, 0);
    return `<article class="card x-secondary-card wide-card usage-detail-card" data-usage-block="detail">
      <div class="card-head"><div><h2>用量统计明细</h2><p data-usage-detail-meta>${rangeText} · 匹配 ${pageInfo.total} 条 · 费用总计 ${formatMoney(totalCost)}</p></div></div>
      ${usageDetailToolbarHtml(matched, baseRows)}
      <div class="providers-table usage-detail-table"><table>
        <thead><tr>
          <th>日期</th>
          <th>组织归属</th>
          <th>主体类型</th>
          <th>密钥名称</th>
          <th>应用 / 个人</th>
          <th>所有者</th>
          <th>模型服务名称</th>
          <th>源模型服务名称</th>
          <th>输入 Token 用量</th>
          <th>输入单价</th>
          <th>输出 Token 用量</th>
          <th>输出单价</th>
          <th>缓存命中百分比</th>
          <th>费用</th>
        </tr></thead>
        <tbody>${usageDetailBodyHtml(pageInfo.rows)}</tbody>
        <tfoot>${usageDetailFootHtml(matched)}</tfoot>
      </table></div>
      ${usageDetailPagerHtml(pageInfo)}
    </article>`;
  }

  function isUsageDetailPage() {
    return typeof currentPage === 'function' && currentPage() === 'usage-detail';
  }

  function usagePageBody() {
    const rows = filteredUsageDetails();
    if (isUsageDetailPage()) {
      return `<div id="usage-tab-panel">${usageDetailPagePanel(rows)}</div>`;
    }
    return `${usageFilterBar()}<div id="usage-tab-panel">${usageOverviewPanel(rows)}</div>`;
  }

  function renderIntegrationPage() {
    const root = $('#page-content');
    if (!root) return;
    let body = $('#integration-page-body', root);
    if (body) body.outerHTML = integrationGuideHtml();
    else root.insertAdjacentHTML('beforeend', integrationGuideHtml());
  }

  function renderUsagePage() {
    const root = $('#page-content');
    if (!root) return;
    // 清理旧独立费用页残留
    $('#billing-page-body', root)?.remove();
    let body = $('#usage-page-body', root);
    if (!body) {
      body = document.createElement('div');
      body.id = 'usage-page-body';
      root.appendChild(body);
    }
    body.innerHTML = usagePageBody();
    syncCustomRangeVisibility(body);
    // 进入页面时拉取网关真实调用日志，避免停留在演示/缓存口径
    syncGatewayCatalog().then(ok => {
      if (!ok || !$('#usage-page-body')) return;
      refreshUsageViews();
    });
  }

  function refreshUsageViews() {
    const body = $('#usage-page-body');
    if (!body) {
      renderUsagePage();
      return;
    }
    syncBillingFiltersFromUsage();
    const rows = filteredUsageDetails();
    const f = state.usageFilters;
    const grainLabel = f.grain === 'week' ? '按周' : f.grain === 'month' ? '按月' : '按日';
    const rangeShort = periodLabelShort(f.period, f.customStart, f.customEnd);
    const filterHint = $('[data-usage-meta]', $('.usage-filter-card', body) || body);
    if (filterHint) {
      filterHint.textContent = `${rangeShort} · ${grainLabel} · 已筛选 ${rows.length} 条 · ${formatMoney(rows.reduce((s, r) => s + r.cost, 0))}`;
    }
    const filterBtn = $('[data-usage-filter-btn]', body);
    if (filterBtn) {
      const n = usageAdvancedFilterCount();
      filterBtn.textContent = n ? `高级筛选 · ${n}` : '高级筛选';
      filterBtn.classList.toggle('active-filter', n > 0);
    }
    const panel = $('#usage-tab-panel', body);
    if (panel) {
      panel.innerHTML = isUsageDetailPage() ? usageDetailPagePanel(rows) : usageOverviewPanel(rows);
      syncCustomRangeVisibility(body);
      return;
    }
    renderUsagePage();
  }

  function billingMetricsHtml(rows = filteredBillingDetails()) {
    const s = usageSummary(rows);
    const f = state.usageFilters;
    const rangeText = periodLabelText(f.period, f.customStart, f.customEnd);
    const budget = Math.max(s.cost * 1.5, 280000 / 4);
    const usageRate = budget ? Math.min(99.9, s.cost / budget * 100) : 0;
    const avg = s.requests ? s.cost / s.requests : 0;
    return `<section class="metrics" data-billing-block="metrics">
      <div class="metric-card"><div class="metric-top"><span>区间总成本</span><span class="metric-icon">${icon('i-wallet')}</span></div><strong>${formatMoney(s.cost)}</strong><small>${rangeText}</small></div>
      <div class="metric-card" style="--tone:#edf3ff;--accent:#427cf3"><div class="metric-top"><span>单次请求均价</span><span class="metric-icon">${icon('i-chart')}</span></div><strong>¥ ${avg.toFixed(4)}</strong><small>${formatRequestCount(s.requests)} 次请求</small></div>
      <div class="metric-card" style="--tone:#fff3e8;--accent:#ef8c3b"><div class="metric-top"><span>Token 总量</span><span class="metric-icon">${icon('i-route')}</span></div><strong>${formatTokensM(s.tokenTotal)}</strong><small>输入 ${formatTokensM(s.inTotal)} · 输出 ${formatTokensM(s.outTotal)}</small></div>
      <div class="metric-card" style="--tone:#f3effe;--accent:#7655cb"><div class="metric-top"><span>预算使用率</span><span class="metric-icon">${icon('i-shield')}</span></div><strong>${usageRate.toFixed(1)}%</strong><small>预算 ${formatMoney(budget)}</small></div>
    </section>`;
  }

  function billingChartHtml(rows = filteredBillingDetails()) {
    const f = state.usageFilters;
    const grainLabel = f.grain === 'week' ? '按周' : f.grain === 'month' ? '按月' : '按日';
    const series = buildChartSeries(rows, f, 'cost');
    const allEmpty = !series.length || series.every(item => item.empty);
    return `<article class="card" data-billing-block="chart"><div class="card-head"><div><h2>费用趋势</h2><p>${periodLabelText(f.period, f.customStart, f.customEnd)} · ${grainLabel} · 悬停查看 Token 与费用${allEmpty ? ' · 本期暂无费用，仍保留完整日期轴' : ''}</p></div><div class="chart-labels" style="border:0"><span><b></b>费用</span></div></div><div class="bar-chart ${series.length > 14 ? 'dense' : ''} ${allEmpty ? 'is-empty' : ''}">${series.map(item => `<div class="bar-item ${item.empty ? 'is-empty' : ''}" tabindex="0">${chartBarTipHtml(item)}<div class="bar-cols"><i style="height:${item.inH || 0}%;background:#427cf3"></i></div><span class="bar-label">${item.label}</span></div>`).join('') || '<div class="bar-empty-note">无法生成日期轴</div>'}</div></article>`;
  }

  function aggregateCostBy(rows, keyFn) {
    const map = {};
    rows.forEach(row => {
      const name = keyFn(row) || '其他';
      if (!map[name]) map[name] = { cost: 0, tokens: 0, app: 0, personal: 0, keys: new Set(), level: row.orgLevel || '' };
      map[name].cost += row.cost;
      map[name].tokens += row.inTokensM + row.outTokensM;
      if (row.keyKind === 'personal') map[name].personal += row.cost;
      else map[name].app += row.cost;
      if (row.keyName) map[name].keys.add(row.keyName);
      if (!map[name].level && row.orgLevel) map[name].level = row.orgLevel;
    });
    return Object.entries(map).sort((a, b) => b[1].cost - a[1].cost);
  }

  function billingPrimaryTableHtml(rows, denom) {
    const dim = state.costDim || 'org';
    if (dim === 'app') {
      const ranked = aggregateCostBy(rows.filter(r => r.keyKind !== 'personal'), r => r.appName || r.subjectLabel || r.keyName);
      const rowsHtml = ranked.length
        ? ranked.map(([name, item]) => `<tr><td><strong>${name}</strong><br><span class="x-muted">${item.keys.size} 把应用 Key · 共用接入可不登录</span></td><td>${formatTokensM(item.tokens)}</td><td>${formatMoney(item.cost)}</td><td>${Math.round(item.cost / denom * 100)}%</td></tr>`).join('')
        : `<tr><td colspan="4">当前筛选无应用费用（可切换主体类型=应用 Key）</td></tr>`;
      return { title: '按应用汇总', desc: '应用 Key 费用归应用本身；终端用户无需登录平台', head: '<tr><th>应用</th><th>Token</th><th>费用</th><th>占比</th></tr>', body: rowsHtml, count: ranked.length };
    }
    if (dim === 'service') {
      const ranked = aggregateCostBy(rows, r => r.serviceName || '未命名').slice(0, 8);
      const rowsHtml = ranked.length
        ? ranked.map(([name, item]) => `<tr><td><strong>${name}</strong><br><span class="x-muted">应用 ${formatMoney(item.app)} · 个人 ${formatMoney(item.personal)}</span></td><td>${formatTokensM(item.tokens)}</td><td>${formatMoney(item.cost)}</td><td>${Math.round(item.cost / denom * 100)}%</td></tr>`).join('')
        : `<tr><td colspan="4">暂无费用数据</td></tr>`;
      return { title: '按模型服务汇总', desc: '可继续用筛选下钻上游源', head: '<tr><th>模型服务</th><th>Token</th><th>费用</th><th>占比</th></tr>', body: rowsHtml, count: ranked.length };
    }
    const ranked = aggregateCostBy(rows, r => `${orgLevelLabel(r.orgLevel)}｜${r.orgName || r.billingDept || '未分配'}`);
    const rowsHtml = ranked.length
      ? ranked.map(([name, item]) => {
          const [levelLabel, orgName] = name.split('｜');
          return `<tr><td><strong>${orgName || name}</strong><br><span class="x-muted">${levelLabel || orgLevelLabel(item.level)} · 应用 ${formatMoney(item.app)} · 个人 ${formatMoney(item.personal)}</span></td><td>${formatTokensM(item.tokens)}</td><td>${formatMoney(item.cost)}</td><td>${Math.round(item.cost / denom * 100)}%</td></tr>`;
        }).join('')
      : `<tr><td colspan="4">暂无组织费用</td></tr>`;
    return { title: '按组织层级汇总', desc: '企业 / 部门 · 以 Key 开通时的费用归属为准', head: '<tr><th>归属组织</th><th>Token</th><th>费用</th><th>占比</th></tr>', body: rowsHtml, count: ranked.length };
  }

  function billingBreakdownHtml(rows = filteredBillingDetails()) {
    const f = state.usageFilters;
    const rangeText = periodLabelText(f.period, f.customStart, f.customEnd);
    const total = rows.reduce((sum, row) => sum + row.cost, 0);
    const denom = total || 1;
    const appCost = rows.filter(r => r.keyKind !== 'personal').reduce((s, r) => s + r.cost, 0);
    const personalCost = rows.filter(r => r.keyKind === 'personal').reduce((s, r) => s + r.cost, 0);
    const byLevel = {
      enterprise: rows.filter(r => r.orgLevel === 'enterprise').reduce((s, r) => s + r.cost, 0),
      dept: rows.filter(r => r.orgLevel !== 'enterprise').reduce((s, r) => s + r.cost, 0)
    };
    const primary = billingPrimaryTableHtml(rows, denom);
    const rankedApps = aggregateCostBy(rows.filter(r => r.keyKind !== 'personal'), r => r.appName || r.subjectLabel || r.keyName).slice(0, 5);
    const rankedPeople = aggregateCostBy(rows.filter(r => r.keyKind === 'personal'), r => r.userName || r.ownerName || '未命名').slice(0, 4);
    const appRows = rankedApps.length
      ? rankedApps.map(([name, item]) => `<tr><td><strong>${name}</strong><br><span class="x-muted">${item.keys.size} Key</span></td><td>${formatTokensM(item.tokens)}</td><td>${formatMoney(item.cost)}</td><td>${Math.round(item.cost / denom * 100)}%</td></tr>`).join('')
      : `<tr><td colspan="4">当前筛选无应用 Key 费用</td></tr>`;
    const personRows = rankedPeople.length
      ? rankedPeople.map(([name, item]) => `<tr><td><strong>${name}</strong></td><td>${formatTokensM(item.tokens)}</td><td>${formatMoney(item.cost)}</td><td>${Math.round(item.cost / denom * 100)}%</td></tr>`).join('')
      : `<tr><td colspan="4">当前筛选无个人 Key 消耗</td></tr>`;
    const levelHtml = `<div class="activity-list">
        <div class="activity"><div class="activity-icon">企</div><div><strong>企业级归属</strong><p>${Math.round(byLevel.enterprise / denom * 100)}%</p></div><b>${formatMoney(byLevel.enterprise)}</b></div>
        <div class="activity"><div class="activity-icon" style="color:#477ee6;background:#edf3ff">部</div><div><strong>部门级归属</strong><p>${Math.round(byLevel.dept / denom * 100)}%</p></div><b>${formatMoney(byLevel.dept)}</b></div>
      </div>`;
    return `<section class="cost-breakdown" data-billing-block="breakdown">
      <article class="card cost-hero"><div><span>区间费用合计</span><strong>${formatMoney(total)}</strong><p style="color:#8c9aa2;font-size:9px">${rangeText}<br>应用 Key ${Math.round(appCost / denom * 100)}% · 个人 Key ${Math.round(personalCost / denom * 100)}%<br>应用费用按应用归集，不要求调用人登录</p></div><div class="cost-donut"></div></article>
      <article class="card"><div class="card-head"><div><h2>组织层级结构</h2><p>开通时绑定的费用归属层级</p></div></div>${levelHtml}</article>
      <article class="card wide-card"><div class="card-head"><div><h2>${primary.title}</h2><p>${primary.desc} · ${primary.count} 项</p></div>${usageDimTabsHtml('cost')}</div><div class="providers-table"><table><thead>${primary.head}</thead><tbody>${primary.body}</tbody></table></div></article>
      <article class="card"><div class="card-head"><div><h2>应用成本 TOP</h2><p>共用应用 Key · 与是否登录无关</p></div></div><div class="providers-table"><table><thead><tr><th>应用</th><th>Token</th><th>费用</th><th>占比</th></tr></thead><tbody>${appRows}</tbody></table></div></article>
      <article class="card"><div class="card-head"><div><h2>个人消耗 TOP</h2><p>仅个人 Key；费用仍计入所属组织</p></div></div><div class="providers-table"><table><thead><tr><th>员工</th><th>Token</th><th>费用</th><th>占比</th></tr></thead><tbody>${personRows}</tbody></table></div></article>
    </section>`;
  }

  function billingEnhancements() {
    return `<article class="card x-secondary-card" data-billing-block="tips"><div class="x-section-intro"><div><h2>统计口径说明</h2><p>平台登录用户与调用方可以分离；费用按 Key 绑定的组织层级或应用归集</p></div><button class="btn" data-x="cost-rules">成本规则</button></div><div class="x-detail-grid" style="padding:0 18px 18px;grid-template-columns:1fr 1fr"><div class="x-stack" style="gap:10px"><div class="x-recommendation"><i>组</i><div><strong>按组织层级</strong><p>企业 / 部门，以开通归属为准</p></div></div><div class="x-recommendation"><i>应</i><div><strong>按应用</strong><p>应用 Key 开放给多方调用时，统一计入该应用成本</p></div></div></div><div class="x-stack" style="gap:10px"><div class="x-recommendation"><i>人</i><div><strong>个人 Key</strong><p>仅统计具名员工消耗，不单独出个人应付账单</p></div></div><div class="x-recommendation"><i>登</i><div><strong>无需人人登录</strong><p>终端用户可不进控制台；账单仍可按组织/应用出账</p></div></div></div></div></article>`;
  }

  function costPagePanel(rows = filteredBillingDetails()) {
    // 兼容旧入口：费用已并入用量概览
    return usageOverviewPanel(rows);
  }

  function usageOverviewPanel(rows = filteredUsageDetails()) {
    const showCost = canViewCostDepth();
    return `<div data-usage-panel="overview">
      ${usageMetricsHtml(rows)}
      ${usageChartsHtml(rows)}
      ${usageRankingHtml(rows)}
      ${showCost ? billingBreakdownHtml(rows) : ''}
      ${showCost ? billingEnhancements() : ''}
      <article class="card x-secondary-card"><div class="x-section-intro"><div><h2>需要逐条核对？</h2><p>明细页支持分页浏览与导出 CSV</p></div><button class="btn primary" data-page-jump="usage-detail">打开用量明细</button></div></article>
    </div>`;
  }

  function usageDetailPagePanel(rows = filteredUsageDetails()) {
    return `<div data-usage-panel="detail">${usageDetailTable(rows)}</div>`;
  }

  function usagePagePanel(rows = filteredUsageDetails()) {
    return isUsageDetailPage() ? usageDetailPagePanel(rows) : usageOverviewPanel(rows);
  }

  function billingPageBody() {
    return usageOverviewPanel();
  }

  function renderBillingPage() {
    if (window.render && currentPage() !== 'usage') {
      window.render('usage');
      setTimeout(enhanceView, 0);
      return;
    }
    renderUsagePage();
  }

  function refreshBillingViews() {
    refreshUsageViews();
  }

  function applyGrain(target, grain) {
    const filter = state.usageFilters;
    filter.grain = grain;
    if (filter.period !== CUSTOM_TIME_RANGE && !grainPresets(grain).includes(filter.period)) {
      filter.period = defaultPeriodForGrain(grain);
    }
    syncBillingFiltersFromUsage();
    resetUsageDetailPager();
    renderUsagePage();
  }

  function resetUsageDetailPager() {
    const pager = ensureUsageDetailPager();
    pager.page = 1;
  }

  function resetUsageDetailLocalFilters() {
    state.usageDetailFilters = { query: '', keyKind: '', service: '', dept: '' };
    resetUsageDetailPager();
  }

  function policyForm(id = '') {
    const p = (state.policies || []).find(x => x.id === id);
    const hostingScope = ['all', 'saas', 'local'].includes(p?.hostingScope) ? p.hostingScope : 'all';
    const types = policyTypesForHosting(hostingScope);
    const type = types.includes(p?.type) ? p.type : types[0];
    const actions = policyActionsForType(type);
    const actionVal = actions.includes(p?.action) ? p.action : actions[0];
    const scopes = ['全局', '指定部门'];
    const deptNames = memberDepartments.filter(d => d && d !== '未分配');
    const selectedDept = (p?.depts || [])[0] || '全部部门';
    const hint = hostingScope === 'saas'
      ? 'SaaS 侧重：出域前脱敏、密钥/凭证拦截、第三方内容安全与越权。'
      : hostingScope === 'local'
        ? '本地侧重：推理端点 ACL、知识库越权、GPU/QPS 资源滥用治理。'
        : '适用于全部部署类型的通用规则；也可再拆成仅 SaaS / 仅本地。';
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">${p ? '编辑安全策略' : '新建安全策略'}</h2><p>按 SaaS / 本地模型差异配置；策略命中审计将引用此处规则</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body"><div class="x-form-grid">
        <div class="x-field full"><label class="x-required">作用模型类型</label>
          <select class="x-select" name="polHostingScope" data-x="pol-hosting-change">
            <option value="all" ${hostingScope === 'all' ? 'selected' : ''}>全部类型（SaaS + 本地）</option>
            <option value="saas" ${hostingScope === 'saas' ? 'selected' : ''}>仅 SaaS 模型</option>
            <option value="local" ${hostingScope === 'local' ? 'selected' : ''}>仅本地模型</option>
          </select>
          <span class="x-help" id="x-pol-hosting-hint">${hint}</span>
        </div>
        <div class="x-field"><label class="x-required">策略名称</label><input class="x-input" name="polName" value="${p?.name || ''}"><span class="x-error">请输入名称</span></div>
        <div class="x-field"><label class="x-required">策略编码</label><input class="x-input" name="polCode" value="${p?.code || ''}" placeholder="pii-mask-cn-v2"><span class="x-error">请输入编码</span></div>
        <div class="x-field"><label>类型</label><select class="x-select" name="polType" data-x="pol-type-change">${selectOptions(types, type)}</select></div>
        <div class="x-field"><label>动作</label><select class="x-select" name="polAction">${selectOptions(actions, actionVal)}</select></div>
        <div class="x-field"><label>作用域</label><select class="x-select" name="polScope">${selectOptions(scopes, p?.scope || '全局')}</select></div>
        <div class="x-field"><label>部门</label><select class="x-select" name="polDept"><option value="全部部门">全部部门</option>${selectOptions(deptNames, selectedDept === '全部部门' ? '' : selectedDept)}</select></div>
        <div class="x-field full"><label>说明</label><textarea class="x-textarea" name="polDesc" placeholder="可选：说明检测点、适用场景与例外">${p?.desc || ''}</textarea></div>
      </div></div>
      <div class="x-dialog-foot"><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn primary" data-x="save-policy" data-id="${p?.id || ''}">保存</button></div></div>`;
  }

  function filteredPolicies() {
    const filter = state.policyHostingFilter || '全部';
    return (state.policies || []).filter(p => {
      const scope = p.hostingScope || 'all';
      if (filter === 'SaaS') return scope === 'saas' || scope === 'all';
      if (filter === '本地') return scope === 'local' || scope === 'all';
      return true;
    });
  }

  function policiesPanelHtml() {
    const all = state.policies || [];
    const rows = filteredPolicies();
    const readonly = !(window.getActiveRoleConfig?.()?.x?.includes('*') || (window.getActiveRoleConfig?.()?.perms || []).includes('cap.manage_policies') || (window.getActiveRoleConfig?.()?.perms || []).includes('cap.all_features'));
    const saasN = all.filter(p => (p.hostingScope || 'all') === 'saas').length;
    const localN = all.filter(p => (p.hostingScope || 'all') === 'local').length;
    const filters = ['全部', 'SaaS', '本地'];
    const body = rows.length ? rows.map(p => `<tr>
      <td><strong>${p.name}</strong><br><span class="x-muted">${p.code}</span></td>
      <td><span class="event-chip ${p.hostingScope === 'local' ? 'orange' : p.hostingScope === 'saas' ? 'green' : ''}">${hostingScopeLabel(p.hostingScope || 'all')}</span></td>
      <td>${p.type}</td>
      <td>${p.action}</td>
      <td>${p.scope}<br><span class="x-muted">${(p.depts || []).join('、') || '—'}</span></td>
      <td>${p.hits ?? 0}</td>
      <td>${displayDateTime(p.updated)}</td>
      <td><button class="x-toggle ${p.enabled ? 'on' : ''}" data-x="policy-toggle" data-id="${p.id}" aria-label="启用策略" ${readonly ? 'disabled' : ''}></button></td>
      <td>${readonly ? '<span class="x-muted">只读</span>' : `<button class="x-mini-btn" data-x="edit-policy" data-id="${p.id}">编辑</button>`}</td>
    </tr>`).join('') : `<tr><td colspan="9"><div class="empty-note">当前筛选下暂无安全策略</div></td></tr>`;
    return `<div id="policies-page-body" class="security-workspace"><section class="security-sheet">
      <div class="security-toolbar"><div class="security-count">安全策略 <strong>${all.length}</strong><span>启用 ${all.filter(p => p.enabled).length}</span><span>SaaS ${saasN}</span><span>本地 ${localN}</span></div>
        <div class="security-toolbar-actions">
          <div class="tabs">${filters.map(f => `<button type="button" class="${state.policyHostingFilter === f ? 'active' : ''}" data-x="policy-hosting-filter" data-filter="${f}">${f}</button>`).join('')}</div>
          <button class="btn" data-page-jump="audit-policy">查看命中审计</button>
        </div></div>
      <div class="x-config-note" style="margin:12px 16px">${icon('i-shield')}<span><strong>SaaS</strong>：数据出域管控、第三方内容安全；<strong>本地</strong>：端点 ACL、知识库越权、推理资源治理。通用脱敏/越权可作用全部类型。</span></div>
      <div class="providers-table"><table><thead><tr><th>策略</th><th>模型类型</th><th>类型</th><th>动作</th><th>范围</th><th>累计命中</th><th>更新时间</th><th>启用</th><th></th></tr></thead><tbody>${body}</tbody></table></div>
    </section></div>`;
  }

  function renderPoliciesPage() {
    const root = $('#page-content');
    if (!root || currentPage() !== 'security-policies') return;
    const mount = $('#x-policies-panel', root) || root;
    const body = $('#policies-page-body', mount) || $('#policies-page-body', root);
    if (body) body.outerHTML = policiesPanelHtml();
    else mount.insertAdjacentHTML('beforeend', policiesPanelHtml());
  }

  function alertRuleForm(id = '') {
    const r = (state.alertRules || []).find(x => x.id === id);
    const metrics = ['延迟', '错误率', '预算', '上游配额'];
    const severities = ['提醒', '警告', '严重'];
    const deptNames = memberDepartments.filter(d => d && d !== '未分配');
    const selectedDept = (r?.depts || [])[0] || '全部部门';
    return `<div class="x-dialog-head"><div><h2 id="x-modal-title">${r ? '编辑告警规则' : '新建告警规则'}</h2><p>触发后写入通知中心，并可跳转审计</p></div><button class="x-close" data-x="close">${icon('i-close')}</button></div>
      <div class="x-dialog-body"><div class="x-form-grid">
        <div class="x-field"><label class="x-required">规则名称</label><input class="x-input" name="alName" value="${r?.name || ''}"><span class="x-error">请输入名称</span></div>
        <div class="x-field"><label>指标</label><select class="x-select" name="alMetric">${selectOptions(metrics, r?.metric || '延迟')}</select></div>
        <div class="x-field"><label class="x-required">阈值</label><input class="x-input" name="alThreshold" value="${r?.threshold || ''}" placeholder="1500 ms / 1.5% / 80%"><span class="x-error">请输入阈值</span></div>
        <div class="x-field"><label>窗口</label><input class="x-input" name="alWindow" value="${r?.window || '5 分钟'}"></div>
        <div class="x-field"><label>严重级别</label><select class="x-select" name="alSeverity">${selectOptions(severities, r?.severity || '警告')}</select></div>
        <div class="x-field"><label>部门</label><select class="x-select" name="alDept"><option value="全部部门">全部部门</option>${selectOptions(deptNames, selectedDept === '全部部门' ? '' : selectedDept)}</select></div>
      </div></div>
      <div class="x-dialog-foot"><div class="x-dialog-foot-right"><button class="btn" data-x="close">取消</button><button class="btn primary" data-x="save-alert-rule" data-id="${r?.id || ''}">保存</button></div></div>`;
  }

  function alertsPanelHtml() {
    const rows = state.alertRules || [];
    const canManage = window.getActiveRoleConfig?.()?.x?.includes('*')
      || (window.getActiveRoleConfig?.()?.perms || []).some(p => ['cap.manage_alerts', 'cap.all_features'].includes(p));
    const body = rows.length ? rows.map(r => `<tr>
      <td><strong>${r.name}</strong><br><span class="x-muted">${(r.channels || []).join(' · ')}</span></td>
      <td>${r.metric}</td>
      <td>${r.threshold}<br><span class="x-muted">${r.window}</span></td>
      <td><span class="event-chip ${r.severity === '严重' ? 'red' : r.severity === '警告' ? 'orange' : 'green'}">${r.severity}</span></td>
      <td>${(r.depts || []).join('、')}</td>
      <td>${displayDateTime(r.lastFired)}</td>
      <td><button class="x-toggle ${r.enabled ? 'on' : ''}" data-x="alert-toggle" data-id="${r.id}" ${canManage ? '' : 'disabled'}></button></td>
      <td>${canManage ? `<button class="x-mini-btn" data-x="edit-alert-rule" data-id="${r.id}">编辑</button>` : '<span class="x-muted">只读</span>'}</td>
    </tr>`).join('') : `<tr><td colspan="8"><div class="empty-note">暂无告警规则</div></td></tr>`;
    return `<div id="alerts-page-body" class="security-workspace"><section class="security-sheet">
      <div class="security-toolbar"><div class="security-count">告警规则 <strong>${rows.length}</strong><span>启用 ${rows.filter(r => r.enabled).length}</span></div>
        <div class="security-toolbar-actions"><button class="btn" data-x="open-notifications">打开通知中心</button></div></div>
      <div class="x-config-note" style="margin:12px 16px">${icon('i-bell')}<span>延迟、错误率、预算与上游配额阈值触发后进入通知中心；可从通知跳转审计或本页调整规则。</span></div>
      <div class="providers-table"><table><thead><tr><th>规则</th><th>指标</th><th>阈值 / 窗口</th><th>级别</th><th>部门</th><th>最近触发</th><th>启用</th><th></th></tr></thead><tbody>${body}</tbody></table></div>
    </section></div>`;
  }

  function renderAlertsPage() {
    const root = $('#page-content');
    if (!root || currentPage() !== 'alerts') return;
    const mount = $('#x-alerts-panel', root) || root;
    const body = $('#alerts-page-body', mount) || $('#alerts-page-body', root);
    if (body) body.outerHTML = alertsPanelHtml();
    else mount.insertAdjacentHTML('beforeend', alertsPanelHtml());
  }

  const OV_SHARE_COLORS = ['#4f7ff0', '#12a984', '#f0a24d', '#8b6fe8', '#5bb8d6', '#c5ced4'];
  const OV_HOUR_COST_W = Array.from({ length: 24 }, (_, h) => Math.exp(-Math.pow((h - 11.2) / 4.4, 2)) + 0.32 * Math.exp(-Math.pow((h - 16.5) / 3.6, 2)) + 0.1);
  const OV_HOUR_REQ_W = Array.from({ length: 24 }, (_, h) => Math.exp(-Math.pow((h - 10.4) / 3.6, 2)) + 0.42 * Math.exp(-Math.pow((h - 15.2) / 3.2, 2)) + 0.18 * Math.exp(-Math.pow((h - 21) / 2.8, 2)) + 0.08);

  function overviewPeriodOptions() {
    return ['今日', '近 7 天', '近 30 天'];
  }

  function overviewPeriodFromChartRange(range) {
    if (range === '7D') return '近 7 天';
    if (range === '30D') return '近 30 天';
    return '今日';
  }

  function overviewChartRangeFromPeriod(period) {
    if (period === '近 7 天') return '7D';
    if (period === '近 30 天') return '30D';
    return '24H';
  }

  function syncOverviewWithUsageFilters(period = state.overviewPeriod) {
    const next = overviewPeriodOptions().includes(period) ? period : '今日';
    state.overviewPeriod = next;
    state.overviewChartRange = overviewChartRangeFromPeriod(next);
    state.usageFilters.period = next;
    state.usageFilters.grain = 'day';
    ensureCustomRangeDefaults(state.usageFilters);
    syncBillingFiltersFromUsage();
  }

  function overviewRows(period = state.overviewPeriod || '今日') {
    ensureCustomRangeDefaults(state.usageFilters);
    return filteredUsageDetails({
      period,
      grain: 'day',
      key: '', service: '', source: '', keyKind: '', dept: '', orgLevel: '', app: '',
      customStart: state.usageFilters.customStart,
      customEnd: state.usageFilters.customEnd
    });
  }

  function overviewPrevRows(period = state.overviewPeriod || '今日') {
    if (period === '今日') {
      const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(0, 0, 0, 0);
      const ye = new Date(y); ye.setHours(23, 59, 59, 999);
      return scopedUsageDataset().filter(r => {
        const d = r.date || rowDateFromDaysAgo(r.daysAgo);
        return d >= y && d <= ye;
      });
    }
    if (period === '近 7 天') {
      const end = new Date(); end.setDate(end.getDate() - 7); end.setHours(23, 59, 59, 999);
      const start = new Date(end); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
      return scopedUsageDataset().filter(r => {
        const d = r.date || rowDateFromDaysAgo(r.daysAgo);
        return d >= start && d <= end;
      });
    }
    const end = new Date(); end.setDate(end.getDate() - 30); end.setHours(23, 59, 59, 999);
    const start = new Date(end); start.setDate(start.getDate() - 29); start.setHours(0, 0, 0, 0);
    return scopedUsageDataset().filter(r => {
      const d = r.date || rowDateFromDaysAgo(r.daysAgo);
      return d >= start && d <= end;
    });
  }

  function overviewPrevMonthRows() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return scopedUsageDataset().filter(r => {
      const d = r.date || rowDateFromDaysAgo(r.daysAgo);
      return d >= start && d <= end;
    });
  }

  function overviewDeltaPct(curr, prev) {
    if (!prev) return curr ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 1000) / 10;
  }

  function formatInt(n) {
    return Math.round(Number(n) || 0).toLocaleString('en-US');
  }

  function overviewRefreshLabel() {
    const sec = Math.max(0, Math.round((Date.now() - (state.overviewRefreshedAt || Date.now())) / 1000));
    if (sec < 5) return '刚刚刷新';
    if (sec < 60) return `${sec} 秒前`;
    return `${Math.floor(sec / 60)} 分钟前`;
  }

  function overviewProviderLabel(text) {
    const raw = String(text || '').trim();
    if (!raw) return '其他';
    if (/OpenAI|GPT/i.test(raw)) return 'OpenAI';
    if (/Anthropic|Claude/i.test(raw)) return 'Anthropic';
    if (/Google|Gemini/i.test(raw)) return 'Google';
    if (/DeepSeek|深度求索/i.test(raw)) return 'DeepSeek';
    if (/阿里|通义|DashScope|百炼/i.test(raw)) return '阿里云';
    if (/腾讯|Tencent/i.test(raw)) return '腾讯云';
    if (/火山|豆包|Volc/i.test(raw)) return '火山引擎';
    if (/Moonshot|月之暗面|Kimi/i.test(raw)) return 'Moonshot';
    return raw.split(/[\s·/\-_|]/)[0] || '其他';
  }

  function overviewDeptLabel(row) {
    const dept = row.billingDept && row.billingDept !== '—' ? row.billingDept : (row.orgName || '');
    return dept && dept !== '—' ? dept : '未分配';
  }

  function overviewDistribute(total, weights) {
    const sumW = weights.reduce((a, b) => a + b, 0) || 1;
    const raw = weights.map(w => total * (w / sumW));
    const rounded = raw.map(v => Number(v.toFixed(4)));
    const drift = total - rounded.reduce((a, b) => a + b, 0);
    if (rounded.length) rounded[rounded.length - 1] = Number((rounded[rounded.length - 1] + drift).toFixed(4));
    return rounded;
  }

  function overviewSmoothPath(points) {
    if (!points.length) return '';
    if (points.length === 1) return `M${points[0][0]} ${points[0][1]}`;
    const pts = points.map(([x, y]) => [Number(x), Number(y)]);
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  }

  function overviewSparkSvg(points, color = '#10a983') {
    const vals = points.length ? points : [0, 0, 0, 0];
    const max = Math.max(...vals, 1);
    const min = Math.min(...vals, 0);
    const span = Math.max(max - min, 0.01);
    const w = 88; const h = 28;
    const pts = vals.map((v, i) => {
      const x = (i / Math.max(vals.length - 1, 1)) * w;
      const y = h - ((v - min) / span) * (h - 5) - 2.5;
      return [x, y];
    });
    const line = overviewSmoothPath(pts);
    const area = `${line} L${w} ${h} L0 ${h} Z`;
    return `<svg class="ov-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${area}" fill="${color}" fill-opacity=".14"></path>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`;
  }

  function overviewModelShare(rows, colorMap = new Map()) {
    const map = new Map();
    rows.forEach(r => {
      const name = r.sourceName || r.serviceName || '其他';
      map.set(name, (map.get(name) || 0) + (r.cost || 0));
    });
    const items = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const top = items.slice(0, 5);
    const rest = items.slice(5).reduce((s, [, v]) => s + v, 0);
    if (rest > 0) top.push(['其他', rest]);
    const total = top.reduce((s, [, v]) => s + v, 0);
    return {
      total,
      items: top.map(([name, cost], i) => {
        const color = colorMap.get(name) || OV_SHARE_COLORS[i % OV_SHARE_COLORS.length];
        colorMap.set(name, color);
        return {
          name,
          cost,
          pct: total ? Math.round(cost / total * 1000) / 10 : 0,
          color
        };
      })
    };
  }

  function overviewModelRank(rows, colorMap = new Map(), metric = 'cost') {
    const groups = new Map();
    rows.forEach(r => {
      const name = r.sourceName || r.serviceName || '其他';
      const provider = overviewProviderLabel(r.sourceName || r.serviceName);
      const service = r.serviceName || '—';
      const cur = groups.get(name) || { name, provider, service, cost: 0, tokens: 0, inTokens: 0, outTokens: 0, requests: 0 };
      cur.cost += r.cost || 0;
      cur.inTokens += r.inTokensM || 0;
      cur.outTokens += r.outTokensM || 0;
      cur.tokens += (r.inTokensM || 0) + (r.outTokensM || 0);
      cur.requests += Number(r.requests || 0);
      groups.set(name, cur);
    });
    const list = [...groups.values()].sort((a, b) => (metric === 'tokens' ? b.tokens - a.tokens : b.cost - a.cost));
    const totalCost = list.reduce((s, x) => s + x.cost, 0);
    const totalTokens = list.reduce((s, x) => s + x.tokens, 0);
    const maxVal = Math.max(...list.map(x => (metric === 'tokens' ? x.tokens : x.cost)), 0.0001);
    return {
      metric,
      totalCost,
      totalTokens,
      items: list.map((item, i) => {
        const color = colorMap.get(item.name) || OV_SHARE_COLORS[i % OV_SHARE_COLORS.length];
        colorMap.set(item.name, color);
        const value = metric === 'tokens' ? item.tokens : item.cost;
        const total = metric === 'tokens' ? totalTokens : totalCost;
        return {
          ...item,
          rank: i + 1,
          color,
          value,
          pct: total ? Math.round(value / total * 1000) / 10 : 0,
          bar: Math.max(6, Math.round(value / maxVal * 100))
        };
      })
    };
  }

  function overviewDeptStack(rows, colorMap = new Map()) {
    const ranked = [...new Set(rows.map(r => r.sourceName || r.serviceName || '其他'))]
      .map(name => ({
        name,
        cost: rows.filter(r => (r.sourceName || r.serviceName || '其他') === name).reduce((s, r) => s + (r.cost || 0), 0)
      }))
      .sort((a, b) => b.cost - a.cost);
    const modelKeys = ranked.slice(0, 5).map(x => x.name);
    const hasOther = ranked.length > 5;
    if (hasOther && !modelKeys.includes('其他')) modelKeys.push('其他');
    modelKeys.forEach((name, i) => {
      if (!colorMap.has(name)) colorMap.set(name, OV_SHARE_COLORS[i % OV_SHARE_COLORS.length]);
    });
    if (hasOther && !colorMap.has('其他')) colorMap.set('其他', OV_SHARE_COLORS[5]);
    const topSet = new Set(ranked.slice(0, 5).map(x => x.name));
    const deptList = [...new Set(rows.map(overviewDeptLabel))].filter(Boolean);
    const rowsByDept = deptList.map(dept => {
      const deptRows = rows.filter(r => overviewDeptLabel(r) === dept);
      const parts = ranked.slice(0, 5).map(m => ({
        name: m.name,
        cost: deptRows.filter(r => (r.sourceName || r.serviceName || '其他') === m.name)
          .reduce((s, r) => s + (r.cost || 0), 0),
        color: colorMap.get(m.name)
      }));
      if (hasOther) {
        const otherCost = deptRows
          .filter(r => !topSet.has(r.sourceName || r.serviceName || '其他'))
          .reduce((s, r) => s + (r.cost || 0), 0);
        parts.push({ name: '其他', cost: otherCost, color: colorMap.get('其他') });
      }
      const total = deptRows.reduce((s, r) => s + (r.cost || 0), 0);
      return { dept, parts: parts.filter(p => p.cost > 0), total };
    }).filter(d => d.total > 0).sort((a, b) => b.total - a.total);
    return { modelKeys, rowsByDept, total: rowsByDept.reduce((s, d) => s + d.total, 0) };
  }

  function overviewChannelStats(models = state.models || []) {
    const disabled = models.filter(m => m.status === '已停用').length;
    const abnormal = models.filter(m => m.status === '异常' || (m.lastProbe && m.lastProbe.ok === false)).length;
    const enabled = models.filter(m => m.status === '运行中' || m.status === '观察中').length;
    const verified = models.filter(m => m.hasApiKey || (m.lastProbe && m.lastProbe.ok)).length;
    const latencies = models.map(m => parseFloat(m.latency)).filter(n => Number.isFinite(n) && n > 0);
    const p95 = latencies.length
      ? `${(latencies.sort((a, b) => a - b)[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] / 1000).toFixed(1)}s`
      : '—';
    const successRate = models.length
      ? (99 + Math.min(0.9, verified / models.length)).toFixed(2)
      : '—';
    return {
      total: models.length,
      enabled: Math.max(enabled, models.length - disabled - abnormal),
      disabled,
      abnormal,
      verified,
      p95,
      successRate
    };
  }

  function overviewKeyStats(keys = apiKeys()) {
    const healthy = keys.filter(k => keyStatusLabel(k) === '健康').length;
    const paused = keys.filter(k => keyStatusLabel(k) === '已停用').length;
    const expired = keys.filter(k => {
      const s = keyStatusLabel(k);
      return s === '已吊销' || s === '已过期';
    }).length;
    return { total: keys.length, healthy, paused, expired };
  }

  function callLogsInRange(rangeStart, rangeEnd) {
    const start = rangeStart?.getTime?.() ?? NaN;
    const end = rangeEnd?.getTime?.() ?? NaN;
    return (state.callLogs || []).filter(log => {
      const t = parseCallLogTime(log.time);
      if (!Number.isFinite(t)) return false;
      if (Number.isFinite(start) && t < start) return false;
      if (Number.isFinite(end) && t > end) return false;
      return true;
    });
  }

  function overviewHourSeriesFromLogs(period) {
    const range = resolvePeriodRange(period, state.usageFilters.customStart, state.usageFilters.customEnd);
    const hours = Array.from({ length: 24 }, () => ({ cost: 0, request: 0, tokens: 0 }));
    callLogsInRange(range.start, range.end).forEach(log => {
      const t = parseCallLogTime(log.time);
      if (!Number.isFinite(t)) return;
      const h = new Date(t).getHours();
      const ok = Number(log.status || 0) < 400;
      hours[h].request += 1;
      if (!ok) return;
      hours[h].cost += Number(log.cost || 0);
      hours[h].tokens += (Number(log.promptTokens || 0) + Number(log.completionTokens || 0)) / 1e6;
    });
    return hours;
  }

  function overviewTrendSeries(period, rows, prevRows, monthBudget, alertPct) {
    const chartRange = overviewChartRangeFromPeriod(period);
    if (chartRange === '24H') {
      const hours = overviewHourSeriesFromLogs(period);
      const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(0, 0, 0, 0);
      const ye = new Date(y); ye.setHours(23, 59, 59, 999);
      const prevHours = Array.from({ length: 24 }, () => ({ cost: 0 }));
      callLogsInRange(y, ye).forEach(log => {
        const t = parseCallLogTime(log.time);
        if (!Number.isFinite(t) || Number(log.status || 0) >= 400) return;
        prevHours[new Date(t).getHours()].cost += Number(log.cost || 0);
      });
      const cost = hours.map(h => Number(h.cost.toFixed(4)));
      const request = hours.map(h => h.request);
      const prevCost = prevHours.map(h => Number(h.cost.toFixed(4)));
      const peakIdx = request.reduce((best, v, i) => (v > request[best] ? i : best), 0);
      return {
        chartRange,
        categories: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`),
        cost,
        request,
        prevCost,
        threshold: Number((monthBudget * (alertPct / 100) / 30).toFixed(2)),
        thresholdLabel: `预算警戒 ${alertPct}%`,
        peakHour: peakIdx,
        sparkCost: cost,
        sparkReq: request,
        sparkTok: hours.map(h => h.tokens)
      };
    }

    const filters = {
      period,
      grain: 'day',
      customStart: state.usageFilters.customStart,
      customEnd: state.usageFilters.customEnd
    };
    const buckets = buildChartSeries(rows, filters, 'cost');
    const prevBuckets = buildChartSeries(prevRows, filters, 'cost');
    const cost = buckets.map(b => Number((b.cost || 0).toFixed(4)));
    const request = buckets.map(b => Math.round(b.requests || 0));
    const prevCost = prevBuckets.length === buckets.length
      ? prevBuckets.map(b => Number((b.cost || 0).toFixed(4)))
      : cost.map(() => 0);
    const peakIdx = request.reduce((best, v, i) => (v > request[best] ? i : best), 0);
    return {
      chartRange,
      categories: buckets.map(b => b.label),
      cost,
      request,
      prevCost,
      threshold: Number((monthBudget * (alertPct / 100) / (chartRange === '7D' ? 7 : 30)).toFixed(2)),
      thresholdLabel: `预算警戒 ${alertPct}%`,
      peakHour: peakIdx,
      sparkCost: cost,
      sparkReq: request,
      sparkTok: buckets.map(b => b.tokens || 0)
    };
  }

  function overviewHeatmapData(rows, models) {
    const range = resolvePeriodRange(state.overviewPeriod || '今日', state.usageFilters.customStart, state.usageFilters.customEnd);
    const providerHour = new Map();
    const providerTotals = new Map();
    callLogsInRange(range.start, range.end).forEach(log => {
      if (Number(log.status || 0) >= 400) return;
      const t = parseCallLogTime(log.time);
      if (!Number.isFinite(t)) return;
      const name = overviewProviderLabel(log.provider || log.sourceModel || log.model);
      const tokens = (Number(log.promptTokens || 0) + Number(log.completionTokens || 0)) / 1e6;
      const h = new Date(t).getHours();
      if (!providerHour.has(name)) providerHour.set(name, Array.from({ length: 24 }, () => 0));
      providerHour.get(name)[h] += tokens;
      providerTotals.set(name, (providerTotals.get(name) || 0) + tokens);
    });
    (models || []).forEach(m => {
      const name = overviewProviderLabel(m.provider || m.name);
      if (!providerTotals.has(name)) providerTotals.set(name, 0);
      if (!providerHour.has(name)) providerHour.set(name, Array.from({ length: 24 }, () => 0));
    });
    rows.forEach(r => {
      const name = overviewProviderLabel(r.sourceName || r.serviceName);
      if (!providerTotals.has(name)) providerTotals.set(name, (r.inTokensM || 0) + (r.outTokensM || 0));
    });
    const labels = [...providerTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
      .slice(0, 5);
    if (!labels.length) return { rows: [], peakStart: 10, peakEnd: 12, tokenTotal: 0 };
    const tokenTotal = labels.reduce((s, name) => s + (providerTotals.get(name) || 0), 0);
    const heatRows = labels.map(name => {
      const hours = providerHour.get(name) || Array.from({ length: 24 }, () => 0);
      const total = providerTotals.get(name) || 0;
      const maxH = Math.max(...hours, 0.0001);
      return {
        name,
        total,
        cells: hours.map(v => Math.min(1, v / maxH))
      };
    });
    const hourTotals = Array.from({ length: 24 }, (_, h) => heatRows.reduce((s, row) => s + row.cells[h] * row.total, 0));
    const peakIdx = hourTotals.reduce((best, v, i) => (v > hourTotals[best] ? i : best), 0);
    return {
      rows: heatRows,
      peakStart: peakIdx,
      peakEnd: Math.min(23, peakIdx + 2),
      tokenTotal
    };
  }

  function buildOverviewSnapshot() {
    if (!overviewPeriodOptions().includes(state.overviewPeriod)) state.overviewPeriod = '今日';
    // 强制图表窗口与时间筛选一致，保证全页同一口径
    state.overviewChartRange = overviewChartRangeFromPeriod(state.overviewPeriod);
    const period = state.overviewPeriod;
    const rows = overviewRows(period);
    const prevRows = overviewPrevRows(period);
    const monthRows = overviewRows('本月');
    const prevMonthRows = overviewPrevMonthRows();
    const summary = usageSummary(rows);
    const prevSummary = usageSummary(prevRows);
    const monthSummary = usageSummary(monthRows);
    const prevMonthSummary = usageSummary(prevMonthRows);
    const memberBudget = (state.members || [])
      .filter(m => m.budgetType === '按月' && m.monthBudget)
      .reduce((s, m) => s + Number(m.monthBudget || 0), 0);
    const monthBudget = Math.max(memberBudget || 0, monthSummary.cost / 0.72, monthSummary.cost + 1, 1);
    const alertPct = state.budgetAlertThreshold || 80;
    const colorMap = new Map();
    const share = overviewModelShare(rows, colorMap);
    const rank = overviewModelRank(rows, colorMap, state.overviewRankMetric === 'tokens' ? 'tokens' : 'cost');
    const dept = overviewDeptStack(rows, colorMap);
    const channels = overviewChannelStats(state.models || []);
    const keys = overviewKeyStats(apiKeys());
    const trend = overviewTrendSeries(period, rows, prevRows, monthBudget, alertPct);
    const monthSparkCost = buildChartSeries(monthRows, {
      period: '本月',
      grain: 'day',
      customStart: state.usageFilters.customStart,
      customEnd: state.usageFilters.customEnd
    }, 'cost').map(b => b.cost || 0);
    const heat = overviewHeatmapData(rows, state.models || []);
    // 分布 / 部门合计必须等于周期费用（允许浮点误差）
    const shareAligned = Math.abs(share.total - summary.cost) < 0.05;
    const deptAligned = Math.abs(dept.total - summary.cost) < 0.05 || !dept.rowsByDept.length;
    return {
      period,
      chartRange: trend.chartRange,
      rows,
      prevRows,
      summary,
      prevSummary,
      monthSummary,
      prevMonthSummary,
      monthBudget,
      alertPct,
      budgetPct: Math.min(100, Math.round(monthSummary.cost / monthBudget * 100)),
      share,
      rank,
      dept,
      channels,
      keys,
      trend,
      heat,
      monthSparkCost,
      aligned: { share: shareAligned, dept: deptAligned },
      deltas: {
        monthCost: overviewDeltaPct(monthSummary.cost, prevMonthSummary.cost),
        requests: overviewDeltaPct(summary.requests, prevSummary.requests),
        tokens: overviewDeltaPct(summary.tokenTotal, prevSummary.tokenTotal)
      }
    };
  }

  function destroyOverviewTrendChart() {
    if (window.__ovTrendChart) {
      window.__ovTrendChart.destroy();
      window.__ovTrendChart = null;
    }
  }

  function mountOverviewTrendChart(snap) {
    const el = $('#ov-trend-chart');
    if (!el) return;
    const props = {
      categories: snap.trend.categories,
      cost: snap.trend.cost,
      request: snap.trend.request,
      prevCost: snap.trend.prevCost,
      threshold: snap.trend.threshold,
      thresholdLabel: snap.trend.thresholdLabel
    };
    if (window.__ovTrendChart) {
      window.__ovTrendChart.update(props);
      return;
    }
    if (!window.OverviewTrendChart) {
      el.innerHTML = '<div class="ov-chart-fallback">趋势图组件未加载</div>';
      return;
    }
    window.__ovTrendChart = window.OverviewTrendChart.mount(el, props);
  }

  function overviewModelRankHtml(rank, period) {
    const metric = rank.metric === 'tokens' ? 'tokens' : 'cost';
    if (!rank.items.length) {
      return `<div class="empty-note" style="padding:18px 0">当前周期暂无模型消耗。接入源并产生调用后展示排名。</div>`;
    }
    return `<div class="ov-rank">
      <div class="ov-rank-tabs">
        <button type="button" class="${metric === 'cost' ? 'active' : ''}" data-x="ov-rank-metric" data-metric="cost">按费用</button>
        <button type="button" class="${metric === 'tokens' ? 'active' : ''}" data-x="ov-rank-metric" data-metric="tokens">按 Token</button>
      </div>
      <div class="ov-rank-head">
        <span>#</span><span>源模型</span><span>${metric === 'cost' ? '费用' : 'Token'}</span><span>占比</span>
      </div>
      <div class="ov-rank-list">
        ${rank.items.slice(0, 8).map(item => `
          <div class="ov-rank-row" title="${item.name}">
            <b class="ov-rank-no ${item.rank <= 3 ? 'top' : ''}">${item.rank}</b>
            <div class="ov-rank-main">
              <strong><i style="background:${item.color}"></i>${item.name}</strong>
              <span>${item.provider} · ${item.service} · 请求 ${formatInt(item.requests)}</span>
              <div class="ov-rank-track"><span style="width:${item.bar}%;background:${item.color}"></span></div>
            </div>
            <div class="ov-rank-val">
              <strong>${metric === 'cost' ? formatMoney(item.cost) : formatTokensM(item.tokens)}</strong>
              <em>${item.pct}%</em>
            </div>
          </div>`).join('')}
      </div>
      <div class="ov-rank-foot x-muted">${period} · 合计费用 ${formatMoney(rank.totalCost)} · Token ${formatTokensM(rank.totalTokens)} · 与分布图同源</div>
    </div>`;
  }

  function overviewDonutHtml(share) {
    if (!share.items.length || !share.total) {
      return `<div class="ov-donut-wrap"><div class="ov-donut" style="background:conic-gradient(#e8eef1 0 100%)"><div class="ov-donut-core"><span>当前合计</span><strong>¥0</strong></div></div><div class="ov-donut-legend"><div class="empty-note" style="padding:8px 0">当前周期暂无费用明细</div></div></div>`;
    }
    let acc = 0;
    const stops = share.items.map(it => {
      const start = acc;
      acc += it.pct;
      return `${it.color} ${start}% ${acc}%`;
    }).join(', ');
    return `<div class="ov-donut-wrap">
      <div class="ov-donut" style="background:conic-gradient(${stops})"><div class="ov-donut-core"><span>当前合计</span><strong>${formatMoney(share.total)}</strong></div></div>
      <div class="ov-donut-legend">${share.items.map(it => `
        <div><i style="background:${it.color}"></i><span>${it.name}</span><b>${it.pct}% · ${formatMoney(it.cost)}</b></div>`).join('')}</div>
    </div>`;
  }

  function overviewDeptBarsHtml(dept) {
    if (!dept.rowsByDept.length) {
      return `<div class="empty-note" style="padding:18px 0">当前周期暂无部门费用归因。请确认已签发 Key 并产生调用。</div>`;
    }
    const max = Math.max(...dept.rowsByDept.map(d => d.total), 1);
    return `<div class="ov-stack-bars">
      <div class="ov-stack-legend">${dept.modelKeys.map(m => {
        const color = dept.rowsByDept[0]?.parts.find(p => p.name === m)?.color || '#4f7ff0';
        const hit = dept.rowsByDept.flatMap(d => d.parts).find(p => p.name === m);
        return `<span><i style="background:${hit?.color || color}"></i>${m}</span>`;
      }).join('')}</div>
      <div class="ov-stack-sum x-muted">部门合计 ${formatMoney(dept.total)} · 与周期费用一致</div>
      ${dept.rowsByDept.map(d => `
        <div class="ov-stack-row">
          <label title="${d.dept}">${d.dept}</label>
          <div class="ov-stack-track">${d.parts.filter(p => p.cost > 0).map(p => {
            const w = Math.max(p.cost / max * 100, 2);
            return `<span style="width:${w}%;background:${p.color}" title="${p.name}: ${formatMoney(p.cost)}"></span>`;
          }).join('')}</div>
          <b>${d.total >= 1000 ? `¥${(d.total / 1000).toFixed(1)}K` : formatMoney(d.total)}</b>
        </div>`).join('')}
    </div>`;
  }

  function overviewHeatmapHtml(heat) {
    if (!heat.rows.length) {
      return `<div class="empty-note" style="padding:18px 0">暂无渠道调用密度。接入源模型并产生用量后展示。</div>`;
    }
    return `<div class="ov-heat">
      <div class="ov-heat-badge">高峰：${String(heat.peakStart).padStart(2, '0')}:00–${String(heat.peakEnd).padStart(2, '0')}:00</div>
      <div class="ov-heat-grid">
        <div class="ov-heat-corner"></div>
        ${Array.from({ length: 12 }, (_, i) => `<div class="ov-heat-xh">${String(i * 2).padStart(2, '0')}</div>`).join('')}
        <div class="ov-heat-corner"></div>
        ${heat.rows.map(row => `
          <div class="ov-heat-label" title="${row.name}">${row.name}</div>
          ${row.cells.map((v, h) => `<div class="ov-heat-cell" style="--v:${v.toFixed(2)}" title="${row.name} ${String(h).padStart(2, '0')}:00"></div>`).join('')}
          <div class="ov-heat-total">${formatTokensM(row.total)}</div>
        `).join('')}
      </div>
      <div class="ov-heat-foot x-muted">渠道 Token 合计 ${formatTokensM(heat.tokenTotal)} · 与周期用量同源</div>
    </div>`;
  }

  function overviewPanelHtml(snap = buildOverviewSnapshot()) {
    const {
      period, chartRange, summary, monthSummary, monthBudget, alertPct, budgetPct,
      share, rank, dept, channels, keys, trend, heat, deltas, monthSparkCost
    } = snap;
    const peakLabel = chartRange === '24H'
      ? `${String(trend.peakHour).padStart(2, '0')}:00`
      : (trend.categories[trend.peakHour] || '—');
    const reqLabel = period === '今日' ? '今日请求数' : `${period}请求数`;
    const tokLabel = period === '今日' ? '今日 Token' : `${period} Token`;
    const deltaCls = v => (v >= 0 ? 'up' : 'down');
    const deltaTxt = (v, suffix = '') => `<em class="ov-delta ${deltaCls(v)}">${v >= 0 ? '↑' : '↓'} ${Math.abs(v)}%${suffix}</em>`;

    return `<div id="overview-page-body" class="ov-ops" data-ov-period="${period}" data-ov-cost="${summary.cost}" data-ov-tokens="${summary.tokenTotal}">
      <div class="ov-toolbar card">
        <div class="ov-period-tabs">
          ${overviewPeriodOptions().map(p => `<button type="button" class="${p === period ? 'active' : ''}" data-x="ov-period" data-period="${p}">${p}</button>`).join('')}
          <button type="button" data-x="ov-period-custom">自定义</button>
        </div>
        <div class="ov-toolbar-meta">
          <span>数据延迟 ≤ 1 分钟 · 上次刷新 ${overviewRefreshLabel()} · 与「用量与费用」同口径</span>
          <label class="ov-switch"><input type="checkbox" data-x="ov-auto-refresh" ${state.overviewAutoRefresh ? 'checked' : ''}> 自动刷新</label>
          <button class="btn" data-x="ov-refresh">刷新</button>
          <button class="btn" data-x="ov-export">导出</button>
        </div>
      </div>

      <section class="ov-kpi-grid">
        <article class="card ov-kpi">
          <div class="ov-kpi-top"><span>本月总消耗</span>${overviewSparkSvg(monthSparkCost, '#4f7ff0')}</div>
          <strong>${formatMoney(monthSummary.cost)}</strong>
          ${deltaTxt(deltas.monthCost, ' vs 上月')}
          <div class="ov-budget"><div class="ov-budget-track"><span style="width:${budgetPct}%"></span></div><small>预算消耗 ${budgetPct}% / ¥${Math.round(monthBudget).toLocaleString('en-US')} · 阈值 ${alertPct}%</small></div>
        </article>
        <article class="card ov-kpi">
          <div class="ov-kpi-top"><span>${reqLabel}</span>${overviewSparkSvg(trend.sparkReq, '#12a984')}</div>
          <strong>${formatInt(summary.requests)}</strong>
          ${deltaTxt(deltas.requests)}
          <small>峰值 ${peakLabel} · P95 ${channels.p95} · 成功率 ${channels.successRate}${channels.successRate === '—' ? '' : '%'}</small>
        </article>
        <article class="card ov-kpi">
          <div class="ov-kpi-top"><span>${tokLabel}</span>${overviewSparkSvg(trend.sparkTok, '#8b6fe8')}</div>
          <strong>${formatTokensM(summary.tokenTotal)}</strong>
          ${deltaTxt(deltas.tokens)}
          <small>输入 ${formatTokensM(summary.inTotal)} · 输出 ${formatTokensM(summary.outTotal)}</small>
        </article>
        <article class="card ov-kpi">
          <div class="ov-kpi-top"><span>渠道数量</span><button class="ov-link" data-page-jump="model-sources">管理</button></div>
          <strong>${channels.total}</strong>
          <div class="ov-status-row">
            <span class="ok">启用 ${channels.enabled}</span>
            <span class="mute">停用 ${channels.disabled}</span>
            <span class="bad">异常 ${channels.abnormal}</span>
          </div>
        </article>
        <article class="card ov-kpi">
          <div class="ov-kpi-top"><span>令牌数量</span><button class="ov-link" data-page-jump="security-api">治理</button></div>
          <strong>${keys.total}</strong>
          <div class="ov-status-row">
            <span class="ok">有效 ${keys.healthy}</span>
            <span class="mute">停用 ${keys.paused}</span>
            <span class="warn">过期 ${keys.expired}</span>
          </div>
        </article>
      </section>

      <section class="ov-mid-grid">
        <article class="card ov-trend-card">
          <div class="card-head">
            <div><h2>成本与调用趋势</h2><p>${period} · 序列合计对齐 KPI（费用 ${formatMoney(summary.cost)} / 请求 ${formatInt(summary.requests)}）</p></div>
            <div class="tabs">
              ${['24H','7D','30D'].map(r => `<button type="button" class="${chartRange === r ? 'active' : ''}" data-x="ov-chart-range" data-range="${r}">${r}</button>`).join('')}
            </div>
          </div>
          <div class="chart-wrap">
            <div class="chart-labels ov-trend-legend">
              <span><b style="background:#4f7ff0"></b>成本</span>
              <span><b style="background:#12a984"></b>请求量</span>
              <span><b class="ov-leg-dash" style="background:#b7c3cc"></b>对比周期成本</span>
              <span><b class="ov-leg-dash" style="background:#e7a05a"></b>预算阈值</span>
              <span class="ov-axis-hint">左轴费用 · 右轴请求</span>
            </div>
            <div id="ov-trend-chart" class="ov-trend-chart" data-ov-chart="trend" role="img" aria-label="成本与调用趋势"></div>
          </div>
        </article>
        <article class="card ov-donut-card">
          <div class="card-head">
            <div><h2>模型成本分布</h2><p>按源模型聚合 · 合计 ${formatMoney(share.total)}</p></div>
            <button class="btn" data-page-jump="usage">费用归因</button>
          </div>
          ${overviewDonutHtml(share)}
        </article>
      </section>

      <section class="ov-rank-grid">
        <article class="card">
          <div class="card-head">
            <div><h2>模型消耗排名</h2><p>按源模型汇总 · Top ${Math.min(8, rank.items.length || 0)} · 与成本分布同一数据集</p></div>
            <button class="btn" data-page-jump="usage">用量明细</button>
          </div>
          <div class="ov-card-body">${overviewModelRankHtml(rank, period)}</div>
        </article>
      </section>

      <section class="ov-bottom-grid">
        <article class="card">
          <div class="card-head">
            <div><h2>配额消耗结构</h2><p>部门 × 源模型 · 与分布图 / 排名共用配色</p></div>
            <button class="btn" data-page-jump="usage">查看明细</button>
          </div>
          <div class="ov-card-body">${overviewDeptBarsHtml(dept)}</div>
        </article>
        <article class="card">
          <div class="card-head">
            <div><h2>24 小时调用热力</h2><p>渠道聚合自周期用量 · 高峰 ${String(heat.peakStart).padStart(2,'0')}:00</p></div>
            <span class="event-chip green">同源密度</span>
          </div>
          <div class="ov-card-body">${overviewHeatmapHtml(heat)}</div>
        </article>
      </section>
    </div>`;
  }

  function renderOverviewPage() {
    const panel = $('#x-overview-panel');
    if (!panel) return;
    destroyOverviewTrendChart();
    syncOverviewWithUsageFilters(state.overviewPeriod);
    const snap = buildOverviewSnapshot();
    panel.innerHTML = overviewPanelHtml(snap);
    const pill = $('#ov-gateway-pill');
    if (pill) pill.innerHTML = `<i></i> ${state.gatewayOnline ? '网关在线' : '网关离线'}`;
    requestAnimationFrame(() => mountOverviewTrendChart(snap));
    syncModelNavBadge();
    setupOverviewAutoRefresh();
  }

  function setupOverviewAutoRefresh() {
    if (window.__ovRefreshTimer) {
      clearInterval(window.__ovRefreshTimer);
      window.__ovRefreshTimer = null;
    }
    if (!state.overviewAutoRefresh) return;
    window.__ovRefreshTimer = setInterval(() => {
      if (currentPage() !== 'overview') return;
      const meta = $('.ov-toolbar-meta span');
      if (meta) meta.textContent = `数据延迟 ≤ 1 分钟 · 上次刷新 ${overviewRefreshLabel()}`;
      if (Date.now() - (state.overviewRefreshedAt || 0) > 60000) {
        state.overviewRefreshedAt = Date.now();
        renderOverviewPage();
      }
    }, 10000);
  }

  function clearDetailViewState() {
    state.currentDetailKind = null;
    state.currentDetailId = null;
  }

  function enhanceView() {
    const root = $('#page-content');
    if (!root) return;
    // 详情页由 openDetail 托管；禁止列表 enhance / MutationObserver 冲掉详情
    if (String(root.dataset.enhanced || '').startsWith('detail-')) return;
    const page = currentPage();
    const cfg = window.getActiveRoleConfig?.() || {};
    const profile = cfg.viewProfile || '';
    if (root.dataset.enhanced === page) return;
    root.dataset.enhanced = page;
    $$('.head-actions .btn, .card-head .btn', root).forEach(btn => btn.classList.add('x-upgraded'));
    if (page === 'model-services') renderServicesPage();
    else if (page === 'model-sources') renderSourcesPage();
    else if (page === 'members') renderMembersPage();
    else if (page === 'security-policies') renderPoliciesPage();
    else if (page === 'alerts') renderAlertsPage();
    else if (page === 'overview') {
      renderOverviewPage();
    }
    if (page === 'routes' && profile !== 'developer') {
      root.insertAdjacentHTML('beforeend', routeRows());
    }
    if (page === 'access' && (cfg.canManageAccess || cfg.x?.includes('*') || profile === 'admin')) renderAccessPage();
    else if (page === 'access' && profile === 'auditor') { /* 只读快照由 roleViews 提供 */ }
    if (isSecurityPage(page) && profile !== 'developer') renderSecurityPage();
    if (page === 'security-api' && profile === 'developer') {
      const mount = $('#x-security-api-panel', root) || root;
      const body = $('#security-page-body', mount) || $('#security-page-body', root);
      if (body) body.outerHTML = developerSecurityHtml();
      else mount.insertAdjacentHTML('beforeend', developerSecurityHtml());
    }
    if (page === 'overview' && profile === 'developer') {
      $$('[data-action="申请 API Key"]', root).forEach(btn => {
        btn.setAttribute('data-x', 'apply-api-key');
        btn.removeAttribute('data-action');
      });
    }
    if (isAuditPage(page)) renderAuditPage();
    if (page === 'usage' || page === 'usage-detail' || page === 'billing') {
      renderUsagePage();
    }
    if (page === 'integration') renderIntegrationPage();
  }

  function openDetail(kind, id) {
    if (kind === 'key') {
      const key = state.keys.find(k => k.id === id);
      if (!key || key.type !== 'api') {
        toast('当前版本仅支持虚拟 Key 详情');
        if (window.render) window.render('security-api');
        setTimeout(enhanceView, 0);
        return;
      }
      kind = 'apikey';
    }
    if (kind === 'kmskey') {
      toast('当前版本暂不开放密钥托管能力');
      if (window.render) window.render('security-api');
      setTimeout(enhanceView, 0);
      return;
    }
    const enhanced = String($('#page-content')?.dataset.enhanced || '');
    if (!enhanced.startsWith('detail-')) {
      const page = currentPage();
      // 详情关闭后回到进入前的功能页，避免误跳总览
      state.returnPage = page && page !== 'overview'
        ? page
        : (kind === 'apikey' ? 'security-api' : kind === 'model' ? 'model-sources' : kind === 'service' ? 'model-services' : page || 'overview');
    }
    if (kind === 'apikey') {
      state.securityTab = 'api';
      state.selectedKeyId = id;
      state.securityDetailTab = state.securityDetailTab || 'overview';
      if (!state.returnPage || state.returnPage === 'overview') state.returnPage = 'security-api';
    }
    if (kind === 'service') {
      state.currentDetailId = id;
      state.serviceDetailTab = state.serviceDetailTab || 'routing';
      if (!state.returnPage || state.returnPage === 'overview') state.returnPage = 'model-services';
    }
    state.currentDetailKind = kind;
    const root = $('#page-content');
    const map = {model:modelDetail, route:routeDetail, role:roleDetail, apikey:apiKeyDetail, kmskey:kmsKeyDetail, service:serviceDetail};
    root.innerHTML = (map[kind] || modelDetail)(id);
    root.dataset.enhanced = `detail-${kind}`;
    const crumbMap = {model:'模型详情', route:'路由详情', role:'角色详情', apikey:'API Key 详情', kmskey:'KMS 密钥详情', service:'服务详情'};
    $('#page-crumb').textContent = crumbMap[kind] || '详情';
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function detailHead(logo, title, sub, status = '运行正常', moreLabel = '更多') {
    return `<button class="btn" data-x="back" style="margin-bottom:13px">← 返回列表</button><div class="x-detail-head"><div class="x-detail-identity"><div class="x-detail-logo">${logo}</div><div><h1>${title}</h1><p>${sub}</p></div></div><div class="head-actions"><span class="status-pill"><i></i>${status}</span><button class="btn" data-x="more">${moreLabel}</button><button class="btn primary" data-x="edit-current">编辑配置</button></div></div>`;
  }

  function serviceRoutingTopologyHtml(snap) {
    const { service, channels, candidateCount, strategy } = snap;
    if (!channels.length) {
      return `<div class="empty-note" style="padding:28px">尚未绑定源模型。请先接入源并配置分发策略。</div>`;
    }
    const visible = filterServiceChannels(channels, service);
    if (!visible.length) {
      return `<div class="empty-note" style="padding:28px">当前「更多」筛选下没有匹配通道。可打开右上角「更多」调整通道健康 / 角色 / 提供商。</div>`;
    }
    const nodes = visible.map((ch) => {
      const edgeClass = !ch.enabled || !ch.healthy ? 'is-muted' : (ch.isBackup ? 'is-backup' : 'is-primary');
      const badge = !ch.enabled || !ch.healthy
        ? `<em class="rt-edge-badge mute">摘除</em>`
        : ch.isBackup
          ? `<em class="rt-edge-badge backup">备用</em>`
          : `<em class="rt-edge-badge">${ch.weight}%</em>`;
      return `<div class="rt-branch ${edgeClass}">
        <div class="rt-edge">${badge}</div>
        <div class="rt-node">
          <div class="rt-node-main">
            <strong><i style="background:${ch.color}"></i>${ch.provider}</strong>
            <span>${ch.source} · ${ch.region}</span>
            <div class="rt-node-meta">
              <span class="rt-health ${ch.healthy ? 'ok' : 'bad'}"></span>
              ${ch.healthy ? '健康' : '异常'} · ${ch.latency} ms · ${ch.keysLabel} · ${ch.pick}
            </div>
          </div>
          <div class="rt-node-side">
            <b>${!ch.enabled || !ch.healthy ? 'Removed' : ch.isBackup ? 'Backup' : `weight ${ch.weight}`}</b>
            <span>P=${ch.priority}</span>
          </div>
        </div>
      </div>`;
    }).join('');
    return `<div class="rt-topo">
      <div class="rt-root">
        <strong>对外服务名 · ${service.name}</strong>
        <span>${service.serviceId} · ${candidateCount} 个候选通道 · ${serviceStrategyLabel(strategy)}</span>
      </div>
      <div class="rt-spine" aria-hidden="true"></div>
      <div class="rt-branches">${nodes}</div>
      <div class="rt-legend">
        <span><i class="solid"></i>实线：主优先级，按权重分流</span>
        <span><i class="dash"></i>虚线：备用优先级，主层失败后启用</span>
        <span><i class="mute"></i>灰色：自动摘除，不参与调度</span>
      </div>
    </div>`;
  }

  function serviceRoutingTimelineHtml(snap) {
    const { bars, retries, totalRequests, channels, timelineMode, tokenTotals } = snap;
    const visibleChannels = filterServiceChannels(channels, snap.service);
    const visibleIds = new Set(visibleChannels.map(c => c.id));
    const visibleBars = visibleIds.size
      ? bars.filter(b => !b.channelId || visibleIds.has(b.channelId))
      : bars;
    const legend = [...new Map(visibleChannels.map(c => [c.id, c])).values()].slice(0, 4);
    const axisLeft = timelineMode === '60s' ? '60s 前' : (timelineMode === 'recent' ? '更早' : '—');
    const note = !totalRequests
      ? '暂无真实调用；使用代理 API Key 请求后，此处按实际上游命中刷新'
      : `${timelineMode === '60s' ? '近 60 秒' : '最近'} ${totalRequests} 次请求 · 重试/转移 ${retries} 次 · 上行 ${tokenTotals?.prompt || 0} / 下行 ${tokenTotals?.completion || 0} / 缓存 ${tokenTotals?.cached || 0} · ¥${Number(tokenTotals?.cost || 0).toFixed(4)}`;
    const shownBars = visibleBars.length ? visibleBars : bars;
    return `<div class="rt-timeline">
      <div class="rt-bars" role="img" aria-label="调度时序">
        ${shownBars.length
          ? shownBars.map(b => `<span class="rt-bar ${b.retried ? 'retried' : ''}" style="background:${b.color}" title="${b.provider}${b.tokens ? ` · ${b.tokens}` : ''}${b.retried ? ' · 重试/转移' : ''}"></span>`).join('')
          : '<div class="empty-note" style="margin:8px 0">等待真实流量</div>'}
      </div>
      <div class="rt-timeline-axis"><span>${axisLeft}</span><span>当前</span></div>
      <div class="rt-timeline-legend">${legend.map(c => `<span><i style="background:${c.color}"></i>${c.provider}${c.isBackup ? '（备）' : ''}</span>`).join('') || '<span class="x-muted">当前筛选下无图例</span>'}</div>
      <div class="rt-timeline-note">${note}</div>
    </div>`;
  }

  function serviceRoutingEventsHtml(snap) {
    const visible = filterServiceChannels(snap.channels, snap.service);
    const visibleProviders = new Set(visible.map(c => c.provider));
    const events = (snap.events || []).filter(ev => {
      if (!visible.length) return true;
      if (ev.type === 'idle') return true;
      // 通道文案通常含提供商名；无匹配时保留以免整表空白
      return !ev.channel || ev.channel === '—' || [...visibleProviders].some(p => String(ev.channel).includes(p));
    });
    const rows = events.length ? events : [{ time: '—', type: 'idle', label: '无匹配记录', channel: '—', impact: '调整「更多」中的通道筛选' }];
    return `<div class="providers-table rt-events"><table>
      <thead><tr><th>时间</th><th>事件</th><th>通道</th><th>Token / 费用</th></tr></thead>
      <tbody>${rows.map(ev => `
        <tr>
          <td>${ev.time}</td>
          <td><span class="event-chip ${ev.type === 'auto-off' ? 'red' : ev.type === 'hit' ? 'green' : ev.type === 'failover' ? 'orange' : ''}">${ev.label}</span></td>
          <td>${ev.channel}${ev.keyName && ev.keyName !== '—' ? `<br><span class="x-muted">${ev.keyName}</span>` : ''}</td>
          <td>${ev.impact}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  }

  function serviceDetailPanel(tab = 'routing') {
    const service = state.services.find(s => s.id === state.currentDetailId) || state.services[0];
    if (!service) return '<div class="empty-note">未找到模型服务</div>';
    const snap = buildServiceRoutingSnapshot(service);
    if (tab === 'sources') {
      const allModels = boundModelsForService(service);
      const models = filterBoundModelsForService(service, allModels);
      return `<article class="card"><div class="card-head"><div><h2>已绑定源模型</h2><p>${allModels.length} 个源 · 当前筛选显示 ${models.length} 个 · 与智能路由候选通道一致</p></div>
        <button class="btn" data-x="bind-source" data-service="${service.id}">接入源</button></div>
        ${models.length ? `<div class="providers-table"><table><thead><tr><th>源模型</th><th>提供商</th><th>延迟</th><th>状态</th></tr></thead>
          <tbody>${models.map(m => `<tr class="x-clickable" data-x-detail="model:${m.id}"><td><strong>${m.sourceModel || m.name}</strong></td><td>${m.provider}</td><td>${m.latency || '—'}</td><td><span class="event-chip ${m.status === '运行中' ? 'green' : 'orange'}">${m.status || '—'}</span></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-note">${allModels.length ? '当前筛选下没有匹配源，请打开右上角「更多」调整' : '暂无绑定源'}</div>`}
      </article>`;
    }
    if (tab === 'strategy') {
      return `<article class="card"><div class="card-head"><div><h2>分发策略</h2><p>当前 ${serviceStrategyLabel(service.strategy)} · 可在此调整并立即生效</p></div>
        <button class="btn primary" data-x="configure-distribution" data-id="${service.id}" data-model="${service.serviceId}">打开策略配置</button></div>
        <div class="x-kv-grid" style="grid-template-columns:repeat(2,1fr)">
          <div class="x-kv"><span>策略模式</span><strong>${serviceStrategyLabel(service.strategy)}</strong></div>
          <div class="x-kv"><span>候选通道</span><strong>${snap.candidateCount}</strong></div>
          <div class="x-kv"><span>主通道</span><strong>${snap.primaryCount}</strong></div>
          <div class="x-kv"><span>备用通道</span><strong>${snap.backupCount}</strong></div>
          <div class="x-kv"><span>当前命中</span><strong>${snap.currentHit ? `${snap.currentHit.provider} · ${snap.currentHit.source}` : '—'}</strong></div>
          <div class="x-kv"><span>关联 API Key</span><strong>${snap.keyCount}</strong></div>
        </div>
      </article>`;
    }
    // routing (default)
    return `<article class="card rt-card">
        <div class="card-head"><div><h2>智能路由拓扑</h2><p>对外服务名稳定，底层按权重 / 备用优先级调度</p></div>
          <button class="btn" data-x="configure-distribution" data-id="${service.id}" data-model="${service.serviceId}">配置策略</button>
        </div>
        <div class="ov-card-body">${serviceRoutingTopologyHtml(snap)}</div>
      </article>
      <section class="rt-bottom-grid">
        <article class="card">
          <div class="card-head"><div><h2>调度时序</h2><p>每根柱 = 1 次真实请求 · 颜色对应命中源</p></div>
            <button class="btn" data-x="refresh-service-routing">刷新</button></div>
          <div class="ov-card-body">${serviceRoutingTimelineHtml(snap)}</div>
        </article>
        <article class="card">
          <div class="card-head"><div><h2>调度记录</h2><p>随 API Key 调用更新 · 上下行 / 缓存 Token 与源侧一致</p></div></div>
          <div class="ov-card-body">${serviceRoutingEventsHtml(snap)}</div>
        </article>
      </section>`;
  }

  function serviceDetail(id) {
    const service = state.services.find(s => s.id === id) || state.services[0];
    if (!service) return `${detailHead('SV', '未知服务', '—', '不可用')}<div class="empty-note">未找到模型服务</div>`;
    state.currentDetailId = service.id;
    state.serviceDetailTab = state.serviceDetailTab || 'routing';
    const tab = state.serviceDetailTab;
    const snap = buildServiceRoutingSnapshot(service);
    const status = service.enabled === false ? '已停用' : (snap.candidateCount ? '运行正常' : '待添加源');
    const logo = (service.name || 'SV').slice(0, 2).toUpperCase();
    const visibleCount = filterServiceChannels(snap.channels, service).length;
    const moreHint = visibleCount < snap.channels.length ? `筛选通道 · ${visibleCount}/${snap.channels.length}` : '筛选通道';
    return `${detailHead(logo, service.name, `${service.serviceId} · ${hostingLabel(service.hosting || 'saas')} · ${serviceStrategyLabel(service.strategy)}`, status, moreHint)}
      <div class="x-subnav">
        <button class="${tab === 'routing' ? 'active' : ''}" data-x-tab="routing" data-detail-kind="service">智能路由</button>
        <button class="${tab === 'sources' ? 'active' : ''}" data-x-tab="sources" data-detail-kind="service">绑定源</button>
        <button class="${tab === 'strategy' ? 'active' : ''}" data-x-tab="strategy" data-detail-kind="service">分发策略</button>
      </div>
      <div id="x-detail-panel" class="rt-detail-panel">${serviceDetailPanel(tab)}</div>`;
  }

  function modelDetail(id) {
    const model = state.models.find(m => m.id === id) || state.models[0] || {id, name:'未知模型', provider:'—', region:'—', status:'运行中'};
    const service = state.services.find(s => s.id === model.serviceRef) || state.services.find(s => s.serviceId === model.serviceId);
    const logo = (model.sourceModel || model.name || 'MO').slice(0, 2).toUpperCase();
    const protocol = model.protocol || 'OpenAI 兼容';
    const snap = modelPriceSnapshot(model);
    const caps = model.capabilities || {};
    const supported = Object.values(caps).filter(v => v === 'supported').length;
    state.currentDetailId = model.id;
    return `${detailHead(logo, model.sourceModel || model.name, `${model.provider} · ${model.region} · ${protocol}`, model.status === '运行中' ? '运行正常' : model.status, '更多操作')}
      <div class="x-subnav">
        <button class="active" data-x-tab="overview" data-detail-kind="model">概览</button>
        <button data-x-tab="billing" data-detail-kind="model">计费详情</button>
        <button data-x-tab="performance" data-detail-kind="model">性能</button>
        <button data-x-tab="routes" data-detail-kind="model">关联路由</button>
        <button data-x-tab="credentials" data-detail-kind="model">凭证与安全</button>
      </div>
      <div id="x-detail-panel">
        <section class="metrics">
          <div class="metric-card"><div class="metric-top"><span>今日请求</span></div><strong>${model.share ? (model.share * 8.3).toFixed(1) + 'K' : '—'}</strong><small>流量占比 ${model.share || 0}%</small></div>
          <div class="metric-card" style="--tone:#edf3ff"><div class="metric-top"><span>SLA</span></div><strong>${model.sla || '—'}</strong><small>目标 99.9%</small></div>
          <div class="metric-card" style="--tone:#fff3e8"><div class="metric-top"><span>实时延迟</span></div><strong>${model.latency || '待检测'}</strong><small>健康检查 ${model.healthCheck || '每 30 秒'}</small></div>
          <div class="metric-card" style="--tone:#f3effe"><div class="metric-top"><span>采购折扣</span></div><strong>${snap.configured && snap.discount != null ? `${snap.discount}%` : '—'}</strong><small>${snap.configured ? (snap.timed ? `分时段 · ${snap.segments?.length || 0} 段` : '统一结算价') : '尚未配置计费'}</small></div>
        </section>
        <div class="x-detail-grid">
          <article class="card"><div class="card-head"><div><h2>服务配置</h2><p>当前生效参数</p></div><button class="btn" data-x="test-current">连接测试</button></div>
            <div class="x-kv-grid">
              <div class="x-kv"><span>Base URL</span><strong>${model.baseUrl || '—'}</strong></div>
              <div class="x-kv"><span>源模型</span><strong>${model.sourceModel || model.name}</strong></div>
              <div class="x-kv"><span>绑定模型服务</span><strong>${service ? `${service.name} · ${service.serviceId}` : (model.name || '—')}</strong></div>
              <div class="x-kv"><span>请求超时</span><strong>${model.timeout || 30} 秒</strong></div>
              <div class="x-kv"><span>最大并发</span><strong>${model.concurrency || 500}</strong></div>
              <div class="x-kv"><span>重试 / 熔断</span><strong>${model.retries || 2} 次 / ${model.circuit || 5}%</strong></div>
              <div class="x-kv"><span>健康检查</span><strong>${model.healthCheck || '每 30 秒'}</strong></div>
              <div class="x-kv"><span>能力声明</span><strong>${supported || 0} 项支持</strong></div>
              <div class="x-kv"><span>上游凭证</span><strong>API Key 已配置</strong></div>
            </div>
          </article>
          ${modelBillingDetailHtml(model)}
        </div>
      </div>`;
  }

  function modelDetailTab(tab) {
    const model = state.models.find(m => m.id === state.currentDetailId) || state.models[0];
    if (!model) return '<div class="empty-note">未找到源模型</div>';
    if (tab === 'billing') return modelBillingDetailHtml(model);
    if (tab === 'credentials') {
      return `<article class="card"><div class="card-head"><div><h2>上游凭证</h2><p>接入时配置的上游 API Key 由网关保存并用于转发</p></div></div>
        <div class="x-kv-grid">
          <div class="x-kv"><span>服务商</span><strong>${model.provider || '—'}</strong></div>
          <div class="x-kv"><span>源模型</span><strong>${model.sourceModel || model.name || '—'}</strong></div>
          <div class="x-kv"><span>Base URL</span><strong>${model.baseUrl || '—'}</strong></div>
          <div class="x-kv"><span>凭证形态</span><strong>上游 API Key</strong></div>
        </div>
        <div class="x-test-result show" style="margin-top:14px"><span>明文不会展示在列表页；连通性探测与转发使用网关侧保存的凭证</span><b>安全</b></div>
      </article>`;
    }
    if (tab === 'performance') {
      return `<article class="card"><div class="card-head"><div><h2>性能观测</h2><p>近 24 小时</p></div></div><div class="x-kv-grid"><div class="x-kv"><span>平均延迟</span><strong>${model.latency || '—'}</strong></div><div class="x-kv"><span>SLA</span><strong>${model.sla || '—'}</strong></div><div class="x-kv"><span>流量占比</span><strong>${model.share || 0}%</strong></div><div class="x-kv"><span>健康检查</span><strong>${model.healthCheck || '每 30 秒'}</strong></div></div></article>`;
    }
    if (tab === 'routes') {
      const routes = state.routes.map(normalizeRoute);
      return `<article class="card"><div class="card-head"><div><h2>业务路由</h2><p>路径入口与模型服务解耦；调用时通过 model 字段指定服务</p></div></div>
        ${routes.length ? `<div class="providers-table"><table><thead><tr><th>路由</th><th>路径</th><th>QPS</th><th>状态</th></tr></thead><tbody>${routes.map(r => `<tr><td><strong>${r.name}</strong></td><td>${r.endpoint}</td><td>${Number(r.qps).toLocaleString('en-US')}</td><td>${r.on ? '启用' : '停用'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-note">暂无业务路由</div>'}
      </article>`;
    }
    return '';
  }

  function routeDetail(id) {
    ensureGatewayRoutes();
    const r = normalizeRoute(state.routes.find(x => x.id === id) || primaryRoute());
    const fullUrl = routeFullUrl(r);
    const kindLabel = r.gateway ? `标准入口 · ${audienceLabel(r.audience)} · ${envLabel(r.env)}` : `追加路径 · ${audienceLabel(r.audience)} · ${envLabel(r.env)}`;
    return `${detailHead('RT', r.name || '业务路由', kindLabel, r.on ? '启用中' : '已停用')}
      <div id="x-detail-panel">
        <article class="card">
          <div class="card-head"><div><h2>入口信息</h2><p>${r.gateway ? '四类标准网关之一，内置多种调用方式，不可删除' : '额外路径，挂在指定对象与环境下'}</p></div>
            <button class="btn" data-x="copy-route-url" data-url="${fullUrl}">复制完整地址</button>
          </div>
          <div class="x-kv-grid" style="grid-template-columns:repeat(2,1fr)">
            <div class="x-kv"><span>开放对象</span><strong>${audienceLabel(r.audience)}</strong></div>
            <div class="x-kv"><span>环境</span><strong>${envLabel(r.env)}</strong></div>
            <div class="x-kv"><span>环境域名</span><strong>${routeHost(r.env).replace(/^https?:\/\//,'')}</strong></div>
            <div class="x-kv"><span>${r.gateway ? '入口前缀' : '路径'}</span><strong>${r.endpoint}</strong></div>
            <div class="x-kv"><span>完整地址</span><strong style="font-size:12px;word-break:break-all">${fullUrl}</strong></div>
            <div class="x-kv"><span>所属部门</span><strong>${r.workspace === '智能客服' ? '客户服务' : (r.workspace || '—')}</strong></div>
            <div class="x-kv"><span>状态</span><strong>${r.on ? '启用' : '停用'}</strong></div>
            <div class="x-kv"><span>最大 QPS</span><strong>${Number(r.qps).toLocaleString('en-US')}</strong></div>
            <div class="x-kv"><span>超时</span><strong>${r.timeout} 秒</strong></div>
            ${r.gateway ? `<div class="x-kv"><span>调用方式</span><strong>${enabledRouteMethods(r).length} / ${(r.methods || []).length} 已启用</strong></div>` : ''}
          </div>
          ${r.gateway ? `<div class="x-route-methods" style="margin:0 18px 18px;border-radius:10px;border:1px solid #edf1f2">
            <div class="x-route-methods-head"><strong>标准调用方式</strong><span>共享该入口 QPS / 超时</span></div>
            ${routeMethodRowsHtml(r)}
          </div>` : ''}
          <div class="x-test-result show" style="margin:0 18px 18px"><span>${r.audience === 'personal' ? '个人入口须携带企业用户身份头；' : '应用入口仅校验应用 Key；'}上游模型由请求中的 model（模型服务名）决定</span><b>入口治理</b></div>
        </article>
      </div>`;
  }

  function roleDetail(id) {
    const roles={superadmin:['SA','超级管理员','1 名成员 · 全平台权限'],admin:['KR','模型key分发审核人','Key 签发与审批'],ops:['MO','模型服务接入维护','服务 / 源 / 路由维护'],observer:['AU','审计人员','日志与安全核查'],member:['US','普通用户','申请 Key 与查看用量']}; const r=roles[id]||roles.superadmin;
    return `${detailHead(...r,'已启用')}<div class="x-subnav"><button class="active">权限范围</button><button>成员</button><button>授权记录</button></div><div class="x-detail-grid"><article class="card"><div class="card-head"><div><h2>权限能力</h2><p>本角色当前有效权限</p></div><button class="btn" data-x="matrix">查看矩阵</button></div><div class="policy-grid" style="grid-template-columns:repeat(3,1fr)"><div class="policy"><span>模型查看<b class="ok">允许</b></span><strong>12 个</strong></div><div class="policy"><span>模型管理<b class="ok">允许</b></span><strong>全局</strong></div><div class="policy"><span>审计查看<b class="ok">允许</b></span><strong>365 天</strong></div><div class="policy"><span>路由管理<b class="ok">允许</b></span><strong>6 条</strong></div><div class="policy"><span>费用导出<b class="ok">允许</b></span><strong>全局</strong></div><div class="policy"><span>权限管理<b class="ok">允许</b></span><strong>全局</strong></div></div></article><article class="card"><div class="card-head"><div><h2>成员</h2><p>最近活跃成员</p></div><button class="x-mini-btn" data-x="invite-member">添加成员</button></div><div class="activity-list"><div class="activity"><div class="activity-icon">LZ</div><div><strong>林舟</strong><p>linzhou@corp.cn</p></div><time>在线</time></div><div class="activity"><div class="activity-icon">ZR</div><div><strong>赵然</strong><p>zhaoran@corp.cn</p></div><time>18m</time></div><div class="activity"><div class="activity-icon">CY</div><div><strong>陈屿</strong><p>chenyu@corp.cn</p></div><time>2h</time></div></div></article></div>`;
  }

  const commands = [
    {k:'G O', icon:'总', title:'运行总览', desc:'网关实时状态与安全动态', page:'overview'},
    {k:'G M', icon:'模', title:'模型服务配置', desc:'创建对外统一服务名', page:'model-services'},
    {k:'G S', icon:'源', title:'源模型能力接入', desc:'接入并绑定底层源模型', page:'model-sources'},
    {k:'G U', icon:'员', title:'成员管理', desc:'企业成员池与部门角色', page:'members'},
    {k:'G K', icon:'钥', title:'签发 API Key', desc:'个人 / 应用两套场景，按组织层级开通', page:'security-api'},
    {k:'G R', icon:'路', title:'业务路由', desc:'配置网关路径尾缀与入口限流', page:'routes'},
    {k:'G A', icon:'审', title:'平台操作审计', desc:'配置变更与权限等管理操作', page:'audit-platform'},
    {k:'G P', icon:'策', title:'策略命中审计', desc:'脱敏、隐私与越权拦截记录', page:'audit-policy'},
    {k:'G L', icon:'调', title:'调用日志', desc:'全链路请求留痕与排障', page:'audit-request'},
    {k:'G Y', icon:'安', title:'安全策略', desc:'脱敏、越权与内容安全规则', page:'security-policies'},
    {k:'G N', icon:'警', title:'告警规则', desc:'延迟、错误率与预算阈值', page:'alerts'},
    {k:'G C', icon:'量', title:'用量与费用', desc:'Token 用量、费用趋势与预算治理', page:'usage'},
    {k:'N R', icon:'＋', title:'追加路径', desc:'在主路由之外增加独立入口', action:'route'},
    {k:'N S', icon:'＋', title:'创建模型服务', desc:'定义对外统一服务名', action:'service'},
    {k:'N M', icon:'＋', title:'接入源模型', desc:'绑定底层源能力到服务', action:'model'},
    {k:'N K', icon:'＋', title:'开通 API Key', desc:'先选个人或应用场景再开通', action:'keyScene'},
    {k:'N U', icon:'＋', title:'添加成员', desc:'加入企业成员池', action:'member'}
  ];

  function openCommand() { renderCommands(''); commandLayer.classList.add('open'); commandLayer.setAttribute('aria-hidden','false'); setTimeout(()=>$('#x-command-input').focus(),50); }
  function renderCommands(q) {
    const cfg = window.getActiveRoleConfig?.() || {};
    const allowed = cfg.pages || [];
    const canAct = cfg.x?.includes('*') || cfg.canManageRoutes || cfg.canManageSecurity || cfg.viewProfile === 'admin' || cfg.viewProfile === 'ops';
    const list = commands
      .filter(c => (c.title + c.desc).toLowerCase().includes(q.toLowerCase()))
      .filter(c => !c.page || allowed.includes(c.page))
      .filter(c => !c.action || canAct);
    $('#x-command-results').innerHTML = list.map(c => `<button class="x-command-item" data-command-page="${c.page||''}" data-command-action="${c.action||''}"><i>${c.icon}</i><div><strong>${c.title}</strong><span>${c.desc}</span></div><kbd>${c.k}</kbd></button>`).join('') || '<div class="empty-note">当前角色没有匹配的功能</div>';
  }

  function validate(fields) {
    let ok=true; fields.forEach(name=>{const el=$(`[name="${name}"]`,modalLayer); if(!el?.value.trim()){el?.closest('.x-field')?.classList.add('invalid');ok=false;} else el.closest('.x-field')?.classList.remove('invalid');}); return ok;
  }

  function simulate() {
    const result=$('#x-sim-result'); if(!result) { toast('路由模拟已启动'); return; }
    result.innerHTML='<h3>正在计算最优路径…</h3><p class="x-placeholder">检查配额、延迟、成本与安全策略</p>';
    setTimeout(()=>{result.innerHTML='<h3>模拟结果 <span class="event-chip green" style="float:right">通过</span></h3><div class="x-result-line"><span>身份与配额</span><b>通过 · 4 ms</b></div><div class="x-result-line"><span>脱敏策略</span><b>命中 PII-CN-V2</b></div><div class="x-result-line"><span>选中路由</span><b>customer-prod</b></div><div class="x-result-line"><span>上游模型</span><b>GPT-5.1</b></div><div class="x-result-line"><span>预计延迟 / 成本</span><b>684 ms / ¥0.026</b></div>';},700);
  }

  function downloadExport(kind) {
    const format=$('#x-export-format')?.value || 'csv';
    const data=format==='json'?JSON.stringify([{time:'2026-11-03 11:42:16',event:'敏感数据脱敏',source:'svc-customer-agent',result:'success'}],null,2):'time,event,source,result\n2026-11-03 11:42:16,敏感数据脱敏,svc-customer-agent,success\n';
    const blob=new Blob([data],{type:format==='json'?'application/json':'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`aegis-${kind}-${new Date().toISOString().slice(0,10)}.${format}`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); closeLayers(); toast(`${kind}已生成并开始下载`);
  }

  document.addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-x-tab]');
    if (tabBtn) {
      e.stopPropagation();
      const tab = tabBtn.dataset.xTab;
      const kind = tabBtn.dataset.detailKind || (String($('#page-content')?.dataset.enhanced || '').replace(/^detail-/, '') || 'model');
      const panel = $('#x-detail-panel');
      $$('.x-subnav button', $('#page-content')).forEach(btn => btn.classList.toggle('active', btn === tabBtn));
      if (panel && state.currentDetailId) {
        if (kind === 'service') {
          state.serviceDetailTab = tab;
          panel.innerHTML = serviceDetailPanel(tab);
        } else if (tab === 'overview') openDetail('model', state.currentDetailId);
        else panel.innerHTML = modelDetailTab(tab);
      }
      return;
    }
    const el=e.target.closest('[data-x], [data-x-detail], [data-command-page], [data-command-action]');
    const clickedBtn = e.target.closest('button');
    const text = clickedBtn?.textContent.trim() || '';
    // 左侧导航 / 跳转按钮只负责切页，不按文案打开弹窗
    if (clickedBtn?.closest('.nav-item[data-page], [data-page-jump], .role-option')) {
      /* fall through to other handlers / app.js navigation */
    } else if (!el && text) {
      if (text.includes('追加路径')) { e.stopPropagation(); openModal('route'); return; }
      if (text.includes('创建模型服务')) { e.stopPropagation(); openModal('service'); return; }
      if (text.includes('添加成员')) { e.stopPropagation(); openModal('member'); return; }
      if (text.includes('批量导入')) { e.stopPropagation(); openModal('memberImport'); return; }
      if (text.includes('接入模型') || text.includes('接入源模型')) {
        e.stopPropagation();
        if (!state.services.length) {
          if (window.render) window.render('model-services');
          setTimeout(() => { enhanceView(); openModal('service'); toast('请先创建对外模型服务，再接入源模型'); }, 0);
        } else openModal('model');
        return;
      }
      if (text.includes('新建角色')) { e.stopPropagation(); openModal('role'); return; }
      if (text.includes('权限矩阵')) { e.stopPropagation(); openModal('matrix'); return; }
      if (text.includes('创建密钥') || text === '签发 API Key' || text.includes('签发新 API Key') || text.includes('开通应用 Key') || text.includes('开通个人 Key') || text.includes('申请 API Key') || text.includes('申请个人 Key')) {
        e.stopPropagation();
        if (isDeveloperProfile()) {
          if (!KEY_APPROVAL_ENABLED) openPersonalKeyIssue();
          else openModal('applyKey', { scene: 'personal' });
        }
        else if (text.includes('开通个人')) openModal('key', { scene: 'personal' });
        else if (text.includes('开通应用')) openModal('key', { scene: 'app' });
        else openModal('keyScene');
        return;
      }
      if (text.includes('导出报告')) { e.stopPropagation(); openModal('export',{kind:'审计报告'}); return; }
      if (text.includes('导出账单')) { e.stopPropagation(); openModal('export',{kind:'费用账单'}); return; }
      if (text === '筛选' || text.includes('高级筛选') || text.includes('自定义范围')) {
        e.stopPropagation();
        const page = typeof currentPage === 'function' ? currentPage() : '';
        openDrawer(page === 'usage' || page === 'usage-detail' || page === 'billing' ? 'usage-filter' : 'filter');
        return;
      }
      if (text.includes('成本规则')) { e.stopPropagation(); openDrawer('costs'); return; }
    }
    if (!el) return;
    const action=el.dataset.x;
    if (action && !String(action).startsWith('ov-') && el.closest('#page-content') && window.roleCanX && !window.roleCanX(action)) { e.stopPropagation(); toast(`${window.getActiveRoleConfig?.().role || '当前角色'}无此操作权限`); return; }
    if (el.dataset.xDetail) { e.stopPropagation(); const [kind,id]=el.dataset.xDetail.split(':'); openDetail(kind,id); return; }
    if (el.dataset.commandPage) { closeLayers(); window.render(el.dataset.commandPage); setTimeout(enhanceView,0); return; }
    if (el.dataset.commandAction) { closeLayers(); openModal(el.dataset.commandAction); return; }
    if (action) e.stopPropagation();
    if (action === 'close') closeLayers();
    if (action === 'new-route') openModal('route');
    if (action === 'route-focus') {
      state.routeFocus = {
        audience: el.dataset.audience === 'personal' ? 'personal' : 'app',
        env: el.dataset.env === 'test' ? 'test' : 'prod'
      };
      if (window.render) window.render('routes');
      setTimeout(enhanceView, 0);
      return;
    }
    if (action === 'route-audience-filter' || action === 'route-env-filter') {
      // 旧双 Tab 筛选已由矩阵点选替代
      return;
    }
    if (action === 'save-route') {
      ensureGatewayRoutes();
      if (!validate(['routeName', 'routePath'])) return;
      const endpoint = ($('[name="routePath"]', modalLayer)?.value || '').trim();
      if (!endpoint.startsWith('/')) {
        $('[name="routePath"]', modalLayer)?.closest('.x-field')?.classList.add('invalid');
        toast('路径需以 / 开头');
        return;
      }
      const audience = $('[name="routeAudience"]', modalLayer)?.value === 'personal' ? 'personal' : 'app';
      const env = $('[name="routeEnv"]', modalLayer)?.value === 'test' ? 'test' : 'prod';
      const gatewayPaths = gatewayRoutes()
        .filter(r => r.env === env)
        .flatMap(r => (r.methods || []).map(m => routeMethodPath(r, m)));
      if (state.routes.some(r => r.env === env && r.endpoint === endpoint) || gatewayPaths.includes(endpoint)) {
        toast('该路径在同环境下已存在');
        return;
      }
      const name = $('[name="routeName"]', modalLayer).value.trim();
      state.routes.push(normalizeRoute({
        id: `route-${Date.now()}`,
        name,
        endpoint,
        audience,
        env,
        workspace: $('[name="routeWorkspace"]', modalLayer)?.value || '未分配',
        qps: $('[name="routeQps"]', modalLayer)?.value || '500',
        timeout: $('[name="routeTimeout"]', modalLayer)?.value || (env === 'test' ? '60' : '30'),
        on: true,
        gateway: false,
        primary: false
      }));
      state.routeFocus = { audience, env };
      persist();
      closeLayers();
      toast(`已追加 ${audienceLabel(audience)} · ${envLabel(env)} 路径 ${endpoint}`);
      if (window.render) window.render('routes');
      setTimeout(enhanceView, 0);
    }
    if (action === 'route-method-toggle') {
      ensureGatewayRoutes();
      const route = state.routes.find(r => r.id === el.dataset.routeId);
      if (!route?.gateway) return;
      route.methods = normalizeRouteMethods(route.methods);
      const method = route.methods.find(m => m.id === el.dataset.methodId);
      if (!method) return;
      method.on = !method.on;
      if (!route.methods.some(m => m.on)) {
        method.on = true;
        toast('至少保留一种调用方式');
        return;
      }
      persist();
      toast(`${method.label}已${method.on ? '启用' : '停用'}`);
      if (currentPage() === 'routes') {
        if (window.render) window.render('routes');
        setTimeout(enhanceView, 0);
      } else if (String($('#page-content')?.dataset.enhanced || '').startsWith('detail-route')) {
        openDetail('route', route.id);
      }
      return;
    }
    if (action === 'copy-route-url') {
      if (el.dataset.url) {
        navigator.clipboard?.writeText(el.dataset.url);
        toast('完整地址已复制');
      }
    }
    if (action === 'new-service') openModal('service');
    if (action === 'edit-service') openModal('editService', { id: el.dataset.id });
    if (action === 'service-toggle') {
      const service = state.services.find(s => s.id === el.dataset.id);
      if (!service) return;
      service.enabled = service.enabled === false;
      persist();
      el.classList.toggle('on', service.enabled !== false);
      toast(`${service.name} 已${service.enabled !== false ? '启用' : '停用'}`);
      renderServicesPage();
      return;
    }
    if (action === 'dist-add-source') {
      const service = state.services.find(s => s.id === state.editingDistributionId);
      const modelId = $('[name="distAddSourceId"]', modalLayer)?.value || '';
      if (!service || !modelId) { toast('请选择要添加的源模型'); return; }
      const model = state.models.find(m => m.id === modelId);
      if (!model) return;
      model.serviceRef = service.id;
      model.serviceId = service.serviceId;
      model.distEnabled = true;
      const maxOrder = Math.max(-1, ...boundModelsForService(service).filter(m => m.id !== model.id).map(m => m.distOrder ?? 0));
      model.distOrder = maxOrder + 1;
      if (model.status === '已停用') model.status = '运行中';
      persist();
      $('#x-distribution-panel').innerHTML = distributionPanel(state.distributionMode || 'fixed');
      const sources = activeDistributionSources();
      $('#x-current-source').textContent = sources.find(s => s.enabled)?.provider || '无可用源';
      const head = $('.x-dialog-head p', modalLayer);
      if (head) head.textContent = `统一服务标识 ${service.serviceId || '—'}，关联 ${sources.length} 个源模型`;
      toast(`已添加 ${model.provider} · ${model.sourceModel || model.name}`);
      return;
    }
    if (action === 'dist-remove-source') {
      const service = state.services.find(s => s.id === state.editingDistributionId);
      const model = state.models.find(m => m.id === el.dataset.id);
      if (!service || !model) return;
      if (model.serviceRef === service.id || model.serviceId === service.serviceId) {
        model.serviceRef = '';
        if (model.serviceId === service.serviceId) model.serviceId = '';
      }
      persist();
      $('#x-distribution-panel').innerHTML = distributionPanel(state.distributionMode || 'fixed');
      const sources = activeDistributionSources();
      $('#x-current-source').textContent = sources.find(s => s.enabled)?.provider || '无可用源';
      const head = $('.x-dialog-head p', modalLayer);
      if (head) head.textContent = `统一服务标识 ${service.serviceId || '—'}，关联 ${sources.length} 个源模型`;
      toast('已从策略中移除该源');
      return;
    }
    if (action === 'new-member') openModal('member');
    if (action === 'import-members') openModal('memberImport');
    if (action === 'edit-member') openModal('editMember', {id: el.dataset.id});
    if (action === 'toggle-member') {
      const member = state.members.find(m => m.id === el.dataset.id);
      if (member) {
        member.status = member.status === '已禁用' ? '已激活' : '已禁用';
        persist();
        syncIdentitySwitcher({ forceShell: true });
        toast(`${member.name} 已${member.status === '已禁用' ? '禁用' : '启用'}`);
        renderMembersPage();
      }
    }
    if (action === 'download-member-template') {
      const csv = '姓名,手机号,部门,角色\n张三,13800138000,客户服务,普通用户\n';
      const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'aegis-member-import-template.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 800);
      toast('成员导入模板已下载');
    }
    if (action === 'confirm-member-import') {
      const fileName = $('#x-member-file-name')?.textContent || '';
      const samples = [
        {name:'沈岚', phone:'159****4412', dept:'研发助手', role:'普通用户'},
        {name:'唐予', phone:'133****7781', dept:'数据分析', role:'普通用户'}
      ];
      samples.forEach(item => {
        if (state.members.some(m => m.phone.replace(/\*/g,'') === item.phone.replace(/\*/g,''))) return;
        state.members.unshift({
          id:`m-${Date.now()}-${Math.random().toString(16).slice(2,5)}`,
          name:item.name, phone:item.phone, userId:`u_${Math.random().toString(16).slice(2,8)}`,
          dept:item.dept, role:item.role, budgetType:'不限制', dayBudget:'', monthBudget:'',
          status:'待激活', joined: nowDateTime()
        });
      });
      persist(); closeLayers();
      toast(fileName.includes('未选择') ? '已按示例导入 2 名成员（原型演示）' : `已导入文件并新增 ${samples.length} 名成员`);
      if (window.render) window.render('members');
      setTimeout(enhanceView, 0);
    }
    if (action === 'save-member') {
      if (!validate(['memberName','memberPhone'])) return;
      const phone = $('[name="memberPhone"]', modalLayer).value.trim();
      if (!/^1\d{10}$/.test(phone)) {
        $('[name="memberPhone"]', modalLayer)?.closest('.x-field')?.classList.add('invalid');
        toast('请输入 11 位有效手机号');
        return;
      }
      const budgetType = $('[name="memberBudgetType"]', modalLayer)?.value || '不限制';
      const budget = $('[name="memberBudget"]', modalLayer)?.value || '';
      const masked = phone.length === 11 ? `${phone.slice(0,3)}****${phone.slice(7)}` : phone;
      state.members.unshift({
        id:`m-${Date.now()}`,
        name:$('[name="memberName"]', modalLayer).value.trim(),
        phone:masked,
        userId:`u_${Math.random().toString(16).slice(2,8)}`,
        dept:$('[name="memberDept"]', modalLayer)?.value || '未分配',
        role:$('[name="memberRole"]', modalLayer)?.value || '普通用户',
        budgetType,
        dayBudget: budgetType === '按天' ? budget : '',
        monthBudget: budgetType === '按月' ? budget : '',
        status:'待激活',
        joined: nowDateTime()
      });
      persist(); closeLayers();
      syncIdentitySwitcher({ forceShell: true });
      toast('成员已加入企业成员池');
      if (window.render) window.render('members');
      setTimeout(enhanceView, 0);
    }
    if (action === 'update-member') {
      if (!validate(['memberName'])) return;
      const member = state.members.find(m => m.id === state.editingMemberId);
      if (member) {
        const budgetType = $('[name="memberBudgetType"]', modalLayer)?.value || '不限制';
        const budget = $('[name="memberBudget"]', modalLayer)?.value || '';
        member.name = $('[name="memberName"]', modalLayer).value.trim();
        member.dept = $('[name="memberDept"]', modalLayer)?.value || member.dept;
        member.role = $('[name="memberRole"]', modalLayer)?.value || member.role;
        member.status = $('[name="memberStatus"]', modalLayer)?.value || member.status;
        member.budgetType = budgetType;
        member.dayBudget = budgetType === '按天' ? budget : '';
        member.monthBudget = budgetType === '按月' ? budget : '';
        persist();
        syncIdentitySwitcher({ forceShell: true });
      }
      closeLayers();
      toast(`${member?.name || '成员'} 信息已更新`);
      renderMembersPage();
    }
    if (action === 'new-source') {
      if (!state.services.length) { toast('请先创建模型服务'); openModal('service'); }
      else openModal('model');
    }
    if (action === 'bind-source') {
      sessionStorage.setItem('preselectService', el.dataset.service || '');
      if (!state.services.length) openModal('service');
      else openModal('model');
    }
    if (action === 'goto-create-service') {
      closeLayers();
      if (window.render) window.render('model-services');
      setTimeout(() => { enhanceView(); openModal('service'); }, 0);
    }
    if (action === 'goto-create-kms' || action === 'goto-kms-key' || action === 'new-kms' || action === 'save-kms') {
      toast('当前版本暂不开放密钥托管能力');
      return;
    }
    if (action === 'open-filter') openDrawer('filter');
    if (action === 'open-usage-filter') openDrawer('usage-filter');
    if (action === 'matrix') openModal('matrix');
    if (action === 'role') openModal('role');
    if (action === 'edit-role') {
      const role = findRoleDef(el.dataset.id);
      openModal('editRole', { id: el.dataset.id, readonly: isSuperAdminRole(role) });
    }
    if (action === 'toggle-perm-group') {
      const group = el.dataset.group;
      const box = $(`.x-perm-group[data-perm-group="${group}"]`, modalLayer);
      if (!box) return;
      const inputs = $$('input[name="rolePerm"]', box).filter(i => !i.disabled);
      const allOn = inputs.every(i => i.checked);
      inputs.forEach(i => { i.checked = !allOn; });
      el.textContent = allOn ? '全选本组' : '取消本组';
      const countEl = $('#x-perm-count', modalLayer);
      if (countEl) countEl.textContent = String(collectRolePerms().length);
    }
    if (action === 'perm-select-all') {
      $$('input[name="rolePerm"]', modalLayer).filter(i => !i.disabled).forEach(i => { i.checked = true; });
      $$('[data-x="toggle-perm-group"]', modalLayer).forEach(btn => { if (!btn.disabled) btn.textContent = '取消本组'; });
      const countEl = $('#x-perm-count', modalLayer);
      if (countEl) countEl.textContent = String(collectRolePerms().length);
    }
    if (action === 'perm-clear-all') {
      $$('input[name="rolePerm"]', modalLayer).filter(i => !i.disabled).forEach(i => { i.checked = false; });
      $$('[data-x="toggle-perm-group"]', modalLayer).forEach(btn => { if (!btn.disabled) btn.textContent = '全选本组'; });
      const countEl = $('#x-perm-count', modalLayer);
      if (countEl) countEl.textContent = '0';
    }
    if (action === 'cost-rules') openDrawer('costs');
    if (action === 'configure-distribution') openModal('distribution',{id:el.dataset.id, model:el.dataset.model});
    if (action === 'configure-generic') openModal('distribution',{id:el.dataset.id, model:el.dataset.model});
    if (action === 'refresh-service-routing') {
      refreshServiceRoutingData().then(ok => {
        toast(ok ? '调度记录已更新' : '网关离线，无法刷新调度记录');
      });
      return;
    }
    if (action === 'new-logical-model') openModal('service');
    if (action === 'goto-bind-source') {
      closeLayers();
      const serviceId = state.editingDistributionId;
      if (serviceId) sessionStorage.setItem('preselectService', serviceId);
      if (window.render) window.render('model-sources');
      setTimeout(() => { enhanceView(); openModal('model'); }, 0);
    }
    if (action === 'delete-entity') {
      if (el.dataset.kind === 'routes') {
        const route = state.routes.find(r => r.id === el.dataset.id);
        if (route?.gateway || route?.primary) { toast('标准网关入口不可删除'); return; }
      }
      openModal('delete',{kind:el.dataset.kind,id:el.dataset.id,name:el.dataset.name,label:el.dataset.label});
    }
    if (action === 'confirm-delete') {
      const pending=state.pendingDelete;
      if (pending?.kind === 'keys-revoke' || pending?.kind === 'keys-delete') {
        deleteGatewayKey(pending.id)
          .then(() => {
            state.keys = (state.keys || []).filter(k => k.id !== pending.id);
            delete state.keySecrets?.[pending.id];
            if (state.selectedKeyId === pending.id) {
              state.selectedKeyId = null;
              state.securityDetailTab = 'overview';
              state.currentDetailKind = null;
            }
            persist(); closeLayers();
            toast(`${pending.name} 已删除`);
            state.securityTab = 'api';
            state.returnPage = 'security-api';
            if (window.render) window.render('security-api');
            setTimeout(enhanceView, 0);
          })
          .catch(err => toast(err.message || '删除失败'));
        return;
      }
      if (pending && Array.isArray(state[pending.kind])) {
        if (pending.kind === 'routes') {
          const route = state.routes.find(r => r.id === pending.id);
          if (route?.gateway || route?.primary) { toast('标准网关入口不可删除'); return; }
        }
        if (pending.kind === 'services') {
          const svc = state.services.find(s => s.id === pending.id);
          state.models.forEach(m => {
            if (m.serviceRef === pending.id || (svc && m.serviceId === svc.serviceId)) {
              m.serviceRef = '';
              if (svc && m.serviceId === svc.serviceId) m.serviceId = '';
            }
          });
        }
        if (pending.kind === 'callers') {
          const linked = callerKeyCount(pending.id);
          if (linked) { toast(`仍有 ${linked} 条 API Key 关联该调用方，请先调整或删除对应 Key`); return; }
        }
        if (pending.kind === 'keys') {
          const key = state.keys.find(k => k.id === pending.id);
          if (key && key.type !== 'api') {
            toast('当前版本暂不开放密钥托管能力');
            return;
          }
          if (key && key.type === 'api') {
            deleteGatewayKey(pending.id)
              .then(() => {
                state.keys = (state.keys || []).filter(k => k.id !== pending.id);
                delete state.keySecrets?.[pending.id];
                if (state.selectedKeyId === pending.id) {
                  state.selectedKeyId = null;
                  state.securityDetailTab = 'overview';
                  state.currentDetailKind = null;
                }
                persist(); closeLayers();
                toast(`${pending.name} 已删除`);
                state.securityTab = 'api';
                state.returnPage = 'security-api';
                if (window.render) { window.render('security-api'); setTimeout(enhanceView, 0); }
                else renderSecurityPage();
              })
              .catch(err => toast(err.message || '删除失败'));
            return;
          }
        }
        if (pending.kind === 'roleDefs') {
          const role = findRoleDef(pending.id);
          if (isSuperAdminRole(role)) { toast('超级管理员不可删除'); return; }
          const used = countRoleMembers(role?.name || pending.name);
          if (used) { toast(`仍有 ${used} 名成员使用该角色，请先调整成员角色后再删除`); return; }
        }
        state[pending.kind]=state[pending.kind].filter(item=>item.id!==pending.id);
        if (pending.kind === 'keys' && state.selectedKeyId === pending.id) {
          state.selectedKeyId = null;
          state.securityDetailTab = 'overview';
        }
        persist(); closeLayers(); toast(`${pending.name} 已删除，列表已更新`);
        if (pending.kind === 'members' || pending.kind === 'roleDefs') syncIdentitySwitcher({ forceShell: true });
        if (pending.kind === 'keys') {
          // 删除后必须留在密钥相关页，忽略可能过期的 returnPage（避免跳回总览）
          const pageNow = currentPage();
          const backTo = 'security-api';
          state.securityTab = 'api';
          state.returnPage = backTo;
          state.currentDetailKind = null;
          if (window.render) { window.render(backTo); setTimeout(enhanceView, 0); }
          else renderSecurityPage();
        }
        else if (pending.kind === 'callers' && currentPage() === 'security-api') renderSecurityPage();
        else if (pending.kind === 'roleDefs') refreshAccessPage();
        else if (window.render) { window.render(currentPage()); setTimeout(enhanceView,0); }
      }
    }
    if (action === 'pricing-mode') {
      syncPricingModeUI(el.dataset.mode || 'flat');
    }
    if (action === 'add-time-break') {
      const input = $('[name="newBreakTime"]', modalLayer);
      const time = (input?.value || '').trim();
      if (!time || toMinutes(time) <= 0 || toMinutes(time) >= 24 * 60) {
        toast('请选择 00:00 与 24:00 之间的断点时间');
        return;
      }
      const segs = readTimeSegmentsFromDom();
      const breaks = ['00:00', ...segs.map(s => s.end), time];
      refreshTimeSegmentsEditor(rebuildSegmentsFromBreaks(breaks, segs));
      toast(`已添加断点 ${time}`);
      return;
    }
    if (action === 'remove-time-break') {
      const time = el.dataset.time;
      if (!time || time === '00:00' || time === '24:00') return;
      const segs = readTimeSegmentsFromDom();
      const breaks = ['00:00', ...segs.map(s => s.end).filter(t => t !== time && t !== '24:00'), '24:00'];
      refreshTimeSegmentsEditor(rebuildSegmentsFromBreaks(breaks, segs));
      toast(`已删除断点 ${time}`);
      return;
    }
    if (action === 'split-time-segment') {
      const idx = Number(el.dataset.index);
      const card = $(`[data-segment-index="${idx}"]`, modalLayer);
      const time = (card?.querySelector('[data-split-for]')?.value || '').trim();
      const segs = readTimeSegmentsFromDom();
      const seg = segs[idx];
      if (!seg || !time) { toast('请选择要插入的断点时间'); return; }
      const t = toMinutes(time);
      if (!(t > toMinutes(seg.start) && t < toMinutes(seg.end))) {
        toast(`断点须落在 ${seg.start} 与 ${seg.end} 之间`);
        return;
      }
      const breaks = ['00:00', ...segs.map(s => s.end), time];
      refreshTimeSegmentsEditor(rebuildSegmentsFromBreaks(breaks, segs));
      toast(`已在 ${seg.start}–${seg.end} 插入断点 ${time}`);
      return;
    }
    if (action === 'holiday-separate') {
      syncHolidayPricingUI(!!el.checked);
    }
    if (action === 'strategy-mode') {
      state.distributionMode = el.dataset.mode;
      $$('.x-strategy-switch button',modalLayer).forEach(btn=>btn.classList.toggle('active',btn===el));
      $('#x-distribution-panel').innerHTML = distributionPanel(state.distributionMode);
      $('#x-current-strategy').textContent = state.distributionMode === 'cost' ? '实时费用最低' : '固定顺序';
      const sources = activeDistributionSources();
      const selected = state.distributionMode === 'fixed' ? sources.find(s=>s.enabled) : [...sources].filter(s=>s.enabled).sort((a,b)=>projectedSourceCost(a)-projectedSourceCost(b))[0];
      $('#x-current-source').textContent = selected?.provider || '无可用源';
    }
    if (action === 'source-toggle') {
      const model = state.models.find(m => m.id === el.dataset.id);
      if (model) {
        const next = model.distEnabled === false;
        model.distEnabled = next;
        if (next && model.status === '已停用') model.status = '运行中';
        if (!next) { /* keep status */ }
        persist();
      }
      const sources = activeDistributionSources();
      const source = sources.find(s => s.id === el.dataset.id);
      el.classList.toggle('on', !!(source && source.enabled));
      const enabled = sources.filter(s => s.enabled).length;
      if (!enabled && model) {
        model.distEnabled = true;
        persist();
        el.classList.add('on');
        toast('至少需要保留一个可用源服务');
      }
      $('#x-current-source').textContent = activeDistributionSources().find(s => s.enabled)?.provider || '无可用源';
    }
    if (action === 'recalculate-cost') {
      const input = Number($('#x-dist-input')?.value || 0), output = Number($('#x-dist-output')?.value || 0);
      const sources = activeDistributionSources();
      const sorted = [...sources].filter(s=>s.enabled).sort((a,b)=>projectedSourceCost(a,input,output)-projectedSourceCost(b,input,output));
      $('#x-cost-source-list').innerHTML = sorted.map((s,i)=>costSourceRow(s,i,input,output)).join('');
      $('#x-current-source').textContent = sorted[0]?.provider || '无可用源';
      toast('已按最新 Token 构成重新计算实时成本');
    }
    if (action === 'source-up' || action === 'source-down') {
      const service = state.services.find(s => s.id === state.editingDistributionId);
      const bound = boundModelsForService(service);
      const index = bound.findIndex(m => m.id === el.dataset.id);
      const target = action === 'source-up' ? index - 1 : index + 1;
      if (index >= 0 && target >= 0 && target < bound.length) {
        // 用 distOrder 持久化顺序
        const ordered = bound.slice();
        [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
        ordered.forEach((m, i) => { m.distOrder = i; });
        persist();
      }
      const sources = activeDistributionSources();
      $('#x-distribution-panel').innerHTML = distributionPanel('fixed');
      $('#x-current-source').textContent = sources.find(s => s.enabled)?.provider || '无可用源';
    }
    if (action === 'save-distribution') {
      const service = state.services.find(s => s.id === state.editingDistributionId);
      if (service) {
        service.strategy = state.distributionMode;
        if (service.serviceId?.includes('deepseek')) state.deepseekStrategy = state.distributionMode;
        persist();
      }
      closeLayers();
      toast(`${service?.name || '模型服务'} 已启用${state.distributionMode==='cost'?'实时费用最低':'固定顺序'}分发`);
      if (window.render) window.render('model-services');
      setTimeout(enhanceView, 0);
    }
    if (action === 'audit-row') {
      state.selectedAuditId = el.dataset.id || null;
      state.auditPayloadTab = 'downReq';
      if (el.dataset.kind === 'policy') state.auditView = 'policy';
      if (el.dataset.kind === 'platform') state.auditView = 'platform';
      if (el.dataset.kind === 'request') state.auditView = 'request';
      openDrawer('audit');
    }
    if (action === 'audit-payload-tab') {
      state.auditPayloadTab = el.dataset.tab || 'downReq';
      openDrawer('audit');
      return;
    }
    if (action === 'copy-audit-payload') {
      const ev = auditEventById(state.selectedAuditId) || auditEventsForView(state.auditView || 'request')[0];
      const payloads = resolveAuditPayloads(ev);
      const tab = state.auditPayloadTab || 'downReq';
      const body = payloads ? payloads[tab] : null;
      if (body == null) { toast('当前方向无内容可复制'); return; }
      const text = formatAuditDiff(body);
      navigator.clipboard?.writeText(text);
      toast(`已复制${auditPayloadTabLabel(tab)}`);
      return;
    }
    if (action === 'export-audit') {
      const kind = el.dataset.kind || (state.auditView === 'policy' ? '策略命中报告' : state.auditView === 'request' ? '调用日志报告' : '平台操作报告');
      openModal('export', {kind});
    }
    if (action === 'goto-alerts') {
      closeLayers();
      if (window.render) window.render('alerts');
      setTimeout(enhanceView, 0);
    }
    if (action === 'goto-policies') {
      closeLayers();
      if (window.render) window.render('security-policies');
      setTimeout(enhanceView, 0);
    }
    if (action === 'open-notifications') openDrawer('notifications');
    if (action === 'new-policy') openModal('policy');
    if (action === 'edit-policy') openModal('policy', {id: el.dataset.id});
    if (action === 'policy-toggle') {
      const p = state.policies.find(x => x.id === el.dataset.id);
      if (p) { p.enabled = !p.enabled; persist(); renderPoliciesPage(); toast(p.enabled ? '策略已启用' : '策略已停用'); }
    }
    if (action === 'pol-hosting-change') {
      const hostingScope = $('[name="polHostingScope"]', modalLayer)?.value || 'all';
      const typeSel = $('[name="polType"]', modalLayer);
      const actionSel = $('[name="polAction"]', modalLayer);
      const hint = $('#x-pol-hosting-hint', modalLayer);
      const types = policyTypesForHosting(hostingScope);
      const prevType = typeSel?.value;
      const nextType = types.includes(prevType) ? prevType : types[0];
      if (typeSel) typeSel.innerHTML = selectOptions(types, nextType);
      const actions = policyActionsForType(nextType);
      if (actionSel) actionSel.innerHTML = selectOptions(actions, actions[0]);
      if (hint) {
        hint.textContent = hostingScope === 'saas'
          ? 'SaaS 侧重：出域前脱敏、密钥/凭证拦截、第三方内容安全与越权。'
          : hostingScope === 'local'
            ? '本地侧重：推理端点 ACL、知识库越权、GPU/QPS 资源滥用治理。'
            : '适用于全部部署类型的通用规则；也可再拆成仅 SaaS / 仅本地。';
      }
      return;
    }
    if (action === 'pol-type-change') {
      const type = $('[name="polType"]', modalLayer)?.value;
      const actionSel = $('[name="polAction"]', modalLayer);
      const actions = policyActionsForType(type);
      if (actionSel) actionSel.innerHTML = selectOptions(actions, actions[0]);
      return;
    }
    if (action === 'save-policy') {
      if (!validate(['polName', 'polCode'])) return;
      const name = $('[name="polName"]', modalLayer)?.value.trim();
      const code = $('[name="polCode"]', modalLayer)?.value.trim();
      const type = $('[name="polType"]', modalLayer)?.value;
      const polAction = $('[name="polAction"]', modalLayer)?.value;
      const scope = $('[name="polScope"]', modalLayer)?.value;
      const dept = $('[name="polDept"]', modalLayer)?.value || '全部部门';
      const hostingScope = $('[name="polHostingScope"]', modalLayer)?.value || 'all';
      const desc = $('[name="polDesc"]', modalLayer)?.value?.trim() || '';
      const id = el.dataset.id;
      if (id) {
        const p = state.policies.find(x => x.id === id);
        if (p) {
          Object.assign(p, {name, code, type, action: polAction, scope, hostingScope, desc, depts:[dept], updated: nowDateTime()});
          delete p.workspaces;
        }
        toast('策略已更新');
      } else {
        state.policies.push({id:`pol-cfg-${Date.now()}`, code, name, type, action: polAction, scope, hostingScope, desc, depts:[dept], services:['全部服务'], enabled:true, hits:0, updated: nowDateTime()});
        toast('策略已创建');
      }
      persist(); closeLayers(); renderPoliciesPage();
    }
    if (action === 'new-alert-rule') openModal('alertRule');
    if (action === 'edit-alert-rule') openModal('alertRule', {id: el.dataset.id});
    if (action === 'alert-toggle') {
      const r = state.alertRules.find(x => x.id === el.dataset.id);
      if (r) { r.enabled = !r.enabled; persist(); renderAlertsPage(); toast(r.enabled ? '告警规则已启用' : '告警规则已停用'); }
    }
    if (action === 'save-alert-rule') {
      if (!validate(['alName', 'alThreshold'])) return;
      const name = $('[name="alName"]', modalLayer)?.value.trim();
      const metric = $('[name="alMetric"]', modalLayer)?.value;
      const threshold = $('[name="alThreshold"]', modalLayer)?.value.trim();
      const windowLabel = $('[name="alWindow"]', modalLayer)?.value.trim() || '5 分钟';
      const severity = $('[name="alSeverity"]', modalLayer)?.value;
      const dept = $('[name="alDept"]', modalLayer)?.value || '全部部门';
      const id = el.dataset.id;
      if (id) {
        const r = state.alertRules.find(x => x.id === id);
        if (r) {
          Object.assign(r, {name, metric, threshold, window: windowLabel, severity, depts:[dept]});
          delete r.workspaces;
        }
        toast('告警规则已更新');
      } else {
        state.alertRules.push({id:`al-${Date.now()}`, name, metric, threshold, window: windowLabel, severity, depts:[dept], channels:['通知中心'], enabled:true, lastFired:'—'});
        toast('告警规则已创建');
      }
      persist(); closeLayers(); renderAlertsPage();
    }
    if (action === 'toggle') el.classList.toggle('on');
    if (action === 'route-toggle') {
      const r = state.routes.find(x => x.id === el.dataset.id);
      if (!r) return;
      r.on = !r.on;
      persist();
      toast(`${r.gateway ? '标准入口' : '追加路径'}已${r.on ? '启用' : '停用'}`);
      if (currentPage() === 'routes') {
        if (window.render) window.render('routes');
        setTimeout(enhanceView, 0);
      } else if (String($('#page-content')?.dataset.enhanced || '').startsWith('detail-route')) {
        openDetail('route', r.id);
      } else {
        el.classList.toggle('on', r.on);
      }
      return;
    }
    if (action === 'test-model') {
      const editing = getEditingModel();
      const fields = readSourceProbeFields();
      const required = ['protocolType','providerName','sourceModelName','baseUrl'];
      if (!(editing && sourceHasStoredCredential(editing) && !fields.apiKey)) required.push('upstreamApiKey');
      if (!validate(required)) return;
      el.classList.add('x-loading');
      el.disabled = true;
      showConnectResult(false, '正在探测上游…', null);
      probeWizardSource(fields, editing).then(probe => {
        state.lastSourceProbe = { ...fields, probe, at: Date.now() };
        showConnectResult(true, probe.message || '上游连通性校验通过', probe.latencyMs, probe);
        const costHint = formatProbeCostHint(probe);
        toast(costHint ? `上游探测通过 · ${probe.latencyMs || '—'} ms · ${costHint}` : `上游探测通过 · ${probe.latencyMs || '—'} ms`);
        afterProbeRecorded(probe);
      }).catch(err => {
        state.lastSourceProbe = null;
        showConnectResult(false, err.message || '探测失败', err.probe?.latencyMs, err.probe);
        toast(err.message || '上游探测失败');
      }).finally(() => {
        el.classList.remove('x-loading');
        el.disabled = false;
      });
      return;
    }
    if (action === 'model-next') {
      const editing = getEditingModel();
      if (state.modalStep === 1) {
        if (!state.services.length) { toast('请先创建模型服务'); return; }
        const fields = readSourceProbeFields();
        const required = ['protocolType','providerName','sourceModelName','proxyServiceRef','baseUrl'];
        if (!(editing && sourceHasStoredCredential(editing) && !fields.apiKey)) required.push('upstreamApiKey');
        if (!validate(required)) return;
        const serviceRef = $('[name="proxyServiceRef"]',modalLayer).value;
        const bound = state.services.find(s => s.id === serviceRef);
        const writeDraft = (probe) => {
          sessionStorage.setItem('modelDraft', JSON.stringify({
            protocol:$('[name="protocolType"]',modalLayer).value || editing?.protocol || '',
            provider:$('[name="providerName"]',modalLayer).value || editing?.provider || '',
            baseUrl: fields.baseUrl || editing?.baseUrl || '',
            sourceModel: fields.sourceModel || editing?.sourceModel || '',
            proxyServiceRef: serviceRef || editing?.serviceRef || '',
            proxyService: bound ? `${bound.name} · ${bound.serviceId}` : '',
            serviceId: bound?.serviceId || editing?.serviceId || '',
            serviceName: bound?.name || editing?.name || '',
            upstreamApiKey: fields.apiKey || '',
            reuseStoredApiKey: !!(editing && sourceHasStoredCredential(editing) && !fields.apiKey),
            region:$('[name="region"]',modalLayer)?.value || editing?.region || '华东（上海）',
            healthCheck:$('[name="healthCheck"]',modalLayer)?.value || editing?.healthCheck || '每 30 秒',
            timeout: fields.timeout || editing?.timeout || 30,
            concurrency: Number($('[name="concurrency"]',modalLayer)?.value || editing?.concurrency || 500),
            retries: Number($('[name="retries"]',modalLayer)?.value || editing?.retries || 2),
            circuit: Number($('[name="circuit"]',modalLayer)?.value || editing?.circuit || 5),
            probe
          }));
          state.modalStep = 2;
          $('#x-model-panel').innerHTML = modelStep(state.modalStep);
          updateModelStepUI();
          updateCapabilityCount();
        };
        const canReuseConnection = editing
          && sourceHasStoredCredential(editing)
          && !connectionFieldsChanged(editing, fields);
        if (canReuseConnection) {
          const probe = editing.lastProbe || state.lastSourceProbe?.probe || { ok: true, message: '沿用已缓存上游凭证', latencyMs: null };
          state.lastSourceProbe = { ...fields, probe, at: Date.now(), reused: true };
          showConnectResult(true, '连接信息未改动，已沿用系统缓存的上游凭证', probe.latencyMs);
          writeDraft(probe);
          return;
        }
        const nextBtn = el;
        nextBtn.classList.add('x-loading');
        nextBtn.disabled = true;
        showConnectResult(false, '进入下一步前正在探测上游…', null);
        probeWizardSource(fields, editing).then(probe => {
          state.lastSourceProbe = { ...fields, probe, at: Date.now() };
          showConnectResult(true, probe.message || '上游连通性校验通过', probe.latencyMs, probe);
          writeDraft(probe);
          afterProbeRecorded(probe);
          const costHint = formatProbeCostHint(probe);
          if (costHint) toast(costHint);
        }).catch(err => {
          state.lastSourceProbe = null;
          showConnectResult(false, err.message || '探测失败', err.probe?.latencyMs, err.probe);
          toast(err.message || '上游探测失败，无法继续');
        }).finally(() => {
          nextBtn.classList.remove('x-loading');
          nextBtn.disabled = false;
        });
        return;
      }
      if (state.modalStep === 2) {
        const selects = $$('.x-cap-select', modalLayer);
        if (selects.some(x=>!x.value)) { $('#x-cap-error')?.classList.add('show'); updateCapabilityCount(); return; }
        const counts = {supported:0,limited:0,unsupported:0};
        selects.forEach(x=>counts[x.value]++);
        const custom = $('[name="customCapabilities"]', modalLayer)?.value || '';
        sessionStorage.setItem('modelCapabilityCounts',JSON.stringify(counts));
        sessionStorage.setItem('modelCapabilities',JSON.stringify(Object.fromEntries(selects.map(x=>[x.dataset.capability,x.value]))));
        sessionStorage.setItem('modelCustomCapabilities', custom);
      }
      if (state.modalStep === 3) {
        const packed = collectPricingFromWizard();
        if (!packed) return;
        sessionStorage.setItem('modelPrices', JSON.stringify(packed));
      }
      if (state.modalStep < 4) {
        state.modalStep++;
        $('#x-model-panel').innerHTML=modelStep(state.modalStep);
        updateModelStepUI();
        if (state.modalStep === 2) updateCapabilityCount();
        if (state.modalStep === 3) refreshPricingPreview();
      }
      else {
        runModelWizardSave(el);
      }
      return;
    }
    if (action === 'model-save') {
      if (!captureModelWizardStep()) return;
      runModelWizardSave(el);
      return;
    }
    if (action === 'service-hosting-filter') {
      state.serviceHostingFilter = el.dataset.filter || '全部';
      renderServicesPage();
      return;
    }
    if (action === 'policy-hosting-filter') {
      state.policyHostingFilter = el.dataset.filter || '全部';
      renderPoliciesPage();
      return;
    }
    if (action === 'save-service') {
      if (!validate(['serviceName','serviceId'])) return;
      const name = $('[name="serviceName"]', modalLayer).value.trim();
      const serviceId = $('[name="serviceId"]', modalLayer).value.trim().toLowerCase().replace(/\s+/g, '-');
      const hosting = $('[name="serviceHosting"]:checked', modalLayer)?.value === 'local' ? 'local' : 'saas';
      const modality = $('[name="serviceModality"]', modalLayer)?.value || '对话 / 推理';
      const protocol = $('[name="serviceProtocol"]', modalLayer)?.value || '';
      const desc = $('[name="serviceDesc"]', modalLayer)?.value || '';
      const editingId = el.dataset.serviceId || '';
      const existing = editingId ? state.services.find(s => s.id === editingId) : null;
      if (!existing && state.services.some(s => s.serviceId === serviceId)) { toast('服务标识已存在，请更换'); return; }
      const finishLocal = (item, created) => {
        if (existing) {
          Object.assign(existing, item);
        } else {
          state.services.unshift(item);
        }
        persist();
        closeLayers();
        toast(created
          ? `模型服务 ${name}（${serviceId} · ${hostingLabel(hosting)}）已创建，请手动添加源模型`
          : `模型服务 ${name} 已更新（${hostingLabel(hosting)}）`);
        if (window.render) window.render('model-services');
        setTimeout(enhanceView, 0);
      };
      if (existing) {
        const patch = {
          name, hosting, modality, protocol, desc,
          enabled: $('[name="serviceEnabled"]', modalLayer)?.value !== '0'
        };
        adminFetch(`/admin/services/${existing.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
          .then(remote => finishLocal({ ...existing, ...patch, ...remote }, false))
          .catch(() => finishLocal({ ...existing, ...patch }, false));
      } else {
        const localItem = {
          id: `svc-${Date.now()}`,
          name, serviceId, hosting, modality, protocol, desc,
          status: '已发布', strategy: 'fixed', enabled: true
        };
        adminFetch('/admin/services', {
          method: 'POST',
          body: JSON.stringify({ name, serviceId, hosting, modality, protocol, desc })
        }).then(remote => {
          state.gatewayOnline = true;
          finishLocal({ ...localItem, ...remote, serviceId: remote.serviceId || serviceId }, true);
          return syncGatewayCatalog();
        }).catch(() => finishLocal(localItem, true));
      }
    }
    if (action === 'model-prev' && state.modalStep > 1) {
      state.modalStep--;
      $('#x-model-panel').innerHTML=modelStep(state.modalStep);
      updateModelStepUI();
      if (state.modalStep === 2) updateCapabilityCount();
      if (state.modalStep === 3) refreshPricingPreview();
    }
    if (action === 'next' || action === 'prev') {
      /* 路由已改为单页表单；向导步进仅保留给其他流程 */
    }
    if (action === 'save-model') { if(!validate(['modelName','baseUrl']))return; closeLayers();toast('模型服务已接入，健康检查已启动'); }
    if (action === 'save-kms') {
      if (!validate(['kmsName','kmsSecret'])) return;
      const name = $('[name="kmsName"]', modalLayer).value.trim();
      if (kmsKeys().some(k => k.name === name)) { toast('密钥别名已存在'); return; }
      const secret = $('[name="kmsSecret"]', modalLayer).value.trim();
      const key = {
        id: `kms-${Date.now()}`,
        type: 'kms',
        kind: 'upstream',
        name,
        mask: maskSecret(secret),
        purpose: $('[name="kmsPurpose"]', modalLayer)?.value.trim() || '上游模型访问凭证',
        algorithm: $('[name="kmsAlgorithm"]', modalLayer)?.value || 'AES-256-GCM',
        provider: $('[name="kmsProvider"]', modalLayer)?.value || '其他',
        rotated: nowDateTime(),
        status: '健康',
        created: nowDateTime()
      };
      state.keys.unshift(key);
      persist();
      closeLayers();
      toast(`${name} 已托管到 KMS`);
      state.securityTab = 'kms';
      state.selectedKeyId = key.id;
      state.securityDetailTab = 'overview';
      if (window.render) window.render('security-kms');
      setTimeout(enhanceView, 0);
    }
    if (action === 'save-role') {
      if (!validate(['roleName'])) return;
      const roleId = el.dataset.roleId || '';
      const name = $('[name="roleName"]', modalLayer).value.trim();
      const scope = $('[name="roleScope"]', modalLayer)?.value || '全局';
      const desc = $('[name="roleDesc"]', modalLayer)?.value.trim() || '';
      let perms = collectRolePerms();
      if (perms.includes('cap.all_features')) perms = allPermissionIds.slice();
      if (!perms.length) { toast('请至少勾选一项权限'); return; }
      const existing = roleId ? findRoleDef(roleId) : null;
      if (isSuperAdminRole(existing)) { toast('超级管理员权限不可编辑'); return; }
      if (!existing && state.roleDefs.some(r => r.name === name)) { toast('角色名称已存在'); return; }
      if (existing) {
        const oldName = existing.name;
        if (!existing.builtin) existing.name = name;
        existing.scope = scope;
        existing.desc = desc;
        existing.perms = perms;
        if (oldName !== existing.name) {
          state.members.forEach(m => { if (m.role === oldName) m.role = existing.name; });
        }
        persist();
        closeLayers();
        toast(`${existing.name} 权限已更新`);
      } else {
        state.roleDefs.push({
          id: `role-${Date.now()}`,
          name,
          scope,
          desc,
          builtin: false,
          locked: false,
          members: 0,
          perms
        });
        persist();
        closeLayers();
        toast(`${name} 已创建`);
      }
      syncIdentitySwitcher({ forceShell: true });
      refreshAccessPage();
    }
    if (action === 'select-key' || action === 'open-key-detail') {
      if (action === 'select-key' && e.target.closest('[data-stop]')) return;
      const key = state.keys.find(k => k.id === el.dataset.id);
      if (key?.type === 'api' && !canViewGlobalKeyReports() && !isApiKeyOwner(key)) {
        toast('无权查看其他用户的 API Key');
        return;
      }
      state.selectedKeyId = el.dataset.id;
      state.securityDetailTab = 'overview';
      if (key?.type === 'api') openDetail('apikey', key.id);
      else if (key) openDetail('kmskey', key.id);
    }
    if (action === 'toggle-key-check') {
      e.stopPropagation();
      const id = el.dataset.id;
      const set = new Set(state.selectedKeyIds || []);
      if (el.checked) set.add(id); else set.delete(id);
      state.selectedKeyIds = [...set];
      refreshSecurityChecks();
    }
    if (action === 'toggle-all-keys') {
      state.selectedKeyIds = el.checked ? securityList().map(k => k.id) : [];
      $$('[data-x="toggle-key-check"]').forEach(box => { box.checked = el.checked; });
      refreshSecurityChecks();
    }
    if (action === 'batch-update-keys') {
      if (!checkedSecurityKeys().length) { toast('请先勾选要更新的明细'); return; }
      state.batchKeyMode = 'selected';
      openModal('editApiKey', {});
    }
    if (action === 'update-all-keys') {
      if (!apiKeys().length) { toast('暂无 API Key'); return; }
      state.batchKeyMode = 'all';
      openModal('editApiKey', {});
    }
    if (action === 'batch-rotate-keys') {
      toast('当前版本暂不开放密钥托管能力');
      return;
    }
    if (action === 'security-detail-tab') {
      state.securityDetailTab = el.dataset.tab || 'overview';
      if (String($('#page-content')?.dataset.enhanced || '').startsWith('detail-')) renderKeyDetailPanel();
      else refreshSecurityDetail();
    }
    if (action === 'new-api-key') {
      if (isDeveloperProfile()) {
        if (!KEY_APPROVAL_ENABLED) openPersonalKeyIssue();
        else {
          openModal('applyKey', { scene: 'personal' });
          setTimeout(updateKeyQuotaPanel, 0);
        }
        return;
      }
      state.securityTab = 'api';
      state.batchKeyMode = 'single';
      const openPicker = () => openModal('keyScene');
      if (currentPage() !== 'security-api' && window.render) {
        window.render('security-api');
        setTimeout(() => { enhanceView(); openPicker(); }, 0);
      } else openPicker();
    }
    if (action === 'new-personal-key' || action === 'new-app-key') {
      const scene = action === 'new-personal-key' ? 'personal' : 'app';
      if (isDeveloperProfile()) {
        if (scene === 'app') { toast('普通用户仅可开通个人 Key'); return; }
        if (!KEY_APPROVAL_ENABLED) openPersonalKeyIssue();
        else {
          openModal('applyKey', { scene: 'personal' });
          setTimeout(updateKeyQuotaPanel, 0);
        }
        return;
      }
      state.securityTab = 'api';
      state.issueKeyScene = scene;
      state.batchKeyMode = 'single';
      const openIssue = () => openModal('key', { scene });
      if (currentPage() !== 'security-api' && window.render) {
        window.render('security-api');
        setTimeout(() => { enhanceView(); openIssue(); }, 0);
      } else openIssue();
      setTimeout(updateKeyQuotaPanel, 0);
      return;
    }
    if (action === 'issue-key-scene') {
      const scene = el.dataset.scene === 'personal' ? 'personal' : 'app';
      state.issueKeyScene = scene;
      openModal('key', { scene });
      setTimeout(updateKeyQuotaPanel, 0);
      return;
    }
    if (action === 'back-key-scene') {
      openModal('keyScene');
      return;
    }
    if (action === 'switch-apply-scene') {
      openModal('applyKey', { scene: el.dataset.scene === 'app' ? 'app' : 'personal' });
      setTimeout(updateKeyQuotaPanel, 0);
      return;
    }
    if (action === 'apply-api-key') {
      if (!KEY_APPROVAL_ENABLED) {
        openPersonalKeyIssue();
        return;
      }
      openModal('applyKey', { scene: 'personal' });
      setTimeout(updateKeyQuotaPanel, 0);
      return;
    }
    if (action === 'security-key-scene') {
      state.securityKeyScene = el.dataset.scene || 'all';
      renderSecurityPage();
      return;
    }
    if (action === 'view-key-apply') {
      if (!KEY_APPROVAL_ENABLED) { toast('审批流程已暂时关闭'); return; }
      openModal('reviewKeyApply', { id: el.dataset.id });
      return;
    }
    if (action === 'save-key-apply') {
      if (!KEY_APPROVAL_ENABLED) {
        toast('审批流程已暂时关闭，请直接开通个人 Key');
        openPersonalKeyIssue();
        return;
      }
      if (!state.services.length) { toast('请先联系管理员创建模型服务'); return; }
      if (!validate(['keyName', 'keyPurpose']) || !validateKeyServices()) return;
      const me = currentIdentity();
      const keyKind = $('[name="keyKind"]', modalLayer)?.value === 'app' ? 'app' : 'personal';
      if (keyKind === 'app' && isDeveloperProfile()) {
        toast('普通用户仅可申请个人 Key');
        return;
      }
      if (keyKind === 'app') {
        const callerName = $('[name="callerName"]', modalLayer)?.value.trim() || '';
        if (!callerName) {
          toast('应用 Key 请填写调用方名称');
          return;
        }
      }
      const limitMode = $('[name="keyLimitMode"]', modalLayer)?.value || 'both';
      const refs = collectKeyServiceRefs();
      const { level: orgLevel, orgId, org } = readOrgSelectionFromForm();
      if (!orgId) { toast('请选择归属组织'); return; }
      const app = {
        id: `app-${Date.now()}`,
        keyKind,
        name: $('[name="keyName"]', modalLayer).value.trim(),
        applicantId: me.id,
        applicantName: me.name,
        dept: me.dept,
        orgLevel,
        orgId,
        orgName: org?.name || '',
        billingDept: org?.dept || me.dept,
        callerName: keyKind === 'app' ? ($('[name="callerName"]', modalLayer)?.value.trim() || '') : '',
        purpose: $('[name="keyPurpose"]', modalLayer).value.trim(),
        serviceRefs: refs,
        services: formatKeyServiceRefs(refs),
        limitMode,
        window: $('[name="keyWindow"]', modalLayer)?.value || '每天',
        maxInTokens: limitMode === 'spend' ? '' : ($('[name="keyMaxIn"]', modalLayer)?.value || ''),
        maxOutTokens: limitMode === 'spend' ? '' : ($('[name="keyMaxOut"]', modalLayer)?.value || ''),
        maxSpend: limitMode === 'token' ? '' : ($('[name="keyMaxSpend"]', modalLayer)?.value || ''),
        overLimit: $('[name="keyOverLimit"]', modalLayer)?.value || '立即拒绝并返回 429',
        status: '待审批',
        created: nowDateTime(),
        note: ''
      };
      const expiryApply = readKeyExpiryFromForm({ expirePreset: keyKind === 'personal' ? '90d' : '365d' });
      if (expiryApply.invalid) { toast('请选择自定义到期日'); return; }
      app.expirePreset = expiryApply.expirePreset;
      app.expiresAt = expiryApply.expiresAt;
      state.keyApplications.unshift(app);
      persist();
      closeLayers();
      toast(`已提交${keyKindLabel(keyKind)} Key 申请「${app.name}」，等待管理员审批`);
      if (window.render) {
        window.render('security-api');
        setTimeout(enhanceView, 0);
      }
      return;
    }
    if (action === 'approve-key-apply') {
      if (!KEY_APPROVAL_ENABLED) { toast('审批流程已暂时关闭'); return; }
      const app = (state.keyApplications || []).find(a => a.id === el.dataset.id);
      if (!app || app.status !== '待审批') { toast('申请不存在或已处理'); return; }
      // 必须在审批弹窗内逐条确认限额，禁止列表一键开通
      const inReviewModal = !!$('[name="quotaConfirmed"]', modalLayer) && modalLayer.classList.contains('open');
      if (!inReviewModal) {
        openModal('reviewKeyApply', { id: app.id });
        toast('请先逐项确认限额策略后再开通');
        return;
      }
      if (!$('[name="quotaConfirmed"]', modalLayer)?.checked) {
        toast('请勾选「已逐项确认限额策略」后再开通');
        return;
      }
      const limitMode = $('[name="keyLimitMode"]', modalLayer)?.value || app.limitMode || 'both';
      const windowLabel = $('[name="keyWindow"]', modalLayer)?.value || app.window || '每天';
      const maxInTokens = limitMode === 'spend' ? '' : ($('[name="keyMaxIn"]', modalLayer)?.value || '');
      const maxOutTokens = limitMode === 'spend' ? '' : ($('[name="keyMaxOut"]', modalLayer)?.value || '');
      const maxSpend = limitMode === 'token' ? '' : ($('[name="keyMaxSpend"]', modalLayer)?.value || '');
      const overLimit = $('[name="keyOverLimit"]', modalLayer)?.value || app.overLimit || '立即拒绝并返回 429';
      const expiry = readKeyExpiryFromForm(app);
      if (expiry.invalid) { toast('请确认 Key 有效期或自定义到期日'); return; }
      if (limitMode !== 'none') {
        const needToken = limitMode === 'token' || limitMode === 'both';
        const needSpend = limitMode === 'spend' || limitMode === 'both';
        if (needToken && !maxInTokens && !maxOutTokens) {
          toast('请至少确认一项 Token 限额，或改为不限制');
          return;
        }
        if (needSpend && !maxSpend) {
          toast('请确认金额限额，或改为不限制');
          return;
        }
      }
      const note = $('[name="approveNote"]', modalLayer)?.value.trim() || '';
      const suffix = Math.random().toString(16).slice(2, 10);
      const plain = `ak_live_${suffix}${Date.now().toString(16).slice(-8)}`;
      const reviewer = currentIdentity();
      const keyKind = app.keyKind === 'app' ? 'app' : 'personal';
      const { level: orgLevel, orgId, org } = readOrgSelectionFromForm();
      let caller = null;
      if (keyKind === 'app') {
        const callerName = app.callerName || `${app.applicantName}应用`;
        caller = {
          id: `caller-${Date.now()}`,
          name: callerName,
          code: generateCallerCode(callerName),
          ownerDept: org?.dept || app.dept || '未分配',
          contact: app.applicantName,
          desc: app.purpose || '',
          status: '启用',
          created: nowDateTime()
        };
        state.callers.unshift(caller);
      }
      const key = assignKeyOwner({
        id: `api-${Date.now()}`,
        type: 'api',
        keyKind,
        name: app.name,
        owner: keyKind === 'personal' ? app.applicantName : (caller?.name || ''),
        callerId: keyKind === 'app' ? (caller?.id || '') : '',
        applicantId: app.applicantId,
        applicantName: app.applicantName,
        ownerMemberId: app.applicantId,
        orgLevel: orgLevel || (app.orgLevel === 'enterprise' ? 'enterprise' : 'dept'),
        orgId: orgId || app.orgId || '',
        orgName: org?.name || app.orgName || '',
        billingDept: org?.dept || app.billingDept || app.dept || '',
        serviceRefs: app.serviceRefs || [],
        serviceRef: (app.serviceRefs || [])[0] || '',
        services: app.services || '',
        mask: `ak_live_••••${suffix.slice(-4).toUpperCase()}`,
        limitMode,
        window: windowLabel,
        maxInTokens,
        maxOutTokens,
        maxSpend,
        overLimit,
        expirePreset: expiry.expirePreset,
        expiresAt: expiry.expiresAt,
        usedIn: '0',
        usedOut: '0',
        usedSpend: '0.00',
        status: '健康',
        created: nowDateTime(),
        lastUsed: nowDateTime(),
        rotated: '—',
        approvedBy: reviewer.name,
        purpose: app.purpose || '',
        plainPending: true,
        quotaConfirmedBy: reviewer.name,
        quotaConfirmedAt: nowDateTime()
      }, { memberId: app.applicantId, name: app.applicantName });
      applyKeyBillingFields(key, { org, orgLevel, orgId, memberId: app.applicantId, name: app.applicantName, billingDept: org?.dept || app.dept });
      app.status = '已通过';
      app.note = note;
      app.keyKind = keyKind;
      app.orgLevel = key.orgLevel;
      app.orgId = key.orgId;
      app.orgName = key.orgName;
      app.billingDept = key.billingDept;
      app.expirePreset = expiry.expirePreset;
      app.expiresAt = expiry.expiresAt;
      app.reviewedBy = reviewer.name;
      app.reviewedAt = nowDateTime();
      app.issuedKeyId = key.id;
      app.approvedLimitMode = limitMode;
      app.approvedWindow = windowLabel;
      app.approvedMaxInTokens = maxInTokens;
      app.approvedMaxOutTokens = maxOutTokens;
      app.approvedMaxSpend = maxSpend;
      app.approvedOverLimit = overLimit;
      storeKeySecret(key.id, plain);
      state.keys.unshift(key);
      state.selectedKeyId = key.id;
      state.securityTab = 'api';
      persist();
      state.refreshSecurityOnClose = true;
      modalLayer.classList.add('open');
      modalLayer.setAttribute('aria-hidden', 'false');
      $('#x-modal-content').innerHTML = keyIssuedAdminResult(key);
      toast(`已确认限额并开通${keyKindLabel(keyKind)} Key「${app.name}」`);
      return;
    }
    if (action === 'reject-key-apply') {
      if (!KEY_APPROVAL_ENABLED) { toast('审批流程已暂时关闭'); return; }
      const app = (state.keyApplications || []).find(a => a.id === el.dataset.id);
      if (!app || app.status !== '待审批') { toast('申请不存在或已处理'); return; }
      const note = $('[name="approveNote"]', modalLayer)?.value.trim() || '不符合当前配额策略';
      const reviewer = currentIdentity();
      app.status = '已驳回';
      app.note = note;
      app.reviewedBy = reviewer.name;
      app.reviewedAt = nowDateTime();
      persist();
      closeLayers();
      toast(`已驳回「${app.name}」`);
      if (isSecurityPage()) renderSecurityPage();
      else if (window.render) { window.render('security-api'); setTimeout(enhanceView, 0); }
      return;
    }
    if (action === 'edit-api-key') {
      state.batchKeyMode = 'single';
      openModal('editApiKey', {id: el.dataset.id || state.selectedKeyId});
    }
    if (action === 'reveal-api-key') {
      // 兼容旧按钮：改为直接复制明文，不在页面展示
      el.dataset.keyId = el.dataset.keyId || el.dataset.id;
      action = 'copy-api-key';
    }
    if (action === 'copy-api-key') {
      const keyId = el.dataset.keyId || el.dataset.id || $('#x-new-api-key')?.dataset.keyId || '';
      const key = keyId ? state.keys.find(k => k.id === keyId) : null;
      if (keyId && !key) {
        toast('Key 不存在');
        return;
      }
      const text = keyId ? peekKeySecret(keyId) : '';
      if (!text) {
        toast('本机未保存明文，无法复制（请重新签发）');
        return;
      }
      copyTextToClipboard(text).then(ok => {
        toast(ok ? '明文 Key 已复制到剪贴板（页面仍只显示掩码）' : '复制失败，请检查浏览器剪贴板权限');
      });
      return;
    }
    if (action === 'save-key') {
      if (!state.services.length) { toast('请先创建模型服务'); return; }
      const keyKind = $('[name="keyKind"]', modalLayer)?.value === 'personal' ? 'personal' : 'app';
      if (keyKind === 'app') {
        if (!validate(['keyName', 'callerName']) || !validateKeyServices()) return;
      } else {
        if (!validate(['keyName']) || !validateKeyServices()) return;
        if (!$('[name="keyOwnerMemberId"]', modalLayer)?.value) {
          toast('请选择使用员工');
          return;
        }
      }
      const name = $('[name="keyName"]', modalLayer).value.trim();
      const limitMode = $('[name="keyLimitMode"]', modalLayer)?.value || 'both';
      const windowLabel = $('[name="keyWindow"]', modalLayer)?.value || '每天';
      const expiry = readKeyExpiryFromForm({ expirePreset: keyKind === 'personal' ? '90d' : '365d' });
      if (expiry.invalid) { toast('请选择自定义到期日'); return; }
      const suffix = Math.random().toString(16).slice(2, 10);
      let plain = `ak_live_${suffix}${Date.now().toString(16).slice(-8)}`;
      const { level: orgLevel, orgId, org } = readOrgSelectionFromForm();
      if (!orgId) { toast('请选择归属组织'); return; }
      const key = {
        id: `api-${Date.now()}`,
        type: 'api',
        keyKind,
        name,
        owner: '',
        callerId: '',
        orgLevel,
        orgId,
        orgName: org?.name || '',
        billingDept: '',
        serviceRefs: [],
        serviceRef: '',
        services: '',
        mask: `ak_live_••••${suffix.slice(-4).toUpperCase()}`,
        limitMode,
        window: windowLabel,
        maxInTokens: limitMode === 'spend' ? '' : ($('[name="keyMaxIn"]', modalLayer)?.value || ''),
        maxOutTokens: limitMode === 'spend' ? '' : ($('[name="keyMaxOut"]', modalLayer)?.value || ''),
        maxSpend: limitMode === 'token' ? '' : ($('[name="keyMaxSpend"]', modalLayer)?.value || ''),
        overLimit: $('[name="keyOverLimit"]', modalLayer)?.value || '立即拒绝并返回 429',
        expirePreset: expiry.expirePreset,
        expiresAt: expiry.expiresAt,
        usedIn: '0',
        usedOut: '0',
        usedSpend: '0.00',
        status: '健康',
        created: nowDateTime(),
        lastUsed: nowDateTime(),
        rotated: '—',
        plainPending: true
      };
      if (keyKind === 'app') {
        if (!applyKeyCallerSelection(key, { createOnly: true })) return;
        applyKeyServiceSelection(key);
        const caller = resolveCaller(key);
        if (org?.dept && caller) caller.ownerDept = org.dept;
        assignKeyOwner(key, { name: caller?.contact || $('[name="callerContact"]', modalLayer)?.value.trim() });
        applyKeyBillingFields(key, { org, orgLevel, orgId, billingDept: org?.dept || caller?.ownerDept });
      } else {
        applyKeyServiceSelection(key);
        const memberId = $('[name="keyOwnerMemberId"]', modalLayer)?.value || '';
        const member = state.members.find(m => m.id === memberId);
        assignKeyOwner(key, { memberId, name: member?.name });
        key.owner = member?.name || '';
        key.callerId = '';
        applyKeyBillingFields(key, { org, orgLevel, orgId, member, billingDept: org?.dept || member?.dept });
      }
      const finishIssue = (finalPlain, curlExample) => {
        const secret = finalPlain || plain;
        storeKeySecret(key.id, secret);
        // 与网关列表合并，避免重复行
        const idx = state.keys.findIndex(k => k.id === key.id);
        if (idx >= 0) state.keys[idx] = { ...state.keys[idx], ...key, type: 'api' };
        else state.keys.unshift(key);
        state.selectedKeyId = key.id;
        state.securityTab = 'api';
        state.securityKeyScene = 'all';
        state.securityDetailTab = 'overview';
        persist();
        state.refreshSecurityOnClose = true;
        $('#x-modal-content').innerHTML = keyOwnerRevealResult(key, secret, curlExample || '');
        modalLayer.classList.add('open');
        modalLayer.setAttribute('aria-hidden', 'false');
        toast(`${keyKindLabel(keyKind)} Key「${name}」已开通（页面仅显示掩码）`);
        copyTextToClipboard(secret).then(ok => {
          if (ok) toast('明文 Key 已自动复制到剪贴板');
        });
      };
      adminFetch('/admin/keys', {
        method: 'POST',
        body: JSON.stringify({
          keyKind,
          name,
          owner: key.owner || key.applicantName || '',
          ownerMemberId: key.ownerMemberId || '',
          orgLevel: key.orgLevel,
          orgId: key.orgId,
          orgName: key.orgName,
          billingDept: key.billingDept,
          serviceRefs: key.serviceRefs && key.serviceRefs.length ? key.serviceRefs : state.services.map(s => s.id),
          limitMode: key.limitMode,
          window: key.window,
          maxInTokens: key.maxInTokens,
          maxOutTokens: key.maxOutTokens,
          maxSpend: key.maxSpend,
          overLimit: key.overLimit,
          expirePreset: key.expirePreset,
          expiresAt: key.expiresAt
        })
      }).then(remote => {
        state.gatewayOnline = true;
        if (remote.id) key.id = remote.id;
        if (remote.mask) key.mask = remote.mask;
        if (remote.plaintext) plain = remote.plaintext;
        key.gatewaySynced = true;
        // 先落明文，再同步目录，避免同步后找不到 secret
        storeKeySecret(key.id, remote.plaintext || plain);
        return syncGatewayCatalog().then(() => {
          finishIssue(remote.plaintext || plain, remote.curlExample || '');
        });
      }).catch(() => {
        finishIssue(plain, '');
        toast('网关未连通：Key 仅保存在浏览器，无法被 8787 调用');
      });
    }
    if (action === 'update-api-key') {
      const mode = state.batchKeyMode || 'single';
      if (mode === 'single' && (!validate(['callerName']) || !validateKeyServices())) return;
      const limitMode = $('[name="keyLimitMode"]', modalLayer)?.value || 'both';
      const expiry = readKeyExpiryFromForm();
      if (expiry.invalid) { toast('请选择自定义到期日'); return; }
      const patch = {
        limitMode,
        window: $('[name="keyWindow"]', modalLayer)?.value || '每天',
        maxInTokens: limitMode === 'spend' ? '' : ($('[name="keyMaxIn"]', modalLayer)?.value || ''),
        maxOutTokens: limitMode === 'spend' ? '' : ($('[name="keyMaxOut"]', modalLayer)?.value || ''),
        maxSpend: limitMode === 'token' ? '' : ($('[name="keyMaxSpend"]', modalLayer)?.value || ''),
        overLimit: $('[name="keyOverLimit"]', modalLayer)?.value || '立即拒绝并返回 429',
        expirePreset: expiry.expirePreset,
        expiresAt: expiry.expiresAt,
        rotated: nowDateTime()
      };
      if (mode === 'single') {
        if (!applyKeyCallerSelection(patch)) return;
        applyKeyServiceSelection(patch);
      }
      let targets = [];
      if (mode === 'all') targets = apiKeys();
      else if (mode === 'selected') targets = checkedSecurityKeys();
      else {
        const key = state.keys.find(k => k.id === state.editingApiKeyId);
        if (key) targets = [key];
      }
      targets.forEach(key => Object.assign(key, patch));
      if (targets[0]) state.selectedKeyId = targets[0].id;
      state.securityTab = 'api';
      persist();
      closeLayers();
      state.batchKeyMode = 'single';
      toast(mode === 'all'
        ? `已全量更新 ${targets.length} 条限额`
        : mode === 'selected'
          ? `已批量更新 ${targets.length} 条限额`
          : `${targets[0]?.name || 'API Key'} 限额已更新`);
      if (String($('#page-content')?.dataset.enhanced || '') === 'detail-apikey' && targets[0]) {
        openDetail('apikey', targets[0].id);
      } else if (isSecurityPage()) renderSecurityPage();
      else if (window.render) { window.render('security-api'); setTimeout(enhanceView, 0); }
    }
    if (action === 'save-edit') {
      /* 编辑已统一到四步向导，由 model-next 最终步保存 */
    }
    if (action === 'download') downloadExport(el.dataset.kind);
    if (action === 'set-grain') {
      applyGrain(el.dataset.grainTarget || 'usage', el.dataset.grain || 'day');
      return;
    }
    if (action === 'usage-tab') {
      // 用量 / 费用已同页合并，保留动作兼容旧按钮
      renderUsagePage();
      return;
    }
    if (action === 'ov-period') {
      syncOverviewWithUsageFilters(el.dataset.period || '今日');
      state.overviewRefreshedAt = Date.now();
      renderOverviewPage();
      return;
    }
    if (action === 'ov-period-custom') {
      syncOverviewWithUsageFilters('近 30 天');
      state.overviewRefreshedAt = Date.now();
      renderOverviewPage();
      toast('已切换近 30 天；总览与用量页共用该时间口径');
      return;
    }
    if (action === 'ov-chart-range') {
      syncOverviewWithUsageFilters(overviewPeriodFromChartRange(el.dataset.range || '24H'));
      state.overviewRefreshedAt = Date.now();
      renderOverviewPage();
      return;
    }
    if (action === 'ov-rank-metric') {
      state.overviewRankMetric = el.dataset.metric === 'tokens' ? 'tokens' : 'cost';
      renderOverviewPage();
      return;
    }
    if (action === 'ov-refresh') {
      state.overviewRefreshedAt = Date.now();
      syncGatewayCatalog().finally(() => {
        renderOverviewPage();
        toast('运营指标已刷新');
      });
      return;
    }
    if (action === 'ov-auto-refresh') {
      state.overviewAutoRefresh = !!el.checked;
      setupOverviewAutoRefresh();
      toast(state.overviewAutoRefresh ? '已开启自动刷新' : '已关闭自动刷新');
      return;
    }
    if (action === 'ov-export') {
      openModal('export', { kind: '运营报表' });
      return;
    }
    if (action === 'copy-key-curl') {
      const box = $('#x-key-curl');
      const keyId = el.dataset.keyId || $('#x-new-api-key')?.dataset.keyId || '';
      let text = '';
      try { text = decodeURIComponent(box?.dataset.fullCurl || ''); } catch { text = ''; }
      if (!text && keyId && peekKeySecret(keyId)) text = gatewayCurlForKey(state.keys.find(k => k.id === keyId) || { id: keyId }, peekKeySecret(keyId));
      if (!text) text = box?.value || '';
      if (!text) { toast('暂无 curl 示例'); return; }
      copyTextToClipboard(text).then(ok => toast(ok ? 'curl（含明文 Key）已复制' : '复制失败，请手动选中示例'));
      return;
    }
    if (action === 'copy-call-guide') {
      const sample = `POST /personal/v1/chat/completions
Host: 127.0.0.1:8787
Authorization: Bearer <个人_API_Key>
X-User-Id: u_55e2cf
X-Org-Dept: 客户服务

{"model":"demo-chat","messages":[{"role":"user","content":"你好"}]}`;
      navigator.clipboard?.writeText(sample);
      toast('个人 · 本地网关 调用示例已复制');
      return;
    }
    if (action === 'cost-dim') {
      const dim = el.dataset.dim || 'org';
      state.costDim = ['org', 'app', 'service'].includes(dim) ? dim : 'org';
      refreshUsageViews();
      return;
    }
    if (action === 'reset-usage-filter' || action === 'reset-billing-filter') {
      const keepGrain = state.usageFilters?.grain || 'day';
      state.usageFilters = {
        period: defaultPeriodForGrain(keepGrain),
        grain: keepGrain,
        key: '', service: '', source: '', keyKind: '', dept: '', orgLevel: '', app: '',
        customStart: '', customEnd: ''
      };
      state.costDim = 'org';
      ensureCustomRangeDefaults();
      syncBillingFiltersFromUsage();
      resetUsageDetailPager();
      renderUsagePage();
      if (drawerLayer.classList.contains('open') && $('#x-drawer-title')?.textContent?.includes('高级筛选')) {
        openDrawer('usage-filter');
      }
      toast('已重置筛选条件');
    }
    if (action === 'usage-detail-prev') {
      const pager = ensureUsageDetailPager();
      if (pager.page > 1) {
        pager.page -= 1;
        refreshUsageViews();
      }
      return;
    }
    if (action === 'usage-detail-next') {
      const pager = ensureUsageDetailPager();
      const total = filteredUsageDetailRows().length;
      const pageCount = Math.max(1, Math.ceil(total / pager.pageSize) || 1);
      if (pager.page < pageCount) {
        pager.page += 1;
        refreshUsageViews();
      }
      return;
    }
    if (action === 'reset-usage-detail-filter') {
      resetUsageDetailLocalFilters();
      refreshUsageViews();
      toast('已重置明细筛选');
      return;
    }
    if (action === 'reset-audit-filter') {
      state.auditFilters = { period: '最近 24 小时', result: '', keyword: '', customStart: '', customEnd: '' };
      ensureCustomRangeDefaults(state.auditFilters);
      renderAuditPage();
      toast('已重置审计筛选');
    }
    if (action === 'export-usage-detail') {
      const rows = isUsageDetailPage() ? filteredUsageDetailRows() : filteredUsageDetails();
      const total = rows.reduce((sum, row) => sum + row.cost, 0);
      const header = '日期,组织层级,归属组织,主体类型,密钥名称,密钥别名,应用或个人,所有者,付款部门,模型服务名称,服务标识,源模型服务名称,输入Token用量,输入单价,输出Token用量,输出单价,缓存命中百分比,费用\n';
      const body = rows.map(row => [
        row.dateLabel || formatFullDate(row.date || rowDateFromDaysAgo(row.daysAgo)),
        row.orgLevelLabel || orgLevelLabel(row.orgLevel), row.orgName || '—',
        row.keyKindLabel || keyKindLabel(row.keyKind),
        row.keyName, row.keyAlias, row.subjectLabel || row.appName || '—', row.ownerName || '—', row.billingDept || '—',
        row.serviceName, row.serviceId, row.sourceName,
        formatTokensM(row.inTokensM), formatMoney(row.inPrice),
        formatTokensM(row.outTokensM), row.outPrice ? formatMoney(row.outPrice) : '—',
        `${row.cache}%`, formatMoney(row.cost)
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
      const footer = `\n"费用总计","","","","","","","","","","","","${formatTokensM(rows.reduce((s,r)=>s+r.inTokensM,0))}","","${formatTokensM(rows.reduce((s,r)=>s+r.outTokensM,0))}","","","${formatMoney(total)}"`;
      const blob = new Blob(['\uFEFF' + header + body + footer], {type:'text/csv;charset=utf-8'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `aegis-usage-detail-${new Date().toISOString().slice(0,10)}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 800);
      toast(`已导出筛选后的 ${rows.length} 条明细，费用总计 ${formatMoney(total)}`);
    }
    if (action === 'export-sources-detail') {
      exportSourceModelsDetail(filteredModels());
      return;
    }
    if (action === 'reset-filter' || action === 'reset-source-filters') {
      state.listFilters = {
        statuses: ['运行中', '观察中', '已停用', '异常'],
        providers: [...SOURCE_PROVIDER_FILTERS],
        region: '全部区域',
        query: '',
        serviceId: '',
        deploy: '全部',
        capability: '全部',
        billing: '全部'
      };
      persistListFilters();
      if (drawerLayer.classList.contains('open') && $('[name="listStatus"]', drawerLayer)) {
        $('#x-drawer-content').innerHTML = filterDrawer();
      }
      applyListFilters({ toastMsg: true });
      return;
    }
    if (action === 'mark-read') { closeLayers(); $('.icon-btn i')?.remove(); toast('通知已全部标为已读'); }
    if (action === 'goto-audit') { closeLayers(); window.render(currentAuditPage()); setTimeout(enhanceView,0); }
    if (action === 'copy-trace') {
      const ev = auditEventById(state.selectedAuditId);
      const trace = (ev?.trace || 'tr_4f9a82c1').replace('…', '82c1');
      navigator.clipboard?.writeText(trace);
      toast('追踪 ID 已复制');
    }
    if (action === 'save-costs') {
      localStorage.setItem('aegis-budget-alert', String(state.budgetAlertThreshold || 80));
      closeLayers();
      toast(`成本规则已保存 · 预算预警阈值 ${state.budgetAlertThreshold || 80}%`);
    }
    if (action === 'apply-rec') { el.textContent='已应用';el.disabled=true;toast('优化建议已应用到草稿策略'); }
    if (action === 'run-sim') simulate();
    if (action === 'rotate-key') {
      const id = el.dataset.id || state.selectedKeyId;
      const key = state.keys.find(k => k.id === id);
      if (!key) return;
      if (key.type === 'kms' || key.type !== 'api') {
        toast('当前版本暂不开放密钥托管能力');
        return;
      }
      el.classList.add('x-loading');
      adminFetch(`/admin/keys/${id}/rotate`, { method: 'POST', body: '{}' })
        .then(remote => {
          key.mask = remote.mask || key.mask;
          key.rotated = remote.rotated || nowDateTime();
          key.status = remote.status || '健康';
          if (remote.plaintext) storeKeySecret(key.id, remote.plaintext);
          persist();
          toast(`${key.name} 虚拟 Key 已轮换，请重新复制明文`);
          if (remote.plaintext) {
            $('#x-modal-content').innerHTML = keyOwnerRevealResult(key, remote.plaintext, remote.curlExample || '');
            modalLayer.classList.add('open');
            modalLayer.setAttribute('aria-hidden', 'false');
            state.refreshSecurityOnClose = true;
            copyTextToClipboard(remote.plaintext);
          } else if (isSecurityPage()) {
            renderSecurityPage();
          }
        })
        .catch(err => toast(err.message || '轮换失败'))
        .finally(() => el.classList.remove('x-loading'));
      return;
    }
    if (action === 'toggle-key' || action === 'suspend-key' || action === 'resume-key') {
      const id = el.dataset.id || state.selectedKeyId;
      const key = state.keys.find(k => k.id === id);
      if (!key) return;
      if (keyStatusLabel(key) === '已吊销') { toast('已吊销的 Key 无法启停'); return; }
      const enable = action === 'resume-key'
        ? true
        : action === 'suspend-key'
          ? false
          : keyStatusLabel(key) === '已停用';
      const path = enable ? `/admin/keys/${id}/resume` : `/admin/keys/${id}/suspend`;
      el.classList.add('x-loading');
      el.disabled = true;
      adminFetch(path, { method: 'POST', body: '{}' })
        .then(() => {
          key.status = enable ? '健康' : '已停用';
          persist();
          toast(enable ? `${key.name} 已启用` : `${key.name} 已停用，网关将拒绝调用`);
          if (isSecurityPage()) {
            if (state.currentDetailKind === 'apikey') openDetail('apikey', id);
            else renderSecurityPage();
          }
        })
        .catch(err => toast(err.message || (enable ? '启用失败' : '停用失败')))
        .finally(() => { el.classList.remove('x-loading'); el.disabled = false; });
      return;
    }
    if (action === 'revoke-key' || action === 'delete-key') {
      const id = el.dataset.id || state.selectedKeyId;
      const key = state.keys.find(k => k.id === id);
      if (!key) return;
      openModal('delete', { kind: 'keys-delete', id, name: key.name, label: '虚拟 Key' });
      return;
    }
    if (action === 'rotate-all' || action === 'batch-rotate-keys') {
      toast('当前版本暂不开放密钥托管能力');
      return;
    }
    if (action === 'row-menu') { const row=el.closest('[data-x-detail]'); if(row){const [k,id]=row.dataset.xDetail.split(':');openDetail(k,id);} }
    if (action === 'back') {
      const backTo = state.returnPage
        || (state.currentDetailKind === 'apikey' ? 'security-api'
          : state.currentDetailKind === 'model' ? 'model-sources'
          : state.currentDetailKind === 'service' ? 'model-services'
          : currentPage());
      state.currentDetailKind = null;
      window.render(backTo);
      setTimeout(enhanceView, 0);
    }
    if (action === 'edit-model') {
      const model = state.models.find(m => m.id === el.dataset.id) || state.models.find(m => m.id === state.currentDetailId);
      if (!model) { toast('未找到源模型'); return; }
      openModal('editModel', {
        ...model,
        focusStep: el.dataset.focus === 'billing' ? 3 : 1
      });
      return;
    }
    if (action === 'edit-current') {
      if (state.currentDetailKind === 'apikey') {
        state.batchKeyMode = 'single';
        openModal('editApiKey', {id: state.currentDetailId || state.selectedKeyId});
        return;
      }
      if (state.currentDetailKind === 'service') {
        const svc = state.services.find(s => s.id === state.currentDetailId);
        if (svc) openModal('editService', { id: svc.id });
        else toast('未找到模型服务');
        return;
      }
      const model = state.models.find(m => m.id === state.currentDetailId);
      if (model) openModal('editModel', { ...model, focusStep: 1 });
      else toast('请从源模型详情进入编辑');
    }
    if (action === 'test-current') {
      const model = state.models.find(m => m.id === state.currentDetailId) || state.models[0];
      if (!model) { toast('未找到源模型'); return; }
      el.classList.add('x-loading');
      el.disabled = true;
      const prices = model.prices && typeof model.prices === 'object' ? model.prices : null;
      const run = model.gatewaySynced
        ? adminFetch(`/admin/sources/${model.id}/probe`, {
            method: 'POST',
            body: JSON.stringify(prices ? { prices } : {})
          })
        : probeUpstreamLive({
            baseUrl: model.baseUrl || '',
            apiKey: '',
            sourceModel: model.sourceModel || '',
            timeout: model.timeout || 25,
            provider: model.provider || '',
            prices
          }, model);
      Promise.resolve(run).then(probe => {
        if (model) {
          model.status = '运行中';
          model.latency = `${probe.latencyMs || '—'} ms`;
          model.lastProbe = probe;
          persist();
        }
        const costHint = formatProbeCostHint(probe);
        toast(costHint ? `连接测试通过 · ${probe.latencyMs || '—'} ms · ${costHint}` : `连接测试通过 · ${probe.latencyMs || '—'} ms`);
        afterProbeRecorded(probe);
        return syncGatewayCatalog();
      }).catch(err => {
        if (model) { model.status = '异常'; persist(); }
        toast(err.message || '连接测试失败');
      }).finally(() => {
        el.classList.remove('x-loading');
        el.disabled = false;
        if (state.currentDetailId) openDetail('model', state.currentDetailId);
      });
      return;
    }
    if (action === 'more') {
      if (state.currentDetailKind === 'service') openDrawer('service-detail-filter');
      else if (state.currentDetailKind === 'model') openDrawer('model-detail-more');
      else if (currentPage() === 'model-sources') openDrawer('filter');
      else toast('当前页面没有可配置的明细筛选');
      return;
    }
    if (action === 'apply-service-detail-filter') {
      applyServiceDetailFilters({ toastMsg: true });
      return;
    }
    if (action === 'reset-service-detail-filter') {
      const service = state.services.find(s => s.id === state.currentDetailId);
      const available = ensureServiceDetailFilters(service)._availableProviders || [];
      state.serviceDetailFilters = {
        health: ['healthy', 'unhealthy', 'removed'],
        roles: ['primary', 'backup'],
        providers: available.slice()
      };
      try { localStorage.setItem('aegis-service-detail-filters', JSON.stringify(state.serviceDetailFilters)); } catch {}
      $('#x-drawer-content').innerHTML = serviceDetailFilterDrawer();
      toast('已重置为本服务全部通道');
      return;
    }
    if (action === 'open-service-detail') {
      const id = el.dataset.id;
      if (!id) return;
      closeLayers();
      openDetail('service', id);
      return;
    }
    if (action === 'invite-member') toast('成员选择器已准备，可接入企业通讯录');
  }, true);

  document.addEventListener('click', e => {
    // 弹窗（含接入源向导）禁止点遮罩关闭，只能点关闭/取消按钮
    if (e.target === drawerLayer || e.target === commandLayer) closeLayers();
    if (e.target.closest('.nav-item[data-page], [data-page-jump]')) {
      clearDetailViewState();
      setTimeout(enhanceView, 0);
    }
    if (e.target.closest('.icon-btn')) { e.stopPropagation(); openDrawer('notifications'); }
  }, true);
  document.addEventListener('change', e => {
    if (e.target.matches('[data-x="cap-template"]')) applyCapabilityTemplate(e.target.value);
    if (e.target.matches('.x-cap-select')) updateCapabilityCount();
    if (e.target.matches('[data-usage-filter]')) {
      const field = e.target.dataset.usageFilter;
      state.usageFilters[field] = e.target.value;
      resetUsageDetailPager();
      refreshUsageViews();
    }
    if (e.target.matches('[data-usage-detail-filter]')) {
      const f = ensureUsageDetailFilters();
      const field = e.target.dataset.usageDetailFilter;
      if (field === 'keyKind' || field === 'service' || field === 'dept') {
        f[field] = e.target.value;
        resetUsageDetailPager();
        refreshUsageViews();
      }
    }
    if (e.target.matches('[data-usage-detail-pagesize]')) {
      const pager = ensureUsageDetailPager();
      const next = Number(e.target.value);
      pager.pageSize = [50, 100, 300].includes(next) ? next : 50;
      pager.page = 1;
      refreshUsageViews();
    }
    if (e.target.matches('[data-audit-filter]')) {
      const field = e.target.dataset.auditFilter;
      if (!state.auditFilters) state.auditFilters = { period: '最近 24 小时', result: '', keyword: '', customStart: '', customEnd: '' };
      state.auditFilters[field] = e.target.value;
      if (field === 'keyword') refreshAuditTableOnly();
      else renderAuditPage();
    }
    if (e.target.matches('[name="listStatus"], [name="listProvider"], [name="listRegion"]')) {
      applyListFilters({ toastMsg: false });
    }
    if (e.target.matches('[data-source-filter]')) {
      const f = ensureListFilters();
      const key = e.target.dataset.sourceFilter;
      const val = e.target.value;
      if (key === 'statusQuick') {
        f.statuses = val === '全部状态' ? ['运行中', '观察中', '已停用', '异常'] : [val];
      } else if (key === 'serviceId' || key === 'deploy' || key === 'capability' || key === 'billing') {
        f[key] = val;
      }
      persistListFilters();
      renderSourcesPage();
    }
    if (e.target.matches('[data-time-range]')) {
      const name = e.target.dataset.timeRange;
      const panel = $(`[data-custom-range="${name}"]`);
      if (panel) panel.hidden = e.target.value !== CUSTOM_TIME_RANGE;
      if (name === 'usage' || name === 'billing') {
        state.usageFilters.period = e.target.value;
        if (e.target.value === CUSTOM_TIME_RANGE) ensureCustomRangeDefaults();
        syncBillingFiltersFromUsage();
        resetUsageDetailPager();
        refreshUsageViews();
      }
      if (name === 'audit') {
        if (!state.auditFilters) state.auditFilters = { period: '最近 24 小时', result: '', keyword: '', customStart: '', customEnd: '' };
        state.auditFilters.period = e.target.value;
        if (e.target.value === CUSTOM_TIME_RANGE) ensureCustomRangeDefaults(state.auditFilters);
        // 自定义区间面板需要重绘；其余仅刷表格避免打断操作
        if (e.target.value === CUSTOM_TIME_RANGE) renderAuditPage();
        else refreshAuditTableOnly();
      }
    }
    if (e.target.matches('[data-time-start], [data-time-end]')) {
      const name = e.target.dataset.timeStart || e.target.dataset.timeEnd;
      if (e.target.dataset.timeStart) {
        if (name === 'usage' || name === 'billing') state.usageFilters.customStart = e.target.value;
        if (name === 'audit' && state.auditFilters) state.auditFilters.customStart = e.target.value;
      } else {
        if (name === 'usage' || name === 'billing') state.usageFilters.customEnd = e.target.value;
        if (name === 'audit' && state.auditFilters) state.auditFilters.customEnd = e.target.value;
      }
      if ((name === 'usage' || name === 'billing') && state.usageFilters.period === CUSTOM_TIME_RANGE) {
        syncBillingFiltersFromUsage();
        resetUsageDetailPager();
        refreshUsageViews();
      }
      if (name === 'audit' && state.auditFilters?.period === CUSTOM_TIME_RANGE) refreshAuditTableOnly();
    }
    if (e.target.id === 'x-member-filter') {
      state.memberFilter = e.target.value;
      renderMembersPage();
    }
    if (e.target.id === 'x-member-file') {
      const name = e.target.files?.[0]?.name || '未选择文件';
      const label = $('#x-member-file-name');
      if (label) label.textContent = name;
    }
    if (e.target.matches('[data-x="budget-type"]') || e.target.name === 'memberBudgetType') {
      const budgetInput = $('[name="memberBudget"]', modalLayer);
      if (budgetInput) budgetInput.disabled = e.target.value === '不限制';
      if (e.target.value === '不限制' && budgetInput) budgetInput.value = '';
    }
    if (e.target.matches('[data-x="pol-hosting-change"]') || e.target.name === 'polHostingScope') {
      const hostingScope = e.target.value || 'all';
      const typeSel = $('[name="polType"]', modalLayer);
      const actionSel = $('[name="polAction"]', modalLayer);
      const hint = $('#x-pol-hosting-hint', modalLayer);
      const types = policyTypesForHosting(hostingScope);
      const prevType = typeSel?.value;
      const nextType = types.includes(prevType) ? prevType : types[0];
      if (typeSel) typeSel.innerHTML = selectOptions(types, nextType);
      const actions = policyActionsForType(nextType);
      if (actionSel) actionSel.innerHTML = selectOptions(actions, actions.includes(actionSel.value) ? actionSel.value : actions[0]);
      if (hint) {
        hint.textContent = hostingScope === 'saas'
          ? 'SaaS 侧重：出域前脱敏、密钥/凭证拦截、第三方内容安全与越权。'
          : hostingScope === 'local'
            ? '本地侧重：推理端点 ACL、知识库越权、GPU/QPS 资源滥用治理。'
            : '适用于全部部署类型的通用规则；也可再拆成仅 SaaS / 仅本地。';
      }
    }
    if (e.target.matches('[data-x="pol-type-change"]') || e.target.name === 'polType') {
      const actions = policyActionsForType(e.target.value);
      const actionSel = $('[name="polAction"]', modalLayer);
      if (actionSel) actionSel.innerHTML = selectOptions(actions, actions.includes(actionSel.value) ? actionSel.value : actions[0]);
    }
    if (e.target.name === 'serviceHosting') {
      $$('.x-scene-card', modalLayer).forEach(card => {
        const input = card.querySelector('input[name="serviceHosting"]');
        card.classList.toggle('active', !!input?.checked);
      });
    }
    if (e.target.matches('[data-x="key-limit-mode"]') || e.target.name === 'keyLimitMode') {
      e.target.dataset.touched = '1';
      updateKeyQuotaPanel();
    }
    if (e.target.matches('[data-x="holiday-separate"]') || e.target.name === 'holidaySeparate') {
      syncHolidayPricingUI(!!e.target.checked);
    }
    if (e.target.matches('[data-x="key-expire-preset"]') || e.target.name === 'keyExpirePreset') {
      updateKeyExpirePanel();
    }
    if (e.target.matches('[name="keyMaxIn"], [name="keyMaxOut"], [name="keyMaxSpend"], [name="keyOverLimit"]')) {
      e.target.dataset.touched = '1';
    }
    if (e.target.matches('[data-x="key-org-level"]') || e.target.name === 'keyOrgLevel') {
      updateOrgUnitOptions();
    }
    if (e.target.matches('[data-x="key-org-id"]') || e.target.name === 'keyOrgId') {
      syncCallerDeptFromOrg();
    }
    if (e.target.matches('[data-x="key-personal-member"]') || e.target.name === 'keyOwnerMemberId') {
      const member = state.members.find(m => m.id === e.target.value);
      const deptInput = $('[name="keyMemberDept"]', modalLayer);
      if (deptInput) deptInput.value = member?.dept || '';
      const defaults = defaultOrgForMember(member);
      const levelSel = $('[name="keyOrgLevel"]', modalLayer);
      const orgSel = $('[name="keyOrgId"]', modalLayer);
      if (levelSel) levelSel.value = defaults.level;
      if (orgSel) {
        orgSel.innerHTML = orgUnitSelectOptions(defaults.level, defaults.id);
        orgSel.value = defaults.id;
      }
    }
    if (e.target.matches('[data-x="toggle-all-key-services"]')) {
      $$('[name="keyServiceRef"]', modalLayer).forEach(box => { box.checked = e.target.checked; });
      syncKeyServicePick();
      $('[data-key-services]', modalLayer)?.closest('.x-field')?.classList.toggle('invalid', !collectKeyServiceRefs().length);
    }
    if (e.target.matches('[name="keyServiceRef"]')) {
      syncKeyServicePick();
      e.target.closest('.x-field')?.classList.toggle('invalid', !collectKeyServiceRefs().length);
    }
    if (e.target.matches('[name="rolePerm"]')) {
      if (e.target.value === 'cap.all_features' && e.target.checked) {
        $$('input[name="rolePerm"]', modalLayer).filter(i => !i.disabled).forEach(i => { i.checked = true; });
        $$('[data-x="toggle-perm-group"]', modalLayer).forEach(btn => { if (!btn.disabled) btn.textContent = '取消本组'; });
      }
      const groupEl = e.target.closest('.x-perm-group');
      if (groupEl) {
        const inputs = $$('input[name="rolePerm"]', groupEl).filter(i => !i.disabled);
        const toggle = $('[data-x="toggle-perm-group"]', groupEl);
        if (toggle && !toggle.disabled) toggle.textContent = inputs.every(i => i.checked) ? '取消本组' : '全选本组';
      }
      const countEl = $('#x-perm-count', modalLayer);
      if (countEl) countEl.textContent = String(collectRolePerms().length);
    }
  });
  document.addEventListener('change', e => {
    if (e.target.matches('[name="routeAudience"], [name="routeEnv"]') && modalLayer?.contains(e.target)) {
      const audience = $('[name="routeAudience"]', modalLayer)?.value === 'personal' ? 'personal' : 'app';
      const env = $('[name="routeEnv"]', modalLayer)?.value === 'test' ? 'test' : 'prod';
      const pathInput = $('[name="routePath"]', modalLayer);
      const timeoutInput = $('[name="routeTimeout"]', modalLayer);
      if (pathInput) {
        const nextPrefix = audience === 'personal' ? '/personal/v1' : '/app/v1';
        const cur = pathInput.value.trim();
        if (!cur || /^\/(app|personal)\/v1(\/|$)/.test(cur)) {
          const tail = cur.replace(/^\/(app|personal)\/v1/, '') || '/batch';
          pathInput.value = `${nextPrefix}${tail.startsWith('/') ? tail : `/${tail}`}`;
        }
      }
      if (timeoutInput && (!timeoutInput.dataset.touched)) {
        timeoutInput.value = env === 'test' ? '60' : '30';
      }
    }
    if (e.target.matches('[name="routeTimeout"]')) e.target.dataset.touched = '1';
    if (e.target.matches('[data-segment-field="kind"]')) {
      const kind = e.target.value;
      const idx = e.target.dataset.index;
      const nameInput = $(`[data-segment-field="name"][data-index="${idx}"]`, modalLayer);
      if (nameInput && (kind === 'busy' || kind === 'idle')) nameInput.value = normalizeTimeLabel(kind);
      const card = e.target.closest('.x-price-period');
      if (card) {
        card.classList.remove('busy', 'idle', 'custom');
        card.classList.add(kind === 'busy' ? 'busy' : kind === 'idle' ? 'idle' : 'custom');
      }
      refreshPricingPreview();
    }
    if (e.target.matches('[data-segment-field="name"]')) refreshPricingPreview();
  });
  document.addEventListener('input', e => {
    if (e.target.matches('.x-price-input')) refreshPricingPreview();
    if (e.target.matches('[data-x="budget-threshold"]')) syncBudgetThresholdUI(e.target.value);
    if (e.target.matches('[data-audit-filter="keyword"]')) {
      if (!state.auditFilters) state.auditFilters = { period: '最近 24 小时', result: '', keyword: '', customStart: '', customEnd: '' };
      state.auditFilters.keyword = e.target.value;
      clearTimeout(window.auditFilterTimer);
      window.auditFilterTimer = setTimeout(() => refreshAuditTableOnly(), 120);
    }
    if (e.target.id === 'x-member-search') {
      state.memberQuery = e.target.value;
      clearTimeout(window.memberSearchTimer);
      window.memberSearchTimer = setTimeout(() => renderMembersPage(true), 120);
    }
    if (e.target.id === 'x-usage-detail-search') {
      const f = ensureUsageDetailFilters();
      f.query = e.target.value;
      clearTimeout(window.usageDetailSearchTimer);
      window.usageDetailSearchTimer = setTimeout(() => {
        const keep = e.target.selectionStart;
        resetUsageDetailPager();
        refreshUsageViews();
        const input = $('#x-usage-detail-search');
        if (input) {
          input.focus();
          try { input.setSelectionRange(keep, keep); } catch {}
        }
      }, 120);
    }
    if (e.target.id === 'x-source-search') {
      const f = ensureListFilters();
      f.query = e.target.value;
      persistListFilters();
      clearTimeout(window.sourceSearchTimer);
      window.sourceSearchTimer = setTimeout(() => {
        const keep = e.target.selectionStart;
        renderSourcesPage();
        const input = $('#x-source-search');
        if (input) {
          input.focus();
          try { input.setSelectionRange(keep, keep); } catch {}
        }
      }, 120);
    }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCommand(); }
    if (e.key === 'Escape') {
      // 命令面板 / 抽屉仍可 ESC 关闭；正式弹窗（接入源等）仅允许点关闭
      if (modalLayer.classList.contains('open') && !commandLayer.classList.contains('open') && !drawerLayer.classList.contains('open')) return;
      closeLayers();
    }
  });
  $('.global-search input')?.addEventListener('focus', e => { e.target.blur(); openCommand(); });
  $('#x-command-input').addEventListener('input', e => renderCommands(e.target.value));
  new MutationObserver(() => setTimeout(enhanceView, 0)).observe($('#page-content'), { childList: true });
  // 包装 render：切页时清掉详情态，避免残留 currentDetailKind 阻断列表 enhance
  if (typeof window.render === 'function' && !window.render.__aegisWrapped) {
    const rawRender = window.render;
    const wrapped = function patchedRender(page) {
      clearDetailViewState();
      return rawRender.apply(this, arguments);
    };
    wrapped.__aegisWrapped = true;
    window.render = wrapped;
  }
  syncGatewayCatalog().finally(() => enhanceView());
  setInterval(() => {
    if (!state.gatewayOnline) return;
    if (state.currentDetailKind === 'service' && String($('#page-content')?.dataset.enhanced || '').startsWith('detail-service')) {
      refreshServiceRoutingData();
      return;
    }
    if (typeof currentPage === 'function' && String(currentPage() || '').startsWith('security')
      && !String($('#page-content')?.dataset.enhanced || '').startsWith('detail-')) {
      syncGatewayCatalog();
    }
  }, 8000);
})();

