# -*- coding: utf-8 -*-
from docx import Document
from pathlib import Path

p = Path(r"C:\Users\10429862\Downloads\康饮苏州厂CCTV项目需求说明书-251210.docx")
d = Document(str(p))
print("STYLES:", sorted({(para.style.name if para.style else "") for para in d.paragraphs if para.text.strip()}))
print("---PARAS---")
for i, para in enumerate(d.paragraphs):
    t = para.text.strip()
    if not t:
        continue
    style = para.style.name if para.style else ""
    preview = t.replace("\n", " / ")[:180]
    print(f"{i}|{style}|{preview}")
print("---TABLES", len(d.tables))
for ti, table in enumerate(d.tables):
    print(f"=== TABLE {ti} rows={len(table.rows)} cols={len(table.columns)} ===")
    for ri, row in enumerate(table.rows):
        cells = [c.text.strip().replace("\n", " / ")[:50] for c in row.cells]
        print(ri, " | ".join(cells))
