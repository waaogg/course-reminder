import { it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import JSZip from "jszip";
import { extractBuffer } from "../../src/extraction/documents";
const root = mkdtempSync(join(tmpdir(), "course-reminder-ocr-"));
process.env.REMINDER_OCR_MODELS = resolve("resources/models");
function pdf(objects: Buffer[]) {
  const chunks = [Buffer.from("%PDF-1.4\n")],
    offsets = [0];
  let length = chunks[0].length;
  objects.forEach((obj, i) => {
    offsets.push(length);
    const b = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      obj,
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(b);
    length += b.length;
  });
  const table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`;
  return Buffer.concat([...chunks, Buffer.from(table)]);
}
it("reads a real PDF text stream through PDF.js", async () => {
  const content = "BT /F1 14 Tf 40 700 Td (Submit by 2026-10-30 23:30) Tj ET";
  const buffer = pdf([
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    ),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.from(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ),
  ]);
  const result = await extractBuffer(buffer, ".pdf", root);
  expect(result.text).toContain("2026-10-30 23:30");
  expect(result.partial).toBe(false);
});
it("extracts DOCX text without executing or rendering source HTML", async () => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>课程报告请在2026年10月30日提交</w:t></w:r></w:p></w:body></w:document>',
  );
  const result = await extractBuffer(
    await zip.generateAsync({ type: "nodebuffer" }),
    ".docx",
    root,
  );
  expect(result.text).toContain("2026年10月30日提交");
});
it("recognizes a rendered deadline image using the bundled local OCR models", async () => {
  const canvas = createCanvas(1200, 180),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1200, 180);
  ctx.fillStyle = "black";
  ctx.font = '44px "Microsoft YaHei"';
  ctx.fillText("请于2026年10月30日提交课程报告", 35, 105);
  const result = await extractBuffer(
    canvas.toBuffer("image/png"),
    ".png",
    root,
  );
  expect(result.text.replace(/\s/g, "")).toContain("2026年10月30日");
}, 120000);

it("renders an image-only PDF before local OCR", async () => {
  const canvas = createCanvas(1200, 180),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1200, 180);
  ctx.fillStyle = "black";
  ctx.font = '44px "Microsoft YaHei"';
  ctx.fillText("请于2026年10月30日提交课程报告", 35, 105);
  const jpeg = canvas.toBuffer("image/jpeg");
  const content = "q 600 0 0 90 0 0 cm /Im0 Do Q";
  const buffer = pdf([
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 90] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 1200 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      Buffer.from("\nendstream"),
    ]),
    Buffer.from(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ),
  ]);
  const result = await extractBuffer(buffer, ".pdf", root);
  expect(result.text.replace(/\s/g, "")).toContain("2026年10月30日");
}, 120000);

it("recognizes deadlines embedded as DOCX images", async () => {
  const canvas = createCanvas(1200, 180),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1200, 180);
  ctx.fillStyle = "black";
  ctx.font = '44px "Microsoft YaHei"';
  ctx.fillText("请于2026年10月30日提交课程报告", 35, 105);
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/_rels/document.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="img1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/deadline.png"/></Relationships>',
  );
  zip.file("word/media/deadline.png", canvas.toBuffer("image/png"));
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="img1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>',
  );
  const result = await extractBuffer(
    await zip.generateAsync({ type: "nodebuffer" }),
    ".docx",
    root,
  );
  expect(result.text.replace(/\s/g, "")).toContain("2026年10月30日");
  expect(result.partial).toBe(false);
}, 120000);
