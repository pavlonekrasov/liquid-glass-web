// Sets the Agent Skill's `version:` to the package's version. Run it after bumping packages/liquid-glass-web/package.json
// for a release (`pnpm skill:version` from the repo root); tests/skill-contract.test.mjs fails until the two match.
import { readFileSync, writeFileSync } from "node:fs";

const pkgUrl = new URL("../package.json", import.meta.url);
const skillUrl = new URL("../../../skills/liquid-glass-web/SKILL.md", import.meta.url);

const { version } = JSON.parse(readFileSync(pkgUrl, "utf8"));
const skill = readFileSync(skillUrl, "utf8");
if (!/^version:\s*\S+/m.test(skill)) throw new Error("SKILL.md has no version: line in its frontmatter");

const next = skill.replace(/^version:\s*\S+/m, `version: ${version}`);
if (next === skill) {
  console.log(`SKILL.md is already at ${version}`);
} else {
  writeFileSync(skillUrl, next);
  console.log(`SKILL.md version set to ${version}`);
}
