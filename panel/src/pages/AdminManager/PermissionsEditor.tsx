import { useState, useMemo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SearchIcon } from 'lucide-react';
import { permissionsByCategory, permCategories, type PermissionDefinition } from '@shared/permissions';
import { cn } from '@/lib/utils';
import { useLocale } from '@/hooks/locale';
import {
    translatePermCategoryLabel,
    translatePermissionDescription,
    translatePermissionLabel,
} from '@/lib/permissionLabel';

type PermissionsEditorProps = {
    selected: string[];
    onChange: (perms: string[]) => void;
    disabled?: boolean;
};

export default function PermissionsEditor({ selected, onChange, disabled }: PermissionsEditorProps) {
    const { t } = useLocale();
    const hasAll = selected.includes('all_permissions');
    const [search, setSearch] = useState('');
    const searchLower = search.toLowerCase().trim();

    const toggle = (permId: string) => {
        if (permId === 'all_permissions') {
            onChange(selected.includes('all_permissions') ? [] : ['all_permissions']);
            return;
        }
        if (selected.includes(permId)) {
            onChange(selected.filter((p) => p !== permId));
        } else {
            onChange([...selected.filter((p) => p !== 'all_permissions'), permId]);
        }
    };

    const toggleCategory = (perms: PermissionDefinition[]) => {
        const ids = perms.flatMap((permission) => (permission.id === 'all_permissions' ? [] : [permission.id]));
        const allChecked = ids.every((id) => selected.includes(id));
        if (allChecked) {
            onChange(selected.filter((p) => !ids.includes(p)));
        } else {
            const merged = new Set([...selected.filter((p) => p !== 'all_permissions'), ...ids]);
            onChange([...merged]);
        }
    };

    // Merge static permissions with dynamic addon permissions from txConsts
    const allCategories = useMemo(() => {
        const addonPerms: PermissionDefinition[] = window.txConsts?.addonPermissions ?? [];
        if (addonPerms.length === 0) return permissionsByCategory;

        // Start with the built-in categories (which won't have addon perms)
        const result = permissionsByCategory.map((cat) => ({ ...cat, permissions: [...cat.permissions] }));

        // Find or create the addons category
        let addonsCat = result.find((c) => c.id === 'addons');
        if (!addonsCat) {
            const catDef = permCategories.find((c) => c.id === 'addons');
            addonsCat = { id: 'addons' as const, label: catDef?.label ?? 'Addons', permissions: [] };
            result.push(addonsCat);
        }
        addonsCat.permissions.push(...addonPerms);

        return result;
    }, []);

    const filteredCategories = allCategories.flatMap((category) => {
        const permissions = category.permissions.filter(
            (permission) =>
                !searchLower ||
                permission.label.toLowerCase().includes(searchLower) ||
                permission.description.toLowerCase().includes(searchLower) ||
                permission.id.toLowerCase().includes(searchLower),
        );

        return permissions.length > 0 ? [{ ...category, permissions }] : [];
    });

    return (
        <div className="space-y-3">
            <div className="relative">
                <SearchIcon className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
                <Input
                    placeholder="Search permissions..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                />
            </div>

            <div className="space-y-4">
                {filteredCategories.map((cat) => {
                    const catIds = cat.permissions.flatMap((permission) =>
                        permission.id === 'all_permissions' ? [] : [permission.id],
                    );
                    const catAllChecked = catIds.length > 0 && catIds.every((id) => selected.includes(id));
                    const catSomeChecked = catIds.some((id) => selected.includes(id));

                    return (
                        <div key={cat.id} className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    checked={hasAll || catAllChecked}
                                    data-indeterminate={!catAllChecked && catSomeChecked ? true : undefined}
                                    onCheckedChange={() => toggleCategory(cat.permissions)}
                                    disabled={disabled || hasAll}
                                />
                                <span className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
                                    {translatePermCategoryLabel(t, cat)}
                                </span>
                            </div>

                            <div className="grid gap-1.5 pl-5 sm:grid-cols-2">
                                {cat.permissions.map((perm) => (
                                    <label
                                        key={perm.id}
                                        htmlFor={`${cat.id}-${perm.id}`}
                                        className={cn(
                                            'hover:bg-muted/60 flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors select-none',
                                            disabled && 'pointer-events-none opacity-50',
                                        )}
                                    >
                                        <Checkbox
                                            id={`${cat.id}-${perm.id}`}
                                            checked={hasAll || selected.includes(perm.id)}
                                            onCheckedChange={() => toggle(perm.id)}
                                            disabled={disabled || (hasAll && perm.id !== 'all_permissions')}
                                            className="mt-0.5"
                                        />
                                        <div className="flex flex-col leading-tight">
                                            <span className="text-sm font-medium">
                                                {translatePermissionLabel(t, perm)}
                                                {perm.dangerous && (
                                                    <Badge
                                                        variant="destructive"
                                                        className="ml-1.5 px-1 py-0 text-[10px]"
                                                    >
                                                        dangerous
                                                    </Badge>
                                                )}
                                            </span>
                                            <span className="text-muted-foreground text-xs">
                                                {translatePermissionDescription(t, perm)}
                                            </span>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    );
                })}
                {filteredCategories.length === 0 && (
                    <p className="text-muted-foreground py-4 text-center text-sm">No permissions match your search.</p>
                )}
            </div>
        </div>
    );
}
