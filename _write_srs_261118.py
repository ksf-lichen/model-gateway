# -*- coding: utf-8 -*-
"""Generate vendor-oriented SRS (capability-level, no detailed design)."""
from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.shared import Cm, Pt


OUT = Path(__file__).resolve().parent / "康师傅企业模型网关项目需求说明书-261118.docx"
DOWNLOADS = Path.home() / "Downloads" / OUT.name


def set_run_font(run, *, size=11, bold=False, name="宋体"):
    run.bold = bold
    run.font.size = Pt(size)
    run.font.name = name
    r = run._element
    rPr = r.get_or_add_rPr()
    rFonts = rPr.get_or_add_rFonts()
    rFonts.set(qn("w:ascii"), "Calibri" if name != "黑体" else "Arial")
    rFonts.set(qn("w:hAnsi"), "Calibri" if name != "黑体" else "Arial")
    rFonts.set(qn("w:eastAsia"), name)


def add_title(doc, text, size=22):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(text)
    set_run_font(run, size=size, bold=True, name="黑体")
    p.paragraph_format.space_after = Pt(6)
    return p


def add_heading_cn(doc, text, level=1):
    p = doc.add_paragraph()
    run = p.add_run(text)
    size = 14 if level == 1 else 12
    set_run_font(run, size=size, bold=True, name="黑体")
    p.paragraph_format.space_before = Pt(14 if level == 1 else 10)
    p.paragraph_format.space_after = Pt(6)
    return p


def add_body(doc, text):
    p = doc.add_paragraph()
    run = p.add_run(text)
    set_run_font(run, size=11, name="宋体")
    p.paragraph_format.first_line_indent = Cm(0.74)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    p.paragraph_format.space_after = Pt(4)
    return p


def add_bullet(doc, text, level=0):
    p = doc.add_paragraph(style="List Bullet")
    p.clear()
    run = p.add_run(text)
    set_run_font(run, size=11, name="宋体")
    p.paragraph_format.left_indent = Cm(0.75 + level * 0.5)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    p.paragraph_format.space_after = Pt(2)
    return p


def add_meta_table(doc):
    table = doc.add_table(rows=3, cols=2)
    table.style = "Table Grid"
    rows = [
        ("专案名称", "康师傅企业模型网关平台建设"),
        ("日  期", "26/11/18"),
        ("撰写人", "（待填写）"),
    ]
    for i, (k, v) in enumerate(rows):
        table.rows[i].cells[0].text = k
        table.rows[i].cells[1].text = v
        for cell in table.rows[i].cells:
            for para in cell.paragraphs:
                for run in para.runs:
                    set_run_font(run, size=10.5, name="宋体")
    doc.add_paragraph()


def build():
    doc = Document()
    section = doc.sections[0]
    section.top_margin = Cm(2.5)
    section.bottom_margin = Cm(2.5)
    section.left_margin = Cm(2.5)
    section.right_margin = Cm(2.5)

    add_title(doc, "康师傅企业模型网关", 20)
    add_title(doc, "项目需求说明书", 18)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run("（面向厂商方案响应 · 能力需求版）")
    set_run_font(run, size=11, name="楷体")
    doc.add_paragraph()
    add_meta_table(doc)

    # 一
    add_heading_cn(doc, "一、项目背景与建设目标")
    add_body(
        doc,
        "随着大模型能力在企业内多业务线落地，模型调用呈现多厂商、多协议、多密钥、多计费口径并存的局面。"
        "若各应用自行对接上游，将导致凭证分散、费用无法归集、开放范围失控、审计链路断裂。"
        "本项目建设统一的企业模型网关及管理控制台，作为企业内模型能力的统一入口与治理中枢。",
    )
    add_body(doc, "建设目标如下：")
    add_bullet(doc, "统一接入与对外发布：屏蔽上游差异，对下游提供稳定、可治理的调用入口。")
    add_bullet(doc, "费用可核算、可分摊：按结算规则计量调用费用，支撑对上结算与对内成本归集。")
    add_bullet(doc, "能力开放可控：以虚拟凭证与审批机制控制「谁可调用什么、调用多少、归属何处」。")
    add_bullet(doc, "运维与开票可协同：提供运维解读与供应商开票辅助能力，降低日常运营成本。")

    # 二
    add_heading_cn(doc, "二、产品定位与边界")
    add_heading_cn(doc, "2.1 产品定位", 2)
    add_body(doc, "平台定位为三项核心能力的组合，不以「充值钱包型模型超市」形态建设：")
    add_bullet(doc, "模型能力中转：统一接入上游厂商与模型能力，统一对外发布模型服务。")
    add_bullet(doc, "费用结算分发：按结算价与调用量核算费用，按组织 / 服务 / 虚拟凭证归属分摊，支撑对上结算与对内费用治理。")
    add_bullet(doc, "模型能力开放审核：对下游开放范围、限额与凭证生命周期进行申请、审批与治理。")

    add_heading_cn(doc, "2.2 明确边界（不在本平台建设范围内）", 2)
    add_bullet(doc, "不提供充值、预付费钱包、可用余额账户或线上支付收银。")
    add_bullet(doc, "不以「平台余额扣款」完成资金闭环；费用闭环路径为：调用计量 → 结算核算 → 限额/预算治理 → 对下游供应商开票结算。")
    add_bullet(doc, "不保障绕过网关直连上游的调用；相关管理制度可由企业另行约定，本系统只对经网关的流量负责。")
    add_bullet(doc, "本说明书描述「能力与约束」，不规定具体技术架构、中间件选型、接口字段与页面交互细节；由厂商提出可落地的解决方案。")

    add_heading_cn(doc, "2.3 产品形态总览", 2)
    add_bullet(doc, "网关运行面：承接下游调用、鉴权限流、选源转发、计量记账、安全策略与审计落库；生产与测试环境隔离。")
    add_bullet(doc, "控制台治理面：厂商与模型能力接入、对外服务与分发策略、虚拟凭证与开放审核、组织权限、用量费用、告警与审计。")
    add_bullet(doc, "智能体辅助面：运维助手（健康 / 费用 / 配置解读）与开票智能体（供应商开票协同）；为控制台内嵌辅助能力，不替代网关转发与计费事实源。")

    # 三
    add_heading_cn(doc, "三、适用场景与角色")
    add_heading_cn(doc, "3.1 核心业务场景", 2)
    add_bullet(doc, "场景 A · 个人试用 / 内部助手：员工具名使用个人凭证调用已授权模型服务，费用归所属组织，须绑定企业用户身份。")
    add_bullet(doc, "场景 B · 业务应用接入：系统或服务以应用凭证调用，终端用户不必登录本平台；可按应用 SLA 配置更高吞吐与限额。")
    add_bullet(doc, "场景 C · 多厂商能力汇聚：同一对外服务名下挂载多个上游源，按策略选源并在故障时切换，调用方无感。")
    add_bullet(doc, "场景 D · 生产与测试隔离：测试流量与生产流量分入口、分凭证，禁止跨环境串用。")
    add_bullet(doc, "场景 E · 结算与开票：按结算规则出具用量账单，并对已接入厂商发起开票协同（不经平台充值）。")
    add_bullet(doc, "场景 F · 运维排障与治理：通过审计、告警与运维助手定位故障、费用异常与配置问题。")

    add_heading_cn(doc, "3.2 主要角色（能力视角）", 2)
    add_bullet(doc, "平台管理员：全局配置、权限、安全与费用治理。")
    add_bullet(doc, "模型运维：厂商接入、模型能力维护、对外服务与分发策略。")
    add_bullet(doc, "开放审核人：审批虚拟凭证申请（可调用范围、限额、归属、环境等）。")
    add_bullet(doc, "组织 / 部门管理员：本组织成员、预算阈值、本组织用量与审批协同。")
    add_bullet(doc, "业务开发 / 普通用户：查看可用能力、申请或持有个人凭证、查看本人用量。")
    add_bullet(doc, "安全审计：只读查阅审计、合规导出与费用核验。")

    # 四 核心功能点
    add_heading_cn(doc, "四、核心功能点")
    add_body(
        doc,
        "以下为必须具备的核心能力点。表述为「要达成什么」，不限定实现方式。"
        "厂商可在响应方案中给出架构、技术选型与交互设计，但验收以本能力清单为准。",
    )

    add_heading_cn(doc, "4.1 厂商与源模型能力接入", 2)
    add_bullet(doc, "F1 厂商与模型能力分层管理：厂商侧管理连接与凭证等共用信息；模型能力挂在厂商下独立维护。")
    add_bullet(doc, "F2 模型能力标签与规格：支持输入 / 输出模态标签（如文本、图像、视频等）、上下文长度、最大生成长度等能力描述，供目录筛选与开放决策使用。")
    add_bullet(doc, "F3 批量纳入能力：支持在已有厂商下追加模型能力（含目录拉取或批量导入等任一可行方式）。")
    add_bullet(doc, "F4 连通性验证：可对上游连接做探测，并保留探测结果供运维判断。")
    add_bullet(doc, "F5 供应商主数据同源：源模型接入中的厂商即开票等场景的供应商主数据，不得另建第二套供应商库。")
    add_bullet(doc, "F6 上游凭证安全：上游真实密钥不得在普通列表、一般审计正文中明文展示；须具备托管或等价的安全保管能力（具体实现由方案给出）。")

    add_heading_cn(doc, "4.2 对外模型服务与智能分发", 2)
    add_bullet(doc, "S1 对外统一服务名：创建逻辑模型服务，调用方只使用服务名，不感知底层厂商与源。")
    add_bullet(doc, "S2 部署形态区分：至少支持公有云 / SaaS 与本地 / 私有化类能力在服务层可区分管理。")
    add_bullet(doc, "S3 多源绑定：一个对外服务可绑定多个已接入源模型。")
    add_bullet(doc, "S4 分发策略：至少支持「固定优先级 + 失败切换」与「费用优先选源」两类策略能力。")
    add_bullet(doc, "S5 故障切换可追溯：上游失败时自动切换候选源，并保留切换过程供审计与排障。")
    add_bullet(doc, "S6 无可用上游时的明确失败：不得静默丢弃请求；须返回可理解的失败信息。")

    add_heading_cn(doc, "4.3 统一调用入口与协议兼容", 2)
    add_bullet(doc, "G1 面向下游提供统一调用入口，协议兼容主流 OpenAI 风格调用习惯，降低业务改造成本。")
    add_bullet(doc, "G2 按开放对象区分入口：个人调用与应用调用分轨，鉴权要求不同。")
    add_bullet(doc, "G3 生产 / 测试环境隔离：分环境入口；凭证签发时绑定环境，跨环境调用必须拒绝。")
    add_bullet(doc, "G4 个人调用须携带可核验的企业用户身份；应用调用默认仅凭应用凭证，可选启用应用标识双因子校验。")
    add_bullet(doc, "G5 支持对话补全、向量化、模型列表等企业常用调用类型（具体覆盖范围可在方案中列明，须满足既有业务迁移需要）。")

    add_heading_cn(doc, "4.4 虚拟凭证、限额与能力开放审核", 2)
    add_bullet(doc, "K1 虚拟凭证隔离上游：下游只持有平台签发的虚拟凭证，不持有上游原始密钥。")
    add_bullet(doc, "K2 双场景凭证：个人凭证与应用凭证分场景治理，费用归属组织层级（企业 / 部门），所有者不等于付款主体。")
    add_bullet(doc, "K3 可调用范围：凭证可绑定允许调用的模型服务白名单。")
    add_bullet(doc, "K4 周期配额：支持按周期限制 Token 用量与 / 或金额消耗，并配置超额策略（硬阻断或告警等）。")
    add_bullet(doc, "K5 速率限制：支持按凭证配置每分钟请求量（QPM/RPM）与每分钟 Token 量（TPM）等速率上限，超限拒绝。")
    add_bullet(doc, "K6 生命周期：支持创建、轮换、启用 / 停用、删除 / 过期；明文仅对授权主体在授权时机可见。")
    add_bullet(doc, "K7 开放审核：普通用户可申请个人凭证；审核角色对申请的服务范围、限额、速率、归属、环境等进行确认后开通。")
    add_bullet(doc, "K8 平台内置运维凭证：控制台智能体等平台自用调用须记入平台内置运维凭证，纳入统一计量。")

    add_heading_cn(doc, "4.5 组织、权限与安全合规", 2)
    add_bullet(doc, "O1 组织模型：至少支持企业 → 部门两级；成员归属部门，费用与报表可按组织收敛。")
    add_bullet(doc, "O2 角色权限：页面可见性与操作能力可配置；内置管理员、运维、审核、审计、普通用户等职责角色。")
    add_bullet(doc, "O3 成员预算阈值：可为成员设置日 / 月消耗预算上限（治理阈值，非充值余额），触达可告警或限制。")
    add_bullet(doc, "O4 安全策略：覆盖脱敏、隐私拦截、越权防护、内容安全、出域管控等能力，并可区分公有云 / 本地作用范围。")
    add_bullet(doc, "O5 审计三态：平台操作、策略命中、调用日志可查询、筛选、导出与详情溯源。")

    add_heading_cn(doc, "4.6 结算计价、用量费用与告警", 2)
    add_bullet(doc, "B1 结算计价规则：支持按厂商配置忙闲时、节假日、阶梯等结算规则及采购折扣；同厂商规则对下属模型能力一致生效。")
    add_bullet(doc, "B2 费用核算：按调用量与结算价核算费用，用于对内分摊与对上结算对账，而非平台扣余额。")
    add_bullet(doc, "B3 多维用量费用：按组织、服务、凭证、时间等维度汇总与导出。")
    add_bullet(doc, "B4 单价缺失处理：费用优先选源在单价缺失时须有明确降级规则，不得产生不可解释的选源结果。")
    add_bullet(doc, "B5 告警：覆盖延迟、错误率、部门 / 成员预算阈值等运维与费用风险。")
    add_bullet(doc, "B6 界面与接口不得出现充值、提现或账户余额管理入口。")

    add_heading_cn(doc, "4.7 开票协同与平台智能体", 2)
    add_bullet(doc, "A1 开票供应商来源：开票对象直接选自已接入厂商，禁止要求用户先登记另一套供应商。")
    add_bullet(doc, "A2 开票资料与提交：对具备自动开票能力的厂商，可补全抬头等资料并走开票链路；不具备自动开票的厂商可选中但须明确说明能力边界。")
    add_bullet(doc, "A3 开票不得虚构成功：资料不全、开票服务不可用或未确认提交时，不得展示虚假已开票结果。")
    add_bullet(doc, "A4 运维助手：基于平台真实数据辅助解读健康、用量费用与配置；不得编造不存在的服务、凭证或费用。")
    add_bullet(doc, "A5 开票智能体：侧重供应商开票协同与字段指引；不得在对话中擅自代替授权人完成真实开票提交。")
    add_bullet(doc, "A6 职责分离：运维助手与开票智能体职责清晰可切换；共用平台配置的对话模型服务，用量计入平台运维凭证。")

    add_heading_cn(doc, "4.8 接入说明与业务迁移", 2)
    add_bullet(doc, "M1 提供面向开发者的接入说明：鉴权差异、环境隔离、服务名用法、限额与速率含义。")
    add_bullet(doc, "M2 业务迁移原则：下游以「改调用入口 + 使用虚拟凭证 + 填写对外服务名」为主要改造面，避免绑定单一上游。")

    # 五
    add_heading_cn(doc, "五、共性约束与非功能要求")
    add_heading_cn(doc, "5.1 业务约束（必须遵守）", 2)
    add_bullet(doc, "无充值：限额、预算、速率均属治理手段，不得描述或实现为「充值余额」。")
    add_bullet(doc, "厂商同源：接入厂商 = 开票供应商主数据。")
    add_bullet(doc, "环境隔离：生产与测试凭证、入口不得串用。")
    add_bullet(doc, "密钥最小化暴露：上游密钥与虚拟凭证明文均按最小可见范围管理。")

    add_heading_cn(doc, "5.2 非功能要求（目标级，实现由方案论证）", 2)
    add_bullet(doc, "可用性：网关作为关键路径，须具备可运维的高可用与故障恢复方案（指标由厂商方案提出并承诺）。")
    add_bullet(doc, "性能：须支持企业级并发调用；个人与应用场景的限流、配额互不影响错误计量。")
    add_bullet(doc, "安全：传输与存储安全、权限隔离、防越权、审计完整；满足甲方信息安全管理制度要求。")
    add_bullet(doc, "可维护性：配置变更可追溯；关键操作可审计；具备监控与告警对接能力。")
    add_bullet(doc, "可扩展性：新增厂商、模型能力、对外服务与凭证时，不要求业务方改造协议习惯。")
    add_bullet(doc, "本地化运维：支持在甲方指定环境独立部署与运维（含私有化场景）。")

    # 六
    add_heading_cn(doc, "六、验收要点")
    add_body(doc, "验收以「能力是否达成」为准，不绑定某一具体实现形态。至少包括：")
    add_bullet(doc, "控制台与网关（含生产 / 测试隔离）可部署、可访问、可运维。")
    add_bullet(doc, "至少完成 1 个真实上游厂商接入，并在其下纳入模型能力、发布对外服务、签发虚拟凭证后调用成功。")
    add_bullet(doc, "验证多源失败切换或等价的上游失败处理，且过程可追溯。")
    add_bullet(doc, "调用可在用量与审计中追溯；用量 / 费用界面无充值入口。")
    add_bullet(doc, "存在虚拟凭证申请 / 审批或等效开放审核路径，角色与页面可达。")
    add_bullet(doc, "凭证可配置周期配额与速率限制（QPM/TPM），超限行为符合约定。")
    add_bullet(doc, "生产 / 测试环境凭证跨环境调用被拒绝。")
    add_bullet(doc, "开票侧可直接选择已接入厂商；运维助手与开票智能体可切换且不编造事实。")
    add_bullet(doc, "交付完整源码、构建部署说明与操作手册；权属条款满足「定制成果归我司」。")

    # 七
    add_heading_cn(doc, "七、交付与权属")
    add_bullet(doc, "交付完整可运行源码（控制台、网关、开票协同及相关脚本 / 配置）与可复现的构建部署说明，确保我司可独立维护。")
    add_bullet(doc, "定制开发成果的知识产权与源代码所有权归我司；未经书面许可不得转让或另行商用。")
    add_bullet(doc, "开源 / 第三方组件权属不转移，须提供组件与许可证清单。")
    add_bullet(doc, "厂商方案可自带产品化能力，但须覆盖本说明书核心功能点，并在差异处明示「标准能力 / 定制项 / 不在范围」。")

    add_heading_cn(doc, "八、厂商方案响应建议")
    add_body(
        doc,
        "请厂商基于本说明书输出解决方案，建议至少包含：总体架构与部署形态、核心功能点覆盖对照表、"
        "生产 / 测试隔离与安全方案、计量结算与开票方案、性能与高可用指标承诺、实施计划与验收映射、"
        "商务边界（标准产品 / 定制工作量）。本说明书不要求、也不接受以详细设计替代需求确认。",
    )

    doc.save(OUT)
    try:
        doc.save(DOWNLOADS)
        downloads_ok = True
    except Exception as e:
        downloads_ok = False
        print("Downloads copy skipped:", e)
    print("Wrote", OUT)
    if downloads_ok:
        print("Wrote", DOWNLOADS)


if __name__ == "__main__":
    build()
