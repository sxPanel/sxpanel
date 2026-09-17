import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import useSWR from 'swr';

export default function TmpSwr() {
    const [counter, setCounter] = useState(0);
    const renderTime = Date.now();
    const swr = useSWR(
        `/whatever?counter=${counter}`,
        async () => {
            await new Promise((resolve) => setTimeout(resolve, 250));
            console.log('Request: ', `/whatever?counter=${counter}`);
            return {
                ts: renderTime,
                counter: counter,
                rand: Math.random().toString(36).substring(2, 8),
            };
        },
        {},
    );

    // const mut = useSWRMutation(`/whatever?counter=${counter}`, async (url: string) => {
    //     await new Promise((resolve) => setTimeout(resolve, 250));
    //     console.log('Request: ', `/whatever?counter=${counter}`, url);
    //     return {
    //         ts: renderTime,
    //         counter: 999,
    //         rand: 'aaa',
    //     };
    // });

    const isDataFresh = swr.data?.ts && renderTime - swr.data.ts < 1000;
    return (
        <div className="w-full">
            <div className="flex flex-col items-center justify-center gap-4">
                <p>Note how there is no useEffect to do swr.mutate() on counter change.</p>

                <div className="flex gap-3 font-mono tracking-wider">
                    <Button size={'sm'} onClick={() => setCounter((curr) => curr - 1)}>
                        --
                    </Button>
                    <div className="bg-primary text-primary-foreground min-w-[4ch] rounded-md px-2 py-1.5 text-center">
                        {counter}
                    </div>
                    <Button size={'sm'} onClick={() => setCounter((curr) => curr + 1)}>
                        ++
                    </Button>
                    {/* <Button size={'sm'} onClick={() => mut.trigger()}>mut</Button> */}
                </div>
                <table className="border text-left">
                    <tbody>
                        <tr>
                            <th className="border p-2">Data</th>
                            <td className="min-w-[8ch] border p-2 text-center">{swr.data?.counter}</td>
                        </tr>
                        <tr>
                            <th className="bg-muted border p-2">Rand</th>
                            <td className="bg-muted border p-2 text-center">{swr.data?.rand}</td>
                        </tr>
                        <tr>
                            <th className="border p-2">Status</th>
                            <td
                                className={cn(
                                    'border p-2 text-center',
                                    swr.data ? (isDataFresh ? 'bg-green-600' : 'bg-red-600') : 'bg-gray-600',
                                    swr.data ? 'opacity-100' : 'opacity-50',
                                )}
                            >
                                {swr.data ? (isDataFresh ? 'Fresh' : 'Stale') : ''}
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div>{JSON.stringify(swr.data)}</div>
            </div>
        </div>
    );
}
