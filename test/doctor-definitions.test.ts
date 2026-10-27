import { expect, test } from "bun:test";
import { createDoctorProbes } from "../src/lib/doctor/checks.ts";
import { materializeObjects } from "../src/lib/materialization/index.ts";
import { fixture } from "./materialization-fixture.ts";

test("schema-dependent doctor checks block absent or empty host definitions", async () => {
  const project = await fixture();
  try {
    await project.write("host-note");
    for (const definitions of [undefined, []]) {
      const probes = createDoctorProbes({
        projectRoot: project.projectRoot,
        sourceRoot: project.vaultRoot,
        materializedDirectory: project.outputDirectory,
        ...(definitions === undefined ? {} : { definitions }),
      });
      for (const id of ["source-validation", "materialization"]) {
        const probe = probes.find((probe) => probe.id === id);
        if (!probe) throw new Error("The fixed schema-dependent probe is missing.");
        const result = await probe.run({});
        expect(result.status).toBe("blocked");
        expect(result.coverage).toBe("unknown");
        expect(result.context).toBeUndefined();
      }
    }
  } finally {
    await project.close();
  }
});

test("doctor source and materialization checks use the host's non-builtin schemas", async () => {
  const project = await fixture();
  try {
    await project.write("host-note");
    expect((await materializeObjects(project)).clean).toBe(true);
    const probes = createDoctorProbes({
      definitions: project.definitions,
      projectRoot: project.projectRoot,
      sourceRoot: project.vaultRoot,
      materializedDirectory: project.outputDirectory,
    });
    const sourceProbe = probes.find((probe) => probe.id === "source-validation");
    if (!sourceProbe) throw new Error("The source-validation probe is missing.");
    const source = await sourceProbe.run({});
    expect(source).toMatchObject({
      status: "ok",
      coverage: "complete",
      context: { scanned: 1, complete: 1, partial: 0, errors: 0 },
    });
    const materializationProbe = probes.find((probe) => probe.id === "materialization");
    if (!materializationProbe) throw new Error("The materialization probe is missing.");
    const materialization = await materializationProbe.run({});
    expect(materialization).toMatchObject({
      status: "ok",
      coverage: "limited",
      context: { scanned: 1, drift: 0, errors: 0 },
    });
  } finally {
    await project.close();
  }
});
