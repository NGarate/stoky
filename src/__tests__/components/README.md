# Component Test Suite

This directory contains comprehensive tests for all UI components in the Stoky project.

## Structure

```
src/__tests__/
├── components/           # Unit tests for components
│   ├── button.test.tsx
│   ├── input.test.tsx
│   ├── LocaleSwitcher.test.tsx
│   ├── LocationPicker.test.tsx
│   ├── Scanner.test.tsx
│   ├── UploadZone.test.tsx
│   ├── ReceiptStatus.test.tsx
│   ├── ReviewCard.test.tsx
│   ├── ShoppingItem.test.tsx
│   ├── PriceChart.test.tsx
│   ├── DashboardNav.test.tsx
│   └── accessibility.test.tsx
├── visual/              # Visual regression tests
│   └── responsive.test.ts
├── e2e/                 # End-to-end component tests
│   └── components.spec.ts
└── README.md           # This file
```

## Running Tests

### Unit Tests

Run all component tests:
```bash
bun test src/__tests__/components/
```

Run specific test file:
```bash
bun test src/__tests__/components/button.test.tsx
```

Run with coverage:
```bash
bun test --coverage src/__tests__/components/
```

### Visual Regression Tests

```bash
npx playwright test src/__tests__/visual/
```

Update snapshots:
```bash
npx playwright test src/__tests__/visual/ --update-snapshots
```

### E2E Component Tests

```bash
npx playwright test src/__tests__/e2e/components.spec.ts
```

## Test Categories

### 1. Unit Tests (`components/`)

Each component test file covers:
- **Props Interface** - Props validation and types
- **Component State** - Internal state management
- **Accessibility** - ARIA attributes, keyboard support
- **Visual States** - UI states and styling
- **Event Handling** - User interactions
- **Dependencies** - External library usage

Example structure:
```typescript
describe("ComponentName", () => {
  describe("Props Interface", () => { ... });
  describe("Component State", () => { ... });
  describe("Accessibility", () => { ... });
  describe("Visual States", () => { ... });
  describe("Event Handling", () => { ... });
});
```

### 2. Accessibility Tests (`accessibility.test.tsx`)

Comprehensive accessibility audit covering:
- ARIA labels and roles
- Focus management
- Keyboard navigation
- Screen reader compatibility
- Color contrast
- Lighthouse targets

### 3. Visual Regression Tests (`visual/`)

Responsive design testing:
- Mobile (375px)
- Tablet (768px)
- Desktop (1440px)

Component state testing:
- Default state
- Hover state
- Focus state
- Disabled state
- Active state

### 4. E2E Tests (`e2e/`)

Interactive testing:
- Click handlers
- Form submissions
- Keyboard navigation
- Focus management
- State transitions

## Test Data Attributes

For E2E testing, components should include `data-testid` attributes:

```tsx
// Example test IDs
<button data-testid="button-default">Click me</button>
<input data-testid="input-text" />
<div data-testid="location-picker">...</div>
<div data-testid="upload-zone">...</div>
```

## Adding New Tests

1. Create test file: `src/__tests__/components/ComponentName.test.tsx`
2. Import dependencies
3. Follow existing test structure
4. Run tests: `bun test src/__tests__/components/ComponentName.test.tsx`
5. Verify all assertions pass

## CI Integration

Tests run automatically on:
- Pull request creation
- Push to main branch
- Scheduled daily runs

## Test Utilities

Common patterns used in tests:

### Mocking tRPC
```typescript
jest.mock('@/lib/trpc/client', () => ({
  api: {
    location: {
      list: {
        useQuery: () => ({
          data: mockLocations,
          isLoading: false,
        }),
      },
    },
  },
}));
```

### Mocking next-intl
```typescript
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'es',
}));
```

### Mocking Next.js Router
```typescript
jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));
```

## Coverage Goals

- **Line Coverage:** 80%+
- **Function Coverage:** 80%+
- **Branch Coverage:** 70%+
- **Component Coverage:** 100%

## Accessibility Goals

- Lighthouse Accessibility Score: 90+
- Zero axe-core violations
- Keyboard navigable: 100%
- Screen reader compatible: 100%

## Troubleshooting

### Tests failing with "Cannot find module"

Ensure path aliases are configured in `tsconfig.json`:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### Visual tests failing due to pixel differences

Update snapshots if changes are intentional:
```bash
npx playwright test --update-snapshots
```

### E2E tests timing out

Increase timeout in `playwright.config.ts`:
```typescript
expect: {
  timeout: 10000,
},
```

## Contributing

1. Write tests for new components
2. Update tests when modifying components
3. Maintain test coverage above thresholds
4. Follow existing test patterns and naming conventions

## Resources

- [bun:test Documentation](https://bun.sh/docs/cli/test)
- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Testing Library](https://testing-library.com/docs/)
- [WCAG Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
