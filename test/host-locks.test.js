import test from "node:test";
import assert from "node:assert/strict";
import { withLock, lockName } from "../src/host/locks.js";

test("lockName", () => assert.equal(lockName("g", "abc"), "plexus:g:abc"));

test("no locks api falls back and runs fn", async () => {
  const r = await withLock("n", async () => 5, { locks: undefined });
  assert.deepEqual(r, { acquired: true, fallback: true, value: 5 });
});

test("locks present: runs under lock", async () => {
  const calls = [];
  const locks = { request: async (name, opts, cb) => { calls.push([name, opts]); return cb({ name }); } };
  const r = await withLock("n", async () => "v", { locks });
  assert.equal(r.acquired, true);
  assert.equal(r.fallback, false);
  assert.equal(r.value, "v");
  assert.equal(calls[0][0], "n");
  assert.ok(calls[0][1].signal);
});

test("ifAvailable with lock held elsewhere does not run fn", async () => {
  let ran = false;
  const locks = { request: async (name, opts, cb) => { assert.equal(opts.ifAvailable, true); return cb(null); } };
  const r = await withLock("n", async () => { ran = true; }, { locks, ifAvailable: true });
  assert.equal(r.acquired, false);
  assert.equal(ran, false);
});

test("ifAvailable acquired", async () => {
  const locks = { request: async (n, o, cb) => cb({}) };
  const r = await withLock("n", async () => 1, { locks, ifAvailable: true });
  assert.equal(r.acquired, true);
  assert.equal(r.value, 1);
});

test("timeout aborts waiting request", async () => {
  const locks = {
    request: (n, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener("abort", () => reject(Object.assign(new Error("x"), { name: "AbortError" })));
    }),
  };
  const r = await withLock("n", async () => 1, { locks, timeoutMs: 10 });
  assert.equal(r.acquired, false);
});

test("fn errors propagate", async () => {
  const locks = { request: async (n, o, cb) => cb({}) };
  await assert.rejects(withLock("n", async () => { throw new Error("boom"); }, { locks }), /boom/);
});
