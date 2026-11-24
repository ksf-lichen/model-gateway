# -*- coding: utf-8 -*-
"""康师傅企业模型网关 · 产品需求说明（PRD），基于控制台原型梳理。"""
from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "frd-shots"
OUT = ROOT.parent / "康师傅企业模型网关-原型功能需求说明-261123.docx"
OUT_ALT = ROOT.parent / "康师傅企业模型网关-原型功能需求说明-261123-v2.docx"
DOWNLOADS = Path.home() / "Downloads" / OUT.name


# ---------------------------------------------------------------------------
# 文档内容：按 PRD 结构组织；flows 描述按钮后的子页面 / 弹窗步骤
# ---------------------------------------------------------------------------

CHAPTERS = [
    {
        "title": "1 运行总览",
        "page": "运行总览",
        "nav": "侧栏 · 运行总览",
        "shot": "frd-01-overview.png",
        "goal": "给管理员一张运营看板，快速判断成本、调用量、渠道与 Key 是否健康，并支持导出。",
        "scope": [
            "展示本月/当日费用、请求、Token、渠道与令牌数量",
            "展示成本趋势、模型分布、部门×模型配额结构、24 小时热力",
            "不提供充值、调账或修改底层配置（配置跳转至对应管理页）",
        ],
        "list_features": [
            "时间范围：今日 / 近 7 天 / 近 30 天 / 自定义",
            "自动刷新与手动刷新；展示数据延迟与最近刷新时间",
            "KPI 卡片：本月总消耗（对照预算）、今日请求（峰值/P95/成功率）、今日 Token（上下行）",
            "渠道数量、令牌数量卡片，可跳转对应管理页",
            "成本与调用趋势；预算预警线",
            "模型成本分布、模型消耗排名、配额消耗结构、调用热力",
        ],
        "flows": [
            {
                "name": "导出运营报表",
                "trigger": "页头「导出报表」",
                "shot": "frd-s13-export.png",
                "steps": [
                    "打开「导出运营报表」弹窗",
                    "选择时间范围（含自定义起止日期）",
                    "选择文件格式：CSV / JSON",
                    "勾选导出字段：基础信息、资源标识、结果与耗时、完整请求体（可选）",
                    "确认「生成并下载」；操作写入本地审计痕迹",
                ],
            },
            {
                "name": "跳转用量概览",
                "trigger": "页头「用量概览」",
                "steps": ["进入「用量与费用 → 用量概览」页面，按日/周/月继续下钻"],
            },
            {
                "name": "渠道 / 令牌卡片跳转",
                "trigger": "渠道数量、令牌数量卡片上的管理入口",
                "steps": ["分别进入源模型能力接入、虚拟 Key 治理列表继续处理异常项"],
            },
        ],
    },
    {
        "title": "2 模型服务配置",
        "page": "模型服务配置",
        "nav": "模型配置 → 模型服务配置",
        "shot": "frd-02-model-services.png",
        "goal": "对外提供稳定的统一服务名（serviceId）；底层可挂多个源模型，由分发策略选路。调用方只认服务标识，不感知上游切换。",
        "scope": [
            "创建 / 编辑 / 启停 / 删除模型服务",
            "绑定已接入的源模型能力",
            "配置固定顺序或费用优先分发，并查看路由命中",
        ],
        "list_features": [
            "统计：对外服务、SaaS、本地，及生效 / 待资源 / 停用",
            "筛选：全部 / SaaS / 本地",
            "列表字段：名称、服务标识、部署类型、已绑源数、分发策略、当前命中源、状态",
            "行内操作：详情、编辑、配置策略、添加源、删除、启用开关",
        ],
        "flows": [
            {
                "name": "创建模型服务",
                "trigger": "「创建模型服务」",
                "shot": "frd-s01-create-service.png",
                "steps": [
                    "弹窗选择部署类型：SaaS 模型 / 本地模型（影响后续安全策略作用面）",
                    "填写服务显示名称、服务标识（创建后不可改）、能力类型、对外协议偏好、说明",
                    "确认「创建服务」；此时尚未绑源，状态多为「待添加源」",
                    "回到列表后，通过「添加源」或详情「绑定源」挂上已接入源",
                ],
            },
            {
                "name": "编辑模型服务",
                "trigger": "行内「编辑」",
                "steps": [
                    "打开同结构表单，服务标识只读",
                    "可改名称、能力、协议、说明、启用状态",
                    "「保存修改」后列表即时刷新",
                ],
            },
            {
                "name": "服务详情（次级页）",
                "trigger": "行内「详情」或点击服务名",
                "shot": "frd-s06-service-detail.png",
                "steps": [
                    "进入详情页，顶栏显示服务名、serviceId、部署类型、策略与运行状态",
                    "子页签「智能路由」：拓扑、调度时序、调度记录；可「配置策略」「刷新」",
                    "子页签「绑定源」：已绑源列表；「添加已有源」打开绑定选择；「更多」打开通道筛选抽屉",
                    "子页签「分发策略」：展示当前模式与主备通道；「打开策略配置」进入策略弹窗",
                    "返回列表保留原筛选状态",
                ],
            },
            {
                "name": "配置分发策略",
                "trigger": "行内「配置策略」或详情内同名按钮",
                "shot": "frd-s07-distribution.png",
                "steps": [
                    "弹窗展示用户调用名、统一标识、当前实际源、生效策略",
                    "切换策略模式：「实时费用最低优先」或「固定顺序」",
                    "固定顺序：调整源优先级、启用/停用候选、失败后顺序降级",
                    "费用优先：按当前时段、折扣与 Token 构成估算后排序展示",
                    "「添加已接入的源模型能力」：下拉选择未绑或改绑源 →「绑定到本服务」",
                    "无可用源时引导「去接入源模型」",
                    "「保存」后策略立即对后续请求生效",
                ],
            },
            {
                "name": "添加源 / 删除服务",
                "trigger": "「添加源」「删除」",
                "steps": [
                    "添加源：等同打开分发策略弹窗中的绑定区，或跳转源模型接入后再回来绑定",
                    "删除：二次确认弹窗，提示不可从页面恢复；确认后从列表移除并记本地配置变更",
                ],
            },
        ],
    },
    {
        "title": "3 源模型能力接入",
        "page": "源模型能力接入",
        "nav": "模型配置 → 源模型能力接入",
        "shot": "frd-03-model-sources.png",
        "goal": "按「厂商（连接凭证）→ 模型能力（标签/上下文/单价）」两层接入上游，供模型服务绑定使用。",
        "scope": [
            "厂商的增删改与连通性测试",
            "在厂商下批量或单条追加模型能力",
            "能力标签、上下文、计费（统一价 / 分时段 / 节假日 / 阶梯）配置",
        ],
        "list_features": [
            "公有云 / 私有化数量与启停、异常统计",
            "按厂商分组展示下属模型能力",
            "筛选：状态、所属服务、部署类型、能力声明、Input/Output、计费配置、关键词",
            "更多筛选抽屉、重置、导出明细",
        ],
        "flows": [
            {
                "name": "添加 / 编辑厂商",
                "trigger": "「添加厂商」或厂商卡片「编辑」",
                "shot": "frd-s02-provider-form.png",
                "steps": [
                    "填写协议类型、厂商名、Base URL、区域、上游 API Key",
                    "配置超时、并发、重试、健康检查、熔断阈值",
                    "「测试连接」：展示探测结果与延迟；凭证可缓存复用",
                    "「添加厂商 / 保存厂商」；能力标签不在此层配置，需「追加模型能力」",
                ],
            },
            {
                "name": "追加模型能力（4 步向导）",
                "trigger": "「追加模型能力」或厂商上「追加」",
                "shot": "frd-s03-append-models-s1.png",
                "steps": [
                    "第 1 步 · 选择模型：选定所属厂商（只读展示连接）；「拉取该厂商可用模型」或「下载 CSV 模板 / 上传 CSV 导入」；勾选待接入模型（全选 / 清空 / 仅未接入）",
                    "第 2 步 · 能力标签：快捷模板（Text / Vision / Image / Embeddings 等）；分别点亮至少 1 个 Input 与 1 个 Output；填写 Context length、Max tokens、补充说明",
                    "第 3 步 · 计费配置：币种、计费单位、采购折扣；统一价格或分时段（断点拆段）；可选独立节假日价；可选按供应商累计花费的阶梯计价；批量模式下支持 OpenRouter 预填、CSV、忙闲时价表",
                    "第 4 步 · 确认接入：核对厂商、模型清单、能力与单价摘要后「保存」",
                    "编辑已有模型：同向导结构，可从「编辑计费」直达第 3 步；连接参数改厂商层",
                ],
            },
            {
                "name": "模型详情（次级页）",
                "trigger": "点击某条模型能力",
                "steps": [
                    "概览：所属厂商、协议、绑定服务、能力标签、状态",
                    "计费详情：当前生效价段、折扣、节假日与阶梯摘要",
                    "性能：延迟、探测结果等",
                    "「更多操作」抽屉：编辑、解绑服务、删除等",
                    "可跳转所属模型服务详情",
                ],
            },
            {
                "name": "筛选与导出",
                "trigger": "「筛选」「导出明细」",
                "steps": [
                    "右侧筛选抽屉设置条件后「应用」或「重置」",
                    "导出打开通用导出弹窗（时间范围 / 格式 / 字段）",
                ],
            },
        ],
    },
    {
        "title": "4 虚拟 Key 治理（Key 签发与审批）",
        "page": "虚拟 Key 治理",
        "nav": "模型配置 → Key 签发与审批",
        "shot": "frd-04-security-api.png",
        "goal": "管理下游虚拟凭证全生命周期。调用方只持有虚拟 Key；按个人/应用场景、生产/测试环境、组织归属与模型白名单做治理。",
        "scope": [
            "开通个人 / 应用虚拟 Key（管理员直开；普通用户侧为开通/申请）",
            "限额、速率（QPM/RPM、TPM）、有效期、启停、轮换、删除",
            "批量 / 全量更新限额；详情查看明文（仅所有者时机）",
        ],
        "list_features": [
            "场景筛选：全部 / 个人 Key / 应用 Key",
            "列表：别名、掩码、环境、组织与费用归属、可调用服务、本周期用量、状态、有效期",
            "行内：详情、限额调整、轮换、启停、删除",
            "工具栏：创建个人 / 创建应用、批量更新限额、全量更新限额",
        ],
        "flows": [
            {
                "name": "选择开通场景",
                "trigger": "管理员侧综合开通入口（或先选场景再填表）",
                "shot": "frd-s04-key-scene.png",
                "steps": [
                    "弹窗二选一：场景 A 个人 Key / 场景 B 应用 Key",
                    "说明不可混用同一把 Key；可「重选场景」返回",
                ],
            },
            {
                "name": "开通个人虚拟 Key",
                "trigger": "「创建个人虚拟 Key」",
                "shot": "frd-s05-issue-key.png",
                "steps": [
                    "选择使用员工；组织层级（企业/部门）与费用归属",
                    "填写 Key 别名；绑定调用环境：生产 / 测试",
                    "限额周期、有效期预设或自定义到期时间",
                    "限制方式：仅 Token / 仅金额 / Token+金额 / 不限制",
                    "勾选可调用模型服务（至少 1 个）；个人默认更严白名单",
                    "配置上行/下行 Token、金额上限、超额策略（拒绝 429 / 仅告警）",
                    "速率限制：QPM/RPM、TPM（留空表示不限该项）",
                    "「确认开通」；明文仅所有者可见可复制",
                ],
            },
            {
                "name": "开通应用虚拟 Key",
                "trigger": "「创建应用虚拟 Key」",
                "steps": [
                    "选择或填写调用方；组织层级与费用归属",
                    "可选开启 AppId 双因子校验（开通时生成 AppId）",
                    "其余字段同个人 Key，默认限额与速率更高，并可「降级到低价模型」作为超额策略",
                    "「确认开通」",
                ],
            },
            {
                "name": "Key 详情（次级面板）",
                "trigger": "行内「详情」",
                "shot": "frd-s14-key-detail.png",
                "steps": [
                    "展示归属、环境、服务白名单、限额与速率、用量、生命周期时间戳",
                    "所有者可查看/复制明文；非所有者仅见掩码",
                    "可从此进入限额调整、轮换、启停",
                ],
            },
            {
                "name": "调整限额（单条 / 批量 / 全量）",
                "trigger": "「限额调整」或工具栏批量/全量",
                "steps": [
                    "单条：可改周期、有效期、限制方式、服务白名单、Token/金额、超额策略、QPM/TPM",
                    "批量：对勾选 Key 覆盖限额配置（不改白名单时按模式提示）",
                    "全量：对全部调用方 Key 统一覆盖",
                    "保存后对后续请求立即生效",
                ],
            },
            {
                "name": "轮换 / 启停 / 删除",
                "trigger": "行内对应按钮",
                "steps": [
                    "轮换：作废旧明文并生成新明文，旧请求鉴权失败",
                    "启停：停用后请求拒绝；启用恢复",
                    "删除：二次确认后移除；生产应由后端做依赖检查并留审计",
                ],
            },
            {
                "name": "申请与审批（审批开关开启时）",
                "trigger": "申请人「提交申请」；审核人待办「审批」",
                "steps": [
                    "申请表：用途、环境、组织、限额期望、速率期望；普通用户仅可申请个人 Key",
                    "审批表：只读申请人期望；管理员逐项确认环境、周期、有效期、限额、速率",
                    "勾选「已逐项确认限额策略」后才可「确认限额并开通」；或「驳回」并填备注",
                ],
            },
        ],
    },
    {
        "title": "5 业务路由",
        "page": "业务路由",
        "nav": "侧栏 · 业务路由",
        "shot": "frd-05-routes.png",
        "goal": "按「开放对象 × 环境」维护标准网关入口与调用方式开关，保证生产/测试隔离。",
        "scope": [
            "四类标准入口：个人生产、个人测试、应用生产、应用测试",
            "入口启停、标准调用方式开关、复制地址、追加独立路径",
        ],
        "list_features": [
            "展示路径：/personal/v1、/app/v1；生产/测试域名或端口隔离",
            "标准方式：对话补全、Responses、向量化、模型列表等开关",
            "复制默认地址 / 复制单条端点",
            "查看入口详情摘要",
        ],
        "flows": [
            {
                "name": "追加独立路径",
                "trigger": "「追加路径」",
                "shot": "frd-s12-route-append.png",
                "steps": [
                    "默认挂到当前选中的「对象 · 环境」入口下",
                    "填写路径、说明、启用状态",
                    "「追加」后列表出现自定义路径；四类标准入口本身不变",
                ],
            },
            {
                "name": "启停入口 / 调用方式",
                "trigger": "入口或方式上的开关",
                "steps": ["关闭后对应流量拒绝；开启恢复；状态即时反映在列表"],
            },
        ],
    },
    {
        "title": "6 成员管理",
        "page": "成员管理",
        "nav": "成员与权限 → 成员管理",
        "shot": "frd-06-members.png",
        "goal": "维护企业成员池：入池、分部门、赋角色、设消耗预算阈值（非充值余额）。",
        "scope": [
            "单条添加、批量导入、编辑、启用/禁用、移除",
            "按姓名 / 手机 / 用户 ID 搜索与状态筛选",
        ],
        "list_features": [
            "统计：总数 / 已激活 / 待激活等",
            "列表：姓名、手机、用户 ID、部门、角色、预算、状态",
            "新成员默认待激活，首次登录后激活",
        ],
        "flows": [
            {
                "name": "添加成员",
                "trigger": "「添加成员」",
                "shot": "frd-s10-member-add.png",
                "steps": [
                    "填写姓名、手机号；选择部门、角色",
                    "预算类型：不限制 / 按天 / 按月；按天或按月时填写额度（元）",
                    "「添加成员」入池",
                ],
            },
            {
                "name": "批量导入",
                "trigger": "「批量导入」",
                "steps": [
                    "下载 CSV 模板（姓名、手机号、部门、角色）",
                    "上传文件；单次最多 500 条；重复手机号跳过",
                    "「开始导入」并查看结果提示",
                ],
            },
            {
                "name": "编辑成员",
                "trigger": "行内「编辑」",
                "steps": [
                    "可改部门、角色、预算、启用状态",
                    "禁用后其 API Key 停止调用，成员仍保留在企业中",
                    "「保存更改」",
                ],
            },
        ],
    },
    {
        "title": "7 角色权限",
        "page": "角色权限",
        "nav": "成员与权限 → 角色权限",
        "shot": "frd-07-access.png",
        "goal": "用「页面可见性 + 操作能力」控制控制台菜单与按钮；内置角色不可破坏超级管理员底座。",
        "scope": [
            "新建 / 编辑 / 删除自定义角色",
            "配置 page.* 与 cap.*；权限矩阵对照",
        ],
        "list_features": [
            "角色卡片：名称、描述、范围、成员数、内置标识",
            "内置示例：超级管理员、模型服务接入维护、Key 分发审核、审计人员、普通用户",
        ],
        "flows": [
            {
                "name": "新建 / 编辑角色",
                "trigger": "「新建角色」或角色「编辑」",
                "shot": "frd-s11-role-form.png",
                "steps": [
                    "填写名称、描述、作用范围",
                    "按分组勾选页面权限与能力权限；支持组内全选 / 取消本组、全局全选 / 清空",
                    "超管角色锁定为只读查看",
                    "「创建角色 / 保存修改」后，对应用户下次进入按新权限显隐菜单与按钮",
                ],
            },
            {
                "name": "权限矩阵",
                "trigger": "「权限矩阵」",
                "shot": "frd-s15-matrix.png",
                "steps": [
                    "宽表对比各角色关键能力（模型、路由、密钥、审计、费用导出等）",
                    "只读对照，关闭即可",
                ],
            },
            {
                "name": "删除自定义角色",
                "trigger": "删除",
                "steps": ["二次确认；内置超管不可删；有成员占用时应先迁移角色（实现侧校验）"],
            },
        ],
    },
    {
        "title": "8 用量概览",
        "page": "用量概览",
        "nav": "用量与费用 → 用量概览",
        "shot": "frd-08-usage.png",
        "goal": "按日/周/月看 Token 与费用趋势、组织排行与成本结构。本模块不提供充值入口。",
        "scope": [
            "趋势与排行展示",
            "高级筛选后跳转明细或导出",
        ],
        "list_features": [
            "时间粒度与周期",
            "Token / 费用趋势",
            "组织、应用、服务等多维排行与成本结构",
        ],
        "flows": [
            {
                "name": "高级筛选",
                "trigger": "筛选按钮",
                "steps": [
                    "打开用量筛选抽屉：Key、服务、源、部门、组织层级、主体类型等",
                    "「应用」刷新图表；「重置」清空条件",
                ],
            },
            {
                "name": "查看明细",
                "trigger": "「查看明细」",
                "steps": ["进入用量明细页，继承或可再调筛选条件"],
            },
            {
                "name": "导出",
                "trigger": "导出相关入口（权限控制）",
                "steps": ["打开导出弹窗，选择范围与格式后下载"],
            },
        ],
    },
    {
        "title": "9 用量明细",
        "page": "用量明细",
        "nav": "用量与费用 → 用量明细",
        "shot": "frd-09-usage-detail.png",
        "goal": "分页查看调用级费用明细，便于对账与追责。",
        "scope": ["筛选、分页、导出；普通用户仅本人名下 Key"],
        "list_features": [
            "字段：日期、组织、主体类型、Key、应用/个人、部门、服务、源模型、上下行 Token、缓存、费用等",
            "上一页 / 下一页",
        ],
        "flows": [
            {
                "name": "明细筛选与导出",
                "trigger": "筛选 / 导出",
                "steps": [
                    "抽屉设置条件后应用",
                    "导出 CSV；返回概览可点「返回概览」",
                ],
            },
        ],
    },
    {
        "title": "10 接入说明",
        "page": "接入说明",
        "nav": "侧栏 · 接入说明",
        "shot": "frd-10-integration.png",
        "goal": "给开发者一份可落地的调用说明：鉴权差异、环境隔离、示例与检查清单。",
        "scope": ["只读文档页；支持复制示例"],
        "list_features": [
            "个人 Key vs 应用 Key 调用方式对照表",
            "生产 / 测试入口与 Key 环境绑定说明",
            "个人示例（含用户身份头）、应用示例（Bearer，可选 AppId）",
            "对接检查清单",
        ],
        "flows": [
            {
                "name": "复制示例",
                "trigger": "示例区复制按钮",
                "steps": ["将 curl / SDK 片段写入剪贴板，提示复制成功"],
            },
        ],
    },
    {
        "title": "11 安全策略",
        "page": "安全策略",
        "nav": "侧栏 · 安全策略",
        "shot": "frd-11-security-policies.png",
        "goal": "按 SaaS / 本地差异配置脱敏、出域、越权、内容安全、本地端点与资源治理等规则；命中写入策略审计。",
        "scope": ["新建 / 编辑 / 启停；按模型类型筛选；跳转命中审计"],
        "list_features": [
            "列表：名称、编码、模型类型、类型、动作、范围、累计命中、更新时间、启用",
            "筛选 Tab：全部 / SaaS / 本地",
        ],
        "flows": [
            {
                "name": "新建 / 编辑策略",
                "trigger": "「新建策略」或「编辑」",
                "shot": "frd-s08-policy-form.png",
                "steps": [
                    "选择作用模型类型：全部 / 仅 SaaS / 仅本地（切换后可选策略类型随之变化）",
                    "填写策略名称、编码",
                    "选择类型与动作（如脱敏后放行、立即拦截、告警并放行等，依类型而定）",
                    "作用域：全局 / 指定部门；可选部门",
                    "填写说明；「保存」",
                    "列表开关控制是否生效；「查看命中审计」跳转策略命中页",
                ],
            },
        ],
    },
    {
        "title": "12 审计日志 · 平台操作",
        "page": "平台操作",
        "nav": "审计日志 → 平台操作",
        "shot": "frd-12-audit-platform.png",
        "goal": "记录控制面变更：配置、成员、Key、策略等，满足追责与合规导出。",
        "scope": ["列表、筛选、详情抽屉、导出报告"],
        "list_features": [
            "时间、操作者、对象、动作、结果",
            "时间范围与关键词筛选",
        ],
        "flows": [
            {
                "name": "查看详情",
                "trigger": "行点击或「详情」",
                "steps": ["右侧抽屉展示操作前后差异、追踪信息；可复制关键 ID"],
            },
            {
                "name": "导出审计报告",
                "trigger": "「导出报告」",
                "steps": ["导出弹窗选范围与格式；需具备导出权限"],
            },
        ],
    },
    {
        "title": "13 审计日志 · 策略命中",
        "page": "策略命中",
        "nav": "审计日志 → 策略命中",
        "shot": "frd-13-audit-policy.png",
        "goal": "记录安全策略触发事件，支撑风险核查。",
        "scope": ["列表、风险标识、详情、导出"],
        "list_features": [
            "策略名、请求方、模型/服务、动作结果、风险等级、时间、追踪 ID",
        ],
        "flows": [
            {
                "name": "详情与导出",
                "trigger": "行详情 / 导出",
                "steps": [
                    "抽屉查看命中上下文与关联请求",
                    "可跳转安全策略页核对规则配置",
                    "导出同通用导出流程",
                ],
            },
        ],
    },
    {
        "title": "14 审计日志 · 调用日志",
        "page": "调用日志",
        "nav": "审计日志 → 调用日志",
        "shot": "frd-14-audit-request.png",
        "goal": "数据面全链路记录：鉴权、选源、Token、费用、失败与 failover。",
        "scope": ["列表、筛选、载荷查看（脱敏/截断）、导出"],
        "list_features": [
            "时间、Key、服务、源、状态、延迟、Token、费用",
            "failover 切换轨迹（如有）",
        ],
        "flows": [
            {
                "name": "调用详情",
                "trigger": "行详情",
                "steps": [
                    "抽屉展示请求/响应摘要、选源过程、计费明细",
                    "完整请求体是否可见受策略与权限约束",
                ],
            },
        ],
    },
    {
        "title": "15 告警规则",
        "page": "告警规则",
        "nav": "侧栏 · 告警规则",
        "shot": "frd-15-alerts.png",
        "goal": "对延迟、错误率、预算、上游配额设阈值；触发后进通知中心并可跳转审计。",
        "scope": ["新建 / 编辑 / 启停；打开通知中心"],
        "list_features": [
            "列表：名称、渠道、指标、阈值与窗口、严重级别、部门、最近触发、启用",
        ],
        "flows": [
            {
                "name": "新建 / 编辑规则",
                "trigger": "「新建规则」或「编辑」",
                "shot": "frd-s09-alert-form.png",
                "steps": [
                    "填写规则名称",
                    "选择指标：延迟 / 错误率 / 预算 / 上游配额",
                    "填写阈值、窗口、严重级别（提醒/警告/严重）、作用部门",
                    "「保存」；列表开关控制启用",
                ],
            },
            {
                "name": "通知中心",
                "trigger": "「打开通知中心」或顶栏铃铛",
                "steps": [
                    "抽屉列出告警与系统通知",
                    "可从通知跳转审计或回到本页调整规则",
                ],
            },
        ],
    },
    {
        "title": "16 助手配置",
        "page": "助手配置",
        "nav": "侧栏 · 助手配置",
        "shot": "frd-16-assistant.png",
        "goal": "配置控制台内嵌智能体共用的模型服务；用量记入平台内置 Key，纳入统一计量。",
        "scope": [
            "选择共用模型服务",
            "打开对话边栏；在运维助手与开票智能体间切换",
        ],
        "list_features": [
            "模型服务选择器",
            "运维助手：基于平台快照解读健康、费用与配置，不编造未接入数据",
            "开票智能体：选择已接入厂商、指引补全开票资料，不擅自代提交",
        ],
        "flows": [
            {
                "name": "打开对话边栏",
                "trigger": "「打开对话边栏」或顶栏智能体入口",
                "steps": [
                    "右侧边栏展开；切换「运维助手」「开票智能体」",
                    "发送问题；回复依赖当前选中模型服务与平台只读快照",
                    "关闭边栏不影响主页面状态",
                ],
            },
            {
                "name": "查看用量",
                "trigger": "「查看用量」",
                "steps": ["跳转用量概览，核对助手相关消耗"],
            },
        ],
    },
]


ROLE_CHAPTER = {
    "title": "17 角色视图差异",
    "intro": "同一功能在不同角色下菜单文案与可写范围不同。验收时按角色各走一遍主路径。",
    "items": [
        "超级管理员：全量模块与写操作",
        "模型服务接入维护：服务 / 源 / 路由 / 调用排查 / 告警为主；无成员费用主密钥写权限",
        "模型 Key 分发审核人：Key 签发与审批、成员申请人、用量",
        "审计人员：策略与三类审计只读、费用核查、导出；隐藏新增编辑轮换发布",
        "普通用户：可用模型、调用路由、我的 API Key、我的用量、接入说明；开通个人 Key",
    ],
}

COMMON = {
    "ia": [
        "运行总览",
        "模型配置：模型服务配置 / 源模型能力接入 / Key 签发与审批",
        "业务路由",
        "成员与权限：成员管理 / 角色权限",
        "用量与费用：用量概览 / 用量明细",
        "接入说明",
        "安全策略",
        "审计日志：平台操作 / 策略命中 / 调用日志",
        "告警规则",
        "助手配置",
    ],
    "cross": [
        "顶栏：全局搜索（命令面板）、智能体、通知、身份/角色切换",
        "菜单与按钮随角色 page.* / cap.* 显隐",
        "网关环境：生产 8787、测试 8788；控制台展示在线状态",
        "无充值：用量与费用不提供余额账户或充值入口",
        "通用导出弹窗：时间范围、CSV/JSON、字段勾选",
        "通用删除确认：展示对象名，确认后移除并记变更",
    ],
}


def set_run_font(run, *, size=11, bold=False, name="微软雅黑", color=None):
    run.bold = bold
    run.font.size = Pt(size)
    run.font.name = name
    if color is not None:
        run.font.color.rgb = color
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.get_or_add_rFonts()
    rFonts.set(qn("w:eastAsia"), name)
    rFonts.set(qn("w:ascii"), "Calibri")
    rFonts.set(qn("w:hAnsi"), "Calibri")


def style_paragraph(p, *, after=6, before=0, line=1.15):
    pf = p.paragraph_format
    pf.space_after = Pt(after)
    pf.space_before = Pt(before)
    pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    pf.line_spacing = line


def add_para(doc, text, *, size=11, bold=False, center=False, after=6, color=None):
    p = doc.add_paragraph()
    if center:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(text)
    set_run_font(run, size=size, bold=bold, color=color)
    style_paragraph(p, after=after)
    return p


def chapter_no(title: str) -> str:
    """'10 接入说明' -> '10'；避免把整段标题当序号。"""
    return title.split(" ", 1)[0]


def add_heading_styled(doc, text, level=1):
    """Use real Word Heading styles so TOC can pick them up. Strip auto-numbering."""
    style_name = f"Heading {level}"
    p = doc.add_paragraph(text, style=style_name)
    # 去掉模板可能带的多级列表编号，避免出现「1. 1 运行总览」这类双序号
    pPr = p._element.get_or_add_pPr()
    for child in list(pPr):
        if child.tag == qn("w:numPr"):
            pPr.remove(child)
    for run in p.runs:
        set_run_font(run, size=16 if level == 1 else 13 if level == 2 else 11, bold=True, name="微软雅黑")
    style_paragraph(p, before=12 if level == 1 else 8, after=6)
    return p


def add_bullets(doc, items, *, size=10.5):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.clear()
        run = p.add_run(item)
        set_run_font(run, size=size)
        style_paragraph(p, after=2)


def add_numbered(doc, items, *, size=10.5):
    """手写 1. 2. 3.，每段流程各自从 1 起算，避免全文 List Number 连号。"""
    for i, item in enumerate(items, 1):
        p = doc.add_paragraph()
        run = p.add_run(f"{i}. {item}")
        set_run_font(run, size=size)
        p.paragraph_format.left_indent = Cm(0.5)
        style_paragraph(p, after=2)


def add_shot(doc, filename: str, caption: str):
    path = SHOTS / filename
    if not path.exists():
        add_para(doc, f"（截图待补：{caption}）", size=9, color=RGBColor(0x88, 0x88, 0x88))
        return False
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run()
    run.add_picture(str(path), width=Inches(6.1))
    style_paragraph(p, after=2)
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = cap.add_run(caption)
    set_run_font(r, size=9, name="宋体", color=RGBColor(0x55, 0x55, 0x55))
    style_paragraph(cap, after=10)
    return True


def _set_update_fields_on_open(doc):
    settings = doc.settings.element
    upd = OxmlElement("w:updateFields")
    upd.set(qn("w:val"), "true")
    settings.append(upd)


def add_toc(doc):
    # 不用 Heading，避免目录自身进入 TOC / 与正文抢序号
    add_para(doc, "目录", size=16, bold=True, after=8)
    add_para(
        doc,
        "下列条目与正文标题序号一致。打开 Word 后可在下方域上右键「更新域」生成带页码目录。",
        size=9,
        color=RGBColor(0x66, 0x66, 0x66),
        after=8,
    )

    # 静态目录：与正文编号完全对齐
    add_para(doc, "0 文档说明", size=10.5, bold=True, after=1)
    add_para(doc, "    0.1 信息架构", size=9.5, after=0, color=RGBColor(0x44, 0x44, 0x44))
    add_para(doc, "    0.2 跨模块约定", size=9.5, after=2, color=RGBColor(0x44, 0x44, 0x44))
    for ch in CHAPTERS:
        n = chapter_no(ch["title"])
        add_para(doc, ch["title"], size=10.5, bold=True, after=1)
        add_para(doc, f"    {n}.1 目标与范围", size=9.5, after=0, color=RGBColor(0x44, 0x44, 0x44))
        add_para(doc, f"    {n}.2 列表页能力", size=9.5, after=0, color=RGBColor(0x44, 0x44, 0x44))
        add_para(doc, f"    {n}.3 交互流程（按钮 → 子页面）", size=9.5, after=0, color=RGBColor(0x44, 0x44, 0x44))
        for i, flow in enumerate(ch.get("flows") or [], 1):
            add_para(doc, f"        {n}.3.{i} {flow['name']}", size=9, after=0, color=RGBColor(0x55, 0x55, 0x55))
        add_para(doc, "", size=6, after=2)
    add_para(doc, ROLE_CHAPTER["title"], size=10.5, bold=True, after=1)
    add_para(doc, "18 附录", size=10.5, bold=True, after=10)

    # Word 自动目录域（可选，更新后带页码）
    paragraph = doc.add_paragraph()
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = 'TOC \\o "1-3" \\h \\z \\u'
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "（更新域后可显示带页码目录）"
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    r = run._r
    r.append(fld_begin)
    r.append(instr)
    r.append(fld_sep)
    r.append(text)
    r.append(fld_end)


def add_meta_table(doc):
    table = doc.add_table(rows=6, cols=2)
    table.style = "Table Grid"
    rows = [
        ("文档类型", "产品需求说明（PRD）· 原型功能基线"),
        ("产品", "康师傅企业模型网关控制台"),
        ("依据", "本地原型 http://127.0.0.1:8765 （超级管理员视角）"),
        ("读者", "产品、研发、测试、实施"),
        ("版本日期", "2026-11-23"),
        ("说明", "交互步骤以原型可点路径为准；实现可优化交互形态，能力应对齐"),
    ]
    for i, (k, v) in enumerate(rows):
        table.rows[i].cells[0].text = k
        table.rows[i].cells[1].text = v
        for cell in table.rows[i].cells:
            for p in cell.paragraphs:
                for run in p.runs:
                    set_run_font(run, size=10)


def write_chapter(doc, ch: dict):
    n = chapter_no(ch["title"])
    add_heading_styled(doc, ch["title"], level=1)
    add_para(doc, f"页面：{ch['page']}　　导航：{ch['nav']}", size=10, color=RGBColor(0x44, 0x44, 0x44))

    add_heading_styled(doc, f"{n}.1 目标与范围", level=2)
    add_para(doc, ch["goal"], size=10.5)
    add_para(doc, "范围", size=10.5, bold=True, after=2)
    add_bullets(doc, ch["scope"])

    add_heading_styled(doc, f"{n}.2 列表页能力", level=2)
    add_bullets(doc, ch["list_features"])
    add_para(doc, "列表页示意", size=10.5, bold=True, after=2)
    add_shot(doc, ch["shot"], f"图 {ch['title']} · 列表/主界面")

    add_heading_styled(doc, f"{n}.3 交互流程（按钮 → 子页面）", level=2)
    for i, flow in enumerate(ch.get("flows") or [], 1):
        add_heading_styled(doc, f"{n}.3.{i} {flow['name']}", level=3)
        add_para(doc, f"入口：{flow['trigger']}", size=10, after=3)
        add_numbered(doc, flow["steps"])
        shot = flow.get("shot")
        if shot:
            add_shot(doc, shot, f"图 {flow['name']}")


def _strip_heading_auto_number(doc):
    """清除 Heading 1–3 样式上的自动编号，只保留正文里手写的 1 / 1.1 / 1.3.1。"""
    for name in ("Heading 1", "Heading 2", "Heading 3"):
        try:
            style = doc.styles[name]
        except KeyError:
            continue
        pPr = style.element.get_or_add_pPr()
        for child in list(pPr):
            if child.tag == qn("w:numPr"):
                pPr.remove(child)


def build():
    doc = Document()
    _strip_heading_auto_number(doc)
    section = doc.sections[0]
    section.top_margin = Cm(2.0)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(2.2)
    section.right_margin = Cm(2.2)

    # Cover
    add_para(doc, "康师傅企业模型网关", size=22, bold=True, center=True, after=8)
    add_para(doc, "产品需求说明（PRD）", size=16, bold=True, center=True, after=6)
    add_para(doc, "基于控制台原型的功能与交互基线", size=11, center=True, after=18)
    add_para(doc, "2026-11-23", size=11, center=True, after=18)
    add_meta_table(doc)
    doc.add_page_break()

    add_toc(doc)
    doc.add_page_break()

    add_heading_styled(doc, "0 文档说明", level=1)
    add_para(
        doc,
        "本文按控制台导航拆模块，写清每块做什么、列表上有什么、点哪个按钮进入哪段流程。"
        "截图来自当前原型；若交互控件改名，以「同义入口」验收。",
        size=10.5,
    )
    add_heading_styled(doc, "0.1 信息架构", level=2)
    add_bullets(doc, COMMON["ia"])
    add_heading_styled(doc, "0.2 跨模块约定", level=2)
    add_bullets(doc, COMMON["cross"])
    doc.add_page_break()

    for ch in CHAPTERS:
        write_chapter(doc, ch)

    add_heading_styled(doc, ROLE_CHAPTER["title"], level=1)
    add_para(doc, ROLE_CHAPTER["intro"], size=10.5)
    add_bullets(doc, ROLE_CHAPTER["items"])

    add_heading_styled(doc, "18 附录", level=1)
    add_bullets(
        doc,
        [
            f"截图目录：{SHOTS}",
            "控制台：http://127.0.0.1:8765",
            "网关生产 / 测试：http://127.0.0.1:8787 / 8788",
            "本文是原型功能基线，不替代详细设计或接口说明书",
        ],
    )

    _set_update_fields_on_open(doc)
    saved = []
    for path in (OUT, OUT_ALT, DOWNLOADS):
        try:
            doc.save(path)
            saved.append(str(path))
            print("Wrote", path)
        except Exception as e:
            print("Skip", path, "->", e)
    if not saved:
        raise SystemExit("未能写入任何输出路径（文件可能被 Word 占用，请先关闭再重试）")


if __name__ == "__main__":
    build()
