-- Copyright (C) 2026 enty@pocus.software. LGPL-3.0-or-later, see LICENSE.
-- Adapted from https://github.com/PocusSoftware/telemetry (server/main.lua @ 246f562) for sxPanel:
--   - config comes from convars instead of server/config.lua
--   - client errors blamed on a resource the server does not have are forwarded to the
--     security module (sv_security.lua) instead of being dropped silently
--   - stands down while the standalone `telemetry` resource is running, to avoid double reports

if not TX_SERVER_MODE then
    return
end
if type(TX_EVENT_HANDLERS) ~= 'table' then
    return
end

local STANDALONE_RESOURCE <const> = 'telemetry'
local CLIENT_EVENT <const> = 'telemetry:clientError'
local ERROR_EVENT <const> = 'telemetry:error'
local ERROR_MARK <const> = 'SCRIPT ERROR'
local CLIENT_TAG <const> = '[client error]'
local SCRIPT_CHANNEL <const> = '^script:([^:]+)$' -- script:<resource>:warning is skipped
local MAX_RESOURCE_LENGTH <const> = 64
local DISCORD_LIMIT <const> = 1900
local FENCE_OVERHEAD <const> = 10
local UNSAFE_CHARS <const> = '[%c\127]'

-- Reports dropped by the throttle inside this window count towards spam detection
local SPAM_WINDOW_MS <const> = 60000
local SPAM_THRESHOLD <const> = 60

local function parseIgnoreList(raw)
    local list = {}
    for name in raw:gmatch('[^,%s]+') do
        list[name] = true
    end
    return list
end

local config <const> = {
    enabled = GetConvarBool('sxp:telemetry:enabled', true),
    cooldown = GetConvarInt('sxp:telemetry:cooldown', 1000),
    stackWait = GetConvarInt('sxp:telemetry:stackWait', 50),
    maxTraceLength = GetConvarInt('sxp:telemetry:maxTraceLength', 2000),
    logClientErrors = GetConvarBool('sxp:telemetry:logClientErrors', true),
    ignoreResources = parseIgnoreList(GetConvar('sxp:telemetry:ignoreResources', '')),
}

if not config.enabled then
    return
end

local function standaloneRunning()
    return GetResourceState(STANDALONE_RESOURCE) == 'started'
end

local function getWebhookUrl()
    -- `set`, never `setr`: replicated convars are readable by every client
    local url = GetConvar('sxp:telemetry:webhook', '')
    if url == '' then
        url = GetConvar('telemetry:webhook', '')
    end
    return url
end

local clientSeen = {} ---@type table<integer, table<string, integer>>
local clientDrops = {} ---@type table<integer, { start: integer, count: integer }>
local serverSeen = {} ---@type table<string, integer>

local function isThrottled(seen, key)
    local now <const> = GetGameTimer()
    if now - (seen[key] or -config.cooldown) < config.cooldown then
        return true
    end
    seen[key] = now
    return false
end

local function keepWhitespace(char)
    return (char == '\n' or char == '\t') and char or ''
end

local function sanitize(text, maxLength, keepNewlines)
    text = text:sub(1, maxLength):gsub('%^%d', '')
    return (text:gsub(UNSAFE_CHARS, keepNewlines and keepWhitespace or ''))
end

local function sendWebhook(entry)
    local url <const> = getWebhookUrl()
    if not url:find('^https://') then
        return
    end

    local who = 'server'
    if entry.source then
        who = ('%s (%d)'):format(GetPlayerName(entry.source) or 'unknown', entry.source)
    end

    local header <const> = ('**%s error** in `%s` | %s\n'):format(entry.side, entry.resource, who)
    local trace <const> = entry.trace:gsub('```', "'''")
    local room <const> = DISCORD_LIMIT - #header - FENCE_OVERHEAD

    PerformHttpRequest(
        url,
        function() end,
        'POST',
        json.encode({
            content = ('%s```\n%s\n```'):format(header, trace:sub(1, room)),
            allowed_mentions = { parse = {} },
        }),
        { ['Content-Type'] = 'application/json' }
    )
end

local function emit(entry)
    TriggerEvent(ERROR_EVENT, entry)
    sendWebhook(entry)
end

--- Counts throttled reports so a client flooding the event gets noticed
local function trackDrop(src)
    local now <const> = GetGameTimer()
    local bucket = clientDrops[src]
    if not bucket or now - bucket.start > SPAM_WINDOW_MS then
        bucket = { start = now, count = 0 }
        clientDrops[src] = bucket
    end
    bucket.count = bucket.count + 1
    if bucket.count == SPAM_THRESHOLD and TxSecurityFlag then
        TxSecurityFlag(src, 'telemetrySpam', ('%d+ error reports in %ds'):format(SPAM_THRESHOLD, SPAM_WINDOW_MS / 1000))
    end
end

RegisterNetEvent(CLIENT_EVENT, function(payload)
    if GetInvokingResource() then
        return
    end
    if standaloneRunning() then
        return
    end
    local src <const> = tonumber(source)
    if not src or src <= 0 then
        return
    end

    if type(payload) ~= 'table' then
        return
    end
    if type(payload.resource) ~= 'string' or type(payload.trace) ~= 'string' then
        return
    end

    local resource <const> = sanitize(payload.resource, MAX_RESOURCE_LENGTH, false)
    local trace <const> = sanitize(payload.trace, config.maxTraceLength, true)

    -- A client cannot run code from a resource the server never sent it.
    -- An error "from" such a resource means injected code (executor, dumper, menu).
    if GetResourceState(resource) == 'missing' then
        if TxSecurityFlag then
            TxSecurityFlag(src, 'injectedResourceError', ('resource "%s": %s'):format(resource, trace:sub(1, 300)))
        end
        return
    end
    if config.ignoreResources[resource] then
        return
    end

    local seen = clientSeen[src]
    if not seen then
        seen = {}
        clientSeen[src] = seen
    end
    if isThrottled(seen, resource) then
        return trackDrop(src)
    end

    if config.logClientErrors then
        print(('^1%s %s (%d) in %s^7\n%s'):format(CLIENT_TAG, GetPlayerName(src) or 'unknown', src, resource, trace))
    end
    emit({ side = 'client', source = src, resource = resource, trace = trace })
end)

AddEventHandler('playerDropped', function()
    local src = tonumber(source)
    if src then
        clientSeen[src] = nil
        clientDrops[src] = nil
    end
end)

local pending

local function flush()
    local entry <const> = pending
    if not entry then
        return
    end
    pending = nil

    if config.ignoreResources[entry.resource] or isThrottled(serverSeen, entry.resource) then
        return
    end
    emit({ side = 'server', resource = entry.resource, trace = entry.text:sub(1, config.maxTraceLength) })
end

RegisterConsoleListener(function(channel, message)
    local resource <const> = channel:match(SCRIPT_CHANNEL)
    if not resource then
        return
    end

    local text <const> = message:gsub('%^%d', '')
    if text:find(CLIENT_TAG, 1, true) then
        return
    end

    if text:find(ERROR_MARK, 1, true) then
        if standaloneRunning() then
            return
        end
        flush()
        pending = { resource = resource, text = text }
        SetTimeout(config.stackWait, flush)
    elseif pending and pending.resource == resource and (text:find('^%s*>') or text:find('^stack traceback')) then
        pending.text = pending.text .. text
    end
end)

DebugPrint('Telemetry error listener ready.')
