# codemode-deno-executor

Run [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode/) outside Cloudflare Workers, in a locked-down Deno sandbox.

Code Mode lets an LLM write code that calls your tools, instead of calling them one at a time. That code has to run somewhere safe. `@cloudflare/codemode` ships `DynamicWorkerExecutor`, which needs Cloudflare Workers. This package is a drop-in executor for everywhere else: Node servers, CLIs, local agents, CI.

```ts
import { createBrowserCodeTool } from "@cloudflare/codemode/browser";
import { DenoExecutor } from "codemode-deno-executor";

const codeTool = createBrowserCodeTool({
  tools: myTools,
  executor: new DenoExecutor(), // the only line that changes
});
```

- **Drop-in.** Implements Code Mode's own `Executor` interface. A build-time check confirms it's assignable to `@cloudflare/codemode`'s type.
- **Isolated by default.** Every permission is denied: no network, filesystem, environment variables, subprocesses, FFI or system info. The `Deno` global is removed before your code runs.
- **Same behaviour as Cloudflare's executors.** Tool-name sanitizing, provider validation, `[warn]`/`[error]` log prefixes, preludes and the never-throw contract all match.
- **TypeScript runs natively,** no stripping step.
- **Hard limits.** Wall-clock timeout (kills even `while (true) {}`), V8 heap limit, and an output cap.
- **Fast enough.** About 25 ms per execution on a typical Linux machine, including a tool round trip, with a fresh process each time.

## Install

Requires Node 20+ and [Deno 2](https://deno.com) on the machine that runs the agent.

```sh
npm install codemode-deno-executor @cloudflare/codemode
```

## Usage

### With `createBrowserCodeTool` (works in plain Node)

```ts
import { createBrowserCodeTool } from "@cloudflare/codemode/browser";
import { DenoExecutor } from "codemode-deno-executor";

const codeTool = createBrowserCodeTool({
  executor: new DenoExecutor({ timeout: 10_000 }),
  tools: {
    getWeather: {
      description: "Get the current temperature for a city",
      inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      execute: async ({ city }) => fetchWeather(city), // runs in YOUR process, not the sandbox
    },
  },
});

// Give codeTool.name / description / inputSchema to your model as a tool,
// and call codeTool.execute({ code }) when the model uses it.
```

See [`examples/basic.mjs`](examples/basic.mjs) for a runnable version.

> **Why the `/browser` entry?** As of `@cloudflare/codemode` 0.5.5, the package's main entry and `/ai` entry import the Workers-only `cloudflare:workers` module, so they don't load in plain Node. The `/browser` entry doesn't, and its `createBrowserCodeTool` accepts any executor.

### Calling the executor directly

```ts
const executor = new DenoExecutor();

const { result, error, logs } = await executor.execute(
  `async () => {
    const issues = await github.listIssues({ state: "open" });
    console.log("found", issues.length);
    return issues.filter((i) => i.labels.includes("bug")).length;
  }`,
  [{ name: "github", fns: { listIssues: async (args) => myGithubClient.issues(args) } }],
);
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `timeout` | `30000` | Wall-clock limit in ms. The process is killed when it's reached. |
| `memoryLimitMb` | `128` | V8 heap limit for the sandbox. |
| `allowNet` | `false` | `false` blocks all network, `["api.example.com"]` allows only those hosts, `true` allows everything. |
| `maxOutputBytes` | `10485760` | Cap on everything the sandbox sends back (logs, tool calls, result). |
| `denoPath` | `"deno"` | Path to the Deno executable. |

`executor.denoArgs` returns the exact flags the sandbox runs with, so you can audit them.

## How it works

Each `execute()` call spawns `deno run` with every permission denied and a small runner script. Host and sandbox talk over newline-delimited JSON on stdin/stdout:

1. The host sends the code and the provider namespaces.
2. Inside the sandbox, each namespace (`codemode`, `github`, …) is a proxy. Calling `github.listIssues(args)` sends a `call` message to the host.
3. The host runs your real function and sends back the result or error, which resolves or rejects the promise in the sandbox.
4. `console.*` output streams back as `log` messages, so logs survive timeouts and crashes.
5. A `done` message carries the result, then the process exits. A timeout or limit breach kills it with `SIGKILL`.

Your tool functions, API keys and environment never enter the sandbox. Only JSON crosses the boundary.

## Security model

The sandbox is as strong as Deno's permission system and V8 isolation, run as a separate OS process. That's a solid default for LLM-generated code, but it is not a VM or container. For hostile multi-tenant workloads, also run the agent itself inside a container or VM with OS-level limits.

Things to know:

- **Your tools are the real attack surface.** Generated code can call any tool you expose, with any arguments. Validate inputs in your tool functions and don't expose destructive tools without approval checks.
- **Values are JSON only.** `Uint8Array`, `Date`, `Map` and similar arrive as their JSON forms. Results that can't be serialized (such as `BigInt`) return an error.
- **`allowNet` is all-or-host-list.** If you enable it, generated code can send data to those hosts.

## Differences from `DynamicWorkerExecutor`

- `connectors` (Workers RPC bindings) aren't supported. Expose the same functions as providers instead.
- Binary values aren't specially encoded yet (see roadmap).
- Startup is a process spawn (about 20–30 ms) instead of a V8 isolate (a few ms).

## Development

```sh
npm install
npm test   # build, type-check against @cloudflare/codemode, run 35 tests
```

Tests cover results and errors, tool routing, name sanitizing, log capture, isolation (network, files, env, subprocesses, imports), timeouts, memory and output limits, concurrency, and an end-to-end run through `createBrowserCodeTool`.

## Roadmap

- [ ] Binary value encoding matching Cloudflare's codec
- [ ] Optional process pool to cut startup cost
- [ ] Shared contract test suite for any Code Mode executor
- [ ] `IsolatedVMExecutor` against the same tests, plus benchmarks

## License

MIT
