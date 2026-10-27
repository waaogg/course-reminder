import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import type { BrowserContext } from "playwright";
import type { DocumentRecord, Requirement, Task } from "../shared/types";
import { teacherRequirements, uid } from "../domain/time";
import { redactError } from "../domain/security";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
export async function extractBuffer(
  buffer: Buffer,
  type: string,
  root: string,
): Promise<{ text: string; partial: boolean }> {
  const ext = type.toLowerCase().split("?")[0];
  if (ext === ".docx") {
    const text = (await mammoth.extractRawText({ buffer })).value;
    const images: string[] = [];
    let count = 0,
      partial = false;
    // Conversion is only used to enumerate embedded images. Its HTML is never
    // rendered, and external relationships are not fetched by this callback.
    await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          count++;
          const imageType: Record<string, string> = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/webp": ".webp",
          };
          const type = imageType[image.contentType];
          if (count > 20 || !type) {
            partial = true;
            return { src: "" };
          }
          try {
            const bytes = Buffer.from(await image.read("base64"), "base64");
            if (bytes.length > 25 * 1024 * 1024) {
              partial = true;
              return { src: "" };
            }
            const result = await extractBuffer(bytes, type, root);
            images.push(`[嵌入图片${count}]\n${result.text}`);
            partial ||= result.partial;
          } catch {
            partial = true;
          }
          return { src: "" };
        }),
      },
    );
    return { text: [text, ...images].join("\n"), partial };
  }
  if (ext === ".xlsx") {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as any);
    const lines: string[] = [];
    book.eachSheet((sheet) => {
      lines.push(sheet.name);
      sheet.eachRow((row) => {
        lines.push(
          row.values instanceof Array
            ? row.values
                .map((x) =>
                  x instanceof Date
                    ? x.toISOString().slice(0, 10)
                    : typeof x === "object" && x
                      ? "result" in x
                        ? String(x.result)
                        : "text" in x
                          ? String(x.text)
                          : JSON.stringify(x)
                      : String(x ?? ""),
                )
                .join(" | ")
            : "",
        );
      });
    });
    return { text: lines.join("\n"), partial: false };
  }
  let worker:
    | Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>
    | undefined;
  async function ocr(image: Buffer) {
    if (!worker) {
      const { createWorker } = await import("tesseract.js");
      worker = await createWorker("chi_sim+eng", 1, {
        cachePath: join(root, "models"),
        ...(process.env.REMINDER_OCR_MODELS
          ? { langPath: process.env.REMINDER_OCR_MODELS }
          : {}),
      });
    }
    return (await worker.recognize(image)).data.text;
  }
  mkdirSync(join(root, "models"), { recursive: true });
  try {
    if (ext === ".pdf") {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loading = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
      });
      const pdf = await loading.promise;
      const lines: string[] = [];
      let partial = pdf.numPages > 30;
      try {
        for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
          const page = await pdf.getPage(i),
            content = await page.getTextContent();
          let text = content.items
            .map((x) => ("str" in x ? x.str : ""))
            .join(" ");
          if (text.replace(/\s/g, "").length < 40) {
            const { createCanvas } = await import("@napi-rs/canvas");
            const viewport = page.getViewport({ scale: 1.6 }),
              canvas = createCanvas(
                Math.ceil(viewport.width),
                Math.ceil(viewport.height),
              );
            await page.render({
              canvasContext: canvas.getContext("2d") as any,
              viewport,
              canvas: canvas as any,
            }).promise;
            text = await ocr(canvas.toBuffer("image/png"));
          }
          lines.push(`[第${i}页]\n${text}`);
          page.cleanup();
        }
      } finally {
        await loading.destroy();
      }
      return { text: lines.join("\n"), partial };
    }
    if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext))
      return { text: await ocr(buffer), partial: false };
    throw new Error("暂不支持该格式；请打开原文件核对");
  } finally {
    await worker?.terminate();
  }
}
export async function extractAttachments(
  context: BrowserContext,
  tasks: Task[],
  root: string,
  send: (record: DocumentRecord, requirements: Requirement[]) => void,
) {
  mkdirSync(join(root, "cache", "documents"), { recursive: true });
  const seen = new Set<string>();
  for (const task of tasks)
    for (const attachment of task.attachments) {
      const id = uid(task.id, attachment.url.split("?")[0]);
      if (seen.has(id)) continue;
      seen.add(id);
      const record: DocumentRecord = {
        id,
        taskId: task.id,
        name: attachment.name,
        url: attachment.url,
        status: "pending",
        message: "等待解析",
        at: new Date().toISOString(),
      };
      send(record, []);
      try {
        const u = new URL(attachment.url);
        if (
          u.protocol !== "https:" ||
          /^(localhost|127\.|10\.|192\.168\.|\[|169\.254\.)/.test(u.hostname) ||
          u.username ||
          u.password
        )
          throw new Error("附件链接不在允许访问范围");
        const urlType = extname(u.pathname).toLowerCase(),
          nameType = extname(attachment.name).toLowerCase();
        const type = [
          ".pdf",
          ".docx",
          ".xlsx",
          ".png",
          ".jpg",
          ".jpeg",
          ".webp",
        ].includes(urlType)
          ? urlType
          : nameType || urlType;
        if (
          ![
            ".pdf",
            ".docx",
            ".xlsx",
            ".png",
            ".jpg",
            ".jpeg",
            ".webp",
          ].includes(type)
        ) {
          send(
            {
              ...record,
              status: "unsupported",
              message: "当前版本暂不支持该附件格式，请打开原链接核对",
            },
            [],
          );
          continue;
        }
        const response = await context.request.get(u.href, { timeout: 45000 });
        if (!response.ok())
          throw new Error(`附件下载失败（${response.status()}）`);
        if (
          Number(response.headers()["content-length"] || 0) >
          25 * 1024 * 1024
        )
          throw new Error("文件超过25MB，需要手动核对");
        const buffer = await response.body();
        await response.dispose();
        if (buffer.length > 25 * 1024 * 1024)
          throw new Error("文件超过25MB，需要手动核对");
        const hash = createHash("sha256").update(buffer).digest("hex"),
          cache = join(root, "cache", "documents", `v2-${hash}.json`);
        let extracted: { text: string; partial: boolean };
        if (existsSync(cache))
          extracted = JSON.parse(readFileSync(cache, "utf8"));
        else {
          extracted = await extractBuffer(buffer, type, root);
          writeFileSync(cache, JSON.stringify(extracted), "utf8");
        }
        const requirements = teacherRequirements(
          task.id,
          extracted.text,
          attachment.url,
          new Date(),
          true,
        );
        send(
          {
            ...record,
            hash,
            status: extracted.partial ? "partial" : "success",
            message: extracted.partial
              ? "仅完成部分解析：PDF最多30页、DOCX最多20张支持格式图片；请打开原文件核对未处理内容"
              : `已提取文字${requirements.length ? `，发现${requirements.length}项日期候选，请核对` : "；未识别到明确日期要求"}`,
            text: extracted.text.slice(0, 160000),
          },
          requirements,
        );
      } catch (error) {
        send({ ...record, status: "error", message: redactError(error) }, []);
      }
    }
}
