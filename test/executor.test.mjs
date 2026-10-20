import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DenoExecutor } from "../dist/index.js";

const executor = new DenoExecutor({ timeout: 10_000 });
const run = (code, providers = [], ex = executor) => ex.execute(code, providers);
const codemode = (fns) => [{ name: "codemode", fns }];

describe("running code", () => {
  it("returns the result of an async arrow function", async () => {
    const r = await run("async () => { return 1 + 1; }");
    assert.equal(r.error, undefined);
    assert.equal(r.result, 2);
  });

  it("accepts statement-style code as a function body", async () => {
    const r = await run("const x = 20;\nreturn x * 2;");
    assert.equal(r.result, 40);
  });

  it("runs TypeScript natively", async () => {
    const r = await run("async (): Promise<number> => { const n: number = 41; return n + 1; }");
    assert.equal(r.error, undefined);
    assert.equal(r.result, 42);
  });

  it("returns undefined results without an error", async () => {
    const r = await run("async () => {}");
    assert.deepEqual([r.result, r.error], [undefined, undefined]);
  });

  it("returns thrown errors instead of throwing", async () => {
    const r = await run("async () => { throw new Error('boom'); }");
    assert.equal(r.error, "boom");
  });

  it("reports syntax errors as errors", async () => {
    const r = await run("async () => { return ; ; ) }");
    assert.ok(r.error);
  });

  it("rejects results that can't be serialized", async () => {
    const r = await run("async () => 10n");
    assert.match(r.error, /not JSON-serializable/);
  });
});

describe("tool calls", () => {
  it("routes namespace calls to host functions", async () => {
    const r = await run(
      "async () => { const a = await codemode.add({ a: 2, b: 3 }); return a * 10; }",
      codemode({ add: async ({ a, b }) => a + b }),
    );
    assert.equal(r.result, 50);
  });

  it("supports multiple namespaces", async () => {
    const r = await run(
      "async () => [await github.repo(), await db.count()]",
      [
        { name: "github", fns: { repo: async () => "cloudflare/agents" } },
        { name: "db", fns: { count: async () => 7 } },
      ],
    );
    assert.deepEqual(r.result, ["cloudflare/agents", 7]);
  });

  it("supports loops of many calls, including in parallel", async () => {
    let calls = 0;
    const r = await run(
      "async () => { const xs = await Promise.all([...Array(25).keys()].map((i) => codemode.twice(i))); return xs.reduce((a, b) => a + b, 0); }",
      codemode({ twice: async (i) => (calls++, i * 2) }),
    );
    assert.equal(r.result, 600);
    assert.equal(calls, 25);
  });

  it("surfaces tool errors inside the sandbox where code can catch them", async () => {
    const r = await run(
      "async () => { try { await codemode.fail(); } catch (e) { return 'caught: ' + e.message; } }",
      codemode({ fail: async () => { throw new Error("rate limited"); } }),
    );
    assert.equal(r.result, "caught: rate limited");
  });

  it("errors on unknown tools", async () => {
    const r = await run("async () => codemode.nope()", codemode({}));
    assert.equal(r.error, 'Tool "nope" not found');
  });

  it("sanitizes tool names the same way Cloudflare does", async () => {
    const r = await run(
      "async () => codemode.list_issues()",
      codemode({ "list-issues": async () => ["#1"] }),
    );
    assert.deepEqual(r.result, ["#1"]);
  });

  it("appends _ to reserved words, like Cloudflare", async () => {
    const r = await run("async () => codemode.delete_()", codemode({ delete: async () => "gone" }));
    assert.equal(r.result, "gone");
  });

  it("accepts the legacy flat-function form", async () => {
    const r = await executor.execute("async () => codemode.ping()", { ping: async () => "pong" });
    assert.equal(r.result, "pong");
  });

  it("runs provider preludes", async () => {
    const r = await run("async () => codemode.twice(4)", [
      { name: "codemode", fns: {}, prelude: "codemode.twice = (n) => n * 2;" },
    ]);
    assert.equal(r.result, 8);
  });

  it("does not treat `await namespace` as a tool call", async () => {
    let called = false;
    const r = await run(
      "async () => { await codemode; return 'ok'; }",
      codemode({ then: async () => { called = true; } }),
    );
    assert.equal(r.result, "ok");
    assert.equal(called, false);
  });
});

describe("console capture", () => {
  it("captures logs with Cloudflare's prefixes", async () => {
    const r = await run(
      "async () => { console.log('a', 1); console.info('b'); console.warn('c'); console.error('d'); return 0; }",
    );
    assert.deepEqual(r.logs, ["a 1", "b", "[warn] c", "[error] d"]);
  });

  it("keeps logs when the code fails", async () => {
    const r = await run("async () => { console.log('before'); throw new Error('x'); }");
    assert.equal(r.error, "x");
    assert.deepEqual(r.logs, ["before"]);
  });
});

describe("sandbox isolation", () => {
  const blocked = async (code) => {
    const r = await run(`async () => { try { ${code}; return 'ALLOWED'; } catch (e) { return 'blocked: ' + e.name; } }`);
    assert.equal(r.error, undefined);
    assert.match(r.result, /^blocked/, `expected to be blocked: ${code}`);
  };

  it("blocks network access", () => blocked("await fetch('https://example.com')"));
  it("hides the Deno namespace", async () => {
    const r = await run("async () => typeof Deno");
    assert.equal(r.result, "undefined");
  });
  it("blocks importing local files", () => blocked("await import('file:///etc/passwd')"));
  it("blocks importing remote modules", () => blocked("await import('https://deno.land/std/fmt/colors.ts')"));
  it("blocks node built-ins that reach the OS", () =>
    blocked("const fs = await import('node:fs'); fs.readFileSync('/etc/passwd')"));
  it("blocks reading environment variables via node:process", () =>
    blocked("const p = await import('node:process'); if (p.env.PATH === undefined) throw new Error('none')"));
  it("blocks spawning subprocesses", () =>
    blocked("const cp = await import('node:child_process'); cp.execSync('id')"));

  it("rejects provider names that would shadow globals", async () => {
    for (const name of ["console", "Promise", "globalThis"]) {
      const r = await run("async () => 1", [{ name, fns: {} }]);
      assert.match(r.error, /reserved/, name);
    }
  });

  it("validates provider names like Cloudflare does", async () => {
    assert.match((await run("1", [{ name: "bad-name", fns: {} }])).error, /valid JavaScript identifier/);
    assert.match(
      (await run("1", [{ name: "a", fns: {} }, { name: "a", fns: {} }])).error,
      /Duplicate provider name/,
    );
  });

  it("refuses Workers-only connectors", async () => {
    const r = await executor.execute("1", [], { connectors: [{ name: "x", binding: {} }] });
    assert.match(r.error, /connectors/);
  });
});

describe("limits", () => {
  it("kills synchronous infinite loops at the timeout", async () => {
    const fast = new DenoExecutor({ timeout: 1_000 });
    const start = Date.now();
    const r = await run("async () => { console.log('spinning'); while (true) {} }", [], fast);
    assert.equal(r.error, "Execution timed out");
    assert.deepEqual(r.logs, ["spinning"]);
    assert.ok(Date.now() - start < 3_000);
  });

  it("stops code that exceeds the memory limit", async () => {
    const small = new DenoExecutor({ memoryLimitMb: 32, timeout: 15_000 });
    const r = await run("async () => { const a = []; while (true) a.push(new Array(1e5).fill('x')); }", [], small);
    assert.match(r.error, /ran out of memory \(limit 32 MB\)/);
  });

  it("stops code that floods the output", async () => {
    const tiny = new DenoExecutor({ maxOutputBytes: 10_000 });
    const r = await run("async () => { while (true) console.log('x'.repeat(100)); }", [], tiny);
    assert.match(r.error, /output exceeded/);
  });

  it("handles concurrent executions independently", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => run(`async () => codemode.id(${n})`, codemode({ id: async (x) => x }))),
    );
    assert.deepEqual(results.map((r) => r.result), [1, 2, 3, 4, 5]);
  });

  it("never throws when Deno is missing", async () => {
    const missing = new DenoExecutor({ denoPath: "/nonexistent/deno" });
    const r = await run("async () => 1", [], missing);
    assert.match(r.error, /Deno executable not found/);
  });
});

describe("drop-in use with @cloudflare/codemode", () => {
  it("works with createBrowserCodeTool, which runs in plain Node", async () => {
    const { createBrowserCodeTool } = await import("@cloudflare/codemode/browser");
    const tool = createBrowserCodeTool({
      executor,
      tools: {
        getWeather: {
          description: "Get the weather for a city",
          inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
          execute: async ({ city }) => ({ city, tempC: 21 }),
        },
      },
    });
    assert.match(tool.description, /getWeather/);
    const out = await tool.execute({
      code: "async () => { const w = await codemode.getWeather({ city: 'Lisbon' }); console.log(w.city); return w.tempC; }",
    });
    assert.equal(out.result, 21);
    assert.deepEqual(out.logs, ["Lisbon"]);
  });
});
