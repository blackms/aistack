# Coverage Fix Documentation

## Problem

Codecov was showing 8% coverage despite having 81%+ unit test coverage. This was caused by coverage reports being overwritten during the test process.

### Root Cause

The `test:coverage` script was running:
```bash
vitest run --coverage                               # Unit tests → coverage/lcov.info (81%)
vitest run --config vitest.integration.config.ts --coverage  # Integration → OVERWRITES coverage/lcov.info (8%)
```

The integration config had no coverage configuration, so the second run produced minimal coverage that overwrote the unit test coverage.

## Solution

Implemented **Option 2: Merge Coverage Reports** - the proper fix.

### Changes Made

#### 1. Updated `vitest.config.ts`
- Changed coverage reporter directory to `./coverage/unit`
- Removed `html` reporter to reduce output size
- Kept `lcov`, `json`, and `text` reporters

#### 2. Updated `vitest.integration.config.ts`
- **Added complete coverage configuration**
- Set coverage reporter directory to `./coverage/integration`
- Used `lcov` and `json` reporters
- Applied same include/exclude rules as unit tests

#### 3. Created `scripts/merge-coverage.js`
- ES module script to merge lcov reports
- Reads `coverage/unit/lcov.info` and `coverage/integration/lcov.info`
- Outputs merged `coverage/lcov.info`
- Handles missing files gracefully

#### 4. Updated `package.json`
- Modified `test:coverage` script to merge coverage after running tests:
  ```json
  "test:coverage": "vitest run --coverage && vitest run --config vitest.integration.config.ts --coverage && node scripts/merge-coverage.js"
  ```

#### 5. Updated `.github/workflows/ci.yml`
- Added Codecov flags for better tracking:
  ```yaml
  flags: merged
  name: merged-coverage
  ```

## Coverage Structure

```
coverage/
├── unit/
│   ├── lcov.info        # Unit test coverage (81%+)
│   └── coverage-final.json
├── integration/
│   ├── lcov.info        # Integration test coverage
│   └── coverage-final.json
└── lcov.info            # MERGED coverage (uploaded to Codecov)
```

## Verification

### Local Testing
```bash
npm run test:coverage
```

Output:
```
Merging coverage reports...
  Reading: coverage/unit/lcov.info
  Reading: coverage/integration/lcov.info
  Merged: coverage/lcov.info
Coverage merge complete!
```

### File Sizes
- `coverage/unit/lcov.info`: 13,934 lines
- `coverage/integration/lcov.info`: 11,651 lines
- `coverage/lcov.info` (merged): 25,585 lines ✓

## Expected Result

After this fix:
- Codecov should show **~80-85% coverage** (combined unit + integration)
- Coverage reports will accurately reflect all test coverage
- CI pipeline uploads the merged coverage report

## Coverage Exclusions

The following are intentionally excluded from coverage:
- `node_modules/**`
- `dist/**`
- `tests/**`
- `**/*.d.ts`
- `**/*.test.ts`
- `**/index.ts` (barrel exports)
- `**/types.ts` (type definitions)
- `src/cli/**` (CLI commands - harder to test)

## Future Improvements

Consider:
1. Adding CLI command tests to increase coverage
2. Testing barrel exports (`index.ts` files)
3. Separate coverage tracking for unit vs integration tests on Codecov
4. Add coverage gates in CI (e.g., require 80%+ coverage)

---

**Fix Applied**: 2026-01-27
**Expected Coverage**: 80-85% (previously 8%)
