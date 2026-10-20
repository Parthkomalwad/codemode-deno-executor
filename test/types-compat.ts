// Build-time proof that DenoExecutor fits Cloudflare's own Executor type.
// Type-only imports: nothing from @cloudflare/codemode is loaded at runtime.
import type { Executor as CloudflareExecutor } from "@cloudflare/codemode/browser";
import { DenoExecutor } from "../src/index.js";

const executor: CloudflareExecutor = new DenoExecutor();
void executor;
