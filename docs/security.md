# Script Telemetry & Anti-Dump Security

sxPanel ships with two related in-game features:

- **Error telemetry**, built on [PocusSoftware/telemetry](https://github.com/PocusSoftware/telemetry) (LGPL-3.0-or-later, files in `resource/telemetry/`).
- **Anti-dump / script theft detection**, which flags players running injected code, dumpers or tools used to copy your scripts, and kicks or bans them through the normal sxPanel ban system (logged in the player's history, enforced on rejoin with HWID matching).

Both run inside the sxPanel resource. Nothing needs to be installed.

## What can and can't be protected

FiveM sends every client script and NUI file to the player's PC; it has to, to run them. No resource can stop a determined person from reading files that are already on their disk. What sxPanel does is **detect the tools and behaviour** used to dump and steal scripts while the player is connected, and remove them. Server-side scripts are never sent to clients and can't be dumped this way.

## Detections

| Detection               | Default | What triggers it                                                                                                                                                                                      |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `honeypotEvent`         | ban     | A client triggered a bait server event. These events are only referenced from decoy client code that nothing calls, so only someone reading dumped client scripts and firing events by hand trips it. |
| `injectedResource`      | ban     | The client is running a resource the server never sent it (executors and menus create these).                                                                                                         |
| `injectedResourceError` | ban     | Telemetry received a client script error blamed on a resource the server doesn't have.                                                                                                                |
| `resourceStopped`       | kick    | The client stopped a resource that is still running on the server (how dumpers/menus disable protections), or restarted sxPanel's client script. Server-side restarts are ignored for 30s.            |
| `heartbeatLost`         | kick    | sxPanel's client script stopped sending its heartbeat for 90s while the player's connection is otherwise alive.                                                                                       |
| `nuiDevtools`           | log     | The NUI devtools (`nui_devtools`), used to copy NUI html/js, were opened. Detected with a `debugger` pause, so it only fires while devtools are actually attached.                                    |
| `nuiForeignOrigin`      | log     | Another resource's NUI page called sxPanel's NUI callbacks.                                                                                                                                           |
| `telemetrySpam`         | log     | A client flooded the telemetry error event.                                                                                                                                                           |

Admins (anyone with an sxPanel admin account in-game) are only logged for every detection except `honeypotEvent`.

Every detection is printed to the server console, written to the **System Logs** (`Security Detection` action), and optionally sent to a Discord webhook.

## Configuration (`server.cfg`)

Use `set`, **never `setr`**: replicated convars can be read by every client.

```cfg
# Turn the whole module off
set sxp:security:enabled "true"

# Per-detection action: ban | kick | log | off
set sxp:security:action:resourceStopped "ban"
set sxp:security:action:nuiDevtools "kick"

# Ban length for security bans (same format as the panel: "2 days", "1 week", "permanent")
set sxp:security:banDuration "permanent"

# Only log admins instead of punishing them (honeypot still applies)
set sxp:security:exemptAdmins "true"

# Extra private bait events. The built-in names are public in the sxPanel source,
# so add a few of your own and reference them from decoy client code only you know about.
set sxp:security:honeypotEvents "myserver:admin:giveItem,myserver:bank:addMoney"

# Resources to never flag as injected/stopped (comma separated)
set sxp:security:ignoreResources ""

# Discord webhook for detections (falls back to the telemetry webhook)
set sxp:security:webhook "https://discord.com/api/webhooks/..."
```

## Error telemetry

Server-side script errors from every resource are captured automatically from the console. Client-side errors need the hook as the **first** client script of each resource you want to watch (the resource needs `lua54 'yes'`):

```lua
client_scripts {
    '@monitor/resource/telemetry/hook.lua', -- '@txadmin/...' on FXServer builds that name the resource txadmin
    'client.lua',
}
```

The upstream hook (`@telemetry/client/hook.lua`) works too. If the standalone `telemetry` resource is running, sxPanel stands down to avoid double reports.

Errors are delivered to the local server event `telemetry:error` (same shape as upstream) and to an optional webhook:

```lua
AddEventHandler('telemetry:error', function(entry)
    -- entry.side 'client' | 'server', entry.resource, entry.trace, entry.source (client only)
end)
```

```cfg
set sxp:telemetry:webhook "https://discord.com/api/webhooks/..."
set sxp:telemetry:enabled "true"
set sxp:telemetry:cooldown "1000"          # ms between reports per resource (and per player)
set sxp:telemetry:stackWait "50"           # ms to wait for the server stack trace
set sxp:telemetry:maxTraceLength "2000"
set sxp:telemetry:logClientErrors "true"
set sxp:telemetry:ignoreResources "noisy_res,other_res"
```

See the upstream README for the hook's limits (which callbacks are wrapped, error swallowing, etc.).
