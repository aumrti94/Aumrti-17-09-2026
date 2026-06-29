# Skill: React Component Creation

## Standard Component Template

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useHospitalId } from '@/hooks/useHospitalId';
import { formatCurrency } from '@/lib/currency';
import { toast } from '@/components/ui/use-toast';

interface ComponentNameProps {
  // define props here
}

export const ComponentName = ({ }: ComponentNameProps) => {
  const hospitalId = useHospitalId();
  const [isLoading, setIsLoading] = useState(false);

  const { data, isLoading: queryLoading, error } = useQuery({
    queryKey: ['entity_name', hospitalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('table_name')
        .select('*')
        .eq('hospital_id', hospitalId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!hospitalId,
  });

  if (queryLoading) return <div>Loading...</div>;
  if (error) return <div>Error loading data</div>;

  return (
    <div className="h-full overflow-hidden">
      {/* content here */}
    </div>
  );
};
```

## Rules
- h-full overflow-hidden on root div (Zero Scroll law)
- All text labels minimum text-[14px] (Clarity law)
- Loading and error states are mandatory
- useHospitalId() — never hardcode
- formatCurrency() — never raw numbers
