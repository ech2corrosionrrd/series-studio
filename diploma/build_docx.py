#!/usr/bin/env python
"""Збирає всі файли diploma/NN-*.md в один Dyplom_Series_Lab.docx.

Оформлення (типові вимоги): Times New Roman 14 pt, інтервал 1,5, абзацний відступ 1,25 см,
поля: ліве 30, праве 15, верхнє й нижнє 20 мм, нумерація сторінок знизу по центру,
кожен заголовок рівня 1 починається з нової сторінки.
Залежність: pip install python-docx
"""
import glob
import os
import re

from docx import Document
from docx.enum.section import WD_ORIENT  # noqa: F401
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "Dyplom_Series_Lab.docx")
FONT = "Times New Roman"

doc = Document()

# ---- сторінка й стилі ----
sec = doc.sections[0]
sec.left_margin, sec.right_margin = Cm(3), Cm(1.5)
sec.top_margin, sec.bottom_margin = Cm(2), Cm(2)


def set_font(style, size, bold=None):
    style.font.name = FONT
    style.font.size = Pt(size)
    if bold is not None:
        style.font.bold = bold
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for a in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rfonts.set(qn(a), FONT)


normal = doc.styles["Normal"]
set_font(normal, 14)
normal.paragraph_format.line_spacing = 1.5
normal.paragraph_format.space_after = Pt(0)

for lvl, size in ((1, 16), (2, 14), (3, 14), (4, 14)):
    st = doc.styles[f"Heading {lvl}"]
    set_font(st, size, bold=True)
    st.font.color.rgb = None
    st.paragraph_format.line_spacing = 1.5
    st.paragraph_format.space_before = Pt(12 if lvl > 1 else 0)
    st.paragraph_format.space_after = Pt(6)
    st.paragraph_format.keep_with_next = True
doc.styles["Heading 1"].paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER

# номер сторінки
fp = sec.footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = fp.add_run()
for tag, text in (("begin", None), (None, "PAGE"), ("end", None)):
    if tag:
        el = OxmlElement("w:fldChar")
        el.set(qn("w:fldCharType"), tag)
    else:
        el = OxmlElement("w:instrText")
        el.set(qn("xml:space"), "preserve")
        el.text = text
    run._r.append(el)

INLINE = re.compile(r"(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)")


def add_inline(par, text, size=None, force_bold=False):
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            r = par.add_run(part[2:-2])
            r.bold = True
        elif part.startswith("`") and part.endswith("`"):
            r = par.add_run(part[1:-1])
            r.font.name = "Courier New"
            r._element.rPr.rFonts.set(qn("w:eastAsia"), "Courier New")
            r.font.size = Pt(12 if size is None else min(size, 12))
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            r = par.add_run(part[1:-1])
            r.italic = True
        else:
            r = par.add_run(part)
        if force_bold:
            r.bold = True
        if size and not (part.startswith("`") and part.endswith("`")):
            r.font.size = Pt(size)


def shade(cell, color="D9D9D9"):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), color)
    tcpr.append(shd)


def add_table(rows):
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    header, body = cells[0], [r for r in cells[2:]] if len(cells) > 2 else []
    ncols = len(header)
    t = doc.add_table(rows=1, cols=ncols)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(header):
        c = t.rows[0].cells[i]
        c.text = ""
        p = c.paragraphs[0]
        p.paragraph_format.line_spacing = 1.0
        add_inline(p, h, size=12, force_bold=True)
        shade(c)
    for r in body:
        rc = t.add_row().cells
        for i in range(ncols):
            rc[i].text = ""
            p = rc[i].paragraphs[0]
            p.paragraph_format.line_spacing = 1.0
            add_inline(p, r[i] if i < len(r) else "", size=12)
    doc.add_paragraph()


def add_code(lines, lang=""):
    if lang == "mermaid":
        p = doc.add_paragraph()
        p.paragraph_format.line_spacing = 1.0
        r = p.add_run("[Схема Mermaid: відрендеріть код нижче (наприклад, на mermaid.live) і вставте зображення замість цього блока]")
        r.italic = True
        r.font.size = Pt(11)
    for ln in lines:
        p = doc.add_paragraph()
        p.paragraph_format.line_spacing = 1.0
        p.paragraph_format.left_indent = Cm(0.5)
        r = p.add_run(ln if ln else " ")
        r.font.name = "Courier New"
        r._element.rPr.rFonts.set(qn("w:eastAsia"), "Courier New")
        r.font.size = Pt(9 if lang == "mermaid" else 10)


def add_md(text, first_file):
    lines = text.split("\n")
    i = 0
    first_h1 = first_file
    while i < len(lines):
        ln = lines[i]
        s = ln.strip()
        if s.startswith("```"):
            lang = s[3:].strip()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i].rstrip("\r"))
                i += 1
            add_code(buf, lang)
            i += 1
            continue
        if s.startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i])
                i += 1
            add_table(rows)
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", s)
        if m:
            lvl = len(m.group(1))
            if lvl == 1 and not first_h1:
                doc.add_page_break()
            first_h1 = False
            doc.add_heading(re.sub(r"[`*]", "", m.group(2)), level=lvl)
            i += 1
            continue
        if s in ("---", "***", ""):
            i += 1
            continue
        if s.startswith(">"):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(1)
            add_inline(p, s.lstrip("> ").strip(), size=12)
            for r in p.runs:
                r.italic = True
            i += 1
            continue
        m = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", ln)
        if m:
            indent = len(m.group(1)) // 2
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(1.25 + 0.6 * indent)
            p.paragraph_format.first_line_indent = Cm(-0.5)
            marker = "– " if m.group(2) in "-*" else m.group(2) + " "
            p.add_run(marker)
            add_inline(p, m.group(3))
            i += 1
            continue
        # звичайний абзац (склеюємо рядки до порожнього)
        buf = [s]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|```|\||>|\s*([-*]|\d+\.)\s)", lines[i]):
            buf.append(lines[i].strip())
            i += 1
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        p.paragraph_format.first_line_indent = Cm(1.25)
        add_inline(p, " ".join(buf))


files = sorted(f for f in glob.glob(os.path.join(HERE, "[0-9][0-9]-*.md")))
for idx, f in enumerate(files):
    with open(f, encoding="utf-8") as fh:
        add_md(fh.read(), first_file=(idx == 0))
    if idx != len(files) - 1:
        doc.add_page_break()

doc.save(OUT)
print("OK:", OUT, f"({len(files)} файлів)")
