// Run with: npm run build && node examples/basic.mjs
import { createBrowserCodeTool } from "@cloudflare/codemode/browser";
import { DenoExecutor } from "codemode-deno-executor";

const codeTool = createBrowserCodeTool({
  executor: new DenoExecutor({ timeout: 10_000 }),
  tools: {
    getWeather: {
      description: "Get the current temperature for a city",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
      execute: async ({ city }) => ({ city, tempC: 15 + city.length }),
    },
  },
});

// This is the TypeScript API the model sees in the tool description:
console.log(codeTool.description, "\n");

// This is the kind of code a model writes. It runs in the Deno sandbox;
// only codemode.getWeather() reaches back to your process.
const output = await codeTool.execute({
  code: `async () => {
    const cities = ["Lisbon", "Oslo", "Nairobi"];
    const readings = await Promise.all(cities.map((city) => codemode.getWeather({ city })));
    const warmest = readings.sort((a, b) => b.tempC - a.tempC)[0];
    console.log("checked", readings.length, "cities");
    return warmest;
  }`,
});

console.log(output); // { result: { city: 'Nairobi', tempC: 22 }, logs: [ 'checked 3 cities' ] }
