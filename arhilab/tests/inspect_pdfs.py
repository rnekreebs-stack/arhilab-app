#!/usr/bin/env python3
"""Inspect real Android PDF fixtures with Poppler; fail with actual/expected evidence."""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
import xml.etree.ElementTree as ET


def require(ok, name, actual, expected):
    if not ok:
        raise RuntimeError(f"{name}: actual={actual!r}; expected={expected!r}")


def command(*args):
    return subprocess.check_output(args, text=True, encoding="utf-8")


def money(value):
    return f"{value:,}".replace(",", " ") + " ₽"


def normalized(text):
    return " ".join(text.split())


def inspect(root):
    for tool in ("pdfinfo", "pdftotext", "pdfimages", "pdftoppm"):
        require(shutil.which(tool), "Poppler dependency", tool, "installed")
    cases = {
        "arhilab-technical-estimate": (2, 9900, 9000, "Общие работы"),
        "arhilab-5-rows": (4, 24200000, 24200000, "Работы"),
        "arhilab-50-rows": (13, 240200000, 240200000, "Работы"),
        "arhilab-200-rows": (43, 960200000, 960200000, "Работы"),
        "arhilab-only-totals": (4, 1500, 100, None),
        "arhilab-with-photo": (4, 9900, 9000, "Общие работы"),
        "arhilab-long-with-photo": (11, 10000, 10000, "Общие работы"),
    }
    actual_names = {p.stem for p in root.glob("*.pdf")}
    require(actual_names == set(cases), "fresh fixture set", sorted(actual_names), sorted(cases))
    forbidden = re.compile(
        r"закупочн|себестоим|маржа|валовая\s+прибыль|операционная\s+прибыль|"
        r"worker\s+cost|purchase\s+cost|gross\s+profit|operating\s+profit|margin|"
        r"internal\s+markup|внутренняя\s+наценка|внутренн\w*\s+коэффициент", re.I
    )
    reports = []
    for name, (baseline_pages, total, section_total, section) in cases.items():
        path = root / (name + ".pdf")
        require(path.is_file() and path.stat().st_size > 0, name + " file", str(path), "nonempty file")
        require(path.read_bytes().startswith(b"%PDF-"), name + " header", path.read_bytes()[:8], "%PDF-")
        info = command("pdfinfo", str(path))
        count = int(re.search(r"^Pages:\s+(\d+)", info, re.M)[1])
        require(count >= baseline_pages, name + " pagination", count, f">={baseline_pages}")
        if name == "arhilab-only-totals":
            require(count == 4, name + " summary pagination", count, 4)
        sizes = re.findall(r"(?:Page\s+\d+\s+size|Page size):\s+([\d.]+) x ([\d.]+) pts",
                           command("pdfinfo", "-f", "1", "-l", str(count), str(path)))
        require(len(sizes) == count and all(float(w) == 960 and float(h) == 540 for w, h in sizes),
                name + " every page size", sizes, f"{count} pages at 960 x 540 pts")
        text = command("pdftotext", "-layout", str(path), "-")
        path.with_suffix(".txt").write_text(text, encoding="utf-8")
        pages = text.split("\f")
        if not pages[-1].strip():
            pages.pop()  # Poppler terminator is not a PDF page.
        require(len(pages) == count, name + " extracted pages", len(pages), count)
        flat = normalized(text)
        leak = forbidden.search(flat)
        require(leak is None, name + " internal finance leak", leak.group() if leak else None, None)
        bbox = ET.fromstring(command("pdftotext", "-bbox", str(path), "-"))
        boxes = bbox.findall(".//{*}page")
        images = command("pdfimages", "-list", str(path))
        image_pages = {int(line.split()[0]) for line in images.splitlines() if re.match(r"^\s*\d+\s+\d+", line)}
        for i, page in enumerate(pages, 1):
            require("ARHILAB" in page and "₽" in flat, f"{name} page {i} text", normalized(page)[:100], "brand and extractable text")
            require(f"{i:02d} / {count:02d}" in normalized(page), f"{name} page {i} footer", normalized(page)[-80:], f"{i:02d} / {count:02d}")
            words = boxes[i-1].findall(".//{*}word")
            body = [w.text for w in words if 130 <= float(w.attrib['yMin']) < 505]
            require(bool(body) or i in image_pages, f"{name} page {i} blank/title-only", body, "body text or photo")
        require("СМЕТА" in flat if name == "arhilab-technical-estimate" else "КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ" in flat,
                name + " Cyrillic document title", flat[:200], "correct Cyrillic mode title")
        grand_lines = [normalized(line) for line in text.splitlines() if "ОБЩАЯ СТОИМОСТЬ ПРОЕКТА" in line]
        expected_grand = "ОБЩАЯ СТОИМОСТЬ ПРОЕКТА " + money(total)
        require(grand_lines == [expected_grand], name + " canonical grand total", grand_lines, [expected_grand])
        work_lines = [normalized(line) for line in pages[-1].splitlines() if "ИТОГО РАБОТЫ" in line]
        require(work_lines == ["ИТОГО РАБОТЫ " + money(total)], name + " canonical work total", work_lines, money(total))
        if section:
            section_lines = [normalized(line) for line in text.splitlines() if "ИТОГО " + section.upper() in line]
            require("ИТОГО " + section.upper() + " " + money(section_total) in section_lines,
                    name + " section total", section_lines, money(section_total))
            require(any(normalized(line).endswith(section + " Работы и материалы " + money(section_total)) for line in pages[-1].splitlines()),
                    name + " summary section total", normalized(pages[-1]), money(section_total))
        else:
            for i in range(1, 16):
                require(f"Раздел {i} Работы и материалы 100 ₽" in flat, name + f" section {i}", flat, "100 ₽")
        rows_match = re.fullmatch(r"arhilab-(\d+)-rows", name)
        if rows_match:
            size = int(rows_match[1])
            require("5 000 000 ₽" in flat and "60 000 000 ₽" not in flat, name + " imported document total", flat, "5 000 000 ₽, never 60 000 000 ₽")
            require("12 м²" in flat, name + " quantity", flat, "12 м²")
            row_lines = [normalized(line) for line in text.splitlines() if "Монтаж перегородки" in line]
            require(len(row_lines) == size, name + " no lost rows", len(row_lines), size)
            require(row_lines[0].endswith("5 000 000 ₽") and all(line.endswith("4 800 000 ₽") for line in row_lines[1:]),
                    name + " canonical row amounts", row_lines, "5000000 then 4800000 each")
            require(all(token in flat for token in ("Демонтаж", "Электрика", "Сантехника", "м³", "×", "—")),
                    name + " Cyrillic and glyphs", flat, "Демонтаж Электрика Сантехника м³ × —")
            require("400 000 ₽" not in row_lines[0], name + " missing unit price", row_lines[0], "no invented unit price")
        if "with-photo" in name:
            require(bool(image_pages), name + " embedded photo", images, "embedded images")
        # Force Poppler to render every page; malformed graphics must also fail inspection.
        render_dir = root / "inspection-render"
        render_dir.mkdir(exist_ok=True)
        subprocess.run(["pdftoppm", "-scale-to", "320", "-gray", str(path), str(render_dir / name)], check=True, stdout=subprocess.DEVNULL)
        rendered = list(render_dir.glob(name + "-*.pgm"))
        require(len(rendered) == count and all(p.stat().st_size > 100 for p in rendered), name + " rendered pages", len(rendered), count)
        reports.append({"pdf": path.name, "bytes": path.stat().st_size, "pages": count,
                        "pageSize": [960, 540], "grandTotal": total, "sectionTotal": section_total,
                        "blankPages": [], "internalFinanceLeaks": [], "renderedPages": count, "result": "PASS"})
        print(f"PASS {path.name}: {count} pages, total={total}, section={section_total}, no blank pages/leaks", flush=True)
    return reports


if __name__ == "__main__":
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "output/pdf-examples")
    report = Path(sys.argv[2] if len(sys.argv) > 2 else "output/pdf-inspection.txt")
    try:
        reports = inspect(root)
    except Exception as error:
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text("FAIL " + str(error) + "\n", encoding="utf-8")
        print("FAIL " + str(error), file=sys.stderr)
        sys.exit(1)
    report.write_text(json.dumps({"result": "PASS", "pdfs": reports}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
