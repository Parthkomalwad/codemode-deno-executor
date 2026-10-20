// Latency of one DenoExecutor.execute() call that makes one tool call.
// Run with: npm run build && node bench/latency.mjs
import os from "node:os";
import { execFileSync } from "node:child_process";
import { DenoExecutor } from "../dist/index.js";

const RUNS = 50;
const WARMUP = 5;
const executor = new DenoExecutor();
const providers = [{ name: "codemode", fns: { add: async ({ a, b }) => a + b } }];
const code = "async () => codemode.add({ a: 1, b: 2 })";

const once = async () => {
  const start = performance.now();
  const r = await executor.execute(code, providers);
  if (r.result !== 3) throw new Error(`unexpected result: ${JSON.stringify(r)}`);
  return performance.now() - start;
};

for (let i = 0; i < WARMUP; i++) await once();
const times = [];
for (let i = 0; i < RUNS; i++) times.push(await once());
times.sort((a, b) => a - b);

const pct = (p) => times[Math.min(times.length - 1, Math.ceil((p / 100) * times.length) - 1)];
const deno = execFileSync("deno", ["--version"], { encoding: "utf8" }).split("\n")[0];

console.log(`runs      ${RUNS} sequential (after ${WARMUP} warmup)`);
console.log(`median    ${pct(50).toFixed(1)} ms`);
console.log(`p90       ${pct(90).toFixed(1)} ms`);
console.log(`min/max   ${times[0].toFixed(1)} / ${times.at(-1).toFixed(1)} ms`);
console.log(`os        ${os.type()} ${os.release()} ${os.arch()}`);
console.log(`cpu       ${os.cpus()[0].model.trim()} (${os.cpus().length} threads)`);
console.log(`node      ${process.version}`);
console.log(`deno      ${deno}`);
