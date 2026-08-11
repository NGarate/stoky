import { createTRPCRouter } from "./trpc";
import { authRouter } from "./routers/auth";
import { householdRouter } from "./routers/household";
import { productRouter } from "./routers/product";
import { locationRouter } from "./routers/location";
import { inventoryRouter } from "./routers/inventory";
import { receiptRouter } from "./routers/receipt";
import { storeRouter } from "./routers/store";
import { priceRouter } from "./routers/price";
import { shoppingRouter } from "./routers/shopping";
import { dataRouter } from "./routers/data";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  data: dataRouter,
  household: householdRouter,
  product: productRouter,
  location: locationRouter,
  inventory: inventoryRouter,
  receipt: receiptRouter,
  store: storeRouter,
  price: priceRouter,
  shopping: shoppingRouter,
});

export type AppRouter = typeof appRouter;
