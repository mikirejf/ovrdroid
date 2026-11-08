export const BUILD_FLAGS = [
  '--compile',
  '--no-compile-autoload-dotenv',
  '--no-compile-autoload-bunfig',
  '--compile-exec-argv=--use-system-ca',
  '--bytecode',
  '--splitting',
  '--format=esm',
  '--minify',
  '--target=bun',
  '--asset-naming=[name].[ext]',
] as const;
