import Database from "better-sqlite3";
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Store } from "../src/main/store";
const root = resolve(".test-data", `live-dedup-${Date.now()}`);
mkdirSync(root, { recursive: true });
const original = new Database(
  join(process.env.APPDATA!, "course-reminder", "reminder.sqlite"),
  { readonly: true },
);
const copy = join(root, "copy.sqlite");
await original.backup(copy);
original.close();
const store = new Store(copy),
  snapshot = store.snapshot();
const raw = store.all<any>("tasks").length,
  folded = snapshot.tasks.reduce(
    (n, t) => n + (t.alternateSources?.length || 0),
    0,
  );
assert.equal(store.all("tasks").length, snapshot.tasks.length + folded);
assert.ok(folded > 0);
for (const t of snapshot.tasks.filter((t) => t.alternateSources?.length))
  assert.equal(
    snapshot.courses.find((c) => c.id === t.courseId)?.platform,
    "spoc",
  );
const record = {
  at: new Date().toISOString(),
  source: "consistent read-only copy of live SQLite",
  rawTasks: raw,
  primaryTasks: snapshot.tasks.length,
  foldedMoocTasks: folded,
  sourceCourses: snapshot.courses.length,
  primaryCourses: snapshot.courses.filter((c) => !c.preferredCourseId).length,
  preservedRawTasks: store.all("tasks").length,
};
writeFileSync(
  ".runtime/dedup-verification.json",
  JSON.stringify(record, null, 2),
);
console.log(JSON.stringify(record, null, 2));
store.close();
