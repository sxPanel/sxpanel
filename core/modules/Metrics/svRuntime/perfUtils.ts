import si from 'systeminformation';
import type { SvRtPerfCountsType } from './perfSchemas';
import got from '@lib/got';
import { parseRawPerf } from './perfParser';
import { PERF_DATA_BUCKET_COUNT } from './config';

//Consts
const perfDataRawThreadsTemplate: SvRtPerfCountsType = {
    svSync: {
        count: 0,
        sum: 0,
        buckets: Array(PERF_DATA_BUCKET_COUNT).fill(0),
    },
    svNetwork: {
        count: 0,
        sum: 0,
        buckets: Array(PERF_DATA_BUCKET_COUNT).fill(0),
    },
    svMain: {
        count: 0,
        sum: 0,
        buckets: Array(PERF_DATA_BUCKET_COUNT).fill(0),
    },
};

/**
 * Compares a perf snapshot with the one that came before
 * NOTE: I could just clone the old perf data, but this way I guarantee the shape of the data
 */
export const diffPerfs = (newPerf: SvRtPerfCountsType, oldPerf?: SvRtPerfCountsType) => {
    const basePerf = oldPerf ?? structuredClone(perfDataRawThreadsTemplate);
    return {
        svSync: {
            count: newPerf.svSync.count - basePerf.svSync.count,
            sum: newPerf.svSync.sum - basePerf.svSync.sum,
            buckets: newPerf.svSync.buckets.map((bucket, i) => bucket - basePerf.svSync.buckets[i]),
        },
        svNetwork: {
            count: newPerf.svNetwork.count - basePerf.svNetwork.count,
            sum: newPerf.svNetwork.sum - basePerf.svNetwork.sum,
            buckets: newPerf.svNetwork.buckets.map((bucket, i) => bucket - basePerf.svNetwork.buckets[i]),
        },
        svMain: {
            count: newPerf.svMain.count - basePerf.svMain.count,
            sum: newPerf.svMain.sum - basePerf.svMain.sum,
            buckets: newPerf.svMain.buckets.map((bucket, i) => bucket - basePerf.svMain.buckets[i]),
        },
    };
};

/**
 * Checks if any perf count/sum from any thread reset (if old > new)
 */
export const didPerfReset = (newPerf: SvRtPerfCountsType, oldPerf: SvRtPerfCountsType) => {
    return (
        oldPerf.svSync.count > newPerf.svSync.count ||
        oldPerf.svSync.sum > newPerf.svSync.sum ||
        oldPerf.svNetwork.count > newPerf.svNetwork.count ||
        oldPerf.svNetwork.sum > newPerf.svNetwork.sum ||
        oldPerf.svMain.count > newPerf.svMain.count ||
        oldPerf.svMain.sum > newPerf.svMain.sum
    );
};

/**
 * Transforms raw perf data into a frequency distribution (histogram)
 * ForEach thread, individualize tick counts (instead of CumSum) and calculates frequency
 */
// export const perfCountsToHist = (threads: SvRtPerfCountsType) => {
//     const currPerfFreqs: SvRtPerfHistType = {
//         svSync: {
//             count: threads.svSync.count,
//             freqs: [],
//         },
//         svNetwork: {
//             count: threads.svNetwork.count,
//             freqs: [],
//         },
//         svMain: {
//             count: threads.svMain.count,
//             freqs: [],
//         },
//     };
//     for (const [tName, tData] of Object.entries(threads)) {
//         currPerfFreqs[tName as SvRtPerfThreadNamesType].freqs = tData.buckets.map((bucketValue, bucketIndex) => {
//             const prevBucketValue = (bucketIndex) ? tData.buckets[bucketIndex - 1] : 0;
//             return (bucketValue - prevBucketValue) / tData.count;
//         });
//     }
//     return currPerfFreqs;
// }

/**
 * Returns got options with Basic Auth if sv_prometheusBasicAuth* convars are set.
 */
export const getPromAuthOpts = () => {
    const user = GetConvar('sv_prometheusBasicAuthUser', '');
    const password = GetConvar('sv_prometheusBasicAuthPassword', '');
    if (user && password) {
        return { username: user, password };
    }
    return undefined;
};

/**
 * Requests /perf/, parses it and returns the raw perf data
 */
export const fetchRawPerfData = async (netEndpoint: string) => {
    const authOpts = getPromAuthOpts();
    const currPerfRaw = await got(`http://${netEndpoint}/perf/`, authOpts).text();
    return parseRawPerf(currPerfRaw);
};

/**
 * Get the fxserver memory usage
 */
export const fetchFxsMemory = async (fxsPid?: number) => {
    if (!fxsPid) return;
    try {
        const data = await si.processes();
        const proc = data.list.find((p) => p.pid === fxsPid);
        if (!proc) return;
        const memoryMb = proc.mem_rss / 1024 / 1024;
        return parseFloat(memoryMb.toFixed(2));
    } catch (error) {
        if (!txCore.fxRunner.child?.isAlive) {
            console.error('Failed to get process memory: the server process is not running.');
        } else {
            console.error('Failed to get process memory usage.');
            console.verbose.dir(error);
        }
        return;
    }
};
