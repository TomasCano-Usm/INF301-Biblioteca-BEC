#!/usr/bin/env python3
"""Construye informe, anexos PDF/DOCX y manual desde fuentes y evidencia real."""
import csv
from datetime import datetime, timezone
from html.parser import HTMLParser
from html import escape
import json
from pathlib import Path
import re
from urllib.parse import unquote
import markdown
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from PIL import Image
from playwright.sync_api import sync_playwright
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.pagesizes import A3, landscape
from evidence import TRACE

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT/"docs"
CSS = """
@page {size:A4;margin:18mm 16mm 19mm}
body{font-family:Arial,sans-serif;color:#203247;font-size:10pt;line-height:1.45}
h1{color:#133b54;font-size:23pt;line-height:1.15;break-before:page;margin:0 0 16px}
h1:first-of-type{break-before:auto}h2{font-size:15pt;color:#126268;margin-top:22px}
h3{font-size:12pt;color:#126268}h1,h2,h3{break-after:avoid}
p,li{orphans:3;widows:3}a{color:#086e78;text-decoration:none}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:8pt;table-layout:fixed}
th{background:#e4f1f2;text-align:left;color:#133b54}
th,td{padding:6px;border:1px solid #b7cbd1;vertical-align:top;overflow-wrap:anywhere}
thead{display:table-header-group}tr{break-inside:avoid}
pre{background:#f0f4f6;border:1px solid #ccd8df;padding:9px;white-space:pre-wrap;
overflow-wrap:anywhere;font:8pt/1.4 Consolas,monospace;break-inside:auto}
code{font-family:Consolas,monospace;font-size:.9em;overflow-wrap:anywhere}
img{display:block;max-width:100%;max-height:225mm;object-fit:contain;margin:14px auto}
blockquote{border-left:4px solid #12858b;padding-left:12px;color:#435567}
hr{border:0;border-top:1px solid #c4d4da}
"""

def table(headers, rows):
    clean=lambda s:str(s).replace("|","/").replace("\n"," ")
    return "\n".join(["| "+" | ".join(map(clean,headers))+" |","| "+" | ".join("---" for _ in headers)+" |"]+
        ["| "+" | ".join(map(clean,row))+" |" for row in rows])

def generate_report():
    backend=json.loads((ROOT/"evidencias/pruebas_backend.json").read_text())
    ui=json.loads((ROOT/"evidencias/interfaz.json").read_text())
    load=json.loads((ROOT/"evidencias/carga.json").read_text())
    contracts=json.loads((DOCS/"contratos.json").read_text())
    operations=contracts["operations"]
    with (DOCS/"matriz_acceso.csv").open(encoding="utf-8-sig") as f:
        access=list(csv.DictReader(f))
    # La misma versión del artefacto debe respaldar los tres conjuntos.
    assert backend["artifact_sha256"]==ui["artifact_sha256"]==load["artifact_sha256"], "Evidencia de versiones distintas."
    routes=table(["ID","Verbo y ruta externa","Destino","Rol/pantalla"],
        [(o["id"],o["method"]+" `"+o["external"]+"`",o["target"],o["roles"]+" · "+o["screen"]) for o in operations])
    metrics=table(["Consulta","Conc.","s efectivos","Solic.","req/s","p95 ms","Errores","CPU % 1 core","RSS MiB"],
        [(r["protocol"].replace(" sobre HTTPS",""),r["concurrency"],r["elapsed_s"],r["requests"],
          r["throughput_rps"],r["p95_ms"],r["errors"],r["services_cpu_percent_one_core"],r["services_peak_rss_mib"]) for r in load["results"]])
    trace=table(["RF/CU o condición","Pantalla","Servicio","Prueba","Resultado"],
        [(r[0],r[2],r[3],r[4],r[5]) for r in TRACE])
    env=load["environment"]
    context={
        "DATE":datetime.now(timezone.utc).strftime("%d-%m-%Y (UTC)"),
        "BACKEND_TOTAL":backend["total"], "UI_TOTAL":len(ui["checks"]),
        "ROUTES_TABLE":routes, "ACCESS_ROWS":len(access),
        "PATH_TOTAL":len({o["external"] for o in operations}),
        "LOAD_DATE":load["recorded_at_utc"], "ARTIFACT_SHA":load["artifact_sha256"],
        "LOAD_PLATFORM":env["platform"], "CPU_COUNT":env["logical_cpus"],
        "MEMORY_GIB":round(int(env["memory_total_kib"])/1024**2,2),
        "DATASET_TOTAL":load["dataset"], "LOAD_TABLE":metrics,
        "LOAD_REQUESTS":sum(r["requests"] for r in load["results"]),
        "LOAD_ERRORS":sum(r["errors"] for r in load["results"]),
        "REST_BYTES":load["results"][0]["mean_response_bytes"],
        "GQL_BYTES":load["results"][3]["mean_response_bytes"],
        "TRACE_TABLE":trace
    }
    result=(DOCS/"informe_fuente.md").read_text()
    for key,value in context.items():
        result=result.replace("{{"+key+"}}",str(value))
    assert not re.search(r"\{\{[A-Z_]+\}\}",result), "Marcador documental sin resolver"
    (DOCS/"informe.md").write_text(result)

class Element:
    def __init__(self, tag="root", attrs=None):
        self.tag,self.attrs,self.children=tag,dict(attrs or []),[]
    def text(self):
        return "".join(c.text() if isinstance(c,Element) else c for c in self.children)
    def all(self,tag):
        result=[]
        for c in self.children:
            if isinstance(c,Element):
                if c.tag==tag:result.append(c)
                result.extend(c.all(tag))
        return result

class Tree(HTMLParser):
    def __init__(self):
        super().__init__();self.root=Element();self.stack=[self.root]
    def handle_starttag(self,tag,attrs):
        node=Element(tag,attrs);self.stack[-1].children.append(node)
        if tag not in ("img","br","hr","meta","link","input"):self.stack.append(node)
    def handle_startendtag(self,tag,attrs):self.handle_starttag(tag,attrs);self.handle_endtag(tag)
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,0,-1):
            if self.stack[i].tag==tag:self.stack=self.stack[:i];break
    def handle_data(self,data):self.stack[-1].children.append(data)

def inline(paragraph,element,bold=False,italic=False,mono=False):
    for child in element.children:
        if isinstance(child,str):
            run=paragraph.add_run(child);run.bold=bold;run.italic=italic
            if mono:run.font.name="Consolas";run.font.size=Pt(8)
        elif child.tag=="br":paragraph.add_run().add_break()
        elif child.tag=="img":continue
        else:inline(paragraph,child,bold or child.tag in ("strong","b"),italic or child.tag in ("em","i"),mono or child.tag=="code")

def to_docx(body,output):
    tree=Tree();tree.feed(body)
    doc=Document()
    sec=doc.sections[0];sec.top_margin=Inches(.65);sec.bottom_margin=Inches(.65)
    sec.left_margin=Inches(.65);sec.right_margin=Inches(.65)
    normal=doc.styles["Normal"];normal.font.name="Calibri";normal.font.size=Pt(10)
    for heading in ("Title","Heading 1","Heading 2","Heading 3"):
        doc.styles[heading].font.color.rgb=RGBColor.from_string("133B54")
    footer=sec.footer.paragraphs[0];footer.text="Caso 16 · BEC · "
    field=OxmlElement("w:fldSimple");field.set(qn("w:instr"),"PAGE");footer._p.append(field)
    def image(node):
        path=(DOCS/unquote(node.attrs.get("src",""))).resolve()
        if not path.is_file():return
        with Image.open(path) as im:
            width,height=im.size
        maxw,maxh=6.6,8.4
        inches=min(maxw,maxh*width/height)
        doc.add_picture(str(path),width=Inches(inches))
        doc.add_paragraph(node.attrs.get("alt",""),style="Caption")
    def render(node):
        if isinstance(node,str):return
        tag=node.tag
        if tag in ("h1","h2","h3","h4"):
            p=doc.add_heading(node.text(),level=min(int(tag[1]),3))
            if tag=="h1" and len(doc.paragraphs)>2:p.paragraph_format.page_break_before=True
        elif tag=="p":
            imgs=node.all("img")
            if node.text().strip():inline(doc.add_paragraph(),node)
            for item in imgs:image(item)
        elif tag=="pre":
            p=doc.add_paragraph()
            p.paragraph_format.space_after=Pt(7)
            run=p.add_run(node.text());run.font.name="Consolas";run.font.size=Pt(7.5)
        elif tag in ("ul","ol"):
            for child in node.children:
                if isinstance(child,Element) and child.tag=="li":
                    inline(doc.add_paragraph(style="List Bullet" if tag=="ul" else "List Number"),child)
        elif tag=="table":
            rows=node.all("tr")
            if not rows:return
            cells=lambda r:[c for c in r.children if isinstance(c,Element) and c.tag in ("td","th")]
            t=doc.add_table(rows=0,cols=max(len(cells(r)) for r in rows));t.style="Light Shading Accent 1"
            for ri,row in enumerate(rows):
                dst=t.add_row().cells
                for ci,cell in enumerate(cells(row)):
                    inline(dst[ci].paragraphs[0],cell,bold=ri==0)
                    for p in dst[ci].paragraphs:
                        for run in p.runs:run.font.size=Pt(7.5)
                if ri==0:
                    repeat=OxmlElement("w:tblHeader");t.rows[-1]._tr.get_or_add_trPr().append(repeat)
            doc.add_paragraph()
        elif tag=="img":image(node)
        else:
            for child in node.children:render(child)
    for node in tree.root.children:render(node)
    doc.core_properties.title="Caso 16 · Biblioteca Municipal BEC"
    doc.core_properties.subject="Diez módulos de backend, seguridad y evidencia"
    doc.core_properties.author="[Completar integrantes]"
    doc.save(output)

def diagram_pdf():
    output=DOCS/"diagramas.pdf"
    size=landscape(A3);c=Canvas(str(output),pagesize=size)
    c.setTitle("Caso 16 · Diagramas UML y arquitectura · A3")
    for index,path in enumerate(sorted((DOCS/"diagramas").glob("*.png")),1):
        c.setFont("Helvetica-Bold",15);c.drawString(32,size[1]-36,path.stem.replace("_"," "))
        with Image.open(path) as image:w,h=image.size
        scale=min((size[0]-64)/w,(size[1]-105)/h)
        dw,dh=w*scale,h*scale
        c.drawImage(str(path),(size[0]-dw)/2,(size[1]-dh)/2-5,width=dw,height=dh)
        c.setFont("Helvetica",9);c.drawString(32,24,"Fuente editable: diagramas/"+path.stem+".puml  |  SVG disponible para ampliar sin perder nitidez.")
        c.drawRightString(size[0]-32,24,str(index));c.showPage()
    c.save()

def main():
    generate_report()
    bodies={}
    for name in ("informe","contratos","contratos_privados","seguridad_operacion","validacion_oracle"):
        bodies[name]=markdown.markdown((DOCS/(name+".md")).read_text(),extensions=["tables","fenced_code","sane_lists"])
    manual=(ROOT/"web/help.html").read_text()
    match=re.search(r"<main[^>]*>(.*?)</main>",manual,re.S)
    bodies["manual_usuario"]="<h1>Manual de usuario · Biblioteca Municipal BEC</h1>"+(match.group(1) if match else manual)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        page=browser.new_page()
        for name,body in bodies.items():
            html='<!doctype html><html lang="es"><meta charset="utf-8"><title>Caso 16 · '+escape(name)+'</title><style>'+CSS+'</style><body>'+body+"</body></html>"
            path=DOCS/(name+".html");path.write_text(html)
            page.goto(path.as_uri(),wait_until="load")
            page.pdf(path=str(DOCS/(name+".pdf")),format="A4",print_background=True,prefer_css_page_size=True,
                display_header_footer=True,
                header_template='<div style="font:8px Arial;color:#53697a;width:100%;text-align:right;margin:0 16mm">CASO 16 · BIBLIOTECA MUNICIPAL BEC</div>',
                footer_template='<div style="font:8px Arial;color:#53697a;width:100%;margin:0 16mm;display:flex;justify-content:space-between"><span>Entrega académica · limitaciones declaradas en informe</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>')
        browser.close()
    to_docx(bodies["informe"],DOCS/"informe.docx")
    to_docx(bodies["contratos"],DOCS/"contratos.docx")
    to_docx(bodies["manual_usuario"],DOCS/"manual_usuario.docx")
    diagram_pdf()
    print("Informe PDF/DOCX, contratos, manual, anexos PDF y diagramas A3 generados con evidencia del mismo JAR.")

if __name__=="__main__":
    main()
