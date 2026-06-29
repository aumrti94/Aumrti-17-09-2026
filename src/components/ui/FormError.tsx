import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * Inline, persistent error box shown AT the form/box that failed (vs a transient
 * toast). Renders nothing when there is no message. Reuses the shared destructive
 * Alert so styling is consistent app-wide.
 *
 * Usage:
 *   const [formError, setFormError] = useState<string | null>(null);
 *   // …on failure: setFormError(getErrorMessage(e))
 *   <FormError message={formError} />
 */
export function FormError({
  message,
  className,
}: {
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <Alert variant="destructive" className={cn(className)}>
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="break-words">{message}</AlertDescription>
    </Alert>
  );
}

export default FormError;
