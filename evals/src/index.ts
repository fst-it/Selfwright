import { createClaudeBaseline } from "./adapters/claude-cli.js";
import { createOllamaCandidate } from "./adapters/ollama.js";
import { runExtractionCheck } from "./checks/extraction.js";
import { runClassificationCheck } from "./checks/classification.js";

async function main(): Promise<void> {
  const claude = createClaudeBaseline();
  const ollama = createOllamaCandidate();

  const extraction = await runExtractionCheck(claude, ollama);
  const classification = await runClassificationCheck(ollama);

  process.stdout.write("\nSelfwright local-model quality-equivalence eval (D13)\n");
  process.stdout.write("======================================================\n");
  process.stdout.write(
    `extraction:     ${extraction.pass ? "PASS" : "FAIL"} ` +
      `(avg Jaccard vs Claude ${extraction.averageScore.toFixed(2)} >= ${extraction.threshold})\n`,
  );
  for (const f of extraction.perFixture) {
    process.stdout.write(
      `  ${f.id}: ollama-vs-claude ${f.ollamaVsClaude.toFixed(2)}, ` +
        `claude-vs-expected ${f.claudeVsExpected.toFixed(2)}\n`,
    );
  }
  process.stdout.write(
    `classification: ${classification.pass ? "PASS" : "FAIL"} ` +
      `(accuracy ${classification.correct}/${classification.total} = ` +
      `${classification.accuracy.toFixed(2)} >= ${classification.threshold})\n`,
  );

  const allPass = extraction.pass && classification.pass;
  process.stdout.write(`\noverall: ${allPass ? "PASS" : "FAIL"}\n`);
  if (!allPass) process.exitCode = 1;
}

main().catch((err: unknown) => {
  process.stderr.write(`Eval run failed: ${String(err)}\n`);
  process.exitCode = 1;
});
