import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// The Agent Skill (skills/liquid-glass-web) ships from the repo's main branch, so it must not drift from the library.
// These checks fail a release whose skill names a component, prop value or optics key the code no longer has, misses
// a new optics key, quotes a stale limit, or carries another version than the package.

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const skill = read("../../../skills/liquid-glass-web/SKILL.md");
const reference = read("../../../skills/liquid-glass-web/references/optical-reference.md");
const pkg = JSON.parse(read("../package.json"));
const presets = read("../src/core/presets.ts");

function sourceFiles(dir) {
  return readdirSync(new URL(dir, import.meta.url), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(`${dir}${entry.name}/`)
      : /\.tsx?$/.test(entry.name)
        ? [read(`${dir}${entry.name}`)]
        : [],
  );
}
const source = sourceFiles("../src/").join("\n");
const exported = new Set(
  [...source.matchAll(/^export (?:function|const|class|interface|type) (\w+)/gm)].map((m) => m[1]),
);

/** The string members of `export type Name = "a" | "b"` in presets.ts. */
function unionMembers(name) {
  const m = presets.match(new RegExp(`export type ${name} =([^;]+);`));
  assert.ok(m, `${name} not found in presets.ts`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** Keys of an interface in presets.ts. */
function interfaceKeys(name) {
  const m = presets.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `${name} not found in presets.ts`);
  return [...m[1].matchAll(/^\s+readonly (\w+)\??:/gm)].map((x) => x[1]);
}

test("the skill's version matches the package version", () => {
  const version = skill.match(/^version:\s*(\S+)/m)?.[1];
  assert.equal(version, pkg.version, "run `pnpm skill:version` (or set version: in SKILL.md) for this release");
});

test("every Glass* name the skill uses is exported by the library", () => {
  const docs = `${skill}\n${reference}`;
  const named = new Set([...docs.matchAll(/\b(Glass[A-Z]\w*|GLASS_[A-Z_]+|MAX_HIC_\w+)\b/g)].map((m) => m[1]));
  // Names that are prose or a member, not an export.
  for (const prose of ["GlassNode", "GlassLoupe"]) named.delete(prose);
  const missing = [...named].filter((name) => !exported.has(name));
  assert.deepEqual(missing, [], `the skill names things the library does not export: ${missing.join(", ")}`);
  assert.ok(/GlassStageChrome/.test(source) && /Chrome:/.test(source), "GlassStage.Chrome is no longer defined");
});

test("variant and engine values in the skill are the library's", () => {
  for (const value of unionMembers("GlassVariant")) assert.ok(skill.includes(`"${value}"`), `variant "${value}" is not documented`);
  for (const value of unionMembers("GlassEnginePreference")) assert.ok(skill.includes(`"${value}"`), `engine "${value}" is not documented`);
  const documentedVariants = skill.match(/\| `variant` \| ([^|]+)\|/)?.[1] ?? "";
  for (const value of documentedVariants.matchAll(/"([^"]+)"/g)) {
    assert.ok(unionMembers("GlassVariant").includes(value[1]), `the skill documents a variant the library lacks: "${value[1]}"`);
  }
});

test("the optics table lists exactly the library's GlassOpticsOverride keys", () => {
  const code = interfaceKeys("GlassOpticsOverride").sort();
  const section = reference.slice(reference.indexOf("GlassOpticsOverride"));
  const documented = [...section.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]).sort();
  assert.deepEqual(
    documented.filter((key) => !code.includes(key)),
    [],
    "the optics table documents keys the library no longer has",
  );
  assert.deepEqual(
    code.filter((key) => !documented.includes(key)),
    [],
    "GlassOpticsOverride has keys the optics table does not document",
  );
});

test("the glass budget the skill quotes matches the code", () => {
  const shaders = read("../src/core/hicShaders.ts");
  const stage = read("../src/primitives/GlassStage.tsx");
  const surfaces = shaders.match(/MAX_HIC_SURFACES = (\d+)/)?.[1];
  const loupes = shaders.match(/MAX_HIC_LOUPES = (\d+)/)?.[1];
  const groups = stage.match(/Math\.min\((\d+), map\.size \+ 1\)/)?.[1];
  assert.ok(surfaces && loupes && groups, "could not read the limits from the source");
  assert.match(skill, new RegExp(`\\| Glass surfaces \\| ${surfaces} \\(`));
  assert.match(skill, new RegExp(`\\| Lifted lenses \\| ${loupes} \\(`));
  assert.match(skill, new RegExp(`\\| Fusion groups \\| ${groups} \\|`));
});
