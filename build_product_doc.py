from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor
from docx.enum.style import WD_STYLE_TYPE
from pathlib import Path


OUT = Path(r"D:\Project_folder\模型网关\模型网关管理平台产品说明文档.docx")


def set_run_font(run, name="Microsoft YaHei", size=None, bold=None, color="000000"):
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=110, start=120, bottom=110, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table, color="D9D9D9", size="6"):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = qn(f"w:{edge}")
        el = borders.find(tag)
        if el is None:
            el = OxmlElement(f"w:{edge}")
            borders.append(el)
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), size)
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)


def repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_repeat_table_header_and_no_split(table):
    repeat_table_header(table.rows[0])
    for row in table.rows:
        tr_pr = row._tr.get_or_add_trPr()
        cant_split = OxmlElement("w:cantSplit")
        tr_pr.append(cant_split)


def add_page_number(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run()
    fld_char1 = OxmlElement("w:fldChar")
    fld_char1.set(qn("w:fldCharType"), "begin")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = " PAGE "
    fld_char2 = OxmlElement("w:fldChar")
    fld_char2.set(qn("w:fldCharType"), "end")
    run._r.extend([fld_char1, instr_text, fld_char2])
    set_run_font(run, size=9, color="7A7A7A")


def set_col_widths(table, widths_cm):
    for row in table.rows:
        for idx, width in enumerate(widths_cm):
            row.cells[idx].width = Cm(width)


def add_table(doc, headers, rows, widths=None, header_fill="1F4E78", small=False):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table)
    if widths:
        set_col_widths(table, widths)
    header = table.rows[0]
    for i, label in enumerate(headers):
        cell = header.cells[i]
        set_cell_shading(cell, header_fill)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_margins(cell, top=130, bottom=130)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run(label)
        set_run_font(run, size=9 if small else 9.5, bold=True, color="FFFFFF")
    for r_idx, values in enumerate(rows):
        row = table.add_row()
        if r_idx % 2 == 1:
            for cell in row.cells:
                set_cell_shading(cell, "F4F8FB")
        for i, value in enumerate(values):
            cell = row.cells[i]
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_margins(cell)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.08
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT if len(str(value)) > 12 else WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(str(value))
            set_run_font(run, size=8.5 if small else 9, color="222222")
    set_repeat_table_header_and_no_split(table)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return table


def add_bullets(doc, items, level=0):
    for item in items:
        p = doc.add_paragraph(style="List Bullet" if level == 0 else "List Bullet 2")
        p.paragraph_format.left_indent = Cm(0.62 + level * 0.45)
        p.paragraph_format.first_line_indent = Cm(-0.28)
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.line_spacing = 1.15
        run = p.add_run(item)
        set_run_font(run, size=10.2, color="202020")


def add_numbered(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Number")
        p.paragraph_format.left_indent = Cm(0.68)
        p.paragraph_format.first_line_indent = Cm(-0.36)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.15
        run = p.add_run(item)
        set_run_font(run, size=10.2, color="202020")


def add_para(doc, text, bold_lead=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = 1.25
    p.paragraph_format.widow_control = True
    if bold_lead and text.startswith(bold_lead):
        r1 = p.add_run(bold_lead)
        set_run_font(r1, size=10.5, bold=True)
        r2 = p.add_run(text[len(bold_lead):])
        set_run_font(r2, size=10.5)
    else:
        r = p.add_run(text)
        set_run_font(r, size=10.5)
    return p


def add_heading(doc, text, level=1):
    p = doc.add_paragraph(text, style=f"Heading {level}")
    p.paragraph_format.keep_with_next = True
    p.paragraph_format.page_break_before = False
    return p


def remove_paragraph_borders(paragraph_or_style):
    element = paragraph_or_style._element
    p_pr = element.get_or_add_pPr()
    p_bdr = p_pr.find(qn("w:pBdr"))
    if p_bdr is not None:
        p_pr.remove(p_bdr)


def add_key_value(doc, label, value):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(3)
    r1 = p.add_run(label + "  ")
    set_run_font(r1, size=10, bold=True, color="333333")
    r2 = p.add_run(value)
    set_run_font(r2, size=10, color="444444")


doc = Document()
section = doc.sections[0]
section.page_width = Cm(21)
section.page_height = Cm(29.7)
section.top_margin = Cm(2.0)
section.bottom_margin = Cm(1.8)
section.left_margin = Cm(2.0)
section.right_margin = Cm(2.0)

styles = doc.styles
normal = styles["Normal"]
normal.font.name = "Microsoft YaHei"
normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
normal.font.size = Pt(10.5)
normal.font.color.rgb = RGBColor(32, 32, 32)

title_style = styles["Title"]
title_style.font.name = "Microsoft YaHei"
title_style._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
title_style.font.size = Pt(28)
title_style.font.bold = True
title_style.font.color.rgb = RGBColor(0, 0, 0)
title_style.paragraph_format.space_after = Pt(14)
remove_paragraph_borders(title_style)

for name, size, before, after in (("Heading 1", 18, 12, 9), ("Heading 2", 13.5, 10, 6), ("Heading 3", 11.5, 8, 4)):
    s = styles[name]
    s.font.name = "Microsoft YaHei"
    s._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    s.font.size = Pt(size)
    s.font.bold = True
    s.font.color.rgb = RGBColor(0, 0, 0)
    s.paragraph_format.space_before = Pt(before)
    s.paragraph_format.space_after = Pt(after)
    s.paragraph_format.keep_with_next = True

footer = section.footer
footer_p = footer.paragraphs[0]
add_page_number(footer_p)

# Cover
doc.add_paragraph().paragraph_format.space_after = Pt(44)
p = doc.add_paragraph(style="Title")
p.alignment = WD_ALIGN_PARAGRAPH.LEFT
p.add_run("模型网关管理平台产品说明文档")
remove_paragraph_borders(p)
subtitle = doc.add_paragraph()
subtitle.paragraph_format.space_after = Pt(28)
r = subtitle.add_run("Model Gateway Admin")
set_run_font(r, size=15, color="4A4A4A")

add_para(doc, "本说明文档面向产品、研发、运维、安全和平台管理员，系统说明模型网关管理平台的产品定位、信息架构、功能模块、核心流程、权限控制与运营规则。平台的核心作用是把多家模型供应商统一接入到一个可治理、可路由、可计量、可审计的管理平面，并向业务应用提供兼容 OpenAI 协议的统一调用入口。")

doc.add_paragraph().paragraph_format.space_after = Pt(22)
add_key_value(doc, "文档版本", "1.0")
add_key_value(doc, "编制日期", "2026 年 11 月 9 日")
add_key_value(doc, "适用系统", "Model Gateway Admin")
add_key_value(doc, "系统地址", "http://10.24.2.34")

doc.add_page_break()

# Contents
h = doc.add_paragraph("目录", style="Heading 1")
h.paragraph_format.page_break_before = False
toc_rows = [
    ("1", "产品概述", "定位 价值 用户与边界"),
    ("2", "信息架构", "全局导航 项目空间 系统空间"),
    ("3", "功能说明", "供应商 项目 路由 护栏 审计与运维"),
    ("4", "核心业务流程", "从接入模型到稳定调用的闭环"),
    ("5", "数据对象关系", "供应商 模型 项目 令牌 请求与日志"),
    ("6", "权限与角色", "资源级权限与可见范围"),
    ("7", "计量与运营规则", "预算 套餐 限流 成本与缓存"),
    ("8", "接口与集成", "OpenAI 兼容接口与外围集成"),
    ("9", "使用建议", "管理员和项目管理员操作建议"),
    ("10", "验收要点", "功能 安全 可观测与可用性检查"),
]
add_table(doc, ["章节", "主题", "主要内容"], toc_rows, widths=[1.5, 4.6, 10.1])

# 1
add_heading(doc, "1 产品概述", 1)
add_heading(doc, "1 1 产品定位", 2)
add_para(doc, "模型网关管理平台是企业级大模型统一接入与治理平台。它位于业务应用与上游模型服务之间，对外提供统一的模型调用协议，对内承载供应商适配、模型目录、项目隔离、配额限流、智能路由、安全护栏、审计分析和运维辅助等能力。")
add_para(doc, "平台既是模型服务的管理后台，也是业务调用的控制面。管理员通过后台配置供应商、用户、路由规则和系统策略；项目管理员在独立项目空间中管理可用模型、成员、API Key、预算或 Token 套餐；调用方只需使用统一地址和令牌即可访问已授权模型。")

doc.add_page_break()
add_heading(doc, "1 2 核心价值", 2)
add_table(doc, ["价值方向", "说明"], [
    ("统一接入", "屏蔽 OpenAI 兼容、Anthropic、Azure、AWS Bedrock、Google Vertex、本地 Ollama 与 vLLM 等上游差异。"),
    ("稳定路由", "以优先级层级、权重、故障转移和智能路由配方组织跨供应商流量。"),
    ("成本治理", "按项目、用户、令牌和模型记录请求、Token 与成本，支持预算或 Token 套餐两种计量模式。"),
    ("安全合规", "通过输入和输出护栏、用户与项目权限、令牌生命周期和完整审计日志控制风险。"),
    ("可观测运维", "提供供应商状态、断路器、请求耗时分解、缓存命中、护栏结果、用量排行和通知。"),
    ("开发提效", "提供 Playground、API 文档、模型列表、流式调用示例和 Pond 运维助手。"),
], widths=[3.2, 13.0])

add_heading(doc, "1 3 目标用户", 2)
add_table(doc, ["用户", "核心诉求", "常用功能"], [
    ("超级管理员", "维护平台级资源和治理规则", "供应商 用户 项目 路由 护栏 审计 系统设置"),
    ("平台运维", "保障模型调用稳定并快速定位异常", "供应商状态 断路器 审计 告警 Pond"),
    ("安全管理员", "控制输入输出风险并留存证据", "护栏规则 护栏审计 Webhook 权限"),
    ("项目管理员", "为业务团队配置模型与额度", "模型目录 成员 API Key 套餐 项目配置"),
    ("开发者", "快速接入并验证模型效果", "API 文档 Playground 模型目录 个人用量"),
    ("财务或运营", "分析成本和资源消耗", "项目分析 模型分析 用户分析 预算与套餐"),
], widths=[2.8, 6.0, 7.4], small=True)

# 2
add_heading(doc, "2 信息架构", 1)
add_para(doc, "平台采用全局管理与项目空间并行的导航结构。左侧导航按项目、管理和系统分组；顶部提供项目切换、通知、语言、主题、用户菜单和 Pond 助手入口。可见菜单由当前用户权限动态决定。")
add_table(doc, ["区域", "一级入口", "功能范围"], [
    ("个人", "我的用量", "查看个人请求、Token、成本、延迟和明细。"),
    ("项目", "分析 模型目录 成员 API Key 套餐 项目配置", "围绕一个项目完成模型授权、成员和额度治理。"),
    ("管理", "供应商 用户 智能路由 护栏", "维护平台级基础资源和治理策略。"),
    ("系统", "Playground Pond 技能 审计 API 文档", "调试模型、智能运维、扩展工具、查询记录和查看接入指南。"),
    ("设置", "个人资料 服务令牌 快捷链接 Pond Webhook", "管理个人与系统级配置。"),
], widths=[2.3, 6.2, 7.7])

add_heading(doc, "2 1 典型调用链", 2)
flow = doc.add_paragraph()
flow.alignment = WD_ALIGN_PARAGRAPH.CENTER
flow.paragraph_format.space_before = Pt(8)
flow.paragraph_format.space_after = Pt(12)
r = flow.add_run("业务应用  →  API Key  →  项目限额与权限  →  智能路由与护栏  →  上游模型  →  审计与计量")
set_run_font(r, size=11, bold=True, color="1F4E78")
add_para(doc, "请求进入网关后，系统先识别令牌和所属项目，校验成员状态、模型授权、预算或套餐额度与速率限制；随后执行输入护栏、缓存查询和路由决策，调用目标供应商模型；返回前执行输出护栏，并把请求结果、成本、延迟、缓存、工具调用和风险检测写入审计记录。")

# 3
add_heading(doc, "3 功能说明", 1)
add_heading(doc, "3 1 登录与全局框架", 2)
add_bullets(doc, [
    "支持账号密码登录以及 OIDC 单点登录回调与退出流程。",
    "项目切换器支持搜索项目，并根据权限跳转到可访问的项目页面。",
    "通知中心支持未读数量、查看全部、标记已读、删除选中和按类型展示。",
    "界面支持中文与英文，以及跟随系统、浅色和深色主题。",
    "离线状态会提示网络不可用；无权限页面会自动回到可访问入口。",
])

add_heading(doc, "3 2 我的用量", 2)
add_para(doc, "我的用量页面面向普通用户和开发者，用于查看个人维度的请求量、Token、成本、成功率、延迟与请求明细。页面与项目分析使用一致的审计口径，便于用户自助判断额度消耗和异常调用。")

doc.add_page_break()
add_heading(doc, "3 3 供应商管理", 2)
add_para(doc, "供应商管理负责维护上游模型服务及其模型清单。列表展示供应商名称、类型、状态、模型数量和断路器状态，支持搜索、新建、编辑、删除、展开模型详情、手动打开断路器和恢复供应商。")
add_table(doc, ["能力", "说明"], [
    ("供应商类型", "覆盖 OpenAI 兼容、Anthropic、AWS Bedrock、Azure Foundry、Azure OpenAI、Google Vertex、Cohere、Jina Rerank、Ollama 与 vLLM 等适配类型。"),
    ("认证配置", "根据类型配置 API Key、Azure AD Token、Scope、区域、API Version、Base URL 与部署方式。编辑时可保留当前密钥。"),
    ("模型清单", "展示上游模型名、别名、模态、能力与分层价格，价格可区分输入、输出和缓存输入。"),
    ("运行状态", "展示启用状态及断路器的关闭、半开、打开状态，管理员可人工隔离或恢复异常供应商。"),
    ("本地部署", "Ollama 与 vLLM 提供本地默认地址，便于接入私有化推理服务。"),
], widths=[3.0, 13.2])

add_heading(doc, "3 4 项目管理", 2)
add_para(doc, "项目是资源隔离、权限授权和计量控制的核心边界。每个项目拥有独立的模型目录、成员、API Key、预算或 Token 套餐、速率限制、护栏和路由配置。项目列表可按状态搜索筛选，并展示预算、并发、RPM、TPM 和计量模式。")
add_table(doc, ["项目页签", "主要功能"], [
    ("分析", "查看总请求、Token、成本、平均延迟、活跃用户、供应商状态、用量成本趋势、模型成本和工具调用。支持 24 小时、7 天、15 天、30 天时间范围。"),
    ("模型目录", "为项目添加供应商模型或路由配方，按优先级层级组织，控制启停、权重与故障转移。"),
    ("成员", "添加或移除成员，查看角色和状态，配置个人预算或套餐，补充额度、重置用量和刷新预算。"),
    ("API Key", "创建、编辑、启用、停用和删除项目令牌，查看创建人、状态、模型范围、限额和配额。"),
    ("套餐", "在 Token 计量模式下配置套餐与多个额度窗口，设置默认套餐并分配给成员。"),
    ("项目配置", "维护显示名称、描述、计量模式、并发、RPM、TPM、预算周期、输入输出护栏、路由策略和语义缓存。"),
], widths=[3.0, 13.2])

add_heading(doc, "3 5 模型目录与路由策略", 2)
add_para(doc, "项目模型目录以能力为单位组织可调用模型。管理员可一次选择多个供应商模型，再配置路由层级和权重。请求优先命中层级数字较小的模型；同一层级中的多个模型可按权重分流，并在失败时进行故障转移。")
add_bullets(doc, [
    "支持添加、编辑、删除和启停项目模型。",
    "支持拖拽调整供应商或模型的优先级层级。",
    "支持把智能路由配方作为虚拟模型加入项目，并单独启停。",
    "项目路由策略可选择均衡、成本优化、延迟优化或优先级加权。",
])

add_heading(doc, "3 6 项目配额与语义缓存", 2)
add_table(doc, ["配置项", "作用"], [
    ("并发限制", "控制项目同时处理的请求数量。"),
    ("RPM", "限制每分钟请求次数，抑制突发流量。"),
    ("TPM", "限制每分钟 Token 数，控制高消耗请求。"),
    ("预算模式", "按美元预算和周期控制项目或成员消耗。"),
    ("Token 套餐模式", "按 5 小时、12 小时、日、周、月或一次性窗口分配 Token 额度。"),
    ("语义缓存", "选择嵌入模型、相似度阈值和 TTL；可手动发起缓存失效。"),
], widths=[3.2, 13.0])

add_heading(doc, "3 7 用户管理", 2)
add_para(doc, "用户管理覆盖用户全生命周期。管理员可创建和编辑用户，设置角色、所属项目、有效期与密码；按待审批、活跃、停用、休眠、过期和已拒绝状态筛选；执行审批、拒绝、停用、重新启用、解锁、重置密码、批量删除和预算充值等操作。")
add_para(doc, "密码策略要求至少 8 个字符，并满足大写、小写、数字、特殊字符四类中的三类，不得包含用户名或 admin，且不能复用最近 5 次密码。该规则适合作为平台本地账号的基础安全约束。")

add_heading(doc, "3 8 智能路由", 2)
add_para(doc, "智能路由由信号和路由配方组成。信号描述请求特征，可使用选择、分数或布尔类型；路由配方以虚拟模型名称对外暴露，并通过多个决策定义条件、优先级和目标模型。")
add_table(doc, ["对象", "关键字段与操作"], [
    ("信号", "信号 ID、名称、描述、类型；选择型配置候选值，分数型配置最小值和最大值。"),
    ("配方", "名称、显示名称、描述、启停、算法、Laya Checkpoint 与温度。算法支持加权和轮询。"),
    ("决策", "决策名称、层级优先级、全部或任一匹配模式、条件列表、目标模型及权重。"),
    ("兜底", "无条件决策始终匹配，可使用较低优先级作为未命中其他规则时的回退。"),
], widths=[3.0, 13.2])

add_heading(doc, "3 9 安全护栏", 2)
add_para(doc, "护栏用于在模型调用前后检测风险内容。规则可绑定输入或输出范围，配置拦截或仅记录动作，设置抽样扫描比例，并组合多个检查项。护栏列表支持搜索、创建、编辑、删除和在线测试。")
add_bullets(doc, [
    "基本配置包括名称、描述、作用范围、动作和扫描抽样率。",
    "检查项分为可用检查和已选择检查，可搜索并添加或移除。",
    "测试工具支持输入文本、查看通过或失败、违规项及修改后的文本。",
    "项目可分别绑定输入护栏组和输出护栏组。",
    "护栏审计提供扫描量、通过率、平均延迟、P95、违规类别和检查类型分析。",
])

add_heading(doc, "3 10 审计与分析", 2)
add_para(doc, "审计中心记录每次网关请求，并提供请求、模型、用户、护栏和管理操作等多种观察视角。请求列表支持按用户、项目、模型和状态筛选，支持刷新、搜索、复制请求 ID 与导出。")
add_table(doc, ["视图", "主要指标或字段"], [
    ("请求日志", "请求 ID、时间、用户、项目、模型、状态、Token、成本、延迟、流式、缓存类型、工具调用。"),
    ("请求详情", "供应商、令牌、客户端 IP、User Agent、设备、错误、护栏结果和完整耗时分解。"),
    ("耗时分解", "输入护栏、语义缓存、智能路由、上游首字节、生成、输出护栏、网关开销和总耗时。"),
    ("模型分析", "模型和供应商的请求数、Token、成本、平均延迟、成功率、成本趋势与 Token 效率。"),
    ("用户分析", "按用户统计请求、Token、成本、成功、失败、平均延迟和使用模型。"),
    ("护栏分析", "扫描量、通过率、延迟、违规类别、检查类型和失败详情。"),
    ("管理审计", "平台管理操作记录，便于追踪配置变更。"),
], widths=[3.0, 13.2], small=True)

add_heading(doc, "3 11 Playground", 2)
add_para(doc, "Playground 用于在后台直接验证模型调用。用户输入 API Key，刷新可授权模型，选择模型并配置温度、最大 Token 和流式开关。对话支持停止生成、清空记录、展示推理过程、提示 Token、补全 Token、总 Token 和错误信息。")

add_heading(doc, "3 12 Pond 运维助手与技能", 2)
add_para(doc, "Pond 是内置 AI 运维助手，可在侧边浮层或独立页面中询问供应商状态、用量、错误和技能运行情况。系统支持配置启用状态、访问令牌、模型、系统提示词和最大工具轮数。对话采用流式返回，可展示思考过程和调用过的工具。")
add_para(doc, "技能模块用于定义 Pond 可调用的扩展能力。技能具有名称、描述、分类、信任级别、是否仅管理员可用、参数 Schema、执行器类型和执行器配置。当前界面明确提供 SQL 执行器配置，并支持使用 JSON 参数在线测试和查看运行结果。")

add_heading(doc, "3 13 API 文档与设置", 2)
add_bullets(doc, [
    "API 文档展示基础地址、身份认证、可用模型、cURL 和 Python 示例、流式响应、视觉输入选项与使用提示。",
    "接口面向 OpenAI 兼容调用方式，调用方使用平台令牌和已授权模型名称接入。",
    "个人资料支持修改显示名称和密码；服务令牌用于自动化系统和 CI/CD，创建后仅展示一次明文。",
    "Pond 设置控制浮动助手是否启用、位置与本地对话历史。",
    "Webhook 支持 None、Bearer 和 HMAC 认证，可启停、编辑、删除、发送测试或预览载荷。",
    "快捷链接用于集中提供常用外部入口。",
])

# 4
add_heading(doc, "4 核心业务流程", 1)
add_heading(doc, "4 1 接入新的模型供应商", 2)
add_numbered(doc, [
    "管理员进入供应商管理，选择供应商类型并填写名称、Base URL、认证信息、区域或 API Version。",
    "系统保存供应商并同步或展示可用模型、模态、能力和价格信息。",
    "管理员确认供应商状态和断路器状态，并在项目模型目录中添加所需模型。",
    "项目管理员设置层级、权重和启用状态，使用 Playground 发起验证请求。",
    "通过审计日志核对实际供应商、延迟、Token、成本、缓存和护栏结果。",
])

add_heading(doc, "4 2 创建项目并授权调用", 2)
add_numbered(doc, [
    "创建项目，选择预算或 Token 套餐计量模式，配置并发、RPM 与 TPM。",
    "添加项目成员，并根据计量模式配置成员预算或分配套餐。",
    "在模型目录中添加供应商模型或路由配方，设置优先级与权重。",
    "创建项目 API Key，并限制可用模型、额度或其他令牌属性。",
    "开发者根据 API 文档配置基础地址和令牌，开始调用；项目分析和审计页面持续展示运行数据。",
])

add_heading(doc, "4 3 配置智能路由", 2)
add_numbered(doc, [
    "在信号管理中定义可被路由决策引用的请求特征。",
    "创建路由配方，设置虚拟模型名称、算法和可选的 Laya 配置。",
    "新增多个决策，配置优先级、全部或任一匹配模式、条件以及模型权重。",
    "补充无条件兜底决策，并启用配方。",
    "把配方加入项目模型目录，通过虚拟模型名调用并在审计中验证决策结果。",
])

add_heading(doc, "4 4 配置安全治理闭环", 2)
add_numbered(doc, [
    "创建输入或输出护栏，选择拦截或仅记录动作并设置检查项。",
    "在护栏测试工具中使用代表性文本验证检测结果和修改文本。",
    "把护栏绑定到项目配置中的输入或输出位置。",
    "上线后查看护栏审计，关注通过率、延迟、违规类别和失败明细。",
    "通过 Webhook 将重要告警发送到外部接收方，并定期复核规则效果。",
])

# 5
add_heading(doc, "5 数据对象关系", 1)
add_table(doc, ["对象", "上游关系", "下游关系", "关键属性"], [
    ("供应商", "无", "供应商模型", "类型 认证 Base URL 状态 断路器"),
    ("供应商模型", "供应商", "项目能力 路由决策", "模型名 别名 模态 能力 价格"),
    ("项目", "平台", "成员 API Key 模型能力 套餐 请求", "计量模式 限额 护栏 路由 缓存"),
    ("项目成员", "用户 项目", "个人预算或套餐", "角色 状态 配额 用量"),
    ("API Key", "项目或用户", "请求", "状态 模型范围 限额 配额 创建人"),
    ("路由配方", "信号", "决策 项目能力", "虚拟模型 算法 启停"),
    ("护栏", "检查项", "项目 请求审计", "范围 动作 抽样率 配置"),
    ("请求日志", "用户 项目 Key 模型", "分析与审计", "Token 成本 延迟 缓存 工具 风险"),
], widths=[2.5, 3.2, 4.0, 6.5], small=True)

# 6
add_heading(doc, "6 权限与角色", 1)
add_para(doc, "平台采用资源和动作组合的权限模型。资源包括 provider、user、project、ability、token、routing_recipe、routing_signal、guardrail、audit、notification、skill 和 role 等；动作包括 read、read:self、create、update、delete 或通配权限。超级管理员拥有全局通配权限。")
add_table(doc, ["页面", "最低读取权限", "说明"], [
    ("我的用量 Playground API 文档 设置", "登录即可", "所有登录用户可访问。"),
    ("供应商", "provider read", "写操作还需对应创建 更新 删除权限。"),
    ("用户", "user read 且非仅 read self", "只具有自读权限的用户不可进入全局用户管理。"),
    ("项目与成员", "project read", "项目配置需要 project update。"),
    ("模型目录", "ability read", "模型增删改需能力写权限。"),
    ("API Key", "token read 或 token read self", "自读权限仅查看与本人相关的令牌。"),
    ("智能路由", "routing recipe read 或 routing signal read", "配方入口还受管理员可见条件约束。"),
    ("护栏", "guardrail read", "规则编辑和测试按写权限控制。"),
    ("审计", "audit read", "统一控制请求和分析视图。"),
    ("技能", "skill read", "技能可另行标记为仅管理员使用。"),
    ("Pond", "全局通配权限", "后台配置入口仅对高权限用户开放。"),
], widths=[4.0, 4.2, 8.0], small=True)

# 7
add_heading(doc, "7 计量与运营规则", 1)
add_heading(doc, "7 1 两种项目计量模式", 2)
add_table(doc, ["模式", "控制对象", "适用场景"], [
    ("预算模式", "美元预算与周期，可下沉到成员", "需要按模型价格核算和控制成本的项目。"),
    ("Token 套餐模式", "多个 Token 额度窗口与用户套餐", "需要按固定 Token 配额提供服务的内部平台或租户。"),
], widths=[3.0, 6.0, 7.2])
add_para(doc, "Token 套餐支持 5 小时、12 小时、每日、每周、每月和一次性窗口。项目可设置默认套餐；未显式分配套餐的成员继承默认套餐。删除套餐会影响已有分配，因此应先核对回退规则。")

add_heading(doc, "7 2 成本与性能口径", 2)
add_bullets(doc, [
    "成本由供应商模型价格、输入 Token、输出 Token 和缓存输入价格共同计算。",
    "缓存命中分为无缓存、精确缓存和语义缓存，并在请求审计中展示。",
    "延迟既展示总耗时，也拆分输入护栏、缓存、路由、上游首字节、生成和输出护栏。",
    "项目、模型、用户和个人用量使用同一审计数据源形成不同聚合视图。",
    "供应商断路器与路由故障转移共同降低单一上游故障对业务的影响。",
])

# 8
add_heading(doc, "8 接口与集成", 1)
add_heading(doc, "8 1 业务调用", 2)
add_para(doc, "平台提供兼容 OpenAI 的统一 API。调用方需要基础地址、Bearer 令牌和已授权模型名称。模型可以是真实供应商模型，也可以是智能路由配方暴露的虚拟模型。接口支持非流式和服务器发送事件流式响应；视觉模型可使用文档列出的图片来源方式。")
add_heading(doc, "8 2 管理集成", 2)
add_table(doc, ["集成点", "用途"], [
    ("OIDC", "对接企业统一身份认证。"),
    ("Webhook", "把告警或通知发送到外部系统，支持 Bearer 和 HMAC。"),
    ("服务令牌", "供自动化系统和 CI CD 管道调用管理接口。"),
    ("SQL 技能", "为 Pond 提供受控的数据查询或运维工具。"),
    ("快捷链接", "在设置页聚合监控、文档或其他平台入口。"),
], widths=[3.2, 13.0])

# 9
add_heading(doc, "9 使用建议", 1)
add_heading(doc, "9 1 平台管理员", 2)
add_bullets(doc, [
    "先建立供应商和价格基线，再向项目开放模型，避免项目侧出现无价格或无能力说明的模型。",
    "为关键模型至少配置两个不同供应商或两个可用层级，并关注断路器和故障转移。",
    "区分预算模式和 Token 套餐模式的适用对象，项目创建后再变更计量模式应评估存量数据。",
    "对高风险项目同时配置输入与输出护栏，并使用仅记录模式观察误报后再启用拦截。",
    "建立最小权限角色，限制供应商密钥、用户管理、路由与技能的写权限。",
])

add_heading(doc, "9 2 项目管理员和开发者", 2)
add_bullets(doc, [
    "创建 API Key 时尽量限制模型范围和有效用途，不在多人共享环境中暴露密钥。",
    "上线前在 Playground 验证流式、最大 Token、推理输出和错误处理。",
    "使用审计请求详情核对实际命中的供应商与模型，避免仅依据前端模型名判断。",
    "设置合理的并发、RPM 与 TPM，防止单个调用方耗尽项目资源。",
    "通过项目分析持续观察成本趋势、成功率、平均延迟和工具调用变化。",
])

# 10
add_heading(doc, "10 验收要点", 1)
add_table(doc, ["领域", "验收检查"], [
    ("身份与权限", "不同角色登录后菜单与操作符合权限；越权访问被拒绝；OIDC 登录和退出正常。"),
    ("供应商", "各类型凭证和地址可保存；模型清单正确；断路器打开、半开和恢复行为符合预期。"),
    ("项目隔离", "成员、令牌、模型、预算、套餐与审计数据不跨项目泄露。"),
    ("限额计量", "并发、RPM、TPM、预算和套餐窗口按配置生效；用量重置与充值结果准确。"),
    ("路由", "层级、权重、故障转移、路由配方条件和兜底决策可重复验证。"),
    ("护栏", "输入输出范围、拦截和仅记录动作、抽样率、测试结果与审计记录一致。"),
    ("缓存", "精确或语义缓存命中、相似度阈值、TTL 和失效操作符合配置。"),
    ("审计", "请求 ID 可追踪；Token、成本、延迟、供应商、缓存、工具和护栏字段完整。"),
    ("通知与 Webhook", "通知可读、可清理；Webhook 认证、测试发送、失败信息和延迟可见。"),
    ("开发接入", "API 文档示例可运行；模型列表、非流式和流式调用可用；错误信息可定位。"),
    ("可用性", "中英文、浅色深色、响应式侧栏、离线提示和空状态显示正常。"),
], widths=[3.2, 13.0], small=True)

# Metadata and final cleanup
doc.core_properties.title = "模型网关管理平台产品说明文档"
doc.core_properties.subject = "Model Gateway Admin 产品功能说明"
doc.core_properties.author = ""
doc.core_properties.keywords = "模型网关, 大模型, 路由, 护栏, 审计, 配额"

for p in doc.paragraphs:
    if p.style.name in ("Title", "Heading 1", "Heading 2", "Heading 3"):
        for run in p.runs:
            set_run_font(run, color="000000")

doc.save(OUT)
print(str(OUT))
