from pathlib import Path
import pypdfium2 as pdfium

pdf_path = Path(r"D:\Project_folder\模型网关\qa_product_doc\模型网关管理平台产品说明文档.pdf")
out_dir = pdf_path.parent
pdf = pdfium.PdfDocument(pdf_path)
for i, page in enumerate(pdf):
    bitmap = page.render(scale=2.0)
    image = bitmap.to_pil()
    image.save(out_dir / f"page-{i + 1}.png")
print(len(pdf))
