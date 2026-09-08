const HIDDEN_SYSTEM_COMMANDS = new Set(['txaReportResources']);
const HIDDEN_SYSTEM_COMMAND_PREFIXES = ['txaEvent "consoleCommand"', 'txaInitialData '];

export const shouldSkipSystemCommandLog = (cmd: string) => {
    return (
        HIDDEN_SYSTEM_COMMANDS.has(cmd.trimEnd()) ||
        HIDDEN_SYSTEM_COMMAND_PREFIXES.some((prefix) => cmd.startsWith(prefix))
    );
};
