import assert from "node:assert/strict";
import type { MaterializedObject } from "../../src/lib/model/index.ts";

/** These product rules are handwritten, not emitted from relation descriptors. */
export function assertAcceptanceCoverage(objects: readonly MaterializedObject[]): void {
  for (const criterion of objects.filter(
    (object) => object.type === "criterion" && object.header.retiredAt === null,
  )) {
    const covered = objects.some(
      (test) =>
        test.type === "acceptance_test" &&
        test.header.retiredAt === null &&
        test.references.some(
          (ref) =>
            ref.field === "relations.covers" &&
            ref.target.type === "criterion" &&
            ref.target.id === criterion.id,
        ),
    );
    assert(covered, `Active criterion ${criterion.id} needs an active acceptance test.`);
  }
}
export function assertImplementationBindings(objects: readonly MaterializedObject[]): void {
  for (const object of objects.filter(
    (object) => object.type === "interface" && object.header.retiredAt === null,
  )) {
    assert(
      object.fileBindings.some((binding) => binding.role === "implementation"),
      `Active interface ${object.id} needs an implementation binding.`,
    );
  }
}
export function assertLiveTargets(objects: readonly MaterializedObject[]): void {
  for (const object of objects.filter((object) => object.header.retiredAt === null)) {
    for (const reference of object.references.filter(
      (reference) => reference.kind === "depends" || reference.kind === "justifies",
    )) {
      const target = objects.find(
        (target) => target.type === reference.target.type && target.id === reference.target.id,
      );
      assert(
        target && target.header.retiredAt === null,
        `${object.id} links to a retired or missing target ${reference.target.id}.`,
      );
    }
  }
}
