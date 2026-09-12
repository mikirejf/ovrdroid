# The Bun standalone module graph

Layout of the structure at the tail of a `bun build --compile` binary, verified against Droid
0.218.1 (Bun 1.3.14) and against purpose-built tiny binaries. Everything is little-endian and
every offset inside the graph is relative to `base`.

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
- The record you want is `entry_point_id`. In Droid it is named `/$bunfs/root/index.js`; in a
  binary you just built it is named after the outfile, so index by `entry_point_id` rather than by
  name.

The application source starts with `// @bun @bytecode\n`. That header string appears several times
in a large binary as interned data, which is why scanning for it finds decoys. The graph gives the
exact range; use it.

## Transplanting

Three regions move together, from the rebuilt binary's entry record into the stock binary's
entry record:

| Region        | Length field    |
| :------------ | :-------------- |
| `contents`    | record + 12     |
| `bytecode`    | record + 28     |
| `module_info` | record + 36     |

- Zero-fill each stock **slot**, write the rebuilt region at the slot's original start, then write
  the new length into the record. Offsets never change and neither does the file size.
- Copy `module_info` too. Source and bytecode alone segfault at launch.
- Throw when a rebuilt region exceeds its slot, naming the region. Droid 0.218.1 leaves roughly
  81KB of source slack, 334KB of bytecode slack and 28KB of module_info slack, so the bytecode
  blob is the real ceiling: adding source grows the blob by far more than the source itself.
- `bytecode_off` is 128-byte aligned in a stock binary. Transplanting in place keeps it aligned;
  if you ever do move it, keep the alignment.
- Offsets `flags` bit 5 (`HAS_SOURCE_HASHES`) is clear in Droid, so there is no separate hash table
  to keep in sync.

## The cache key, and why not to touch it

The bytecode blob carries a cache-key flags word and a hash of the source at `bytecode_off + 64`
and `+ 68` (`0x27` and `0x4c491e` in stock Droid 0.218.1). The hash is WYHash over the source
expanded to 16-bit lanes, XORed with the flags, from the WebKit revision that Bun release pins.

Reproducing it is a dead end. Bun compiles out WebKit's source-equality check, so a repaired hash
makes the runtime accept the cache and run the **old** compiled code: the patch appears to apply
and changes nothing. Regenerate the blob instead.

## Building the replacement

```bash
bun build --compile --bytecode --format=esm --minify --target=bun index.js --outfile rebuilt
```

- `--format=esm` is forced: the Droid bundle uses top-level await, which CJS bytecode rejects.
- `--bytecode` with ESM requires `--compile`; there is no two-step `.js` + `.jsc` path for it.
- Use the exact Bun release the target embeds, downloaded from
  `https://github.com/oven-sh/bun/releases/download/bun-v<ver>/bun-darwin-aarch64.zip`. The JSC
  cache carries a version tag and a mismatch is rejected at runtime.
- Do not build with `BUN_BE_BUN=1 <droid binary> build ...`. `--compile` copies the running
  executable as its base, so the 269MB Droid binary becomes the base and the build dies with
  `Error writing standalone module graph: error.OutOfMemory`. That failure says nothing about your
  source; download a real Bun.
