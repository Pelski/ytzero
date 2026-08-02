import { resolve } from "node:path";

export async function runIsolatedTestFile(relativePath: string, isolationFlag: string): Promise<void> {
  const child = Bun.spawn([process.execPath, "test", relativePath], {
    cwd: resolve(import.meta.dir, ".."),
    env: { ...Bun.env, [isolationFlag]: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Isolated test file ${relativePath} failed:\n${stderr}\n${stdout}`);
  }
}
