import { bisector, max, range } from 'd3-array';
import { axisBottom, axisLeft, axisRight } from 'd3-axis';
import { scaleLinear, scaleTime } from 'd3-scale';
import { pointer, select, type BaseType, type Selection } from 'd3-selection';
import { area, curveLinear, curveMonotoneX, curveNatural, line } from 'd3-shape';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomTransform } from 'd3-zoom';
import 'd3-transition';
import type { SvRtPerfThreadNamesType } from '@shared/otherTypes';
import { PerfLifeSpanType, PerfSnapType, PERF_MIN_TICK_TIME, getMinTickIntervalMarker } from './chartingUtils';
import { throttle } from 'throttle-debounce';

//Grafana-ish series colors, shared with the legend in FullPerfCard
export const PERF_SERIES_COLORS = {
    healthy: '#22c55e',
    strained: '#eab308',
    lagging: '#ef4444',
} as const;

//Helpers
const translate = (x: number, y: number) => `translate(${x}, ${y})`;

type AugmentedLifespanType = PerfLifeSpanType & {
    lifespanStartX: number;
    lifespanEndX: number;
    lifespanWidth: number;
};

type drawFullPerfChartProps = {
    svgRef: SVGElement;
    setRenderError: (error: string) => void;
    size: {
        width: number;
        height: number;
    };
    margins: {
        top: number;
        right: number;
        bottom: number;
        left: number;
        axis: number;
    };
    isDarkMode: boolean;
    threadName: SvRtPerfThreadNamesType;
    boundaries: (string | number)[];
    dataStart: Date;
    dataEnd: Date;
    lifespans: PerfLifeSpanType[];
    cursorSetter: (snap: PerfSnapType | undefined) => void;
    showPlayerCount: boolean;
    showFxsMemory: boolean;
    showNodeMemory: boolean;
};

export default function drawFullPerfChart({
    svgRef,
    setRenderError,
    size: { width, height },
    margins,
    isDarkMode,
    threadName,
    boundaries,
    dataStart,
    dataEnd,
    lifespans,
    cursorSetter,
    showPlayerCount,
    showFxsMemory,
    showNodeMemory,
}: drawFullPerfChartProps) {
    //Clear SVG
    select(svgRef).selectAll('*').remove();

    //Setup selectors
    const svg = select<SVGElement, PerfLifeSpanType>(svgRef);
    if (svg.empty()) throw new Error('SVG selection failed.');

    //closed by the end of file

    //Grafana-style stacked left axes: the player-count axis and a memory axis both dock
    //at `margins.left`, so showing both at once made their tick labels overlap/interleave
    //illegibly (and look like the chart itself was broken). FXS and Node memory also share
    //the same unit (MB), so they're combined onto a single shared axis/scale instead of two.
    const maxFxsMemory = max(lifespans, (lspn) => max(lspn.log, (log) => log.fxsMemory)) ?? 0;
    const maxNodeMemory = max(lifespans, (lspn) => max(lspn.log, (log) => log.nodeMemory)) ?? 0;
    const hasMemoryAxis = Boolean((showFxsMemory && maxFxsMemory) || (showNodeMemory && maxNodeMemory));
    const memoryAxisExtraWidth = hasMemoryAxis && showPlayerCount ? 34 : 0;
    margins = { ...margins, left: margins.left + memoryAxisExtraWidth };

    //Setup
    const drawableAreaHeight = height - margins.top - margins.bottom;
    const drawableAreaWidth = width - margins.left - margins.right;

    svg.append('clipPath')
        .attr('id', 'fullPerfChartClipPath')
        .append('rect')
        .attr('x', 0)
        .attr('y', margins.top)
        .attr('width', drawableAreaWidth)
        .attr('height', height);

    //Gradient defs for the tick-duration series (Grafana/dashboard-style faded area fills)
    const gradientDefs = svg.append('defs');
    for (const [name, color] of Object.entries(PERF_SERIES_COLORS)) {
        const gradient = gradientDefs
            .append('linearGradient')
            .attr('id', `perf-area-gradient-${name}`)
            .attr('x1', '0')
            .attr('x2', '0')
            .attr('y1', '0')
            .attr('y2', '1');
        gradient.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.28);
        gradient.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0);
    }

    //Shared muted styling for all d3 axes (no domain line, no tick marks, small muted labels)
    const axisTextColor = isDarkMode ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.5)';
    const styleAxis = (g: Selection<SVGGElement, any, any, any>) => {
        g.select('.domain').remove();
        g.selectAll('.tick line').remove();
        g.selectAll<SVGTextElement, unknown>('.tick text')
            .attr('fill', axisTextColor)
            .attr('font-size', 10)
            .attr('font-family', 'inherit');
    };

    const chartGroup = svg
        .append('g')
        .attr('clip-path', 'url(#fullPerfChartClipPath)')
        .attr('transform', translate(margins.left, 0));

    //Fixed Scales
    const timeScale = scaleTime().domain([dataStart, dataEnd]).range([0, drawableAreaWidth]);

    // Series: % of time spent on ticks OVER the thread's budget. The healthy
    // majority is intentionally not drawn — an always-full fill hides the spikes.
    const tickBudget = PERF_MIN_TICK_TIME[threadName];
    const budgetMarker = getMinTickIntervalMarker(boundaries, tickBudget);
    const budget2xMarker = getMinTickIntervalMarker(boundaries, tickBudget * 2);
    let budgetIdx = boundaries.findIndex((b) => b === budgetMarker);
    let budget2xIdx = boundaries.findIndex((b) => b === budget2xMarker);
    if (budgetIdx === -1) budgetIdx = Math.floor(boundaries.length * 0.5);
    if (budget2xIdx === -1 || budget2xIdx < budgetIdx) {
        budget2xIdx = Math.min(boundaries.length - 2, Math.floor(boundaries.length * 0.75));
    }

    const sumBucketRange = (perf: number[], from: number, to: number) => {
        let sum = 0;
        for (let i = from; i <= to && i < perf.length; i++) {
            sum += perf[i];
        }
        return Math.min(sum, 1);
    };

    //Strained is a superset of lagging (all over-budget time), so lagging draws on top of it
    const seriesDefs = [
        {
            name: 'strained',
            color: PERF_SERIES_COLORS.strained,
            getValue: (snap: PerfSnapType) => sumBucketRange(snap.weightedPerf, budgetIdx + 1, boundaries.length - 1),
        },
        {
            name: 'lagging',
            color: PERF_SERIES_COLORS.lagging,
            getValue: (snap: PerfSnapType) => sumBucketRange(snap.weightedPerf, budget2xIdx + 1, boundaries.length - 1),
        },
    ];

    //Auto-scale the y axis to the worst spike (with a 2% floor so a healthy server isn't just noise)
    let maxSeriesVal = 0;
    for (const lspn of lifespans) {
        for (const snap of lspn.log) {
            const v = seriesDefs[0].getValue(snap); //strained is the superset
            if (v > maxSeriesVal) maxSeriesVal = v;
        }
    }
    const yMax = Math.min(Math.max(maxSeriesVal * 1.15, 0.02), 1);
    const pctScale = scaleLinear([0, yMax], [height - margins.bottom, margins.top]);

    //Line Scales
    const maxPlayers = max(lifespans, (lspn) => max(lspn.log, (log) => log.players))!;
    const maxPlayersDomain = Math.ceil((maxPlayers + 1) / 5) * 5;
    const lineScalesRange = [height - margins.bottom, margins.top];
    const playersScale = scaleLinear([0, maxPlayersDomain], lineScalesRange);
    const memoryScale = scaleLinear([0, Math.max(maxFxsMemory, maxNodeMemory) || 1], lineScalesRange);

    //Axis
    const timeAxisTicksScale = scaleLinear([382, 1350], [7, 16]);
    const timeAxis = axisBottom(timeScale).ticks(timeAxisTicksScale(width));
    const timeAxisGroup = svg
        .append('g')
        .attr('transform', translate(margins.left, height - margins.bottom))
        .attr('class', 'time-axis')
        .call(timeAxis)
        .call(styleAxis);

    const pctAxis = axisRight(pctScale)
        .tickFormat((t) => `${parseFloat((Number(t) * 100).toFixed(1))}%`)
        .ticks(5);
    svg.append('g')
        .attr('class', 'pct-axis')
        .attr('transform', translate(width - margins.right + margins.axis, 0))
        .call(pctAxis)
        .call(styleAxis);

    const playersAxisTickValues = maxPlayersDomain <= 7 ? range(maxPlayersDomain + 1) : null;
    const playersAxis = axisLeft(playersScale)
        .tickFormat((t) => t.toString())
        .tickValues(playersAxisTickValues as any); //integer values only
    if (showPlayerCount) {
        svg.append('g')
            .attr('class', 'players-axis')
            .attr('transform', translate(margins.left - margins.axis, 0))
            .call(playersAxis)
            .call(styleAxis);
    }

    if (hasMemoryAxis) {
        //Docked to the left of the players axis (if shown) instead of stacking on top of it
        const memoryAxisX = margins.left - margins.axis - memoryAxisExtraWidth;
        const memoryAxis = axisLeft(memoryScale).tickFormat((t) => t.toString() + ' MB');
        svg.append('g')
            .attr('class', 'memory-axis')
            .attr('transform', translate(memoryAxisX, 0))
            .call(memoryAxis)
            .call(styleAxis);
    }

    // Drawing the over-budget series (strained first, lagging on top of it)
    let snapshotsDrawn: PerfSnapType[] = [];

    //Dedicated container created once so its DOM position (and therefore z-order) never shifts on redraw
    const seriesContainer = chartGroup.append('g').attr('class', 'perf-series-container');

    const drawPerfSeries = () => {
        snapshotsDrawn = [];
        seriesContainer.selectAll('*').remove();

        for (const lifespan of lifespans) {
            const { log } = lifespan;
            if (log.length < 2) continue; //area needs at least 2 points to draw anything

            const lifespanStartX = lifespan.bootTime ? timeScale(lifespan.bootTime) : timeScale(log[0].start);
            const lifespanEndX = lifespan.closeTime ? timeScale(lifespan.closeTime) : timeScale(log.at(-1)!.end);
            if (lifespanEndX < 0 || lifespanStartX > drawableAreaWidth) continue;
            snapshotsDrawn.push(...log);

            //Grafana-style: sharp linear segments, with point dots when spacing allows
            const avgPointSpacing = (lifespanEndX - lifespanStartX) / Math.max(log.length - 1, 1);
            const drawDots = avgPointSpacing >= 14;
            const isPointVisible = (d: PerfSnapType) => {
                const x = timeScale(d.end);
                return x >= -10 && x <= drawableAreaWidth + 10;
            };

            const lifespanGroup = seriesContainer.append('g').attr('class', 'perf-series-lifespan');
            for (const def of seriesDefs) {
                const areaGenerator = area<PerfSnapType>()
                    .x((d) => timeScale(d.end))
                    .y0(pctScale(0))
                    .y1((d) => pctScale(def.getValue(d)))
                    .curve(curveLinear);
                const lineGenerator = line<PerfSnapType>()
                    .x((d) => timeScale(d.end))
                    .y((d) => pctScale(def.getValue(d)))
                    .curve(curveLinear);

                lifespanGroup
                    .append('path')
                    .attr('class', `perf-area-${def.name}`)
                    .attr('fill', `url(#perf-area-gradient-${def.name})`)
                    .attr('d', areaGenerator(log));
                lifespanGroup
                    .append('path')
                    .attr('class', `perf-line-${def.name}`)
                    .attr('fill', 'none')
                    .attr('stroke', def.color)
                    .attr('stroke-width', 1.5)
                    .attr('stroke-linejoin', 'round')
                    .attr('stroke-linecap', 'round')
                    .attr('d', lineGenerator(log));
                if (drawDots) {
                    lifespanGroup
                        .append('g')
                        .attr('class', `perf-dots-${def.name}`)
                        .selectAll('circle')
                        .data(log.filter(isPointVisible))
                        .join('circle')
                        .attr('cx', (d) => timeScale(d.end))
                        .attr('cy', (d) => pctScale(def.getValue(d)))
                        .attr('r', 2.5)
                        .attr('fill', def.color);
                }
            }
        }
    };
    drawPerfSeries();

    const prepareLifespanDataItem = (d: PerfLifeSpanType): AugmentedLifespanType[] => {
        const lifespanStartX = d.bootTime ? timeScale(d.bootTime) : timeScale(d.log[0].start);
        const lifespanEndX = d.closeTime ? timeScale(d.closeTime) : timeScale(d.log.at(-1)!.end);
        const lifespanWidth = lifespanEndX - lifespanStartX;
        if (lifespanWidth < 5 || lifespanEndX < 0 + margins.left || lifespanStartX > drawableAreaWidth + margins.left) {
            return [];
        }

        return [
            {
                ...d,
                lifespanStartX,
                lifespanEndX,
                lifespanWidth,
            },
        ];
    };

    const drawLifespan = (lifespanGSel: Selection<BaseType | SVGGElement, PerfLifeSpanType, SVGElement, unknown>) => {
        // Close Reason
        lifespanGSel
            .selectAll('text.closeReason')
            .data(prepareLifespanDataItem)
            .join('text')
            .attr('class', 'closeReason')
            .attr('x', (d) => d.lifespanEndX)
            .attr('y', 0)
            .attr('dy', 6)
            .attr('text-anchor', 'end')
            .attr('dominant-baseline', 'baseline')
            .attr('font-size', 12)
            .attr('fill', 'rgba(255, 255, 255, 0.75)')
            .attr('transform', (d) => `rotate(-90, ${d.lifespanEndX}, 12)`)
            .attr('letter-spacing', '2px')
            .text((d) => d.closeReason ?? '');

        //FXServer memory
        if (showFxsMemory && maxFxsMemory) {
            const fxsMemoryLineGenerator = line<PerfSnapType>()
                .defined((d) => d.fxsMemory !== null)
                .x((d) => timeScale(d.end))
                .y((d) => memoryScale(d.fxsMemory as number))
                .curve(curveNatural);
            lifespanGSel
                .selectAll('path.fxsmem-line')
                .data(prepareLifespanDataItem)
                .join('path')
                .attr('class', 'fxsmem-line')
                .each((d, i, nodes) => {
                    select(nodes[i])
                        .attr('fill', 'none')
                        .attr('opacity', 0.75)
                        .attr('stroke-dasharray', '4 6')
                        .attr('stroke-linejoin', 'round')
                        .attr('stroke-linecap', 'round')
                        .attr('stroke', '#a78bfa')
                        .attr('stroke-width', 1.5)
                        .attr('d', fxsMemoryLineGenerator(d.log));
                });
        }

        //Node memory
        if (showNodeMemory && maxNodeMemory) {
            const nodeMemoryLineGenerator = line<PerfSnapType>()
                .defined((d) => d.nodeMemory !== null)
                .x((d) => timeScale(d.end))
                .y((d) => memoryScale(d.nodeMemory as number))
                .curve(curveNatural);
            lifespanGSel
                .selectAll('path.nodemem-line')
                .data(prepareLifespanDataItem)
                .join('path')
                .attr('class', 'nodemem-line')
                .each((d, i, nodes) => {
                    select(nodes[i])
                        .attr('fill', 'none')
                        .attr('opacity', 0.75)
                        .attr('stroke-dasharray', '4 6')
                        .attr('stroke-linejoin', 'round')
                        .attr('stroke-linecap', 'round')
                        .attr('stroke', '#22d3ee')
                        .attr('stroke-width', 1.5)
                        .attr('d', nodeMemoryLineGenerator(d.log));
                });
        }

        //Player lines
        const playerLineGenerator = line<PerfSnapType>(
            (d) => timeScale(d.end),
            (d) => playersScale(d.players),
        );
        if (maxPlayers <= 20) {
            //NOTE: curveNatural (cubic spline) can overshoot past the actual data points
            //to stay smooth, which made the line dip below 0 players around sharp spikes.
            //curveMonotoneX stays smooth but never overshoots past neighboring points.
            playerLineGenerator.curve(curveMonotoneX);
        }
        if (showPlayerCount) {
            lifespanGSel
                .selectAll('path.players-line-bg')
                .data(prepareLifespanDataItem)
                .join('path')
                .attr('class', 'players-line-bg')
                .each((d, i, nodes) => {
                    select(nodes[i])
                        .attr('fill', 'none')
                        .attr('stroke-linejoin', 'round')
                        .attr('stroke-linecap', 'round')
                        .attr('stroke', 'rgba(0, 0, 0, 0.6)')
                        .attr('stroke-width', 4)
                        .attr('d', playerLineGenerator(d.log));
                });
            lifespanGSel
                .selectAll('path.players-line')
                .data(prepareLifespanDataItem)
                .join('path')
                .attr('class', 'players-line')
                .each((d, i, nodes) => {
                    select(nodes[i])
                        .attr('fill', 'none')
                        .attr('stroke-linejoin', 'round')
                        .attr('stroke-linecap', 'round')
                        .attr('stroke', 'rgb(204, 203, 203)')
                        .attr('stroke-width', 2)
                        .attr('d', playerLineGenerator(d.log));
                });
        }
    };

    // Drawing the lifespans (overlay lines, rendered on top of the stream container)
    chartGroup.selectAll('g.lifespan').data(lifespans).join('g').attr('class', 'lifespan').call(drawLifespan);

    /**
     * Cursor
     */
    const crosshairColor = isDarkMode ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.35)';
    const cursorLineVert = chartGroup
        .append('line')
        .attr('class', 'cursorLineHorz')
        .attr('stroke', crosshairColor)
        .attr('stroke-width', 1);
    const cursorLineHorz = chartGroup
        .append('line')
        .attr('class', 'cursorLineHorz')
        .attr('stroke', crosshairColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3 3');
    const cursorDot = chartGroup
        .append('circle')
        .attr('class', 'cursorDot')
        .attr('fill', '#3b82f6')
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5)
        .attr('r', 4);
    const cursorTextBg = chartGroup
        .append('rect')
        .attr('class', 'cursorTextBg')
        .attr('fill', '#18181b')
        .attr('rx', 5)
        .attr('ry', 5)
        .attr('stroke', 'rgba(255, 255, 255, 0.15)')
        .attr('stroke-width', 1);
    const cursorText = chartGroup
        .append('text')
        .attr('class', 'cursorText font-mono')
        .attr('fill', 'rgba(255, 255, 255, 0.9)')
        .attr('font-size', 13);
    const cursorTextNode = cursorText.node();

    const clearCursor = () => {
        cursorLineVert.attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 0);
        cursorDot.attr('cx', -99).attr('cy', -99);
        cursorLineHorz.attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 0);
        cursorText.attr('x', -99).attr('y', -99);
        cursorTextBg.attr('x', -99).attr('y', -99);
        cursorSetter(undefined);
    };
    clearCursor();

    //Find the closest data point for a given X value
    const maxAllowedGap = 20 * 60 * 1000;
    const timeBisector = bisector((lfspn: PerfSnapType) => lfspn.end).center;
    const getClosestData = (x: number) => {
        if (!snapshotsDrawn.length) return;
        const xPosDate = timeScale.invert(x);
        const indexFound = timeBisector(snapshotsDrawn, xPosDate);
        if (indexFound === -1) return;
        const snapData = snapshotsDrawn[indexFound];
        if (Math.abs(snapData.end.getTime() - xPosDate.getTime()) < maxAllowedGap) {
            return {
                snapIndex: indexFound,
                snapData,
            };
        }
    };

    //Detect mouse over and show timestamp + draw vertical line
    let lastFlatSnapsIndex: number | null = null;
    const handleMouseMove = (pointerX: number, pointerY: number) => {
        // Find closest data point
        const findResult = getClosestData(pointerX);
        if (!findResult) {
            lastFlatSnapsIndex = null;
            return clearCursor();
        }
        const { snapIndex, snapData } = findResult;
        if (snapIndex === lastFlatSnapsIndex) return;
        lastFlatSnapsIndex = snapIndex;
        cursorSetter(snapData);

        const pointData = {
            x: Math.round(timeScale(snapData.end)) + 0.5,
            y: Math.round(playersScale(snapData.players)) + 0.5,
            val: snapData.players,
        };

        // Draw cursor
        cursorLineVert.attr('x1', pointData.x).attr('y1', 0).attr('x2', pointData.x).attr('y2', drawableAreaHeight);
        cursorLineHorz.attr('x1', 0).attr('y1', pointData.y).attr('x2', drawableAreaWidth).attr('y2', pointData.y);
        cursorDot.attr('cx', pointData.x).attr('cy', pointData.y);

        const countString = pointData.val.toString();
        const isTextTooLeft = pointData.x < 50;
        const isTextTooHigh = pointData.y < 50;
        cursorText
            .text(countString)
            .attr('x', isTextTooLeft ? pointData.x + 20 : pointData.x - 15)
            .attr('y', isTextTooHigh ? pointData.y + 15 : pointData.y - 15)
            .attr('text-anchor', isTextTooLeft ? 'start' : 'end')
            .attr('dominant-baseline', isTextTooHigh ? 'hanging' : 'baseline');
        if (!cursorTextNode) return;
        const cursorTextBBox = cursorTextNode.getBBox();
        const bgPadX = 6;
        const bgPadY = 2;
        cursorTextBg
            .attr('x', Math.round(cursorTextBBox.x) - bgPadX - 0.5)
            .attr('y', Math.round(cursorTextBBox.y) - bgPadY - 0.5)
            .attr('width', Math.round(cursorTextBBox.width) + bgPadX * 2)
            .attr('height', Math.round(cursorTextBBox.height) + bgPadY * 2);
    };

    // Handle svg mouse events
    let isEventInCooldown = false;
    let cursorRedrawTimeout: NodeJS.Timeout;
    const cooldownTime = 20;
    chartGroup
        .append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', drawableAreaWidth)
        .attr('height', drawableAreaHeight)
        .attr('fill', 'transparent')
        .on('mousemove', function (event) {
            const [pointerX, pointerY] = pointer(event);
            if (!isEventInCooldown) {
                isEventInCooldown = true;
                handleMouseMove(pointerX, pointerY);
                setTimeout(() => {
                    isEventInCooldown = false;
                }, cooldownTime);
            } else {
                clearTimeout(cursorRedrawTimeout);
                cursorRedrawTimeout = setTimeout(() => {
                    handleMouseMove(pointerX, pointerY);
                }, cooldownTime);
            }
        });
    svg.on('mouseleave', function () {
        setTimeout(() => {
            clearCursor();
        }, 150);
    });

    /**
     * Pan arrows
     */
    const arrowSize = 24;
    const arrowPadY = drawableAreaHeight / 2;
    const arrowColor = isDarkMode ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)';
    const arrowHoverColor = isDarkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';

    const leftArrow = svg
        .append('g')
        .attr('class', 'pan-arrow-left')
        .attr('transform', translate(margins.left + 8, arrowPadY))
        .style('cursor', 'pointer')
        .style('opacity', 0);
    leftArrow
        .append('polygon')
        .attr('points', `0,0 ${arrowSize},${-arrowSize / 2} ${arrowSize},${arrowSize / 2}`)
        .attr('fill', arrowColor);
    leftArrow
        .on('mouseenter', function () {
            select(this).select('polygon').attr('fill', arrowHoverColor);
        })
        .on('mouseleave', function () {
            select(this).select('polygon').attr('fill', arrowColor);
        });

    const rightArrow = svg
        .append('g')
        .attr('class', 'pan-arrow-right')
        .attr('transform', translate(width - margins.right - arrowSize - 8, arrowPadY))
        .style('cursor', 'pointer')
        .style('opacity', 0);
    rightArrow
        .append('polygon')
        .attr('points', `${arrowSize},0 0,${-arrowSize / 2} 0,${arrowSize / 2}`)
        .attr('fill', arrowColor);
    rightArrow
        .on('mouseenter', function () {
            select(this).select('polygon').attr('fill', arrowHoverColor);
        })
        .on('mouseleave', function () {
            select(this).select('polygon').attr('fill', arrowColor);
        });

    const updatePanArrows = (transform: ZoomTransform) => {
        const canPanLeft = transform.x < 0;
        const maxTranslateX = -(transform.k - 1) * drawableAreaWidth;
        const canPanRight = transform.x > maxTranslateX;
        leftArrow.style('opacity', canPanLeft ? 1 : 0);
        rightArrow.style('opacity', canPanRight ? 1 : 0);
    };

    /**
     * Zoom
     */
    let wasZoomed = false;
    const zoomedHandler = ({ transform }: D3ZoomEvent<SVGElement, PerfLifeSpanType>) => {
        //Prevent spamming re-renders when zoomed out
        if (transform.k === 1 && transform.x === 0) {
            if (!wasZoomed) return;
            wasZoomed = false;
        } else {
            wasZoomed = true;
        }

        timeScale.range([
            parseFloat(transform.applyX(0).toFixed(6)),
            parseFloat(transform.applyX(drawableAreaWidth).toFixed(6)),
        ]);
        const visibleTimeScale = transform.rescaleX(timeScale).range([0, drawableAreaWidth]);
        timeAxis.scale(visibleTimeScale);
        timeAxisGroup.call(timeAxis).call(styleAxis);

        drawPerfSeries();
        //@ts-ignore
        chartGroup.selectAll('g.lifespan').call(drawLifespan);

        clearCursor();
        updatePanArrows(transform);
    };
    const debouncedZoomHandler = throttle(20, zoomedHandler, { noLeading: false, noTrailing: false });

    const zoomExtent = [
        [0, margins.top],
        [drawableAreaWidth, height - margins.top],
    ] satisfies [[number, number], [number, number]];
    const zoomBehavior = zoom<SVGElement, PerfLifeSpanType>()
        .scaleExtent([1, 12])
        .translateExtent(zoomExtent)
        .extent(zoomExtent)
        .on('zoom', debouncedZoomHandler);
    svg.call(zoomBehavior);

    //Pan arrow click handlers
    const panStep = drawableAreaWidth * 0.3;
    leftArrow.on('click', function () {
        svg.transition().duration(300).call(zoomBehavior.translateBy, panStep, 0);
    });
    rightArrow.on('click', function () {
        svg.transition().duration(300).call(zoomBehavior.translateBy, -panStep, 0);
    });

    //Initial zoom to show last 30h of data
    const totalDataMs = dataEnd.getTime() - dataStart.getTime();
    const targetWindowMs = 30 * 60 * 60 * 1000; //30 hours
    if (totalDataMs > targetWindowMs) {
        const initialScale = totalDataMs / targetWindowMs;
        const clampedScale = Math.min(initialScale, 12);
        const endX = drawableAreaWidth;
        const initialTranslateX = endX - endX * clampedScale;
        const initialTransform = zoomIdentity.translate(initialTranslateX, 0).scale(clampedScale);
        svg.call(zoomBehavior.transform, initialTransform);
    }
}
