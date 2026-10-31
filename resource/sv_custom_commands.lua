-- Prevent running in monitor mode
if not TX_SERVER_MODE then
    return
end

-- =============================================
--  Custom chat commands, managed from the web panel (Server > Chat Commands).
--  The definitions are pulled from sxPanel via intercom on start and whenever
--  the panel fires the `customCommandsChanged` event.
--  NOTE: FXServer has no way to unregister a command, so disabled/deleted
--  commands stay registered but become no-ops.
-- =============================================

local intercomUrl = 'http://' .. TX_LUACOMHOST .. '/intercom/customCommands'
local FETCH_RETRY_DELAY = 5000
local FETCH_MAX_ATTEMPTS = 6
local SUGGESTION_REQ_COOLDOWN = 5000

local commandsByName = {} -- name/alias => definition
local registeredNames = {} -- names already passed to RegisterCommand
local suggestedNames = {} -- [src] = { name = true } last suggestions sent to each player
local lastUses = {} -- [src] = { [cmdId] = gameTimer }
local lastSuggestionReq = {} -- [src] = gameTimer
local fetchGeneration = 0

--- Permission check that works even when the menu is disabled
---@param src number
---@param perm string
---@return boolean
local function hasCommandPerm(src, perm)
    if type(perm) ~= 'string' or perm == '' then
        return true
    end
    local admin = TX_ADMINS[tostring(src)]
    if not admin or type(admin.perms) ~= 'table' then
        return false
    end
    for _, p in pairs(admin.perms) do
        if p == 'all_permissions' or p == perm then
            return true
        end
    end
    return false
end

local function replyToPlayer(src, message)
    TriggerClientEvent('chat:addMessage', src, {
        color = { 255, 80, 80 },
        args = { 'sxPanel', message },
    })
end

--- Removes characters that would allow chaining extra console commands
local function sanitizeArg(str)
    return (tostring(str):gsub('[;\r\n]', ''))
end

--- Expands {source} {name} {args} and {1}..{9} placeholders
local function expandTemplate(template, src, args)
    local safeArgs = {}
    for i, v in ipairs(args) do
        safeArgs[i] = sanitizeArg(v)
    end
    local values = {
        source = tostring(src),
        name = sanitizeArg(GetPlayerName(src) or 'unknown'),
        args = table.concat(safeArgs, ' '),
    }
    return (template:gsub('{(%w+)}', function(key)
        local idx = tonumber(key)
        if idx then
            return safeArgs[idx] or ''
        end
        return values[key]
    end))
end

--- Returns true if the command is on cooldown for this player (and warns them)
local function isOnCooldown(src, cmd)
    local cooldownMs = (tonumber(cmd.cooldownSeconds) or 0) * 1000
    if cooldownMs <= 0 then
        return false
    end
    local key = tostring(src)
    lastUses[key] = lastUses[key] or {}
    local now = GetGameTimer()
    local last = lastUses[key][cmd.id]
    if last and now - last < cooldownMs then
        local secsLeft = math.ceil((cooldownMs - (now - last)) / 1000)
        replyToPlayer(src, ('Please wait %ds before using /%s again.'):format(secsLeft, cmd.name))
        return true
    end
    lastUses[key][cmd.id] = now
    return false
end

local function logUsage(src, cmd, detail)
    TriggerEvent('txsv:logger:menuEvent', src, 'customCommand', true, { name = cmd.name, detail = detail })
end

-- =============================================
-- MARK: Execution
-- =============================================
local actionRunners = {
    menuAction = function(src, cmd, args)
        if not TX_MENU_ENABLED then
            return replyToPlayer(src, 'This command requires the sxPanel menu to be enabled.')
        end
        -- The menu action re-validates permissions server-side when it fires its request
        TriggerClientEvent('txcl:customCommands:runMenuAction', src, cmd.action.actionId, args)
    end,

    chatMessage = function(src, cmd, args)
        local message = expandTemplate(cmd.action.message, src, args)
        local target = cmd.action.broadcast and -1 or src
        TriggerClientEvent('chat:addMessage', target, { multiline = true, args = { message } })
        if cmd.action.broadcast then
            logUsage(src, cmd, 'broadcast: ' .. message)
        end
    end,

    consoleCommand = function(src, cmd, args)
        local command = expandTemplate(cmd.action.command, src, args)
        logUsage(src, cmd, 'console: ' .. command)
        ExecuteCommand(command)
    end,

    serverEvent = function(src, cmd, args)
        logUsage(src, cmd, 'server event: ' .. cmd.action.eventName)
        TriggerEvent(cmd.action.eventName, src, args)
    end,

    clientEvent = function(src, cmd, args)
        TriggerClientEvent(cmd.action.eventName, src, args)
    end,
}

local function handleCommand(src, args, rawCommand)
    -- Console usage is not supported, those actions are all player-centric
    if src == 0 then
        return TxPrint('^3Custom chat commands can only be used in-game.')
    end

    local cmdName = string.lower(string.match(rawCommand or '', '^/?(%S+)') or '')
    local cmd = commandsByName[cmdName]
    if not cmd then
        return -- disabled or deleted
    end
    if not hasCommandPerm(src, cmd.permission) then
        return replyToPlayer(src, 'You do not have permission to use this command.')
    end
    if isOnCooldown(src, cmd) then
        return
    end

    local runner = actionRunners[cmd.action and cmd.action.type]
    if not runner then
        return TxPrintError('[CustomCommands] unknown action type for /' .. cmd.name)
    end
    DebugPrint(('[CustomCommands] #%d used /%s (%s)'):format(src, cmdName, cmd.action.type))
    local ok, err = pcall(runner, src, cmd, args)
    if not ok then
        TxPrintError(('[CustomCommands] /%s failed: %s'):format(cmd.name, tostring(err)))
    end
end

-- =============================================
-- MARK: Chat suggestions
-- =============================================
--- Sends the suggestions for the commands this player can use, and removes stale ones
local function syncSuggestions(src)
    local key = tostring(src)
    local previous = suggestedNames[key] or {}
    local current = {}
    local toAdd = {}
    for name, cmd in pairs(commandsByName) do
        if hasCommandPerm(src, cmd.permission) then
            current[name] = true
            toAdd[#toAdd + 1] = {
                name = '/' .. name,
                help = cmd.description ~= '' and cmd.description or ('Custom command /' .. cmd.name),
                params = type(cmd.params) == 'table' and cmd.params or {},
            }
        end
    end
    for name in pairs(previous) do
        if not current[name] then
            TriggerClientEvent('chat:removeSuggestion', src, '/' .. name)
        end
    end
    if #toAdd > 0 then
        TriggerClientEvent('chat:addSuggestions', src, toAdd)
    end
    suggestedNames[key] = current
end

local function syncAllSuggestions()
    for _, playerId in ipairs(GetPlayers()) do
        syncSuggestions(tonumber(playerId))
    end
end

-- Client asks once its chat resource is up (server pushes before that would be lost)
RegisterNetEvent('txsv:customCommands:requestSuggestions', function()
    local src = source
    local key = tostring(src)
    local now = GetGameTimer()
    if lastSuggestionReq[key] and now - lastSuggestionReq[key] < SUGGESTION_REQ_COOLDOWN then
        return
    end
    lastSuggestionReq[key] = now
    syncSuggestions(src)
end)

-- Permissions changed, resync that player (or everyone on a global invalidation)
AddEventHandler('txAdmin:events:adminAuth', function(data)
    if type(data) ~= 'table' then
        return
    end
    if data.netid == -1 then
        return syncAllSuggestions()
    end
    if type(data.netid) == 'number' and data.netid > 0 then
        syncSuggestions(data.netid)
    end
end)

AddEventHandler('playerDropped', function()
    local key = tostring(source)
    suggestedNames[key] = nil
    lastUses[key] = nil
    lastSuggestionReq[key] = nil
end)

-- =============================================
-- MARK: Loading definitions
-- =============================================
local function applyCommands(commands)
    local nextByName = {}
    local count = 0
    for _, cmd in ipairs(commands) do
        if type(cmd) == 'table' and cmd.enabled and type(cmd.name) == 'string' and type(cmd.action) == 'table' then
            count = count + 1
            local names = { cmd.name }
            for _, alias in ipairs(cmd.aliases or {}) do
                names[#names + 1] = alias
            end
            for _, name in ipairs(names) do
                nextByName[name] = cmd
                if not registeredNames[name] then
                    RegisterCommand(name, handleCommand, false)
                    registeredNames[name] = true
                end
            end
        end
    end
    commandsByName = nextByName
    DebugPrint(('[CustomCommands] loaded %d custom command(s)'):format(count))
    syncAllSuggestions()
end

local function fetchCommands(attempt)
    attempt = attempt or 1
    fetchGeneration = fetchGeneration + 1
    local generation = fetchGeneration
    local payload = json.encode({ txAdminToken = TX_LUACOMTOKEN })
    PerformHttpRequest(intercomUrl, function(httpCode, data)
        -- a newer fetch was started meanwhile, drop this result
        if generation ~= fetchGeneration then
            return
        end
        local resp = httpCode == 200 and json.decode(data or '') or nil
        if type(resp) ~= 'table' or type(resp.commands) ~= 'table' then
            if attempt < FETCH_MAX_ATTEMPTS then
                SetTimeout(FETCH_RETRY_DELAY, function()
                    if generation == fetchGeneration then
                        fetchCommands(attempt + 1)
                    end
                end)
            else
                TxPrintError(('[CustomCommands] failed to load commands (code %s)'):format(tostring(httpCode)))
            end
            return
        end
        applyCommands(resp.commands)
    end, 'POST', payload, { ['Content-Type'] = 'application/json' })
end

AddEventHandler('txAdmin:events:customCommandsChanged', function()
    fetchCommands()
end)

CreateThread(function()
    fetchCommands()
end)
