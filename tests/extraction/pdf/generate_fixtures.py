"""Regenerate deterministic, synthetic PDF reader fixtures for local CI."""

from __future__ import annotations

import tempfile
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    ByteStringObject,
    DictionaryObject,
    EncodedStreamObject,
    NameObject,
    NumberObject,
    TextStringObject,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).parent / "fixtures"
LETTER = (612, 792)
FONT_PATH = Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf")


def new_canvas(path: Path, pagesize: tuple[float, float] = LETTER) -> canvas.Canvas:
    result = canvas.Canvas(str(path), pagesize=pagesize, pageCompression=1, invariant=1)
    result.setTitle("Synthetic fixture")
    result.setAuthor("Event Intelligence tests")
    return result


def rewrite(source: Path, destination: Path, edit) -> None:
    writer = PdfWriter()
    writer.clone_document_from_reader(PdfReader(str(source)))
    edit(writer)
    with destination.open("wb") as stream:
        writer.write(stream)


def make_rotated_unicode(path: Path) -> None:
    pdfmetrics.registerFont(TTFont("FixtureArialUnicode", str(FONT_PATH)))
    doc = new_canvas(path)
    doc.setFont("FixtureArialUnicode", 18)
    doc.drawString(64, 704, "Festival 東京 2027")
    doc.save()

    def rotate(writer: PdfWriter) -> None:
        writer.pages[0][NameObject("/Rotate")] = NumberObject(90)

    rewrite(path, path.with_suffix(".rotated.tmp.pdf"), rotate)
    path.with_suffix(".rotated.tmp.pdf").replace(path)


def make_scanned_page(path: Path) -> None:
    image = Image.new("RGB", (500, 180), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONT_PATH), 28)
    draw.text((20, 30), "RASTER ONLY / SATURDAY 2027", fill="black", font=font)
    draw.rectangle((16, 20, 470, 90), outline="black", width=2)
    with tempfile.TemporaryDirectory(prefix="ei-pdf-fixture-") as temp:
        image_path = Path(temp) / "raster.png"
        image.save(image_path, format="PNG", optimize=False)
        doc = new_canvas(path)
        doc.drawImage(str(image_path), 48, 600, width=500, height=180)
        doc.save()


def make_pdf_fixtures() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)

    # Two pages make page numbering/order observable; the second page is rotated.
    multipage = ROOT / "text-multipage.pdf"
    doc = new_canvas(multipage)
    doc.setFont("Helvetica", 18)
    doc.drawString(48, 720, "Community Night - Doors at 7 PM")
    doc.showPage()
    doc.drawString(48, 720, "Saturday, October 17, 2026")
    doc.showPage()
    doc.save()

    def rotate_second(writer: PdfWriter) -> None:
        writer.pages[1][NameObject("/Rotate")] = NumberObject(90)

    rotated = ROOT / "text-multipage.rotated.tmp.pdf"
    rewrite(multipage, rotated, rotate_second)
    rotated.replace(multipage)

    make_rotated_unicode(ROOT / "text-rotated-unicode.pdf")

    empty = new_canvas(ROOT / "empty.pdf")
    empty.showPage()
    empty.save()
    make_scanned_page(ROOT / "scanned.pdf")

    mixed = new_canvas(ROOT / "mixed.pdf")
    mixed.setFont("Helvetica", 18)
    mixed.drawString(48, 720, "Text layer is partial")
    with tempfile.TemporaryDirectory(prefix="ei-pdf-mixed-") as temp:
        image_path = Path(temp) / "raster.png"
        Image.new("RGB", (160, 80), "white").save(image_path, format="PNG")
        mixed.drawImage(str(image_path), 48, 590, width=160, height=80)
    mixed.save()

    encrypted_source = ROOT / "text-multipage.pdf"

    def encrypt(writer: PdfWriter) -> None:
        writer._ID = ArrayObject(
            [ByteStringObject(b"synthetic-pdf-fixture-id")]
        )
        writer.encrypt("synthetic-fixture-password")

    rewrite(encrypted_source, ROOT / "encrypted.pdf", encrypt)

    def open_action(writer: PdfWriter) -> None:
        writer.root_object[NameObject("/OpenAction")] = DictionaryObject(
            {
                NameObject("/S"): NameObject("/JavaScript"),
                NameObject("/JS"): TextStringObject("app.alert('synthetic');"),
            }
        )

    rewrite(encrypted_source, ROOT / "javascript-open-action.pdf", open_action)

    def add_link_action(writer: PdfWriter, action: DictionaryObject) -> None:
        annotation = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Annot"),
                NameObject("/Subtype"): NameObject("/Link"),
                NameObject("/Rect"): ArrayObject(
                    [NumberObject(48), NumberObject(700), NumberObject(240), NumberObject(730)]
                ),
                NameObject("/A"): action,
            }
        )
        reference = writer._add_object(annotation)
        writer.pages[0][NameObject("/Annots")] = ArrayObject([reference])

    def uri_link(writer: PdfWriter) -> None:
        add_link_action(
            writer,
            DictionaryObject(
                {
                    NameObject("/S"): NameObject("/URI"),
                    NameObject("/URI"): TextStringObject("https://example.invalid/remote"),
                }
            ),
        )

    rewrite(encrypted_source, ROOT / "uri-link.pdf", uri_link)

    def remote_goto(writer: PdfWriter) -> None:
        add_link_action(
            writer,
            DictionaryObject(
                {
                    NameObject("/S"): NameObject("/GoToR"),
                    NameObject("/F"): TextStringObject("remote.pdf"),
                    NameObject("/D"): TextStringObject("page.1"),
                }
            ),
        )

    rewrite(encrypted_source, ROOT / "remote-goto-action.pdf", remote_goto)

    def launch_action(writer: PdfWriter) -> None:
        writer.root_object[NameObject("/OpenAction")] = DictionaryObject(
            {
                NameObject("/S"): NameObject("/Launch"),
                NameObject("/F"): TextStringObject("synthetic-never-run"),
            }
        )

    rewrite(encrypted_source, ROOT / "launch-open-action.pdf", launch_action)

    def embedded_file(writer: PdfWriter) -> None:
        payload = EncodedStreamObject()
        payload._data = b"synthetic attachment"
        payload_ref = writer._add_object(payload)
        filespec = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Filespec"),
                NameObject("/F"): TextStringObject("synthetic.txt"),
                NameObject("/EF"): DictionaryObject({NameObject("/F"): payload_ref}),
            }
        )
        filespec_ref = writer._add_object(filespec)
        tree = writer._add_object(
            DictionaryObject(
                {
                    NameObject("/Names"): ArrayObject(
                        [TextStringObject("synthetic.txt"), filespec_ref]
                    )
                }
            )
        )
        writer.root_object[NameObject("/Names")] = DictionaryObject(
            {NameObject("/EmbeddedFiles"): tree}
        )

    rewrite(encrypted_source, ROOT / "embedded-file.pdf", embedded_file)

    giant = ROOT / "giant-dimensions.pdf"
    large_page = new_canvas(giant, pagesize=(100_000, 100_000))
    large_page.drawString(100, 99_000, "Oversized page")
    large_page.save()

    over_pages = new_canvas(ROOT / "over-pages.pdf")
    for _ in range(21):
        over_pages.showPage()
    over_pages.save()

    # A small Flate stream expands to 111,000 extracted text code units,
    # beyond the reader's all-or-nothing 100,000-unit ceiling.
    def expansion_stream(writer: PdfWriter) -> None:
        text = b"A" * 74
        expanded = b"".join(
            b"BT /F1 12 Tf 24 720 Td (" + text + b") Tj ET\n"
            for _ in range(1_500)
        )
        content = EncodedStreamObject()
        content.update({NameObject("/Filter"): NameObject("/FlateDecode")})
        content._data = zlib.compress(expanded, level=9)
        writer.pages[0][NameObject("/Contents")] = writer._add_object(content)

    rewrite(encrypted_source, ROOT / "compressed-expansion.pdf", expansion_stream)

    overflow = new_canvas(ROOT / "text-overflow.pdf")
    overflow.setFont("Helvetica", 8)
    for line in range(500):
        overflow.drawString(24, 740 - line, "A" * 100)
    overflow.save()

    (ROOT / "malformed.pdf").write_bytes(
        b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\n%%EOF\n"
    )


if __name__ == "__main__":
    make_pdf_fixtures()
