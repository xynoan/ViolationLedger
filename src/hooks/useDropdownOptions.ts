import { useQuery } from '@tanstack/react-query';
import { dropdownOptionsAPI } from '@/lib/api';
import { DEFAULT_DROPDOWN_CATALOG, type DropdownCatalog } from '@/types/dropdownCatalog';

export function useDropdownOptions() {
  const query = useQuery({
    queryKey: ['dropdown-options'],
    queryFn: () => dropdownOptionsAPI.get() as Promise<DropdownCatalog>,
    staleTime: 60_000,
    placeholderData: DEFAULT_DROPDOWN_CATALOG,
  });

  const options: DropdownCatalog = query.data ?? DEFAULT_DROPDOWN_CATALOG;

  return {
    ...query,
    options,
  };
}
