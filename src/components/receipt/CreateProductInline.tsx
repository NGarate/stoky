"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CreateProductInlineProps {
  defaultName: string;
  onCreate: (name: string) => void;
  onCancel: () => void;
}

export function CreateProductInline({
  defaultName,
  onCreate,
  onCancel,
}: CreateProductInlineProps) {
  const t = useTranslations("receipts");
  const common = useTranslations("common");
  // Generated rather than literal: every unreviewed line renders its own card,
  // so two open at once shared `id="product-name"` and the second label named
  // the first input.
  const fieldId = useId();
  const hintId = useId();
  const [name, setName] = useState(defaultName);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onCreate(name.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="block">
        <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
          {t("productNameLabel")}
        </label>
        <Input
          id={fieldId}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("productNamePlaceholder")}
          aria-describedby={hintId}
          className="mt-1"
          autoFocus
        />
        {/* Attached, not merely adjacent: a hint that only sits under the box
            is help for sighted mouse users and nobody else (AAA 3.3.5). */}
        <p id={hintId} className="mt-1 text-sm text-muted-foreground">
          {t("productNameHint")}
        </p>
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          {common("cancel")}
        </Button>
        <Button type="submit" className="flex-1" disabled={!name.trim()}>
          {t("createProduct")}
        </Button>
      </div>
    </form>
  );
}
