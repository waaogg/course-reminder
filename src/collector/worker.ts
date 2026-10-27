import { launchSession, entries, loggedIn } from "./session";
import { scanXjtu } from "./xjtu";
import { scanIcourse } from "./icourse";
import { extractAttachments, extractBuffer } from "../extraction/documents";
import { redactError } from "../domain/security";
import { peerReviewTasks } from "./common";
const port = (process as any).parentPort;
const send = (value: unknown) => port.postMessage(value);
const job = JSON.parse(process.argv[2]) as {
  platform: "xjtu" | "icourse";
  root: string;
  mode: "login" | "scan" | "diagnostic";
  attachments: boolean;
};
let context: Awaited<ReturnType<typeof launchSession>> | undefined;
try {
  if (job.mode === "diagnostic") {
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(1200, 180),
      paint = canvas.getContext("2d");
    paint.fillStyle = "white";
    paint.fillRect(0, 0, 1200, 180);
    paint.fillStyle = "black";
    paint.font = '44px "Microsoft YaHei"';
    paint.fillText("请于2026年10月30日提交课程报告", 35, 105);
    const extraction = await extractBuffer(
      canvas.toBuffer("image/png"),
      ".png",
      job.root,
    );
    context = await launchSession(job.root, job.platform);
    const p = context.pages()[0];
    await p.goto(
      "data:text/html,<title>Browser diagnostic</title><p>Browser ready</p>",
    );
    send({
      type: "diagnostic",
      text: extraction.text,
      browserOK: (await p.title()) === "Browser diagnostic",
    });
    await context.close();
    send({ type: "done" });
    process.exit(0);
  }
  context = await launchSession(job.root, job.platform, job.mode === "login");
  if (job.mode === "login") {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(entries[job.platform], { waitUntil: "domcontentloaded" });
    send({ type: "progress", message: "请在专用浏览器窗口完成登录" });
    let done = false;
    context.on("close", () => {
      done = true;
    });
    while (!done) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      if (await loggedIn(page, job.platform).catch(() => false)) {
        await page.waitForTimeout(2000);
        send({ type: "authenticated" });
        break;
      }
    }
  } else {
    const result = await (job.platform === "xjtu" ? scanXjtu : scanIcourse)(
      context,
      (message) => send({ type: "progress", message }),
    );
    result.tasks = peerReviewTasks(result.tasks, result.courses);
    send({ type: "result", result });
    if (job.attachments && !result.error)
      await extractAttachments(
        context,
        result.tasks,
        job.root,
        (record, requirements) =>
          send({ type: "document", record, requirements }),
      );
  }
} catch (error) {
  send({ type: "error", message: redactError(error) });
} finally {
  await context?.close().catch(() => {});
  send({ type: "done" });
  process.exit(0);
}
