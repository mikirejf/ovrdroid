#!/usr/bin/env bun
import { Command } from "commander";

import pkg from "../package.json" with { type: "json" };

const program = new Command()
  .name("overdroid")
  .description("Patch harness for the Droid CLI binary")
  .version(pkg.version);

await program.parseAsync();
