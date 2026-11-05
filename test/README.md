# Test layout conventions

Tests live in this directory alongside three support locations. Do not move
existing fixtures; place new shared fixtures in `helpers/`.

- `test/helpers/` — shared in-process fixtures (framework/client
  construction, sample objects). This is where new shared fixtures belong.
- `test/fixtures/` — static data files (for example SQL cache fixtures)
  loaded by tests.
- Root-level `test/*-fixture.ts` / `test/*-helper.ts` — legacy fixtures
  kept in place for historical reasons. Prefer `helpers/` for anything new.
