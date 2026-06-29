import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

export interface FormFieldSchema {
  id: string;
  type: "text" | "number" | "select" | "checkbox" | "textarea" | "date";
  label: string;
  options?: string[];
  required?: boolean;
}

export interface DynamicFormRendererProps {
  schema: FormFieldSchema[];
  initialData?: Record<string, any>;
  onChange?: (data: Record<string, any>) => void;
  readOnly?: boolean;
}

export const DynamicFormRenderer: React.FC<DynamicFormRendererProps> = ({
  schema,
  initialData = {},
  onChange,
  readOnly = false,
}) => {
  const [formData, setFormData] = useState<Record<string, any>>(initialData);

  const handleChange = (id: string, value: any) => {
    if (readOnly) return;
    const newData = { ...formData, [id]: value };
    setFormData(newData);
    if (onChange) onChange(newData);
  };

  return (
    <div className="space-y-4">
      {schema.map((field) => (
        <div key={field.id} className="space-y-1">
          <label className="text-[13px] font-medium text-foreground">
            {field.label} {field.required && <span className="text-destructive">*</span>}
          </label>
          {field.type === "text" && (
            <Input
              value={formData[field.id] || ""}
              onChange={(e) => handleChange(field.id, e.target.value)}
              disabled={readOnly}
              className="h-9"
            />
          )}
          {field.type === "number" && (
            <Input
              type="number"
              value={formData[field.id] || ""}
              onChange={(e) => handleChange(field.id, e.target.value)}
              disabled={readOnly}
              className="h-9"
            />
          )}
          {field.type === "date" && (
            <Input
              type="date"
              value={formData[field.id] || ""}
              onChange={(e) => handleChange(field.id, e.target.value)}
              disabled={readOnly}
              className="h-9"
            />
          )}
          {field.type === "select" && (
            <select
              value={formData[field.id] || ""}
              onChange={(e) => handleChange(field.id, e.target.value)}
              disabled={readOnly}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Select option</option>
              {field.options?.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )}
          {field.type === "textarea" && (
            <textarea
              value={formData[field.id] || ""}
              onChange={(e) => handleChange(field.id, e.target.value)}
              disabled={readOnly}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          )}
          {field.type === "checkbox" && (
            <div className="flex items-center gap-2">
              <Checkbox
                checked={!!formData[field.id]}
                onCheckedChange={(c) => handleChange(field.id, c)}
                disabled={readOnly}
                id={field.id}
              />
              <label htmlFor={field.id} className="text-sm cursor-pointer">
                {field.label}
              </label>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
