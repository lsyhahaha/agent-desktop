import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentControl } from "./agent-control.ts";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};

test("spawn and wait return completed result", async () => {
  const control = new AgentControl<string>(1);
  const id = control.spawn("parent", async () => "done");
  const result = await control.wait(id);
  assert.equal(result.state, "completed");
  assert.equal(result.result, "done");
  assert.ok(result.finishedAt! >= result.startedAt);
  await control.close();
});

test("stopping child retains capacity until settled", async () => {
  const control = new AgentControl<string>(1);
  const gate = deferred<string>();
  const id = control.spawn("parent", async () => gate.promise);
  assert.equal(control.cancel(id), true);
  assert.equal(control.get(id)?.state, "stopping");
  assert.throws(() => control.spawn("parent", async () => "other"), /concurrency/);
  gate.resolve("late");
  assert.equal((await control.wait(id)).state, "cancelled");
  const next = control.spawn("parent", async () => "next");
  assert.equal((await control.wait(next)).state, "completed");
  await control.close();
});

test("parent abort propagates and rejects new children", async () => {
  const parent = new AbortController();
  const control = new AgentControl<string>();
  const gate = deferred<string>();
  const id = control.spawn("parent", async () => gate.promise, parent.signal);
  parent.abort();
  assert.equal(control.get(id)?.state, "stopping");
  assert.throws(() => control.spawn("parent", async () => "no", parent.signal), /cancelled/);
  gate.resolve("late");
  assert.equal((await control.wait(id)).state, "cancelled");
  await control.close();
});

test("failures are recorded without rejecting wait", async () => {
  const control = new AgentControl<string>();
  const id = control.spawn("parent", async () => { throw new Error("failure"); });
  const result = await control.wait(id);
  assert.equal(result.state, "failed");
  assert.equal(result.error, "failure");
  await control.close();
});

test("close requests cancellation and waits for settlement", async () => {
  const control = new AgentControl<string>();
  const gate = deferred<string>();
  const id = control.spawn("parent", async () => gate.promise);
  let closed = false;
  const closing = control.close().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  assert.equal(control.get(id)?.state, "stopping");
  gate.resolve("late");
  await closing;
  assert.equal(closed, true);
  assert.equal(control.get(id), null);
});
