import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Snapshot } from "../shared/types";
export interface APIDependencies {
  snapshot: () => Snapshot;
  sync: () => void;
  analyze?: (id: string) => Promise<unknown>;
}
export class LocalAPI {
  private server?: Server;
  private requests = 0;
  private reset = Date.now() + 60000;
  port = 0;
  constructor(
    private token: string,
    private dependencies: APIDependencies,
  ) {}
  private send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(JSON.stringify(body));
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (req.headers.origin) {
      this.send(res, 403, { error: "Browser-origin calls are not allowed" });
      return;
    }
    if (
      ![`127.0.0.1:${this.port}`, `localhost:${this.port}`].includes(
        req.headers.host || "",
      )
    ) {
      this.send(res, 403, { error: "Invalid Host" });
      return;
    }
    const provided = Buffer.from(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
      ),
      expected = Buffer.from(this.token);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      this.send(res, 401, { error: "Bearer token required" });
      return;
    }
    if (Date.now() > this.reset) {
      this.requests = 0;
      this.reset = Date.now() + 60000;
    }
    if (++this.requests > 60) {
      this.send(res, 429, { error: "Rate limit exceeded" });
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const snapshot = this.dependencies.snapshot();
    if (req.method === "GET" && url.pathname === "/v1/status") {
      this.send(res, 200, {
        version: snapshot.version,
        busy: snapshot.busy,
        accounts: snapshot.accounts,
        coverage: snapshot.coverage,
        nextSync: snapshot.nextSync,
      });
      return;
    }
    if (
      req.method === "GET" &&
      ["/v1/tasks", "/v1/courses", "/v1/notices"].includes(url.pathname)
    ) {
      const key = url.pathname.slice(4) as "tasks" | "courses" | "notices";
      const limit = Math.max(
          1,
          Math.min(200, Number(url.searchParams.get("limit")) || 100),
        ),
        offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const values = snapshot[key];
      this.send(res, 200, {
        items: values.slice(offset, offset + limit),
        total: values.length,
        offset,
        limit,
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/openapi.json") {
      this.send(res, 200, this.spec());
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/sync") {
      this.dependencies.sync();
      this.send(res, 202, { status: "scheduled" });
      return;
    }
    if (
      req.method === "POST" &&
      url.pathname === "/v1/ai/analyze" &&
      this.dependencies.analyze
    ) {
      let text = "";
      for await (const chunk of req) {
        text += String(chunk);
        if (text.length > 16000) {
          this.send(res, 413, { error: "Body too large" });
          return;
        }
      }
      let input: any;
      try {
        input = JSON.parse(text);
      } catch {
        this.send(res, 400, { error: "Expected JSON with taskId" });
        return;
      }
      if (typeof input.taskId !== "string" || input.taskId.length > 100) {
        this.send(res, 400, { error: "Invalid taskId" });
        return;
      }
      try {
        this.send(res, 200, await this.dependencies.analyze(input.taskId));
      } catch {
        this.send(res, 400, {
          error:
            "AI request failed; check configuration, consent and daily limit in the application",
        });
      }
      return;
    }
    this.send(res, 404, { error: "Route not found" });
  }
  async start(port: number) {
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        if (!res.headersSent) this.send(res, 500, { error: "Request failed" });
      });
    });
    this.server.requestTimeout = 50000;
    this.server.headersTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "127.0.0.1", () => {
        this.port = (this.server!.address() as any).port;
        resolve();
      });
    });
  }
  async stop() {
    if (this.server)
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
        this.server!.closeIdleConnections();
      });
  }
  spec() {
    return {
      openapi: "3.0.3",
      info: { title: "课期本机 API", version: "1.0.0" },
      servers: [{ url: `http://127.0.0.1:${this.port}` }],
      security: [{ bearerAuth: [] }],
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      },
      paths: Object.fromEntries(
        [
          "/v1/status",
          "/v1/tasks",
          "/v1/courses",
          "/v1/notices",
          "/v1/openapi.json",
          "/v1/sync",
          "/v1/ai/analyze",
        ].map((path) => [
          path,
          {
            [path.endsWith("/sync") || path.endsWith("/analyze")
              ? "post"
              : "get"]: {
              summary: path,
              responses: {
                "200": { description: "Success" },
                "401": { description: "Unauthorized" },
              },
            },
          },
        ]),
      ),
    };
  }
}
