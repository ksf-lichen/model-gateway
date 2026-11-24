const icons = {
  cpu: '<svg><use href="#i-cpu"/></svg>', route: '<svg><use href="#i-route"/></svg>',
  shield: '<svg><use href="#i-shield"/></svg>', users: '<svg><use href="#i-users"/></svg>',
  key: '<svg><use href="#i-key"/></svg>', log: '<svg><use href="#i-log"/></svg>',
  chart: '<svg><use href="#i-chart"/></svg>', wallet: '<svg><use href="#i-wallet"/></svg>'
};

const pageHead = (eyebrow, title, desc, actions = '') => `
  <div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${desc}</p></div><div class="head-actions">${actions}</div></div>`;

const views = {
  overview: () => `${pageHead('OPS DASHBOARD','管理员运营分析','把成本增长、配额风险、渠道健康、令牌生命周期与模型调用结构放在同一屏，支持按今日 / 近 7 天 / 近 30 天切换。','<span class="status-pill" id="ov-gateway-pill"><i></i> 本地网关</span><button class="btn" data-page-jump="usage">用量概览</button><button class="btn primary" data-x="ov-export">导出报表</button>')}
    <div id="x-overview-panel"></div>`,

  assistant: () => `${pageHead('ASSISTANT SETUP','助手配置','配置智能体共用模型；右侧边栏可切换「运维助手」「开票智能体」。用量记入平台内置 Key。','<button class="btn" data-page-jump="usage">查看用量</button><button class="btn primary" data-x="assistant-toggle">打开对话边栏</button>')}
    <div id="x-assistant-panel"></div>`,

  'model-services': () => `${pageHead('MODEL SERVICES','模型服务配置','创建对外统一服务名（类似 enterprise-chat）。调用方只使用服务名；底层多源按成本/固定顺序调度，故障自动转移。','<button class="btn primary" data-action="创建模型服务"><svg><use href="#i-plus"/></svg>创建模型服务</button>')}
    <div id="x-services-panel"></div>`,
  'model-sources': () => `${pageHead('SOURCE MODELS','源模型能力接入','先添加厂商（连接与凭证），再在厂商下追加模型能力（标签 / 上下文 / 单价）。','<button class="btn" data-x="open-filter"><svg><use href="#i-filter"/></svg>筛选</button><button class="btn" data-x="new-provider"><svg><use href="#i-plus"/></svg>添加厂商</button><button class="btn primary" data-x="append-models"><svg><use href="#i-plus"/></svg>追加模型能力</button>')}
    <div id="x-sources-panel"></div>`,
  providers: () => `${pageHead('MODEL SOURCES','可用模型','已授权给当前部门的逻辑模型。','')}
    <div class="permission-note" style="margin-bottom:15px">${icons.shield}<span>底层源模型由平台管理；调用方始终使用统一服务标识。</span></div>`,

  routes: () => `${pageHead('API ROUTES','业务路由','点选「对象 × 环境」查看标准入口与调用方式；追加路径仅作用于当前选中的入口。','')}`,
  integration: () => `${pageHead('INTEGRATION GUIDE','接入说明','改一行 Base URL 即可迁移：虚拟 Key + 对外服务名。个人 Key 需 X-User-Id；应用 Key 仅 Bearer。Key 签发时绑定生产或测试，入口端口必须一致。','')}`,

  members: () => `${pageHead('MEMBER DIRECTORY','成员管理','统一管理企业成员池：添加、导入、分配部门与角色，不含订阅席位分配。','<button class="btn" data-action="批量导入成员">批量导入</button><button class="btn primary" data-action="添加成员"><svg><use href="#i-plus"/></svg>添加成员</button>')}
    <div id="x-members-panel"></div>`,

  access: () => `${pageHead('IDENTITY & ACCESS','角色权限','管理角色的编辑与删除；超级管理员权限固定不可改。保存后立即生效。','<button class="btn" data-action="权限矩阵">权限矩阵</button><button class="btn primary" data-action="新建角色"><svg><use href="#i-plus"/></svg>新建角色</button>')}
    <div id="x-access-panel"></div>`,

  'security-api': () => `${pageHead('VIRTUAL KEYS','虚拟 Key 治理','创建 / 轮换 / 停用 / 删除 / 过期。调用方只持有虚拟 Key，可按组织与模型服务控制访问范围。','<button class="btn" data-x="new-personal-key">创建个人虚拟 Key</button><button class="btn primary" data-x="new-app-key"><svg><use href="#i-plus"/></svg>创建应用虚拟 Key</button>')}
    <div id="x-security-api-panel"></div>`,
  'security-policies': () => `${pageHead('SECURITY POLICIES','安全策略','按 SaaS / 本地模型分别配置脱敏、出域管控、端点防护与内容安全；策略命中审计将引用此处生效规则。','<button class="btn primary" data-x="new-policy"><svg><use href="#i-plus"/></svg>新建策略</button>')}
    <div id="x-policies-panel"></div>`,
  alerts: () => `${pageHead('ALERT RULES','告警规则','配置延迟、错误率与预算阈值；触发后写入通知中心并可跳转审计。','<button class="btn primary" data-x="new-alert-rule"><svg><use href="#i-plus"/></svg>新建规则</button>')}
    <div id="x-alerts-panel"></div>`,

  'audit-platform': () => `${pageHead('PLATFORM AUDIT','平台操作','记录控制台内的配置变更、权限审批、成员与密钥等管理操作。','')}`,
  'audit-policy': () => `${pageHead('POLICY HITS','策略命中','记录模型调用中的隐私识别、脱敏改写、内容安全与越权拦截等策略命中。','')}`,
  'audit-request': () => `${pageHead('REQUEST LOG','调用日志','全链路调用留痕：详情包含请求记录中的全部文本与文件（二进制仅保留元数据）。','')}`,

  usage: () => `${pageHead('USAGE OVERVIEW','用量概览','按日 / 周 / 月查看 Token 与费用趋势、组织排行与成本结构。','<button class="btn" data-page-jump="usage-detail">查看明细</button>')}`,
  'usage-detail': () => `${pageHead('USAGE DETAILS','用量明细','查看当前筛选条件下的调用明细，支持分页浏览与导出。','<button class="btn" data-page-jump="usage">返回概览</button>')}`,

  // 兼容旧链接：费用页已并入用量概览
  billing: () => `${pageHead('USAGE OVERVIEW','用量概览','费用统计已与用量合并，正在打开概览页…','')}`
};

const titles = {
  overview:'运行总览', assistant:'助手配置', providers:'可用模型', 'model-services':'模型服务配置', 'model-sources':'源模型能力接入',
  routes:'业务路由', integration:'接入说明', members:'成员管理', access:'角色权限',
  'security-api':'虚拟 Key 治理', 'security-policies':'安全策略', security:'访问凭证',
  'audit-platform':'平台操作', 'audit-policy':'策略命中', 'audit-request':'调用日志', audit:'审计日志',
  alerts:'告警规则', usage:'用量概览', 'usage-detail':'用量明细', billing:'用量概览'
};
const crumbParents = {
  'model-services':'模型配置', 'model-sources':'模型配置', 'security-api':'模型配置',
  members:'成员与权限', access:'成员与权限',
  usage:'用量与费用', 'usage-detail':'用量与费用',
  'audit-platform':'审计日志', 'audit-policy':'审计日志', 'audit-request':'审计日志'
};
const content = document.getElementById('page-content');
const crumb = document.getElementById('page-crumb');

const allPlatformPages = ['overview','providers','model-services','model-sources','routes','members','access','security-api','usage','usage-detail','integration','security-policies','audit-platform','audit-policy','audit-request','alerts','assistant'];

const readJson = (key, fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value == null ? fallback : value;
  } catch { return fallback; }
};

const identityInitials = name => {
  if (!name) return '?';
  if (/[\u4e00-\u9fff]/.test(name)) return name.slice(0, 2);
  return name.split(/\s+/).map(part => part[0] || '').join('').slice(0, 2).toUpperCase() || '?';
};

const viewProfileForRole = roleName => {
  const name = roleName || '';
  if (/审计/.test(name)) return 'auditor';
  if (/服务接入|运维|运营/.test(name)) return 'ops';
  if (/普通用户|普通成员|调用方/.test(name)) return 'developer';
  if (/key|Key|密钥|审核/.test(name)) return 'admin';
  return 'admin';
};

const LEGACY_ROLE_NAME_MAP = {
  '企业管理员': '模型服务接入维护',
  '模型运维': '模型服务接入维护',
  '部门管理员': '模型key分发审核人',
  '安全审计员': '审计人员',
  '普通成员': '普通用户'
};
const mapLegacyRoleName = name => LEGACY_ROLE_NAME_MAP[name] || name || '普通用户';

const isSuperAdminAccess = (roleName, roleDef, perms = []) => {
  const list = Array.isArray(perms) ? perms : [];
  return list.includes('cap.all_features')
    || !!roleDef?.locked
    || roleDef?.id === 'role-superadmin'
    || roleName === '超级管理员';
};

const pagesFromPerms = (perms, options = {}) => {
  const list = Array.isArray(perms) ? perms : [];
  if (options.fullAccess || list.includes('cap.all_features')) return allPlatformPages.slice();
  // 导航严格跟随 page.*；page.billing 仅控制合并页内「费用」深度，不再单独占导航
  const pages = list.filter(id => id.startsWith('page.')).map(id => id.slice(5));
  if (pages.includes('billing') && !pages.includes('usage')) pages.push('usage');
  // 有用量概览时默认可看明细页
  if (pages.includes('usage') && !pages.includes('usage-detail')) pages.push('usage-detail');
  if (pages.includes('usage-detail') && !pages.includes('usage')) pages.push('usage');
  // 有路由 / Key / 用量权限时，默认可看接入说明
  if (!pages.includes('integration') && (pages.includes('routes') || pages.includes('security-api') || pages.includes('usage') || pages.includes('usage-detail'))) {
    pages.push('integration');
  }
  // 运维助手：有服务/密钥治理或超管时开放
  if (!pages.includes('assistant') && (
    list.includes('cap.manage_services')
    || list.includes('cap.manage_keys')
    || list.includes('cap.all_features')
  )) {
    pages.push('assistant');
  }
  // 普通用户：有查看模型能力但无模型配置页时，展示扁平「可用模型」
  if (list.includes('cap.view_models') && !pages.includes('providers') && !pages.includes('model-services') && !pages.includes('model-sources')) {
    pages.push('providers');
  }
  return [...new Set(pages.filter(p => p !== 'billing').length ? pages.filter(p => p !== 'billing') : ['overview'])];
};

const actionsFromPerms = (perms, profile, options = {}) => {
  const list = Array.isArray(perms) ? perms : [];
  if (options.fullAccess || list.includes('cap.all_features')) return ['*'];
  if (profile === 'auditor') return ['导出审计报告','导出账单','高级筛选'];
  const actions = [];
  if (list.includes('cap.configure_distribution')) actions.push('配置策略');
  if (list.includes('cap.manage_models')) actions.push('接入模型');
  if (list.includes('cap.manage_services')) actions.push('创建模型服务');
  if (list.includes('cap.manage_keys')) actions.push('创建密钥','签发 API Key','申请 API Key');
  if (list.includes('cap.apply_keys') || profile === 'developer') actions.push('申请 API Key');
  if (list.includes('cap.manage_members')) actions.push('添加成员','批量导入成员');
  if (list.includes('cap.manage_roles')) actions.push('新建角色');
  if (list.includes('cap.export_audit')) actions.push('导出审计报告');
  if (list.includes('cap.export_billing')) actions.push('导出账单');
  if (list.includes('cap.view_models') || list.includes('cap.manage_keys')) actions.push('复制端点');
  actions.push('高级筛选');
  return [...new Set(actions)];
};

const xFromPerms = (perms, profile, options = {}) => {
  const list = Array.isArray(perms) ? perms : [];
  if (options.fullAccess || list.includes('cap.all_features')) return ['*'];
  const x = ['back','more','row-menu','mark-read','open-filter','open-usage-filter','reset-filter','reset-source-filters','reset-service-detail-filter','apply-service-detail-filter','open-service-detail','member-search','export-usage-detail','export-sources-detail','reset-usage-filter','reset-usage-detail-filter','reset-billing-filter','reset-audit-filter','usage-tab','cost-dim','set-grain','cost-rules','usage-detail-prev','usage-detail-next','apply-rec','copy-route-url','copy-call-guide','route-focus'];
  if (list.includes('cap.manage_services') || list.includes('cap.manage_models') || list.includes('cap.configure_distribution')) {
    x.push('configure-distribution','configure-generic','refresh-service-routing','new-logical-model','new-service','edit-service','service-toggle','dist-add-source','dist-remove-source','goto-bind-source','new-source','goto-create-service','bind-source','test-model','test-current','edit-current','source-toggle','source-up','source-down','save-distribution','strategy-mode','recalculate-cost','save-service','delete-entity','confirm-delete','apply-service-detail-filter','reset-service-detail-filter','open-service-detail');
  }
  if (list.includes('cap.manage_routes')) x.push('route-toggle','route-method-toggle','new-route','save-route');
  if (list.includes('cap.manage_keys')) {
    x.push('new-api-key','new-personal-key','new-app-key','issue-key-scene','back-key-scene','switch-apply-scene','security-key-scene','save-key','edit-api-key','update-api-key','select-key','open-key-detail','security-detail-tab','toggle-key-check','toggle-all-keys','batch-update-keys','update-all-keys','rotate-all','rotate-key','batch-rotate-keys','copy-endpoint','copy-api-key','approve-key-apply','reject-key-apply','view-key-apply','toggle-key','suspend-key','resume-key','revoke-key','delete-key','delete-entity','confirm-delete');
  }
  if (list.includes('cap.apply_keys') || profile === 'developer') {
    x.push('apply-api-key','save-key-apply','switch-apply-scene','copy-api-key','reveal-api-key','select-key','security-detail-tab','copy-endpoint','security-key-scene');
  }
  if (list.includes('cap.view_audit') || list.includes('cap.export_audit')) x.push('audit-row','audit-payload-tab','copy-audit-payload','copy-trace','goto-audit','goto-policies','export-audit','download');
  if (list.includes('cap.manage_members')) x.push('new-member','import-members','edit-member','toggle-member');
  if (list.includes('cap.manage_roles')) x.push('role','edit-role','matrix','save-role','toggle-perm-group','perm-select-all','perm-clear-all','delete-entity','confirm-delete');
  if (list.includes('cap.manage_policies')) {
    x.push('new-policy','save-policy','edit-policy','policy-toggle');
  }
  if (list.includes('cap.manage_alerts')) {
    x.push('new-alert-rule','save-alert-rule','edit-alert-rule','alert-toggle');
  }
  if (list.includes('page.alerts') || list.includes('cap.manage_alerts') || list.includes('cap.view_audit')) {
    x.push('goto-alerts','open-notifications');
  }
  return [...new Set(x)];
};

const fallbackRoleDefs = [
  {id:'role-superadmin', name:'超级管理员', scope:'全局', desc:'拥有平台全部功能与操作权限', locked:true, perms:['cap.all_features', ...allPlatformPages.map(p=>`page.${p}`),'cap.view_models','cap.manage_models','cap.manage_services','cap.manage_routes','cap.configure_distribution','cap.manage_keys','cap.manage_policies','cap.view_audit','cap.export_audit','cap.manage_members','cap.manage_roles','cap.manage_alerts','cap.view_usage','cap.export_billing']},
  {id:'role-ops', name:'模型服务接入维护', scope:'全局', desc:'负责模型服务、源模型接入、业务路由与分发策略维护', perms:['page.overview','page.assistant','page.model-services','page.model-sources','page.routes','page.integration','page.usage','page.usage-detail','page.alerts','page.audit-request','cap.view_models','cap.manage_models','cap.manage_services','cap.manage_routes','cap.configure_distribution','cap.view_usage','cap.manage_alerts','cap.view_audit']},
  {id:'role-key-reviewer', name:'模型key分发审核人', scope:'全局', desc:'负责 API Key 签发、申请审批与密钥生命周期治理', perms:['page.overview','page.assistant','page.security-api','page.members','page.integration','page.usage','page.usage-detail','page.audit-platform','cap.view_models','cap.manage_keys','cap.view_usage','cap.view_audit']},
  {id:'role-auditor', name:'审计人员', scope:'全局', desc:'安全策略核查、审计日志与调用留痕（只读）', perms:['page.overview','page.members','page.access','page.security-policies','page.integration','page.audit-platform','page.audit-policy','page.audit-request','page.alerts','page.usage','page.usage-detail','page.billing','cap.view_models','cap.view_audit','cap.export_audit','cap.view_usage','cap.export_billing']},
  {id:'role-member', name:'普通用户', scope:'所属部门', desc:'查看可用模型与路由、申请个人 Key、查看本人用量', perms:['page.overview','page.routes','page.integration','page.security-api','page.usage','page.usage-detail','cap.view_models','cap.apply_keys','cap.view_usage']}
];

const fallbackMembers = [
  {id:'m-lichen', name:'李晨', dept:'总部 / 平台中心', role:'超级管理员', status:'已激活'},
  {id:'m-linzhou', name:'林舟', dept:'总部 / 平台中心', role:'模型服务接入维护', status:'已激活'},
  {id:'m-zhaoran', name:'赵然', dept:'客户服务', role:'模型key分发审核人', status:'已激活'},
  {id:'m-shenyao', name:'沈钥', dept:'总部 / 平台中心', role:'模型key分发审核人', status:'已激活'},
  {id:'m-chenyu', name:'陈屿', dept:'安全合规', role:'审计人员', status:'已激活'},
  {id:'m-dengyanfeng', name:'邓艳峰', dept:'客户服务', role:'普通用户', status:'已激活'},
  {id:'m-wangyaomin', name:'王耀民', dept:'研发助手', role:'普通用户', status:'已激活'}
];

const roleNavLabels = {
  admin:{'security-api':'Key 签发与审批',members:'成员与申请人'},
  ops:{'model-services':'模型服务配置','model-sources':'源模型接入',routes:'业务路由','audit-request':'调用排查',alerts:'告警规则'},
  auditor:{overview:'审计概览',members:'成员快照',access:'权限快照','security-policies':'策略快照','audit-platform':'平台操作','audit-policy':'策略命中','audit-request':'调用日志',alerts:'告警只读',usage:'用量概览','usage-detail':'用量明细'},
  developer:{overview:'我的工作台',providers:'可用模型',routes:'调用路由',integration:'接入说明','security-api':'我的 API Key',usage:'我的用量概览','usage-detail':'我的用量明细'}
};

let roleConfigs = {};

function normalizeRoleDefForAccess(roleDef) {
  if (!roleDef) return roleDef;
  const isSuper = isSuperAdminAccess(roleDef.name, roleDef, roleDef.perms);
  if (!isSuper) return roleDef;
  return {
    ...roleDef,
    locked: true,
    builtin: true,
    perms: ['cap.all_features', ...allPlatformPages.map(p => `page.${p}`),
      'cap.view_models','cap.manage_models','cap.manage_services','cap.manage_routes','cap.configure_distribution',
      'cap.manage_keys','cap.manage_policies','cap.view_audit','cap.export_audit',
      'cap.manage_members','cap.manage_roles','cap.manage_alerts','cap.view_usage','cap.export_billing']
  };
}

function buildIdentityConfig(member, roleDef) {
  const roleName = mapLegacyRoleName(member.role || roleDef?.name || '普通用户');
  const normalizedDef = normalizeRoleDefForAccess(
    roleDef || fallbackRoleDefs.find(r => r.name === roleName)
  );
  const perms = Array.isArray(normalizedDef?.perms)
    ? normalizedDef.perms.slice()
    : (fallbackRoleDefs.find(r => r.name === roleName)?.perms || []).slice();
  const profile = viewProfileForRole(roleName);
  const hasAll = isSuperAdminAccess(roleName, normalizedDef, perms);
  const effectivePerms = hasAll
    ? ['cap.all_features', ...allPlatformPages.map(p => `page.${p}`),
      'cap.view_models','cap.manage_models','cap.manage_services','cap.manage_routes','cap.configure_distribution',
      'cap.manage_keys','cap.manage_policies','cap.view_audit','cap.export_audit',
      'cap.manage_members','cap.manage_roles','cap.manage_alerts','cap.view_usage','cap.export_billing']
    : perms.filter(p => p !== 'page.security-kms' && p !== 'cap.manage_kms');
  const pages = pagesFromPerms(effectivePerms, { fullAccess: hasAll }).filter(p => p !== 'security-kms');
  return {
    id: member.id,
    memberId: member.id,
    name: member.name,
    initials: identityInitials(member.name),
    role: roleName,
    scope: `${member.dept || normalizedDef?.scope || '未分配'} · 康师傅`,
    mode: normalizedDef?.desc || `${roleName}权限`,
    home: pages.includes('overview') ? 'overview' : (pages[0] || 'overview'),
    summary: hasAll
      ? '超级管理员可使用全部功能模块与操作。'
      : (normalizedDef?.desc || `以 ${roleName} 身份预览平台能力。`),
    pages,
    actions: actionsFromPerms(effectivePerms, profile, { fullAccess: hasAll }),
    x: xFromPerms(effectivePerms, profile, { fullAccess: hasAll }),
    readonly: profile === 'auditor',
    viewProfile: profile,
    perms: effectivePerms,
    fullAccess: hasAll,
    canManageAccess: hasAll || effectivePerms.includes('cap.manage_roles'),
    canManageRoutes: hasAll || effectivePerms.includes('cap.manage_routes'),
    canManageSecurity: hasAll || effectivePerms.includes('cap.manage_keys'),
    canManageMembers: hasAll || effectivePerms.includes('cap.manage_members')
  };
}

function normalizeDemoMember(m) {
  if (!m) return m;
  const role = mapLegacyRoleName(m.role);
  // 超管统一为李晨；兼容旧 id / 旧姓名
  if (m.id === 'm-lichen' || m.id === 'm-guheng' || m.name === '顾衡' || m.role === '超级管理员') {
    return { ...m, id: 'm-lichen', name: '李晨', role: '超级管理员', dept: m.dept || '总部 / 平台中心', status: m.status || '已激活' };
  }
  if (m.id === 'm-linzhou' || m.name === '林舟') {
    return { ...m, id: 'm-linzhou', name: '林舟', role: '模型服务接入维护', dept: m.dept || '总部 / 平台中心', status: m.status || '已激活' };
  }
  if (m.id === 'm-zhaoran' || m.name === '赵然') {
    return { ...m, id: 'm-zhaoran', name: '赵然', role: '模型key分发审核人', dept: m.dept || '客户服务', status: m.status || '已激活' };
  }
  if (m.id === 'm-shenyao' || m.name === '沈钥') {
    return { ...m, id: 'm-shenyao', name: '沈钥', role: '模型key分发审核人', dept: m.dept || '总部 / 平台中心', status: '已激活' };
  }
  if (m.id === 'm-chenyu' || m.name === '陈屿') {
    return { ...m, id: 'm-chenyu', name: '陈屿', role: '审计人员', dept: m.dept || '安全合规', status: m.status || '已激活' };
  }
  if (m.id === 'm-zhouning' || m.name === '周宁') {
    return { ...m, id: 'm-dengyanfeng', name: '邓艳峰', role: '普通用户', dept: m.dept || '客户服务', status: m.status || '已激活' };
  }
  if (m.name === '邓艳峰') return { ...m, id: m.id === 'm-zhouning' ? 'm-dengyanfeng' : (m.id || 'm-dengyanfeng'), role: '普通用户' };
  if (m.name === '王耀民') return { ...m, id: m.id || 'm-wangyaomin', role: '普通用户' };
  return { ...m, role };
}

function rebuildIdentitySwitcher(options = {}) {
  const seen = new Set();
  const stored = (readJson('aegis-members', null) || fallbackMembers)
    .map(normalizeDemoMember)
    .filter(m => {
      if (!m?.id || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  if (!stored.some(m => m.id === 'm-lichen')) {
    stored.unshift({ id: 'm-lichen', name: '李晨', dept: '总部 / 平台中心', role: '超级管理员', status: '已激活' });
  }
  if (!stored.some(m => m.id === 'm-shenyao')) {
    stored.push({ id: 'm-shenyao', name: '沈钥', dept: '总部 / 平台中心', role: '模型key分发审核人', status: '已激活' });
  }
  if (!stored.some(m => m.id === 'm-dengyanfeng')) {
    stored.push({ id: 'm-dengyanfeng', name: '邓艳峰', dept: '客户服务', role: '普通用户', status: '已激活' });
  }
  if (!stored.some(m => m.id === 'm-wangyaomin')) {
    stored.push({ id: 'm-wangyaomin', name: '王耀民', dept: '研发助手', role: '普通用户', status: '已激活' });
  }
  // 回写纠正后的成员，避免侧栏仍读到旧姓名
  localStorage.setItem('aegis-members', JSON.stringify(stored));
  const members = stored.filter(m => m && m.status === '已激活');
  const roleDefs = readJson('aegis-role-defs', null);
  const rawDefs = Array.isArray(roleDefs) && roleDefs.length ? roleDefs : fallbackRoleDefs;
  const defs = rawDefs
    .filter(r => r.id !== 'role-admin' && r.id !== 'role-dept')
    .map(r => normalizeRoleDefForAccess({ ...r, name: mapLegacyRoleName(r.name) }));
  fallbackRoleDefs.forEach(def => {
    if (!defs.some(r => r.id === def.id || r.name === def.name)) defs.push(normalizeRoleDefForAccess(def));
  });
  // 确保存量数据里超管不会丢权限
  if (!defs.some(r => r.name === '超级管理员' || r.id === 'role-superadmin')) {
    defs.unshift(normalizeRoleDefForAccess(fallbackRoleDefs.find(r => r.id === 'role-superadmin')));
  }
  const next = {};
  members.forEach(member => {
    const roleName = mapLegacyRoleName(member.role);
    const roleDef = defs.find(r => r.name === roleName) || fallbackRoleDefs.find(r => r.name === roleName);
    next[member.id] = buildIdentityConfig({ ...member, role: roleName }, roleDef);
  });
  if (!Object.keys(next).length) {
    fallbackMembers.forEach(member => {
      next[member.id] = buildIdentityConfig(member, fallbackRoleDefs.find(r => r.name === member.role));
    });
  }
  roleConfigs = next;

  const legacyMap = {
    superadmin: 'm-lichen',
    admin: 'm-shenyao',
    ops: 'm-linzhou',
    auditor: 'm-chenyu',
    developer: 'm-dengyanfeng',
    'key-reviewer': 'm-shenyao'
  };
  const identityAlias = { 'm-zhouning': 'm-dengyanfeng', 'm-guheng': 'm-lichen' };
  let preferred = options.preferId || localStorage.getItem('aegis-identity') || legacyMap[localStorage.getItem('aegis-role')] || activeRole;
  preferred = identityAlias[preferred] || preferred;
  if (!roleConfigs[preferred]) preferred = Object.keys(roleConfigs)[0];
  activeRole = preferred;
  localStorage.setItem('aegis-identity', activeRole);
  localStorage.setItem('aegis-role', activeRole);
  if (options.refreshShell !== false) updateRoleShell();
  const current = roleConfigs[activeRole];
  const needRerender = options.rerender || options.forceShell || (current && activePage && !current.pages.includes(activePage));
  if (needRerender) render(current?.pages.includes(activePage) ? activePage : (current?.home || 'overview'));
  return roleConfigs;
}

const roleContext = role => `<div class="role-context ${role.readonly?'role-readonly':''}">
  <div class="role-context-mark">${role.initials}</div>
  <div class="role-context-copy"><strong>${role.name} · ${role.role}</strong><span>${role.summary}</span></div>
  <div class="role-context-scope"><i></i>${role.scope}</div>
</div>`;

const opsOverview = () => `${pageHead('MODEL OPERATIONS','模型运营工作台','优先处理影响调用质量的上游异常、配额风险与待发布变更。','<span class="status-pill"><i></i> 暂无已接入源</span><button class="btn primary" data-action="创建模型服务"><svg><use href="#i-plus"/></svg>创建模型服务</button>')}
  <section class="metrics"><div class="metric-card"><div class="metric-top"><span>待处理告警</span></div><strong>0</strong><small>接入上游后展示</small></div><div class="metric-card"><div class="metric-top"><span>P95 响应延迟</span></div><strong>—</strong><small>暂无调用数据</small></div><div class="metric-card"><div class="metric-top"><span>源服务可用率</span></div><strong>—</strong><small>暂无上游</small></div><div class="metric-card"><div class="metric-top"><span>待发布变更</span></div><strong>0</strong><small>无草稿</small></div></section>
  <section class="role-home-grid"><article class="card"><div class="card-head"><div><h2>运营处置队列</h2><p>按业务影响和剩余处理时间排序</p></div><button class="btn" data-page-jump="model-sources">进入源模型接入</button></div><div class="empty-note" style="padding:18px">暂无告警或待发布变更。请先创建模型服务并接入可连通的上游源。</div></article><article class="card"><div class="card-head"><div><h2>我的权限边界</h2><p>模型运营 · 4 个部门</p></div></div><div class="activity-list"><div class="activity"><div class="activity-icon">允</div><div><strong>模型与路由管理</strong><p>可接入、测试、发布和回滚</p></div></div><div class="activity"><div class="activity-icon">允</div><div><strong>运行数据查看</strong><p>可查看调用与运行审计</p></div></div><div class="activity"><div class="activity-icon">—</div><div><strong>成员、费用与主密钥</strong><p>无查看或变更权限</p></div></div></div></article></section>`;

const auditorOverview = () => `${pageHead('COMPLIANCE REVIEW','审计概览','聚焦高风险访问、权限变更和关键配置操作，全局数据只读。','<button class="btn primary" data-action="导出审计报告">导出审计报告</button>')}
  <section class="metrics"><div class="metric-card"><div class="metric-top"><span>今日高风险事件</span></div><strong>2</strong><small>均已拦截，无数据泄露</small></div><div class="metric-card"><div class="metric-top"><span>权限变更</span></div><strong>7</strong><small>2 项临时授权仍在有效期</small></div><div class="metric-card"><div class="metric-top"><span>配置变更覆盖率</span></div><strong>100%</strong><small>全部关联审批与追踪 ID</small></div><div class="metric-card"><div class="metric-top"><span>日志保留</span></div><strong>365 天</strong><small>符合当前留存策略</small></div></section>
  <section class="role-home-grid"><article class="card"><div class="card-head"><div><h2>优先核查事件</h2><p>按风险等级和发生时间排序</p></div><button class="btn" data-page-jump="audit-policy">进入策略命中</button></div><div class="role-queue"><div class="role-queue-row"><div><strong>越权模型调用已拦截</strong><span>svc-marketing-test → finance-rag · 2026-11-04 10:58:02</span></div><b>tr_9d11…43f2</b><span class="event-chip red">高风险</span></div><div class="role-queue-row"><div><strong>临时管理员权限将在 3 小时后到期</strong><span>数据分析组 · 营销内容部门 · 到期 2026-11-04 14:43:27</span></div><b>2026-11-04 14:43:27</b><span class="event-chip orange">待复核</span></div><div class="role-queue-row"><div><strong>路由权重调整已完成双人审批</strong><span>赵然提交 · 林舟审批</span></div><b>2026-11-04 11:37:09</b><span class="event-chip green">合规</span></div></div></article><article class="card"><div class="card-head"><div><h2>只读边界</h2><p>审计视角不会影响生产配置</p></div></div><div style="padding:0 18px 18px"><div class="permission-note">${icons.shield}<span>所有新增、编辑、轮换与发布操作均已隐藏，仅保留筛选、追溯和导出。</span></div><div class="activity-list"><div class="activity"><div class="activity-icon">允</div><div><strong>全局审计与费用查验</strong><p>覆盖全部部门</p></div></div><div class="activity"><div class="activity-icon">允</div><div><strong>权限配置快照</strong><p>可查看，不可修改</p></div></div></div></div></article></section>`;

const developerOverview = () => `${pageHead('MY DEPARTMENT','客户服务工作台','查看已授权模型、调用额度、访问凭证和本部门费用。','<button class="btn primary" data-x="apply-api-key"><svg><use href="#i-key"/></svg>开通个人 Key</button>')}
  <section class="metrics"><div class="metric-card"><div class="metric-top"><span>今日请求</span></div><strong>0</strong><small>仅客户服务部门</small></div><div class="metric-card"><div class="metric-top"><span>调用成功率</span></div><strong>—</strong><small>暂无调用</small></div><div class="metric-card"><div class="metric-top"><span>本月 Token</span></div><strong>0</strong><small>暂无用量</small></div><div class="metric-card"><div class="metric-top"><span>本月费用</span></div><strong>¥ 0</strong><small>暂无费用</small></div></section>
  <article class="card"><div class="card-head"><div><h2>已授权模型服务</h2><p>统一服务名保持稳定，底层源模型由平台策略自动选择</p></div><button class="btn" data-page-jump="providers">查看全部</button></div><div class="empty-note" style="padding:18px">暂无已授权服务。请管理员在「模型服务配置」创建并接入可连通上游后，再签发 Key。</div></article>`;

const developerProviders = () => `${pageHead('MODEL CATALOG','可用模型','这里只展示已授权给客户服务部门的逻辑模型，不暴露底层服务商凭证和分发配置。','')}
  <div class="permission-note" style="margin-bottom:15px">${icons.shield}<span>底层源模型、采购单价和路由优先级由平台管理；调用方始终使用统一服务标识。</span></div>
  <div class="empty-note">暂无可用模型。请先由管理员创建模型服务并接入真实上游。</div>`;

const developerRoutes = () => `${pageHead('SERVICE ENDPOINTS','调用路由','个人 Key 请走个人入口；生产与测试域名不同，且须使用对应环境的 Key。请求体 model 填已授权模型服务名。','')}
  <article class="card"><div class="card-head"><div><h2>个人调用 · 生产</h2><p>gateway.corp.cn · /personal/v1 · ak_live_</p></div><span class="event-chip green">生产</span></div>
    <div style="padding:0 18px 18px;display:grid;gap:10px">
      <div class="api-endpoint"><code>https://gateway.corp.cn/personal/v1/chat/completions</code><button data-action="复制端点">复制</button></div>
      <div class="api-endpoint"><code>https://gateway.corp.cn/personal/v1/responses</code><button data-action="复制端点">复制</button></div>
      <div class="api-endpoint"><code>https://gateway.corp.cn/personal/v1/embeddings</code><button data-action="复制端点">复制</button></div>
      <div class="api-endpoint"><code>https://gateway.corp.cn/personal/v1/models</code><button data-action="复制端点">复制</button></div>
    </div>
  </article>
  <article class="card" style="margin-top:14px"><div class="card-head"><div><h2>个人调用 · 测试</h2><p>gateway-test.corp.cn · /personal/v1 · ak_test_</p></div><span class="event-chip orange">测试</span></div>
    <div style="padding:0 18px 18px;display:grid;gap:10px">
      <div class="api-endpoint"><code>https://gateway-test.corp.cn/personal/v1/chat/completions</code><button data-action="复制端点">复制</button></div>
      <div class="api-endpoint"><code>https://gateway-test.corp.cn/personal/v1/models</code><button data-action="复制端点">复制</button></div>
      <div class="permission-note" style="margin:0">${icons.shield}<span>须携带对应环境的个人 Key + 企业用户身份头；跨环境调用会被拒绝。</span></div>
    </div>
  </article>`;

const developerSecurity = () => `${pageHead('API KEY REQUEST','我的 API Key','开通时选择生产或测试；费用归所选组织层级，明文仅本人可复制。','<button class="btn primary" data-x="apply-api-key"><svg><use href="#i-plus"/></svg>开通个人 Key</button>')}
    <div id="x-security-api-panel"></div>`;

const developerUsage = () => `${pageHead('MY USAGE OVERVIEW','我的用量概览','按日 / 周 / 月查看消耗与分摊费用。','<button class="btn" data-page-jump="usage-detail">查看明细</button>')}`;
const developerUsageDetail = () => `${pageHead('MY USAGE DETAILS','我的用量明细','分页查看本人名下 Key 的调用明细，并可导出。','<button class="btn" data-page-jump="usage">返回概览</button>')}`;

const auditorAccess = () => `${pageHead('PERMISSION SNAPSHOT','权限快照','查看当前角色、成员和授权范围；审计员不能新增角色或修改权限。','')}
  <div class="permission-note" style="margin-bottom:15px">${icons.shield}<span>本页面为只读快照。所有权限变更需要由平台管理员发起并经过审批。</span></div>
  <article class="card"><div class="card-head"><div><h2>角色覆盖</h2><p>与成员管理、角色权限配置保持同步</p></div><span class="event-chip green">策略已同步</span></div><div class="providers-table"><table class="scope-table"><thead><tr><th>角色</th><th>成员</th><th>数据范围</th><th>关键能力</th><th>最近变更</th></tr></thead><tbody><tr><td>超级管理员</td><td>1</td><td>全局</td><td>平台全部功能与操作</td><td>2026-11-04 09:00:00</td></tr><tr><td>模型服务接入维护</td><td>2</td><td>全局</td><td>服务 / 源 / 路由与分发</td><td>2026-10-28 14:22:00</td></tr><tr><td>模型key分发审核人</td><td>2</td><td>全局</td><td>Key 签发与审批</td><td>2026-11-03 10:18:05</td></tr><tr><td>审计人员</td><td>2</td><td>全局只读</td><td>日志追溯、合规导出</td><td>2026-10-30 11:28:00</td></tr><tr><td>普通用户</td><td>21</td><td>所属部门</td><td>申请 Key、查看用量</td><td>2026-11-02 16:40:12</td></tr></tbody></table></div></article>`;

const roleViews = {
  ops:{overview:opsOverview}, auditor:{overview:auditorOverview,access:auditorAccess},
  developer:{overview:developerOverview,providers:developerProviders,routes:developerRoutes,'security-api':developerSecurity,usage:developerUsage,'usage-detail':developerUsageDetail}
};

let activeRole = (() => {
  const raw = localStorage.getItem('aegis-identity') || localStorage.getItem('aegis-role') || 'm-lichen';
  if (raw === 'm-guheng' || raw === 'superadmin') return 'm-lichen';
  if (raw === 'm-zhouning' || raw === 'developer') return 'm-dengyanfeng';
  return raw;
})();
let activePage = 'overview';

function normalizePageId(page) {
  if (page === 'security-callers' || page === 'security-kms') return 'security-api';
  if (page === 'workspaces') return 'members';
  if (page === 'audit') return 'audit-platform';
  if (page === 'billing') return 'usage';
  if (page === 'usage-detail') return 'usage-detail';
  return page;
}

function rememberActivePage(page) {
  try { localStorage.setItem('aegis-active-page', page); } catch {}
  try {
    const hash = `#${page}`;
    if ((location.hash || '') !== hash) history.replaceState(null, '', hash);
  } catch {}
}

function resolveInitialPage() {
  const role = roleConfigs[activeRole];
  const home = role?.home || 'overview';
  let wanted = '';
  try { wanted = (location.hash || '').replace(/^#\/?/, ''); } catch {}
  if (!wanted) {
    try { wanted = localStorage.getItem('aegis-active-page') || ''; } catch {}
  }
  wanted = normalizePageId(wanted);
  if (!wanted) return home;
  if (!role) return home;
  if (!role.fullAccess && !(role.pages || []).includes(wanted)) return home;
  return wanted;
}

function canRoleAction(action) {
  const cfg = roleConfigs[activeRole];
  if (!cfg) return false;
  if (cfg.fullAccess || (cfg.actions || []).includes('*')) return true;
  return (cfg.actions || []).includes(action);
}
function canRoleX(action) {
  const cfg = roleConfigs[activeRole];
  if (!cfg) return false;
  if (cfg.fullAccess || (cfg.x || []).includes('*')) return true;
  return (cfg.x || []).includes(action);
}
window.getActiveRole = () => activeRole;
window.getActiveRoleConfig = () => roleConfigs[activeRole];
window.getActivePage = () => activePage;
window.roleCanAction = canRoleAction;
window.roleCanX = canRoleX;
window.rebuildIdentitySwitcher = rebuildIdentitySwitcher;

function updateRoleShell() {
  const role = roleConfigs[activeRole];
  if (!role) return;
  // 硬校验：超管展示名固定为李晨
  if (role.role === '超级管理员' || activeRole === 'm-lichen' || activeRole === 'm-guheng') {
    role.name = '李晨';
    role.initials = identityInitials('李晨');
    role.id = 'm-lichen';
    role.memberId = 'm-lichen';
  }
  const allowed = new Set(role.pages || []);
  document.querySelector('.app-shell').dataset.role = role.viewProfile || activeRole;
  document.getElementById('role-avatar').textContent = role.initials;
  document.getElementById('role-user-name').textContent = role.name;
  document.getElementById('role-title').textContent = role.role;
  document.querySelectorAll('.main-nav .nav-item[data-page]').forEach(btn => {
    const page = btn.dataset.page;
    const allowedPage = role.fullAccess || allowed.has(page);
    btn.hidden = !allowedPage;
    btn.setAttribute('aria-hidden', allowedPage ? 'false' : 'true');
    const label = btn.querySelector('span');
    if (label) label.textContent = (roleNavLabels[role.viewProfile] || {})[page] || titles[page];
  });
  document.querySelectorAll('.main-nav .nav-group').forEach(group => {
    const children = [...group.querySelectorAll('.nav-subitem[data-page]')];
    const visibleCount = children.filter(el => role.fullAccess || allowed.has(el.dataset.page)).length;
    const visible = visibleCount > 0;
    group.hidden = !visible;
    group.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (visible) group.classList.add('open');
    const countEl = group.querySelector('.nav-group-count');
    if (countEl) {
      countEl.hidden = visibleCount < 1;
      countEl.textContent = String(visibleCount);
    }
  });
  document.querySelectorAll('.main-nav .nav-label').forEach(label => {
    let next = label.nextElementSibling;
    let visible = false;
    while (next && !next.classList.contains('nav-label')) {
      if (next.classList.contains('nav-item') && !next.hidden) visible = true;
      if (next.classList.contains('nav-group') && !next.hidden) visible = true;
      next = next.nextElementSibling;
    }
    label.hidden = !visible;
  });
  // 「可用模型」：仅在无「模型配置」分组时展示（如普通用户只读模型目录）
  const flatModel = document.querySelector('.main-nav .nav-flat-model[data-page="providers"]');
  if (flatModel) {
    const hasModelConfig = role.fullAccess || ['model-services', 'model-sources', 'security-api'].some((p) => allowed.has(p));
    flatModel.hidden = hasModelConfig || !allowed.has('providers');
  }
  const assistantToggle = document.getElementById('x-assistant-toggle');
  if (assistantToggle) {
    const canAssistant = role.fullAccess || allowed.has('assistant');
    assistantToggle.hidden = !canAssistant;
  }
  document.getElementById('role-menu-options').innerHTML = Object.entries(roleConfigs).map(([id,r])=>`<button class="role-option ${id===activeRole?'active':''}" type="button" role="menuitemradio" aria-checked="${id===activeRole}" data-role-id="${id}"><span class="role-option-avatar">${r.initials}</span><span class="role-option-copy"><strong>${r.name} · ${r.role}</strong><span>${r.scope}</span></span><em>当前</em></button>`).join('') || '<div class="empty-note" style="padding:14px">暂无已激活成员，请先在成员管理中激活账号</div>';
}

function syncNavActive(page) {
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));
  document.querySelectorAll('.nav-group').forEach(group => {
    const childActive = !!group.querySelector(`.nav-subitem[data-page="${page}"]`);
    group.classList.toggle('has-active', childActive);
    if (childActive) {
      group.classList.add('open');
      const toggle = group.querySelector('[data-nav-toggle]');
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }
  });
}

function applyRoleAccess() {
  content.querySelectorAll('[data-action]').forEach(el => el.classList.toggle('role-hidden', !canRoleAction(el.dataset.action)));
  content.querySelectorAll('button[data-x]').forEach(el => {
    if (String(el.dataset.x || '').startsWith('ov-')) return;
    el.classList.toggle('role-hidden', !canRoleX(el.dataset.x));
  });
  const implicit=[['新建角色','新建角色'],['权限矩阵','新建角色'],['创建密钥','创建密钥'],['成本规则','成本规则'],['分摊规则','成本规则'],['批量轮换','创建密钥'],['立即轮换','创建密钥']];
  content.querySelectorAll('button').forEach(btn=>{ const hit=implicit.find(([label])=>btn.textContent.includes(label)); if(hit && !canRoleAction(hit[1])) btn.classList.add('role-hidden'); });
}

function render(page) {
  page = normalizePageId(page);
  // 费用页已并入用量与费用；保留旧 page=billing 深链
  if (arguments.length && arguments[0] === 'billing') {
    try { sessionStorage.setItem('aegis-usage-tab', 'cost'); } catch {}
  }
  const role=roleConfigs[activeRole];
  if (!role) { rebuildIdentitySwitcher({refreshShell:false}); }
  const current = roleConfigs[activeRole];
  if (!current) return;
  if (!current.fullAccess && !current.pages.includes(page)) { showToast(`${current.role}没有访问“${titles[page] || page}”的权限`); page=current.home; }
  activePage = page;
  rememberActivePage(page);
  const scoped=(roleViews[current.viewProfile]||{})[page];
  delete content.dataset.enhanced;
  content.innerHTML = roleContext(current) + (scoped ? scoped() : (views[page] ? views[page]() : views.overview()));
  const pageTitle = (roleNavLabels[current.viewProfile]||{})[page] || titles[page];
  crumb.innerHTML = crumbParents[page]
    ? `<span>${crumbParents[page]}</span><i>/</i><strong>${pageTitle}</strong>`
    : `<strong>${pageTitle}</strong>`;
  syncNavActive(page);
  applyRoleAccess();
  window.scrollTo({top:0, behavior:'smooth'});
}

function switchRole(nextRole) {
  if (!roleConfigs[nextRole] || nextRole===activeRole) return;
  const stayPage = activePage;
  activeRole=nextRole;
  localStorage.setItem('aegis-identity', nextRole);
  localStorage.setItem('aegis-role', nextRole);
  const next = roleConfigs[nextRole];
  activePage = (next.fullAccess || (next.pages || []).includes(stayPage)) ? stayPage : next.home;
  updateRoleShell();
  closeRoleMenu();
  render(activePage);
  window.dispatchEvent(new CustomEvent('aegis:rolechange',{detail:{role:nextRole, memberId:nextRole, roleName:roleConfigs[nextRole].role}}));
  showToast(`已切换为 ${roleConfigs[nextRole].name}（${roleConfigs[nextRole].role}）`);
}

function closeRoleMenu() {
  const menu=document.getElementById('role-menu');
  menu.hidden=true;
  document.getElementById('role-switcher').setAttribute('aria-expanded','false');
}

document.addEventListener('click', event => {
  const roleToggle=event.target.closest('#role-switcher');
  const roleOption=event.target.closest('[data-role-id]');
  const roleMenu=document.getElementById('role-menu');
  if (roleToggle) {
    const open=roleMenu.hidden;
    roleMenu.hidden=!open;
    roleToggle.setAttribute('aria-expanded',String(open));
    return;
  }
  if (roleOption) { switchRole(roleOption.dataset.roleId); return; }
  if (!event.target.closest('#role-menu')) closeRoleMenu();
  const navToggle = event.target.closest('[data-nav-toggle]');
  if (navToggle) {
    const group = navToggle.closest('.nav-group');
    if (group) {
      const open = group.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    }
    return;
  }
  const nav = event.target.closest('[data-page]');
  const jump = event.target.closest('[data-page-jump]');
  const action = event.target.closest('[data-action]');
  if (nav) render(nav.dataset.page);
  if (jump) render(jump.dataset.pageJump);
  if (action) {
    if (!canRoleAction(action.dataset.action)) showToast(`${roleConfigs[activeRole].role}无此操作权限`);
    else if (action.dataset.action==='复制端点') {
      const endpoint=action.closest('.api-endpoint')?.querySelector('code')?.textContent || 'https://gateway.corp.cn';
      navigator.clipboard?.writeText(endpoint);
      showToast('调用端点已复制');
    }     else if (['接入模型','创建模型服务','新建角色','创建密钥','导出审计报告','导出账单','添加成员','批量导入成员'].includes(action.dataset.action)) {
      /* interactions.js 在捕获阶段处理真实弹窗 */
    } else showToast(`${action.dataset.action}入口已就绪，此原型中展示交互反馈`);
  }
  const tab = event.target.closest('.tabs button');
  if (tab) { tab.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active')); tab.classList.add('active'); showToast(`已切换到 ${tab.textContent} 数据范围`); }
});

document.addEventListener('keydown',event=>{ if(event.key==='Escape') closeRoleMenu(); });

function setSidebarCollapsed(collapsed) {
  const shell = document.querySelector('.app-shell');
  if (!shell || window.matchMedia('(max-width: 760px)').matches) return;
  shell.classList.toggle('nav-collapsed', !!collapsed);
  if (!collapsed) shell.classList.remove('nav-peek');
  localStorage.setItem('aegis-nav-collapsed', collapsed ? '1' : '0');
  const collapseBtn = document.querySelector('[data-sidebar-toggle="collapse"]');
  const expandBtn = document.querySelector('[data-sidebar-toggle="expand"]');
  if (collapseBtn) {
    collapseBtn.setAttribute('aria-label', collapsed ? '展开侧栏' : '收起为窄栏');
    collapseBtn.title = collapsed ? '展开侧栏' : '收起为窄栏（悬停可临时展开）';
  }
  if (expandBtn) {
    expandBtn.hidden = true;
    expandBtn.setAttribute('aria-expanded', String(!collapsed));
  }
  shell.setAttribute('data-nav', collapsed ? 'collapsed' : 'open');
}

function initSidebarToggle() {
  setSidebarCollapsed(localStorage.getItem('aegis-nav-collapsed') === '1');
  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-sidebar-toggle]');
    if (!toggle) return;
    const shell = document.querySelector('.app-shell');
    const collapsed = shell?.classList.contains('nav-collapsed');
    if (toggle.dataset.sidebarToggle === 'expand') setSidebarCollapsed(false);
    else if (toggle.dataset.sidebarToggle === 'collapse') setSidebarCollapsed(!collapsed);
  });

  // 收起态：窄栏悬停自动展开，移出后收回（保留窄条）
  const sidebar = document.getElementById('app-sidebar');
  let peekTimer = null;
  const clearPeekTimer = () => { if (peekTimer) { clearTimeout(peekTimer); peekTimer = null; } };
  const setPeek = on => {
    const shell = document.querySelector('.app-shell');
    if (!shell?.classList.contains('nav-collapsed')) return;
    shell.classList.toggle('nav-peek', !!on);
  };
  if (sidebar) {
    sidebar.addEventListener('mouseenter', () => {
      clearPeekTimer();
      setPeek(true);
    });
    sidebar.addEventListener('mouseleave', () => {
      clearPeekTimer();
      peekTimer = setTimeout(() => setPeek(false), 160);
    });
    sidebar.addEventListener('focusin', () => { clearPeekTimer(); setPeek(true); });
    sidebar.addEventListener('focusout', () => {
      clearPeekTimer();
      peekTimer = setTimeout(() => {
        if (!sidebar.contains(document.activeElement)) setPeek(false);
      }, 160);
    });
  }

  window.addEventListener('resize', () => {
    if (window.matchMedia('(max-width: 760px)').matches) {
      document.querySelector('.app-shell')?.classList.remove('nav-collapsed', 'nav-peek');
    } else {
      setSidebarCollapsed(localStorage.getItem('aegis-nav-collapsed') === '1');
    }
  });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-text').textContent = message;
  toast.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

window.render = render;
window.showToast = showToast;

new MutationObserver(()=>requestAnimationFrame(applyRoleAccess)).observe(content,{childList:true,subtree:true});
rebuildIdentitySwitcher({refreshShell:true});
initSidebarToggle();
window.addEventListener('hashchange', () => {
  const next = normalizePageId((location.hash || '').replace(/^#\/?/, ''));
  if (!next || next === activePage) return;
  render(next);
});
render(resolveInitialPage());
