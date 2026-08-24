/** Which engines actually register outside OmniRoute? */
import { registerBuiltinCompressionEngines } from "../src/engine/engines/index.ts";
import { listCompressionEngines } from "../src/engine/engines/registry.ts";
import { ENGINE_CATALOG } from "../src/engine/engineCatalog.ts";

registerBuiltinCompressionEngines();

const registered = new Set(listCompressionEngines().map((e) => e.id));
console.log("registered:", [...registered].sort().join(", "));

const catalog = Object.keys(ENGINE_CATALOG);
console.log("catalog count:", catalog.length);
console.log("catalog missing from registry:", catalog.filter((id) => !registered.has(id)));
console.log("registered beyond catalog:", [...registered].filter((id) => !catalog.includes(id)));
