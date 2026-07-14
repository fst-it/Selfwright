/**
 * Credential generator for the Selfwright web dashboard.
 *
 * Usage: pnpm --filter @selfwright/web hash-password
 *
 * Reads the passphrase from the SELFWRIGHT_WEB_PASSPHRASE environment variable
 * (preferred, avoids shell history) or prompts on stdin. Writes credentials.json
 * to <SELFWRIGHT_DATA_DIR>/web/credentials.json.
 *
 * The env override SELFWRIGHT_WEB_PASSWORD_HASH (format "salt:hash" hex) can
 * be used instead of the file — see apps/web/README.md.
 */
import { createInterface } from "node:readline";
import { hashPassword, saveCredential } from "./auth.js";

async function readPassphrase(): Promise<string> {
  const envPass = process.env["SELFWRIGHT_WEB_PASSPHRASE"];
  if (envPass !== undefined && envPass.length > 0) {
    return envPass;
  }

  process.stderr.write("Enter passphrase: ");
  const rl = createInterface({ input: process.stdin, output: undefined, terminal: false });
  return new Promise<string>((resolve) => {
    rl.once("line", (line) => {
      rl.close();
      resolve(line);
    });
  });
}

async function main(): Promise<void> {
  const dataDir = process.env["SELFWRIGHT_DATA_DIR"];
  if (!dataDir) {
    process.stderr.write("Error: SELFWRIGHT_DATA_DIR environment variable is not set\n");
    process.exit(1);
  }

  const passphrase = await readPassphrase();
  if (passphrase.length === 0) {
    process.stderr.write("Error: passphrase must not be empty\n");
    process.exit(1);
  }

  const credential = await hashPassword(passphrase);
  await saveCredential(dataDir, credential);

  process.stderr.write(
    `Credentials written to ${dataDir}/web/credentials.json\n` +
      `Env override: SELFWRIGHT_WEB_PASSWORD_HASH=${credential.salt}:${credential.hash}\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
