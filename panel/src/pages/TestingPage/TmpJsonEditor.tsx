import { useState, useEffect, useRef } from 'react';
import { LazyMonacoEditor } from '@/components/LazyMonacoEditor';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Save, RotateCcw, ChevronRight, ChevronLeft, XIcon, Settings2Icon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import TxAnchor from '@/components/TxAnchor';
import InlineCode from '@/components/InlineCode';
import { PageHeader } from '@/components/page-header';
import { emsg } from '@shared/emsg';

const beautifyJson = (json: string) => JSON.stringify(JSON.parse(json), null, 4);

type SheetBackdropProps = {
    isOpen: boolean;
    closeSheet: () => void;
};

function SheetBackdrop({ isOpen, closeSheet }: SheetBackdropProps) {
    return (
        <button
            type="button"
            aria-label="Close JSON editor panel"
            className={cn(
                'absolute inset-0 z-20',
                'bg-black/60 duration-300',
                'data-[state=closed]:pointer-events-none data-[state=open]:pointer-events-auto',
                'data-[state=open]:opacity-100',
                'data-[state=closed]:opacity-0',
            )}
            data-state={isOpen ? 'open' : 'closed'}
            onClick={closeSheet}
        />
    );
}

interface JSONConfigEditorProps {
    description: React.ReactNode;
    initialConfig?: string;
    defaultConfig: string;
    onSave: (config: string) => void;
    onBack: () => void;
    placeholders: Record<string, string>;
}

function DiscordJsonEditor({
    initialConfig = '{}',
    defaultConfig,
    onSave,
    onBack,
    description,
    placeholders,
}: JSONConfigEditorProps) {
    const initialConfigRef = useRef(initialConfig);
    const [config, setConfig] = useState(initialConfigRef.current);
    const [error, setError] = useState<string | null>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);

    useEffect(() => {
        try {
            JSON.parse(config);
            setError(null);
        } catch (e) {
            setError('Invalid JSON: ' + emsg(e));
        }
    }, [config]);

    const handleSave = () => {
        setError('Invalid JSON: xxx');
        // if (!error) {
        //     onSave(config)
        // }
    };

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            {/* <div className="px-2 md:px-0">
                {description} <br />
                <span className="text-muted-foreground italic">
                    TIP: You can also drag and drop to reorder the list. <br />
                </span>
            </div> */}
            <div className="mb-4 flex-none space-y-2">
                <div className="flex items-start justify-between">
                    <p className="text-muted-foreground">{description}</p>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsPanelOpen(!isPanelOpen)}
                        className="ml-4 flex-none"
                    >
                        {isPanelOpen ? 'Hide Placeholders' : 'Show Placeholders'}
                        {isPanelOpen ? (
                            <ChevronRight className="ml-2 size-4" />
                        ) : (
                            <ChevronLeft className="ml-2 size-4" />
                        )}
                    </Button>
                </div>
            </div>

            {/* Main Content */}
            <div className="relative flex-1 overflow-hidden rounded-xl border bg-[#1E1E1E]">
                {/* Overlay Panel */}
                <div className="absolute inset-0 rounded-[inherit]">
                    <SheetBackdrop isOpen={isPanelOpen} closeSheet={() => setIsPanelOpen(false)} />
                    <div
                        className={cn(
                            'z-20',
                            'bg-card absolute top-0 right-0 h-full w-80 border-l shadow-xl',
                            'transition-transform duration-300 ease-in-out',
                            isPanelOpen ? 'translate-x-0' : 'translate-x-full',
                        )}
                    >
                        <ScrollArea className="h-full">
                            <div className="mr-4 space-y-2 p-4">
                                <h3 className="text-lg font-semibold">Available Placeholders</h3>
                                <ul className="space-y-4">
                                    {Object.entries(placeholders).map(([pString, pDesc]) => (
                                        <li key={pString}>
                                            <InlineCode className="text-secondary-foreground bg-secondary/50 mb-1 block rounded-md border py-1">
                                                {`{{${pString}}}`}
                                            </InlineCode>
                                            {/* <div className="font-mono text-lg bg-secondary/35 border rounded-lg px-2 py-1">{`{{${pString}}}`}</div> */}
                                            <span className="text-muted-foreground text-sm">{pDesc}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </ScrollArea>
                    </div>
                </div>
                {/* Editor */}
                <LazyMonacoEditor
                    height="100%"
                    defaultLanguage="json"
                    value={config}
                    onChange={(value) => setConfig(value || '')}
                    options={{
                        automaticLayout: true,
                        minimap: { enabled: false },
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        wordWrap: 'on',
                    }}
                />
            </div>

            {/* Footer */}
            <div className="mt-4 flex-none">
                {error && (
                    <Alert variant="destructive" className="mb-4">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                <div className="flex justify-between">
                    <Button variant="outline" onClick={onBack}>
                        <ArrowLeft className="mr-2 size-4" /> Back
                    </Button>
                    <div className="space-x-2">
                        <Button variant="outline" onClick={() => setConfig(initialConfigRef.current)}>
                            <XIcon className="mr-2 size-4" /> Discard Changes
                        </Button>
                        <Button variant="outline" onClick={() => setConfig(defaultConfig)}>
                            <RotateCcw className="mr-2 size-4" /> Reset to Default
                        </Button>
                        <Button onClick={handleSave} disabled={!!error}>
                            <Save className="mr-2 size-4" /> Save Changes
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

const placeholderDescriptions = {
    serverCfxId: 'The Cfx.re id of your server, this is tied to your `sv_licenseKey` and detected at runtime.',
    serverJoinUrl: 'The direct join URL of your server. Example: `https://cfx.re/join/xxxxxx`.',
    serverBrowserUrl:
        'The FiveM Server browser URL of your server. Example: `https://servers.fivem.net/servers/detail/xxxxxx`.',
    serverClients: 'The number of players online in your server.',
    serverMaxClients: 'The `sv_maxclients` of your server, detected at runtime.',
    serverName: 'This is the sxPanel-given name for this server. Can be changed in `sxPanel > Settings > Global`.',
    statusColor: 'A hex-encoded color, from the Config JSON.',
    statusString: 'A text to be displayed with the server status, from the Config JSON.',
    uptime: 'For how long is the server online. Example: `1 hr, 50 mins`.',
    nextScheduledRestart: 'String with when is the next scheduled restart. Example: `in 2 hrs, 48 mins`.',
};

// [TMP/TEST] This component is for temporary/testing purposes only. Not for production use.
export default function TmpJsonEditor() {
    return (
        <div className="max-h-contentvh flex h-full w-full flex-col">
            <PageHeader icon={<Settings2Icon />} title="Embed Editor" parentName="Settings" parentLink="/settings" />
            <div className="xs:px-3 max-h-minx mx-auto h-32 w-full max-w-(--breakpoint-lg) grow px-0 md:px-0">
                <DiscordJsonEditor
                    defaultConfig={beautifyJson('{}')}
                    initialConfig={beautifyJson('{}')} //just for testing
                    placeholders={placeholderDescriptions}
                    onSave={(config) => console.log('Saved config:', config)}
                    onBack={() => console.log('Back')}
                    description={
                        <>
                            The server status embed is customizable by editing the JSON below. <br />
                            You can use the placeholders to include dynamic server information in the embed. <br />
                            For information refer to{' '}
                            <TxAnchor href="https://sxpanel.org/docs/v0.6.0-Beta/discord">our docs</TxAnchor>.
                        </>
                    }
                />
            </div>
        </div>
    );
}
