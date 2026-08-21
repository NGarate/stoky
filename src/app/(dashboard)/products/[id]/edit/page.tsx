import { permanentRedirect } from "next/navigation";

import type { JSX } from "react";

/**
 * The edit form moved onto the product itself.
 *
 * It existed because the product page refused to be edited, so correcting a
 * typo meant leaving the record and losing everything else it showed. Now the
 * fields are editable where they are read, and this route has nothing left to
 * render.
 *
 * A permanent redirect rather than a deletion: this URL has been linked from
 * the product list and the product page for the life of the project, and is in
 * people's history and bookmarks. A 404 would be a worse answer than the page
 * they wanted.
 */
export default async function ProductEditRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  permanentRedirect(`/products/${id}`);
}
