-- =============================================
-- sv_security.lua — anti-dump / script theft detection
-- =============================================
-- Detections (id -> default action):
--   honeypotEvent         ban   client triggered a bait server event that legit code never fires
--   injectedResource      ban   client runs a resource the server never sent it
--   injectedResourceError ban   client reported a script error from such a resource (sv_telemetry.lua)
--   resourceStopped       kick  client stopped a resource the server still has running
--   heartbeatLost         kick  sxPanel's client script stopped answering (stopped / hooked)
--   nuiDevtools           log   NUI devtools opened (used to copy NUI html/js)
--   nuiForeignOrigin      log   NUI callback called from another resource's page
--   telemetrySpam         log   client flooded the error telemetry event
--
-- Actions: 'ban' | 'kick' | 'log' | 'off'. Override per detection with
--   set sxp:security:action:<detectionId> "<action>"
-- Admins are only logged, except for honeypotEvent.
-- =============================================
if not TX_SERVER_MODE then
    return
end
if type(TX_EVENT_HANDLERS) ~= 'table' then
    return
end

local SECURITY_AUTHOR <const> = 'sxPanel Security'
local VALID_ACTIONS <const> = { ban = true, kick = true, log = true, off = true }
local ACTION_RANK <const> = { off = 0, log = 1, kick = 2, ban = 3 }

local DEFAULT_ACTIONS <const> = {
    honeypotEvent = 'ban',
    injectedResource = 'ban',
    injectedResourceError = 'ban',
    resourceStopped = 'kick',
    heartbeatLost = 'kick',
    nuiDevtools = 'log',
    nuiForeignOrigin = 'log',
    telemetrySpam = 'log',
}

-- Bait events. Keep in sync with the decoys in cl_security.lua.
-- Server owners should add their own private names with `sxp:security:honeypotEvents`,
-- since this list is public in the sxPanel source.
local HONEYPOT_EVENTS <const> = {
    'txsv:admin:grantPermissions',
    'txsv:admin:setGroup',
    'txsv:dev:runCode',
    'txsv:resources:dumpFiles',
    'txsv:resources:getSource',
    'txsv:menu:giveMoney',
}

local HEARTBEAT_TIMEOUT_MS <const> = 90 * 1000
local HEARTBEAT_CHECK_MS <const> = 10 * 1000
-- Ignore client "resource stopped" reports this soon after the server itself changed the resource
local RESOURCE_CHANGE_GRACE_MS <const> = 30 * 1000
local REPORT_RATE_WINDOW_MS <const> = 10 * 1000
local REPORT_RATE_MAX <const> = 20
local DETAILS_MAX_LENGTH <const> = 500

-- =============================================
-- MARK: Config
-- =============================================
local function parseList(raw)
    local list = {}
    for item in raw:gmatch('[^,%s]+') do
        list[#list + 1] = item
    end
    return list
end

local securityEnabled = GetConvarBool('sxp:security:enabled', true)
local exemptAdmins = GetConvarBool('sxp:security:exemptAdmins', true)
local banDuration = GetConvar('sxp:security:banDuration', 'permanent')

local ignoredResources = {}
for _, name in ipairs(parseList(GetConvar('sxp:security:ignoreResources', ''))) do
    ignoredResources[name] = true
end

local function getAction(detection)
    local action = GetConvar('sxp:security:action:' .. detection, DEFAULT_ACTIONS[detection] or 'log')
    if not VALID_ACTIONS[action] then
        TxPrintError(('[Security] invalid action "%s" for %s, using "log"'):format(action, detection))
        return 'log'
    end
    return action
end

local function getWebhookUrl()
    local url = GetConvar('sxp:security:webhook', '')
    if url == '' then
        url = GetConvar('sxp:telemetry:webhook', '')
    end
    return url
end

-- =============================================
-- MARK: Helpers
-- =============================================
local punished = {} ---@type table<integer, boolean>
local loggedOnce = {} ---@type table<integer, table<string, boolean>>

local function isAdmin(src)
    return TX_ADMINS[tostring(src)] ~= nil
end

local function isValidPlayer(src)
    return type(src) == 'number' and src > 0 and GetPlayerName(src) ~= nil
end

local function sanitize(text)
    text = tostring(text or ''):sub(1, DETAILS_MAX_LENGTH)
    return (text:gsub('%^%d', ''):gsub('[%c\127]', ' '))
end

local function getIdentifierList(src)
    local ids = GetPlayerIdentifiers(src) or {}
    local out = {}
    for _, id in ipairs(ids) do
        if not id:find('^ip:') then
            out[#out + 1] = id
        end
    end
    return table.concat(out, ', ')
end

local function sendWebhook(src, detection, action, details)
    local url = getWebhookUrl()
    if not url:find('^https://') then
        return
    end
    local content = ('**[sxPanel Security]** `%s` -> **%s**\nPlayer: %s (#%d)\nIDs: %s\n```\n%s\n```'):format(
        detection,
        action,
        GetPlayerName(src) or 'unknown',
        src,
        getIdentifierList(src),
        details:gsub('```', "'''")
    )
    PerformHttpRequest(
        url,
        function() end,
        'POST',
        json.encode({
            content = content:sub(1, 1990),
            allowed_mentions = { parse = {} },
        }),
        { ['Content-Type'] = 'application/json' }
    )
end

--- Flags a player for a detection and applies the configured action.
--- Global so sv_telemetry.lua (and other monitor files) can report detections.
---@param src number
---@param detection string
---@param details string|nil
function TxSecurityFlag(src, detection, details)
    if not securityEnabled then
        return
    end
    src = tonumber(src)
    if not src or not isValidPlayer(src) or punished[src] then
        return
    end

    local action = getAction(detection)
    if action == 'off' then
        return
    end
    if exemptAdmins and detection ~= 'honeypotEvent' and isAdmin(src) then
        action = 'log'
    end

    -- Log-only detections are reported once per player per session to avoid spam
    if action == 'log' then
        loggedOnce[src] = loggedOnce[src] or {}
        if loggedOnce[src][detection] then
            return
        end
        loggedOnce[src][detection] = true
    end

    details = sanitize(details)
    local playerName = GetPlayerName(src) or 'unknown'
    TxPrintError(('[Security] %s (#%d) flagged for %s -> %s: %s'):format(playerName, src, detection, action, details))
    sendWebhook(src, detection, action, details)

    if ACTION_RANK[action] >= ACTION_RANK.kick then
        punished[src] = true
    end

    -- Core logs the detection, and for kick/ban registers it in the player's history
    PrintStructuredTrace(json.encode({
        type = 'txAdminSecurityDetection',
        detection = detection,
        action = action,
        targetNetId = src,
        details = details,
        duration = banDuration,
        author = SECURITY_AUTHOR,
    }))

    -- Fallback: make sure the player is removed even if core can't process the trace
    if action == 'kick' or action == 'ban' then
        SetTimeout(5000, function()
            if GetPlayerName(src) ~= nil then
                DropPlayer(src, '[sxPanel] Security violation detected (' .. detection .. ').')
            end
        end)
    end
end

-- Per-player rate limit for client security reports
local reportBuckets = {} ---@type table<integer, { start: integer, count: integer }>
local function isReportRateLimited(src)
    local now = GetGameTimer()
    local bucket = reportBuckets[src]
    if not bucket or now - bucket.start > REPORT_RATE_WINDOW_MS then
        reportBuckets[src] = { start = now, count = 1 }
        return false
    end
    bucket.count = bucket.count + 1
    return bucket.count > REPORT_RATE_MAX
end

--- Common guard for client -> server security events
local function getReportingPlayer()
    if GetInvokingResource() then
        return nil
    end
    local src = tonumber(source)
    if not src or not isValidPlayer(src) then
        return nil
    end
    if isReportRateLimited(src) then
        return nil
    end
    return src
end

local function isIgnoredResource(name)
    return ignoredResources[name] or name:find('^_cfx') ~= nil
end

-- =============================================
-- MARK: Honeypot events
-- =============================================
local function registerHoneypot(eventName)
    RegisterNetEvent(eventName, function(...)
        if GetInvokingResource() then
            return
        end
        local src = tonumber(source)
        if not src or not isValidPlayer(src) then
            return
        end
        local okArgs, args = pcall(json.encode, { ... })
        TxSecurityFlag(src, 'honeypotEvent', ('event "%s" args: %s'):format(eventName, okArgs and args or '?'))
    end)
end

for _, eventName in ipairs(HONEYPOT_EVENTS) do
    registerHoneypot(eventName)
end
for _, eventName in ipairs(parseList(GetConvar('sxp:security:honeypotEvents', ''))) do
    registerHoneypot(eventName)
end

-- =============================================
-- MARK: Resource tracking
-- =============================================
local serverResourceChangedAt = {} ---@type table<string, integer>
local function markResourceChange(resName)
    serverResourceChangedAt[resName] = GetGameTimer()
end
AddEventHandler('onResourceStart', markResourceChange)
AddEventHandler('onResourceStarting', markResourceChange)
AddEventHandler('onResourceStop', markResourceChange)

local function changedRecently(resName)
    local changedAt = serverResourceChangedAt[resName]
    return changedAt ~= nil and GetGameTimer() - changedAt < RESOURCE_CHANGE_GRACE_MS
end

--- Client sends the names of resources running on its side
RegisterNetEvent('txsv:security:resources', function(resourceNames)
    local src = getReportingPlayer()
    if not src or type(resourceNames) ~= 'table' then
        return
    end

    local count = 0
    for _, name in pairs(resourceNames) do
        count = count + 1
        if count > 2048 then
            break
        end
        if type(name) == 'string' and #name > 0 and #name <= 128 and not isIgnoredResource(name) then
            if GetResourceState(name) == 'missing' then
                TxSecurityFlag(src, 'injectedResource', ('client is running unknown resource "%s"'):format(name))
                return
            end
        end
    end
end)

--- Client reports that a resource stopped on its side
RegisterNetEvent('txsv:security:resourceStopped', function(resName)
    local src = getReportingPlayer()
    if not src or type(resName) ~= 'string' or #resName > 128 then
        return
    end
    if isIgnoredResource(resName) or changedRecently(resName) then
        return
    end
    -- The server stopping/restarting a resource also stops it on clients: only flag running ones
    if GetResourceState(resName) ~= 'started' then
        return
    end
    TxSecurityFlag(src, 'resourceStopped', ('client stopped resource "%s" while it runs on the server'):format(resName))
end)

-- =============================================
-- MARK: Heartbeat
-- =============================================
local heartbeats = {} ---@type table<integer, { nonce: string, last: integer, confirmed: boolean }>

local function newNonce()
    return ('%08x%08x'):format(math.random(0, 0x7fffffff), math.random(0, 0x7fffffff))
end

RegisterNetEvent('txsv:security:hello', function()
    local src = getReportingPlayer()
    if not src then
        return
    end
    -- A second hello after the session started means the client script restarted.
    -- Only possible when the server restarted the monitor (all state reset), otherwise it's tampering.
    local existing = heartbeats[src]
    local nonce = newNonce()
    heartbeats[src] = { nonce = nonce, last = GetGameTimer(), confirmed = false }
    if existing and existing.confirmed and not changedRecently(TX_RESOURCE_NAME) then
        TxSecurityFlag(src, 'resourceStopped', 'sxPanel client script was restarted by the client')
    end
    TriggerClientEvent('txcl:security:nonce', src, nonce)
end)

RegisterNetEvent('txsv:security:hb', function(nonce)
    local src = getReportingPlayer()
    if not src then
        return
    end
    local hb = heartbeats[src]
    if hb and nonce == hb.nonce then
        hb.last = GetGameTimer()
        hb.confirmed = true
    end
end)

CreateThread(function()
    while true do
        Wait(HEARTBEAT_CHECK_MS)
        if securityEnabled then
            local now = GetGameTimer()
            for src, hb in pairs(heartbeats) do
                if GetPlayerName(src) == nil then
                    heartbeats[src] = nil
                elseif hb.confirmed and now - hb.last > HEARTBEAT_TIMEOUT_MS and GetPlayerLastMsg(src) < 5000 then
                    -- Still sending network traffic, but the security script went silent
                    heartbeats[src] = nil
                    TxSecurityFlag(
                        src,
                        'heartbeatLost',
                        ('no security heartbeat for %ds'):format(math.floor((now - hb.last) / 1000))
                    )
                end
            end
        end
    end
end)

-- =============================================
-- MARK: NUI reports
-- =============================================
RegisterNetEvent('txsv:security:nuiReport', function(kind, info)
    local src = getReportingPlayer()
    if not src then
        return
    end
    if kind == 'devtools' then
        TxSecurityFlag(src, 'nuiDevtools', 'NUI devtools were opened')
    elseif kind == 'foreignOrigin' then
        TxSecurityFlag(src, 'nuiForeignOrigin', ('NUI callback from origin %s'):format(tostring(info)))
    end
end)

-- =============================================
-- MARK: Cleanup & status
-- =============================================
AddEventHandler('playerDropped', function()
    local src = tonumber(source)
    if not src then
        return
    end
    punished[src] = nil
    loggedOnce[src] = nil
    reportBuckets[src] = nil
    heartbeats[src] = nil
end)

-- Make sure the server has a fresh state for the monitor resource itself on (re)start
markResourceChange(TX_RESOURCE_NAME)

if securityEnabled then
    TxPrint('Security module enabled (anti-dump / injection detection).')
else
    TxPrint('^3Security module disabled via sxp:security:enabled.')
end
