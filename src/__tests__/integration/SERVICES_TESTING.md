# OCR & Business Logic Services Testing Documentation

## Overview

This document provides comprehensive documentation for the OCR pipeline and business logic services testing suite in the Stoky project.

## Service Architecture

### OCR Pipeline (`src/server/services/ocr.ts`)
- **Purpose**: Processes receipt images using Tesseract.js OCR
- **Key Functions**:
  - `processReceiptOcr(receiptId)`: Main entry point for OCR processing
  - `sharedWorker()`: One Tesseract.js worker per process, shared by concurrent first scans
  - `terminateWorker()`: Cleans up worker resources
- **Status Flow**: UPLOADING → PROCESSING → PARSED/FAILED

### Receipt Parser (`src/server/services/receiptParser.ts`)
- **Purpose**: Parses OCR text to extract structured receipt data
- **Key Functions**:
  - `parseReceiptText(ocrText)`: Extracts items, store, date, total
  - `saveParsedItems(receiptId, parsed)`: Persists parsed data to database
- **Features**:
  - Multiple receipt format support (Mercadona, Carrefour, DIA, Lidl, etc.)
  - Flexible date parsing (DD/MM/YYYY, YYYY/MM/DD, DDMMYYYY)
  - Multi-currency support (EUR with comma/dot separators)
  - Quantity extraction (2x, 3x patterns)

### Product Matcher (`src/server/services/productMatcher.ts`)
- **Purpose**: Matches parsed receipt items to existing products using pg_trgm
- **Key Functions**:
  - `matchReceiptItems(receiptId)`: Main matching logic
  - `getItemCandidates(receiptItemId)`: Returns candidate products
- **Matching Thresholds**:
  - Auto-match: similarity ≥ 0.7 — reachable only by the symmetric
    `similarity()`; containment (`word_similarity`, shared words) is capped
    just below and can only rank a candidate
  - Candidate list: 0.3 ≤ similarity < 0.7
  - No match: similarity < 0.3

### Open Food Facts Client (`src/server/services/openFoodFacts.ts`)
- **Purpose**: External API integration for product lookup
- **Key Functions**:
  - `getProductByBarcode(barcode)`: Fetches product by barcode
  - `searchProducts(query, limit)`: Searches products by name
  - `extractUnit(quantity)`: Extracts unit from quantity string
- **Features**:
  - 30-day in-memory caching
  - Automatic retry on failures
  - Zod schema validation

## Test Suite Structure

### 1. OCR Pipeline Integration Tests
**File**: `src/__tests__/integration/ocr.pipeline.test.ts`

#### Test Categories:

**Complete Pipeline Tests**:
- Valid receipt processing through full pipeline
- Multiple products with quantities extraction
- End-to-end flow from image to parsed items

**Product Matching Tests**:
- Auto-match with >0.7 similarity
- Candidate list for 0.3-0.7 similarity
- No match handling for <0.3 similarity

**Error Handling Tests**:
- Non-existent receipt handling
- OCR failure recovery
- Empty OCR text handling
- Receipt with no recognizable products

**Edge Cases**:
- Special characters in store names
- Various date formats
- Mixed currency formats
- Header/footer line filtering

**Data Persistence Tests**:
- Receipt item persistence
- Status progression through pipeline
- Store linking

### 2. Receipt Parser Comprehensive Tests
**File**: `src/__tests__/integration/receiptParser.comprehensive.test.ts`

#### Test Categories:

**Receipt Format Variations**:
- Mercadona format
- Carrefour format
- DIA format
- Lidl format
- El Corte Inglés format
- ALDI format

**Currency Handling**:
- EUR with comma separator
- EUR with dot separator
- € symbol handling
- Mixed formats
- No currency indicators

**Date Extraction**:
- DD/MM/YYYY format
- YYYY/MM/DD format
- DD-MM-YYYY format
- DDMMYYYY format
- Two-digit year handling
- Date with time

**Malformed OCR Text Handling**:
- Garbled text
- Extremely long lines
- No line breaks
- Duplicate prices
- OCR errors in names
- Mixed languages

**Edge Cases**:
- Receipt with only total
- Zero price items
- Very high prices
- Items with units in name
- Promotional items
- Discounted items

### 3. Product Matcher Comprehensive Tests
**File**: `src/__tests__/integration/productMatcher.comprehensive.test.ts`

#### Test Categories:

**pg_trgm Similarity Queries**:
- Exact matches (similarity = 1.0)
- High similarity matches (≥0.7)
- Partial word matches
- Word order variations
- Candidate limit (max 5)
- Low similarity filtering (<0.3)

**Exact Barcode Matching**:
- Barcode uniqueness per household
- Products with/without barcodes

**Fuzzy Name Matching**:
- OCR error tolerance
- Accented character handling
- Case insensitive matching
- Special character handling

**Multi-word Queries**:
- Multiple word products
- Missing words in queries
- Brand name queries

**Receipt Status Updates**:
- CONFIRMED when all items auto-matched
- NEEDS_REVIEW when manual matching required

### 4. Open Food Facts Comprehensive Tests
**File**: `src/__tests__/integration/openFoodFacts.comprehensive.test.ts`

#### Test Categories:

**API Integration**:
- Valid barcode lookup
- Non-existent barcode handling
- Response caching
- Cache TTL compliance
- API error handling
- Network failure handling

**Search Functionality**:
- Valid search queries
- Empty results handling
- Limit parameter respect
- Result validation

**Data Transformation**:
- Complete product data transformation
- Minimal data handling
- Missing field handling
- Nutriments extraction

**Unit Extraction**:
- Grams (g)
- Kilograms (kg)
- Liters (L)
- Milliliters (ml)
- Centiliters (cl)
- Ounces (oz)
- Pounds (lb)

**Error Scenarios**:
- Timeout handling
- Malformed responses
- Rate limiting (429)
- Unauthorized (403)

### 5. Performance & Error Handling Tests
**File**: `src/__tests__/integration/performance.error.test.ts`

#### Performance Benchmarks:
- Receipt parsing: <100ms for 20 items
- Product matching: <1s for 100 products
- Concurrent processing: 5 receipts in <5s
- Database queries: <100ms for 50 products
- Large OCR text: <200ms for 100 items

#### Error Handling:
- Network failures
- Database connection issues
- Invalid file uploads
- Timeout scenarios
- Memory usage limits
- Concurrent processing limits

## Test Configuration

### Test Runner: Bun
```bash
# Run all tests. `bun run test`, not `bun test`: the bare form is Bun's own
# runner over the whole repository, which loads the component tests without the
# happy-dom preload the `test:components` script passes — they fail on
# `document is not defined` — and the integration tests without the database
# `test:integration` starts.
bun run test

# Run specific test file. Here the bare runner is right: these need the
# services up, and nothing else.
bun test src/__tests__/integration/ocr.pipeline.test.ts

# Run with coverage, per tier. A whole-repository coverage figure would mix
# three different denominators — see docs/TEST_SETUP.md.
bun test --coverage src/__tests__/integration/
```

### Database Requirements
- PostgreSQL with pg_trgm extension enabled
- Test database isolated from production
- Automatic cleanup after each test

### Performance Benchmarks

| Operation | Target Time | Max Time |
|-----------|-------------|----------|
| OCR Text Parsing (20 items) | 50ms | 100ms |
| Product Matching (100 products) | 500ms | 1000ms |
| Database Query (50 products) | 50ms | 100ms |
| Concurrent Processing (5 receipts) | 2500ms | 5000ms |
| Large OCR Processing (100 items) | 100ms | 200ms |

## Quality Gates

### Code Coverage Requirements
- **Target**: 90%+ service code coverage
- **Minimum**: 85% service code coverage
- **Critical Paths**: 100% coverage

### Performance Requirements
- All operations must complete within defined benchmarks
- No memory leaks during concurrent processing
- Graceful degradation under load

### Error Handling Requirements
- All error paths must be tested
- No unhandled promise rejections
- Proper cleanup of resources
- Meaningful error messages

## Running the Tests

### Prerequisites
```bash
# Start database services
docker compose up -d db cache

# Install dependencies
bun install

# Generate Prisma client
bunx prisma generate
```

### Execute Tests
```bash
# Run integration tests
bun test src/__tests__/integration/

# Run with verbose output
bun test --verbose src/__tests__/integration/

# Run specific service tests
bun test src/__tests__/integration/ocr.pipeline.test.ts
bun test src/__tests__/integration/receiptParser.comprehensive.test.ts
bun test src/__tests__/integration/productMatcher.comprehensive.test.ts
bun test src/__tests__/integration/openFoodFacts.comprehensive.test.ts
bun test src/__tests__/integration/performance.error.test.ts
```

## Continuous Integration

### GitHub Actions Pipeline
The tests are integrated into the CI pipeline:

1. **Quality Check**, likewise in the image — the job runs five gates, not two,
   and `bun run lint` on its own is the local shorthand rather than what CI does:
   ```bash
   bash scripts/ci-in-image.sh quality
   ```

2. **Test Execution**: what the pipeline actually runs, which is the suites
   inside this project's own development image rather than on the runner's
   toolchain — see `.github/workflows/ci.yml`.
   ```bash
   bash scripts/ci-in-image.sh test
   ```

3. **Coverage Report**, per tier, because the denominators differ:
   ```bash
   bun test --coverage src/__tests__/integration/
   ```

### Pre-commit Hooks
Tests run automatically before commits to ensure:
- No breaking changes
- Maintained code coverage
- Passing performance benchmarks

## Maintenance

### Adding New Tests
1. Follow existing test structure
2. Use descriptive test names
3. Include both success and error cases
4. Document performance expectations
5. Clean up test data in `afterEach`

### Updating Tests
1. Update tests when service logic changes
2. Maintain backward compatibility tests
3. Update benchmarks if requirements change
4. Document breaking changes

### Test Data Management
- Use unique identifiers for test data
- Clean up all created records
- Use transactions where possible
- Mock external dependencies

## Troubleshooting

### Common Issues

**Database Connection Errors**:
```bash
# Ensure PostgreSQL is running
docker compose ps db

# Check connection string
 cat .env | grep DATABASE_URL
```

**Permission Errors**:
```bash
# Fix file permissions
chmod -R 755 src/__tests__/
```

**Missing Dependencies**:
```bash
# Reinstall dependencies
bun install
bunx prisma generate
```

### Debug Mode
```bash
# Run with debug output
DEBUG=* bun test src/__tests__/integration/ocr.pipeline.test.ts
```

## Contributing

When contributing to service tests:
1. Follow the existing test patterns
2. Ensure tests are deterministic
3. Document any new test utilities
4. Update this documentation
5. Run the full test suite before submitting

## Additional Resources

- [Bun Test Documentation](https://bun.sh/docs/cli/test)
- [Tesseract.js Documentation](https://github.com/naptha/tesseract.js)
- [PostgreSQL pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)
- [Open Food Facts API](https://world.openfoodfacts.org/data/api)
