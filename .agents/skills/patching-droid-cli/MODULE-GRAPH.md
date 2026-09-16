# The Bun standalone module graph

Layout of the structure at the tail of a `bun build --compile` binary, verified against Droid
0.218.1 through 0.220.0 and against purpose-built tiny binaries. Everything is little-endian and
every offset inside the graph is relative to `base`. `src/binary/graph.ts` is the parser.

## Parsing

- The last 16 bytes of the file are the trailer `\n---- Bun! ----\n`. Search from the end: the
  string also appears earlier as interned data.
- The 32 bytes before the trailer are the Offsets struct:
  `<Q byte_count><I modules_off><I modules_len><I entry_point_id><I argv_off><I argv_len><I flags>`.
- `base = offsets_pos - byte_count`. The module table starts at `base + modules_off`.
- Records are 52 bytes:
  `<I name_off><I name_len><I contents_off><I contents_len><I sourcemap_off><I sourcemap_len>`
  `<I bytecode_off><I bytecode_len><I module_info_off><I module_info_len>`
  `<I bytecode_origin_path_off><I bytecode_origin_path_len><B encoding><B loader><B module_format><B side>`.
- The entry point is the record at `entry_point_id`, named after the outfile (`/$bunfs/root/droid`
  in stock Droid). Index by id, never by name.
- Loader tells the record's kind: `1` is JS (the entry and, since 0.220.0, every `chunk-*.js`),
  `5` is a file sidecar (ripgrep, dylibs, sounds), `13` is a text sidecar (skill markdown;
  encoding `1` latin1, `2` UTF-16LE).

Every JS source starts with `// @bun @bytecode\n`. That header also appears in the binary as
interned data, so scanning for it finds decoys; the graph gives the exact ranges.

## The cache key, and why not to touch it

The bytecode blob carries a cache-key flags word and a hash of the source at `bytecode_off + 64`
and `+ 68`. The hash is WYHash over the source expanded to 16-bit lanes, XORed with the flags,
from the WebKit revision that Bun release pins.

Reproducing it is a dead end. Bun compiles out WebKit's source-equality check, so a repaired hash
makes the runtime accept the cache and run the **old** compiled code: the patch appears to apply
and changes nothing. Regenerate the blob by rebuilding instead.

## Building the replacement

```bash
bun build --compile --bytecode --splitting --format=esm --minify --target=bun \
  --asset-naming=[name].[ext] entry.js --outfile rebuilt
```

- `--format=esm` is forced: the Droid bundle uses top-level await, which CJS bytecode rejects.
- `--bytecode` with ESM requires `--compile`; there is no two-step `.js` + `.jsc` path for it.
- `--splitting` keeps the chunks as separate records with their own bytecode, the layout Droid
  ships. Bun renames them on rebuild (496 in, 481 out on 0.220.0); nothing addresses a chunk by
  literal, so that is fine.
- `--asset-naming=[name].[ext]` reproduces each sidecar's name byte for byte; the app addresses
  them by string literal, so a content hash in the name breaks them at runtime.
- The pinned build Bun downloads from
  `https://github.com/oven-sh/bun/releases/download/bun-v<ver>/bun-darwin-aarch64.zip`. Because
  the whole binary is rebuilt, its runtime and its bytecode always agree; only a transplant into
  the stock file needed the versions to match.
- Do not build with `BUN_BE_BUN=1 <droid binary> build ...`. `--compile` copies the running
  executable as its base, so the 269MB Droid binary becomes the base and the build dies with
  `Error writing standalone module graph: error.OutOfMemory`. That failure says nothing about your
  source; download a real Bun.
