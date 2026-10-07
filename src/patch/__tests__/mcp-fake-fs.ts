export function fakeFs(files: Map<string, string>) {
  return {
    readFileSync(file: string): string {
      const text = files.get(file);
      if (text === undefined) {
        throw new Error(`ENOENT: ${file}`);
      }
      return text;
    },
    promises: {
      mkdir: async () => {
        await Promise.resolve();
      },
      writeFile: async (file: string, text: string) => {
        files.set(file, text);
        await Promise.resolve();
      },
      rename: async (from: string, to: string) => {
        const text = files.get(from);
        if (text === undefined) {
          throw new Error(`ENOENT: ${from}`);
        }
        files.delete(from);
        files.set(to, text);
        await Promise.resolve();
      },
    },
  };
}
