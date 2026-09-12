import { mkdir, readFile, writeFile } from "node:fs/promises";
const cases = JSON.parse(
  await readFile(
    new URL("../tests/fixtures/deficiency-suggestions.json", import.meta.url),
    "utf8",
  ),
);
const results = [];
for (const item of cases) {
  const response = await fetch("http://127.0.0.1:8791", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item),
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.json();
  const actual = (body.suggestions || [])
    .map((s) => s.kind + (s.deficiencyId ? ":" + s.deficiencyId : ""))
    .sort();
  const pass =
    !body.error &&
    (item.allowed || [item.expected]).some(
      (expected) =>
        JSON.stringify(actual) === JSON.stringify([...expected].sort()),
    );
  results.push({
    name: item.name,
    pass,
    expected: item.expected,
    actual,
    ...body,
  });
  console.log(
    `${pass ? "PASS" : "FAIL"} ${item.name}: ${JSON.stringify(actual)}`,
  );
}
await mkdir(new URL("../tmp/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../tmp/deficiency-model-evaluation.json", import.meta.url),
  JSON.stringify(results, null, 2),
);
console.log(
  `${results.filter((r) => r.pass).length}/${results.length} cases passed`,
);
if (results.some((r) => !r.pass)) process.exitCode = 1;
