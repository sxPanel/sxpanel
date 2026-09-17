import { useId } from 'react';

type SparklineProps = {
    points: number[];
    height: number;
    strokeClassName?: string;
    fillArea?: boolean;
    className?: string;
};

/** Minimal responsive line/area chart — no charting library needed for a simple trend line. */
export default function Sparkline({
    points,
    height,
    strokeClassName = 'text-accent',
    fillArea,
    className,
}: SparklineProps) {
    const gradientId = useId();
    if (points.length < 2) return null;

    const viewboxWidth = 100;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const padY = height * 0.12;

    const coords = points.map((value, i) => {
        const x = (i / (points.length - 1)) * viewboxWidth;
        const y = height - padY - ((value - min) / range) * (height - padY * 2);
        return [x, y] as const;
    });

    const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const areaPath = `${linePath} L${viewboxWidth},${height} L0,${height} Z`;

    return (
        <svg
            viewBox={`0 0 ${viewboxWidth} ${height}`}
            preserveAspectRatio="none"
            className={className}
            style={{ width: '100%', height }}
        >
            {fillArea && (
                <>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
                            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    <path d={areaPath} fill={`url(#${gradientId})`} className={strokeClassName} stroke="none" />
                </>
            )}
            <path
                d={linePath}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                vectorEffect="non-scaling-stroke"
                className={strokeClassName}
            />
        </svg>
    );
}
