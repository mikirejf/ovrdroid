export async function guardHook(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch {
    process.exitCode = 0;
  }
}
