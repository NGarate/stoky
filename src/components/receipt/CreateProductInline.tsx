"use client";

import { useState } from "react";
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
        <label htmlFor="product-name" className="text-sm font-medium text-gray-700">
          Nombre del producto:
        </label>
        <Input
          id="product-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Leche semi desnatada"
          className="mt-1"
          autoFocus
        />
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancelar
        </Button>
        <Button type="submit" className="flex-1" disabled={!name.trim()}>
          Crear producto
        </Button>
      </div>
    </form>
  );
}
