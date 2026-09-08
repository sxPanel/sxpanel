import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

function LabelRequired() {
    return <span className="text-destructive-inline text-[10px] font-semibold tracking-wide">Required</span>;
}

function LabelOptional() {
    return <span className="text-muted-foreground text-[10px] font-semibold tracking-wide">Optional</span>;
}

export type SettingItemDescProps = {
    children: ReactNode;
    className?: string;
};

export function SettingItemDesc({ children, className }: SettingItemDescProps) {
    return <div className={cn('text-muted-foreground text-sm leading-relaxed', className)}>{children}</div>;
}

export type SettingItemProps = {
    label: string;
    htmlFor?: string;
    required?: boolean;
    showOptional?: boolean;
    showIf?: boolean;
    children: ReactNode;
};

export function SettingItem({
    label,
    htmlFor,
    required: isRequired,
    showOptional,
    showIf,
    children,
}: SettingItemProps) {
    if (showIf !== undefined && !showIf) return null;

    return (
        <div className="flex max-w-4xl flex-col gap-y-2 sm:grid sm:grid-cols-8 sm:items-start sm:gap-4 sm:gap-y-0">
            <div className="min-w-0 sm:col-span-2">
                <Label
                    className="text-foreground flex flex-wrap items-center gap-2 text-sm leading-6 font-semibold sm:text-base"
                    htmlFor={htmlFor}
                >
                    {label}
                    {isRequired ? <LabelRequired /> : null}
                    {showOptional ? <LabelOptional /> : null}
                </Label>
            </div>
            <div className="min-w-0 space-y-2 sm:col-span-6 [&_input]:max-w-none [&_select]:max-w-none [&_textarea]:max-w-none">
                {children}
            </div>
        </div>
    );
}

export function AdvancedDivider() {
    return (
        <div className="relative py-8">
            <div className="absolute inset-x-0 top-1/2 border-t" />
            <p className="text-muted-foreground bg-card relative mx-auto w-fit px-4 text-[11px] font-semibold tracking-widest uppercase">
                Advanced
            </p>
        </div>
    );
}
