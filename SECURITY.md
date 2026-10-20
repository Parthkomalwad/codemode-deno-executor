# Security Policy

`codemode-deno-executor` runs code written by a language model on your machine. Treat every report seriously.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: the **Report a vulnerability** button under this repository's **Security** tab. If that is not available, email **parthkomalwad99@gmail.com** with the subject `codemode-deno-executor security`.

Include reproduction steps, the affected version or commit, your Deno and Node versions, and the impact. You will get an acknowledgement within 72 hours. Please do not open a public issue.

## Threat model

**What is protected:** the host process and machine, from code a model generated and the executor runs.

**The attacker:** anyone who can influence the model's output. That includes prompt injection through tool results, documents or web pages the model reads.

**The boundary:** a separate `deno run` process with these flags (see `executor.denoArgs`):

```text
--no-prompt --no-config --no-lock --no-npm --no-remote
--deny-net (or --allow-net=<hosts> if you opt in)
--deny-read --deny-write --deny-env --deny-run --deny-ffi --deny-sys
--v8-flags=--max-old-space-size=<memoryLimitMb>
```

The child process gets a minimal environment (`PATH`, `HOME`, `DENO_DIR` if set), runs in the OS temp directory, and has the `Deno` global removed before generated code runs.

## What the sandbox protects against

- Reading or writing files, reading environment variables, spawning processes, loading native code, and reading system information.
- Network access, unless you set `allowNet`.
- Importing remote modules or npm packages.
- Gaining permissions through `new Worker()`. Workers inherit the denied permissions.
- Running forever. The timeout kills the process, including loops in JavaScript, WebAssembly and `Atomics.wait`.
- Exhausting memory. The V8 heap is capped.
- Flooding the host with output. Output is capped by `maxOutputBytes`.
- Crashing the host with malformed protocol messages, or reaching `Object.prototype` methods through tool names.

## What it does not protect against

- **Misuse of your tools.** Generated code can call any tool you expose, with any arguments, as many times as it likes within the limits. Your tools must validate their inputs and gate destructive actions.
- **Data sent to allowed hosts.** With `allowNet` on, generated code can send anything it can see to those hosts.
- **Bugs in Deno or V8.** The sandbox is only as strong as Deno's permission checks and V8. It is not a VM or a container. For hostile multi-tenant workloads, also run the agent inside a container or VM with OS-level limits.
- **CPU and process exhaustion across many runs.** Each `execute()` starts a process. Rate-limit calls if callers are untrusted.
- **Forged results.** Generated code controls its own result and logs, as it does with every executor.

## Supported versions

Only the latest release receives fixes until 1.0.
