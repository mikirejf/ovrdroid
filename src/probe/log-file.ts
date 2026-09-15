export function logSize(file: string): number {
  return Bun.file(file).size;
}

export async function logSlice(file: string, from: number, to?: number): Promise<string> {
  return await Bun.file(file)
    .slice(from, to)
    .text()
    .catch(() => '');
}
