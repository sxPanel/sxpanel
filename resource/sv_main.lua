-- Prevent running in monitor mode
if not TX_SERVER_MODE then
    return
end

--Helpers
local function logError(x)
    TxPrint('^1' .. x)
end
-- function unDeQuote(x)
--     local new, count = string.gsub(x, utf8.char(0xFF02), '"')
--     return new
-- end
function ReplaceSemicolon(x)
    local new, count = string.gsub(x, utf8.char(0x037E), ';')
    return new
end

if TX_RESOURCE_NAME ~= 'monitor' and TX_RESOURCE_NAME ~= 'txadmin' then
    logError('This resource should not be installed separately, it already comes with fxserver.')
    return
end

-- =============================================
-- Command to trigger events from sxPanel core
-- =============================================
RegisterCommand('txaSendEvent', function(source, args)
    if source ~= 0 then return end
    if #args < 2 then
        TxPrint('^1txaSendEvent: missing arguments')
        return
    end

    local eventName = args[1]
    table.remove(args, 1)
    local jsonData = table.concat(args, ' ')

    local success, data = pcall(json.decode, jsonData)
    if not success then
        TxPrint('^1txaSendEvent: failed to decode JSON data')
        return
    end

    TriggerEvent(eventName, data)
end, true)

-- =============================================
-- MARK: Variables stuff
-- =============================================
TX_ADMINS = {}
TX_PLAYERLIST = {}

--- Normalizes player/server IDs to string keys (Lua treats t[1] and t["1"] as different).
function TxPlayerListKey(id)
    return tostring(id)
end
TX_LUACOMHOST = GetConvar('txAdmin-luaComHost', 'invalid')
TX_LUACOMTOKEN = GetConvar('txAdmin-luaComToken', 'invalid')
TX_VERSION = GetResourceMetadata(TX_RESOURCE_NAME, 'version', 0) -- for now, only used in the start print
TX_IS_SERVER_SHUTTING_DOWN = false

-- Checking convars
if TX_LUACOMHOST == 'invalid' or TX_LUACOMTOKEN == 'invalid' then
    TxPrint('^1API Host or Pipe Token ConVars not found. Do not start this resource if not using txAdmin.')
    return
end
if TX_LUACOMTOKEN == 'removed' then
    TxPrint('^1Please do not restart the monitor resource.')
    return
end

-- Erasing the token convar for security reasons, and then restoring it if debug mode.
-- The convar needs to be reset on first tick to prevent other resources from reading it.
-- We actually need to wait two frames: one for convar replication, one for DebugPrint.
SetConvar('txAdmin-luaComToken', 'removed')
CreateThread(function()
    Wait(0)
    if not TX_DEBUG_MODE then
        return
    end
    DebugPrint('Restoring txAdmin-luaComToken for next monitor restart')
    SetConvar('txAdmin-luaComToken', TX_LUACOMTOKEN)
end)

-- =============================================
-- MARK: Heartbeat functions
-- =============================================
local httpHbUrl = 'http://' .. TX_LUACOMHOST .. '/intercom/monitor'
local httpHbPayload = json.encode({ txAdminToken = TX_LUACOMTOKEN })
local hbReturnData = '{"error": "no data cached in sv_main.lua"}'
local function HTTPHeartBeat()
    PerformHttpRequest(httpHbUrl, function(httpCode, data, resultHeaders)
        local resp = tostring(data)
        if httpCode ~= 200 then
            hbReturnData = 'HeartBeat failed with code ' .. httpCode .. ' and message: ' .. resp
            logError(hbReturnData)
        else
            hbReturnData = resp
        end
    end, 'POST', httpHbPayload, { ['Content-Type'] = 'application/json' })
end

local fd3HbPayload = json.encode({ type = 'txAdminHeartBeat' })
local function FD3HeartBeat()
    PrintStructuredTrace(fd3HbPayload)
end

-- HTTP request handler
local notFoundResponse = json.encode({ error = 'route not found' })
local function handleHttp(req, res)
    res.writeHead(200, { ['Content-Type'] = 'application/json' })

    if req.path == '/stats.json' then
        return res.send(hbReturnData)
    else
        return res.send(notFoundResponse)
    end
end

-- =============================================
-- MARK: Commands
-- =============================================

--- Simple stdout reply just to make sure the resource is alive
--- this is only used in debug
local function txaPing(source, args)
    TxPrint('Pong! (txAdmin resource is running)')
    CancelEvent()
end

--- Get all resources/statuses and report back to txAdmin
local function txaReportResources(source, args)
    --Prepare resources list
    local resources = {}
    local max = GetNumResources() - 1
    for i = 0, max do
        local resName = GetResourceByFindIndex(i)
        local currentRes = {
            name = resName,
            status = GetResourceState(resName),
            author = GetResourceMetadata(resName, 'author', 0),
            version = GetResourceMetadata(resName, 'version', 0),
            description = GetResourceMetadata(resName, 'description', 0),
            path = GetResourcePath(resName),
        }

        resources[#resources + 1] = currentRes
    end

    --Send to txAdmin
    local url = 'http://' .. TX_LUACOMHOST .. '/intercom/resources'
    local exData = {
        txAdminToken = TX_LUACOMTOKEN,
        resources = resources,
    }
    TxPrint('Sending resources list to sxPanel.')
    PerformHttpRequest(url, function(httpCode, data, resultHeaders)
        local resp = tostring(data)
        if httpCode ~= 200 then
            logError('ReportResources failed with code ' .. httpCode .. ' and message: ' .. resp)
        end
    end, 'POST', json.encode(exData), { ['Content-Type'] = 'application/json' })
end

--- Setter for the txAdmin-debugMode convar and TX_DEBUG_MODE global variable
local function txaSetDebugMode(source, args)
    -- prevent execution from admins or resources
    if source ~= 0 or GetInvokingResource() ~= nil then
        return
    end
    -- validating argument
    if args[1] == nil then
        return
    end

    -- changing mode
    if args[1] == '1' then
        TX_DEBUG_MODE = true
        TxPrint('^1!! Debug Mode enabled via console !!')
    elseif args[1] == '0' then
        TX_DEBUG_MODE = false
        TxPrint('^1!! Debug Mode disabled via console !!')
    else
        TxPrint("^1!! txaSetDebugMode only accepts '1' or '0' as input. !!")
    end
    SetConvarReplicated('txAdmin-debugMode', tostring(TX_DEBUG_MODE))
    TriggerClientEvent('txcl:setDebugMode', -1, TX_DEBUG_MODE)
end

-- =============================================
-- MARK: Events handling
-- =============================================
local txServerName = GetConvar('txAdmin-serverName', 'txAdmin')
local cvHideAdminInPunishments = GetConvarBool('txAdmin-hideAdminInPunishments')
local cvHideAdminInMessages = GetConvarBool('txAdmin-hideAdminInMessages')
local cvHideAnnouncement = GetConvarBool('txAdmin-hideDefaultAnnouncement')
local cvHideDirectMessage = GetConvarBool('txAdmin-hideDefaultDirectMessage')
local cvHideWarning = GetConvarBool('txAdmin-hideDefaultWarning')
local cvHideScheduledRestartWarning = GetConvarBool('txAdmin-hideDefaultScheduledRestartWarning')

--- Refreshes cached notification convars after sxPanel pushes updated settings.
local function refreshNotificationConvars()
    txServerName = GetConvar('txAdmin-serverName', 'txAdmin')
    cvHideAdminInPunishments = GetConvarBool('txAdmin-hideAdminInPunishments')
    cvHideAdminInMessages = GetConvarBool('txAdmin-hideAdminInMessages')
    cvHideAnnouncement = GetConvarBool('txAdmin-hideDefaultAnnouncement')
    cvHideDirectMessage = GetConvarBool('txAdmin-hideDefaultDirectMessage')
    cvHideWarning = GetConvarBool('txAdmin-hideDefaultWarning')
    cvHideScheduledRestartWarning = GetConvarBool('txAdmin-hideDefaultScheduledRestartWarning')
end

AddEventHandler('txAdmin:events:configChanged', refreshNotificationConvars)
-- Adding all known events to the list so txaEvent can do whitelist checking
TX_EVENT_HANDLERS = {
    -- Handled by another file
    adminsUpdated = false, -- sv_admins.lua
    configChanged = false, -- sv_ctx.lua
    customCommandsChanged = false, -- sv_custom_commands.lua

    -- Known NO-OP
    actionRevoked = false,
    adminAuth = false,
    consoleCommand = false,
    playerHealed = false,
    webPlayerHealed = false,
    webSpectatePlayer = false,
    webScreenshotPlayer = false,
    webLiveSpectateStart = false,
    webLiveSpectateStop = false,
    playerWhitelisted = false,
    scheduledRestartSkipped = false,
    whitelistPlayer = false,
    whitelistPreApproval = false,
    whitelistRequest = false,
}

local isBridgingLegacyHealedPlayer = false

function TxAdminNotifyPlayerHealed(target, author)
    isBridgingLegacyHealedPlayer = true
    local ok, err = pcall(function()
        TriggerEvent('txAdmin:events:healedPlayer', {
            id = target,
            target = target,
            author = author or 'unknown',
        })
    end)
    isBridgingLegacyHealedPlayer = false

    if not ok then
        TxPrintError('[txAdmin:events:healedPlayer] failed to emit legacy event', err)
    end

    TriggerEvent('txAdmin:events:playerHealed', {
        target = target,
        author = author or 'unknown',
    })
end

AddEventHandler('txAdmin:events:healedPlayer', function(eventData)
    if isBridgingLegacyHealedPlayer then
        return
    end
    if type(eventData) ~= 'table' then
        return TxPrintError('[txAdmin:events:healedPlayer] invalid eventData', eventData)
    end

    local target = eventData.id
    if type(target) ~= 'number' then
        target = eventData.target
    end
    if type(target) ~= 'number' then
        return TxPrintError('[txAdmin:events:healedPlayer] invalid eventData', eventData)
    end

    isBridgingLegacyHealedPlayer = true
    local ok, err = pcall(function()
        TriggerEvent('txAdmin:events:playerHealed', {
            target = target,
            author = eventData.author or 'unknown',
        })
    end)
    isBridgingLegacyHealedPlayer = false

    if not ok then
        TxPrintError('[txAdmin:events:healedPlayer] failed to bridge legacy event', err)
    end
end)
local function requestPlayerTagChange(action, serverId, tagId)
    serverId = tonumber(serverId)
    if type(serverId) ~= 'number' or type(tagId) ~= 'string' then
        return false, 'serverId must be a number and tagId must be a string'
    end
    tagId = string.lower(tagId)
    if tagId == '' then
        return false, 'tagId cannot be empty'
    end
    if TX_LUACOMHOST == 'invalid' or TX_LUACOMTOKEN == 'invalid' then
        return false, 'sxPanel intercom is not configured'
    end

    local intercomUrl = 'http://' .. TX_LUACOMHOST .. '/intercom/playerTag'
    local requestBody = json.encode({
        txAdminToken = TX_LUACOMTOKEN,
        action = action,
        netId = serverId,
        tagId = tagId,
    })

    local completed = false
    local succeeded = false
    local failureReason = 'intercom request timed out'

    PerformHttpRequest(intercomUrl, function(httpCode, rawData)
        if httpCode ~= 200 then
            failureReason = 'intercom HTTP ' .. tostring(httpCode) .. ': ' .. tostring(rawData)
            completed = true
            return
        end
        local resp = json.decode(rawData or '')
        if type(resp) == 'table' and resp.success == true then
            succeeded = true
            completed = true
            return
        end
        failureReason = type(resp) == 'table' and resp.error or tostring(rawData)
        completed = true
    end, 'POST', requestBody, { ['Content-Type'] = 'application/json' })

    local deadline = GetGameTimer() + 5000
    while not completed and GetGameTimer() < deadline do
        Wait(0)
    end

    if not succeeded then
        TxPrintError('[playerTag]', failureReason)
        return false, failureReason
    end

    return true
end

--- Export: add a custom tag to a player (persisted in DB)
--- @param serverId number The player's server ID (GetPlayers() returns strings — use tonumber)
--- @param tagId string The custom tag ID (must be defined in sxPanel settings)
--- @return boolean success
exports('addPlayerTag', function(serverId, tagId)
    local ok, err = requestPlayerTagChange('add', serverId, tagId)
    if not ok then
        TxPrintError('[addPlayerTag]', err)
        return false
    end
    return true
end)

--- Export: remove a custom tag from a player (persisted in DB)
--- @param serverId number The player's server ID (GetPlayers() returns strings — use tonumber)
--- @param tagId string The custom tag ID to remove
--- @return boolean success
exports('removePlayerTag', function(serverId, tagId)
    local ok, err = requestPlayerTagChange('remove', serverId, tagId)
    if not ok then
        TxPrintError('[removePlayerTag]', err)
        return false
    end
    return true
end)

-- =============================================
-- MARK: Resource API Exports
-- Permission checking & admin info for external scripts
-- =============================================

--- Local helper: check if an admin entry has a specific permission
--- @param admin table The admin entry from TX_ADMINS
--- @param permission string The permission to check
--- @return boolean
local function adminHasPerm(admin, permission)
    if not admin or not admin.perms then return false end
    for _, perm in pairs(admin.perms) do
        if perm == 'all_permissions' or perm == permission then
            return true
        end
    end
    return false
end

--- Export: check if a player has a specific sxPanel permission
--- @param serverId number The player's server ID
--- @param permission string The permission to check (e.g. 'players.ban', 'players.kick')
--- @return boolean
exports('hasPermission', function(serverId, permission)
    if type(serverId) ~= 'number' or type(permission) ~= 'string' then
        TxPrintError('[hasPermission] invalid arguments: serverId must be number, permission must be string')
        return false
    end
    local admin = TX_ADMINS[tostring(serverId)]
    if not admin or not admin.perms then
        return false
    end
    return adminHasPerm(admin, permission)
end)

--- Export: check if a player is an sxPanel admin
--- @param serverId number The player's server ID
--- @return boolean
exports('isPlayerAdmin', function(serverId)
    if type(serverId) ~= 'number' then
        TxPrintError('[isPlayerAdmin] invalid arguments: serverId must be number')
        return false
    end
    return TX_ADMINS[tostring(serverId)] ~= nil
end)

--- Export: get an admin's username
--- @param serverId number The player's server ID
--- @return string|nil username or nil if not an admin
exports('getAdminUsername', function(serverId)
    if type(serverId) ~= 'number' then
        TxPrintError('[getAdminUsername] invalid arguments: serverId must be number')
        return nil
    end
    local admin = TX_ADMINS[tostring(serverId)]
    if admin then
        return admin.username
    end
    return nil
end)

--- Export: get an admin's permissions list
--- @param serverId number The player's server ID
--- @return table|nil Array of permission strings or nil if not an admin
exports('getAdminPermissions', function(serverId)
    if type(serverId) ~= 'number' then
        TxPrintError('[getAdminPermissions] invalid arguments: serverId must be number')
        return nil
    end
    local admin = TX_ADMINS[tostring(serverId)]
    if admin and admin.perms then
        local copy = {}
        for i, v in ipairs(admin.perms) do
            copy[i] = v
        end
        return copy
    end
    return nil
end)

--- Export: kick a player through sxPanel (logs to action history)
--- @param serverId number The admin's server ID (must have players.kick permission)
--- @param targetId number The target player's server ID
--- @param reason string|nil The kick reason
exports('kickPlayer', function(serverId, targetId, reason)
    if type(serverId) ~= 'number' or type(targetId) ~= 'number' then
        return TxPrintError('[kickPlayer] invalid arguments: serverId and targetId must be numbers')
    end
    local admin = TX_ADMINS[tostring(serverId)]
    if not admin then
        return TxPrintError('[kickPlayer] source player is not an admin')
    end
    if not adminHasPerm(admin, 'players.kick') then
        return TxPrintError('[kickPlayer] admin does not have players.kick permission')
    end
    PrintStructuredTrace(json.encode({
        type = 'txAdminCommandBridge',
        command = 'kick',
        author = TxAdminActionAuthor(admin),
        targetNetId = targetId,
        reason = type(reason) == 'string' and reason or translator.t('kick_messages.unknown_reason'),
    }))
    return true
end)

--- Export: ban a player through sxPanel (logs to action history)
--- @param serverId number The admin's server ID (must have players.ban permission)
--- @param targetId number The target player's server ID
--- @param reason string|nil The ban reason
--- @param duration string|nil The ban duration (e.g. '2 hours', '1 week', 'permanent'). Defaults to 'permanent'.
exports('banPlayer', function(serverId, targetId, reason, duration)
    if type(serverId) ~= 'number' or type(targetId) ~= 'number' then
        return TxPrintError('[banPlayer] invalid arguments: serverId and targetId must be numbers')
    end
    local admin = TX_ADMINS[tostring(serverId)]
    if not admin then
        return TxPrintError('[banPlayer] source player is not an admin')
    end
    if not adminHasPerm(admin, 'players.ban') then
        return TxPrintError('[banPlayer] admin does not have players.ban permission')
    end
    PrintStructuredTrace(json.encode({
        type = 'txAdminCommandBridge',
        command = 'ban',
        author = TxAdminActionAuthor(admin),
        targetNetId = targetId,
        reason = type(reason) == 'string' and reason or translator.t('kick_messages.unknown_reason'),
        duration = type(duration) == 'string' and duration or 'permanent',
    }))
    return true
end)

--- Export: warn a player through sxPanel (logs to action history)
--- @param serverId number The admin's server ID (must have players.warn permission)
--- @param targetId number The target player's server ID
--- @param reason string|nil The warn reason
exports('warnPlayer', function(serverId, targetId, reason)
    if type(serverId) ~= 'number' or type(targetId) ~= 'number' then
        return TxPrintError('[warnPlayer] invalid arguments: serverId and targetId must be numbers')
    end
    local admin = TX_ADMINS[tostring(serverId)]
    if not admin then
        return TxPrintError('[warnPlayer] source player is not an admin')
    end
    if not adminHasPerm(admin, 'players.warn') then
        return TxPrintError('[warnPlayer] admin does not have players.warn permission')
    end
    PrintStructuredTrace(json.encode({
        type = 'txAdminCommandBridge',
        command = 'warn',
        author = TxAdminActionAuthor(admin),
        targetNetId = targetId,
        reason = type(reason) == 'string' and reason or translator.t('kick_messages.unknown_reason'),
    }))
    return true
end)

--- Export: send a server-wide announcement through sxPanel
--- @param serverId number The admin's server ID (must have announcement permission)
--- @param message string The announcement message
exports('sendAnnouncement', function(serverId, message)
    if type(serverId) ~= 'number' or type(message) ~= 'string' then
        return TxPrintError('[sendAnnouncement] invalid arguments: serverId must be number, message must be string')
    end
    local admin = TX_ADMINS[tostring(serverId)]
    if not admin then
        return TxPrintError('[sendAnnouncement] source player is not an admin')
    end
    if not adminHasPerm(admin, 'announcement') then
        return TxPrintError('[sendAnnouncement] admin does not have announcement permission')
    end
    PrintStructuredTrace(json.encode({
        type = 'txAdminCommandBridge',
        command = 'announcement',
        author = TxAdminActionAuthor(admin),
        message = message,
    }))
    return true
end)

--- Handler for announcement events
--- Broadcast admin message to all players
TX_EVENT_HANDLERS.announcement = function(eventData)
    local authorName = cvHideAdminInMessages and txServerName or eventData.author or 'anonym'
    if not cvHideAnnouncement then
        TriggerClientEvent('txcl:showAnnouncement', -1, eventData.message, authorName)
    end
    TriggerEvent('txsv:logger:addChatMessage', 'tx', '(Broadcast) ' .. authorName, eventData.message)
end

--- Handler for scheduled restarts event
--- Broadcast through an announcement that the server will restart in XX minutes
TX_EVENT_HANDLERS.scheduledRestart = function(eventData)
    if not cvHideScheduledRestartWarning then
        TriggerClientEvent('txcl:showAnnouncement', -1, eventData.translatedMessage, 'txAdmin')
    end
    TriggerEvent('txsv:logger:addChatMessage', 'tx', '(Broadcast) txAdmin', eventData.translatedMessage)
end

--- Handler for player DM event
--- Sends a direct message from an admin to a player
TX_EVENT_HANDLERS.playerDirectMessage = function(eventData)
    local authorName = cvHideAdminInMessages and txServerName or eventData.author or 'anonym'
    if not cvHideDirectMessage then
        TriggerClientEvent('txcl:showDirectMessage', eventData.target, eventData.message, authorName)
    end
    TriggerEvent('txsv:logger:addChatMessage', 'tx', '(DM) ' .. authorName, eventData.message)
end

--- Handler for player kicked event
TX_EVENT_HANDLERS.playerKicked = function(eventData)
    Wait(0) -- give other resources a chance to read player data

    -- sanity check
    if
        type(eventData.target) ~= 'number'
        or type(eventData.reason) ~= 'string'
        or type(eventData.dropMessage) ~= 'string'
    then
        return TxPrintError('[playerKicked] invalid eventData', eventData)
    end

    -- kicking
    if eventData.target == -1 then
        TxPrint('Kicking everyone: ' .. eventData.reason)
        for _, pid in pairs(GetPlayers()) do
            DropPlayer(pid, '[sxPanel] ' .. eventData.dropMessage)
        end
    else
        TxPrint('Kicking: #' .. eventData.target .. ': ' .. eventData.reason)
        DropPlayer(eventData.target, '[sxPanel] ' .. eventData.dropMessage)
    end
end

--- Handler for player warned event
--- Warn specific player via server ID
TX_PENDING_WARNINGS = {}
TX_EVENT_HANDLERS.playerWarned = function(eventData, isWarningNew)
    if isWarningNew == nil then
        isWarningNew = true
    end
    if cvHideWarning then
        return
    end
    if eventData.targetNetId == nil then
        return
    end

    if not DoesPlayerExist(eventData.targetNetId) then
        TxPrint(
            string.format(
                '[handleWarnEvent] ignoring warning for disconnected player (#%s) %s',
                eventData.targetNetId,
                eventData.targetName
            )
        )
        return
    end

    TX_PENDING_WARNINGS[tostring(eventData.targetNetId)] = eventData.actionId
    local authorName = cvHideAdminInPunishments and txServerName or eventData.author or 'anonym'
    TriggerClientEvent(
        'txcl:showWarning',
        eventData.targetNetId,
        authorName,
        eventData.reason,
        eventData.actionId,
        isWarningNew
    )
    TxPrint(
        string.format('Warning player (#%s) %s for %s', eventData.targetNetId, eventData.targetName, eventData.reason)
    )
end

-- Event so the client can ack the warning
RegisterNetEvent('txsv:ackWarning', function(actionId)
    if TX_PENDING_WARNINGS[tostring(source)] == actionId then
        PrintStructuredTrace(json.encode({
            type = 'txAdminAckWarning',
            actionId = actionId,
        }))
        TX_PENDING_WARNINGS[tostring(source)] = nil
    end
end)

-- Remove any pending warnings when a player leaves
AddEventHandler('playerDropped', function()
    local srcStr = tostring(source)
    local pendingActionId = TX_PENDING_WARNINGS[srcStr]
    if pendingActionId ~= nil then
        TX_PENDING_WARNINGS[srcStr] = nil
        TxPrint(string.format('Player #%s left without accepting the warning [%s]', srcStr, pendingActionId))
    end
end)

--- Handler for the player banned event
--- Ban player(s) via netid or identifiers
TX_EVENT_HANDLERS.playerBanned = function(eventData)
    Wait(0) -- give other resources a chance to read player data
    local kickCount = 0
    for _, playerID in pairs(GetPlayers()) do
        local identifiers = GetPlayerIdentifiers(playerID)
        if identifiers ~= nil then
            local found = false
            for _, searchIdentifier in pairs(eventData.targetIds) do
                if found then
                    break
                end

                for _, playerIdentifier in pairs(identifiers) do
                    if searchIdentifier == playerIdentifier then
                        TxPrint('[handleBanEvent] Kicking #' .. playerID .. ': ' .. eventData.reason)
                        kickCount = kickCount + 1
                        DropPlayer(playerID, '[sxPanel] ' .. eventData.kickMessage)
                        found = true
                        break
                    end
                end
            end
        end
    end

    if kickCount == 0 then
        TxPrint('[handleBanEvent] No players found to kick')
    end
end

--- Handler for the imminent shutdown event
--- Kicks all players and lock joins in preparation for server shutdown
TX_EVENT_HANDLERS.serverShuttingDown = function(eventData)
    TxPrint('Server shutting down. Kicking all players.')
    TX_IS_SERVER_SHUTTING_DOWN = true
    local players = GetPlayers()
    for _, serverID in pairs(players) do
        DropPlayer(serverID, '[sxPanel] ' .. eventData.message)
    end
end

--- Handler for healing a player from the web panel
TX_EVENT_HANDLERS.webPlayerHealed = function(eventData)
    if type(eventData.target) ~= 'number' then
        return TxPrintError('[webPlayerHealed] invalid eventData', eventData)
    end
    if eventData.target == -1 then
        TxPrint('[webPlayerHealed] Healing all players (by ' .. (eventData.author or 'unknown') .. ')')
        TriggerClientEvent('txcl:heal', -1)
        TxAdminNotifyPlayerHealed(-1, eventData.author)
    else
        local ped = GetPlayerPed(eventData.target)
        if ped then
            TxPrint(
                '[webPlayerHealed] Healing #' .. eventData.target .. ' (by ' .. (eventData.author or 'unknown') .. ')'
            )
            TriggerClientEvent('txcl:heal', eventData.target)
            TxAdminNotifyPlayerHealed(eventData.target, eventData.author)
        else
            TxPrintError('[webPlayerHealed] Player #' .. eventData.target .. ' ped not found')
        end
    end
end

--- Handler for spectating a player from the web panel
--- Routes the spectate request to a connected admin's game client
TX_EVENT_HANDLERS.webSpectatePlayer = function(eventData)
    if type(eventData.target) ~= 'number' or type(eventData.adminName) ~= 'string' then
        return TxPrintError('[webSpectatePlayer] invalid eventData', eventData)
    end

    -- Find the admin's netid from the TX_ADMINS table
    local adminNetId = nil
    for netid, admin in pairs(TX_ADMINS) do
        if admin.username == eventData.adminName then
            adminNetId = tonumber(netid)
            break
        end
    end

    if not adminNetId or not DoesPlayerExist(adminNetId) then
        return TxPrintError('[webSpectatePlayer] Admin "' .. eventData.adminName .. '" is not connected in-game')
    end

    -- Use the same spectate logic the menu uses
    local targetPed = GetPlayerPed(eventData.target)
    if not targetPed then
        return TxPrintError('[webSpectatePlayer] Target player #' .. eventData.target .. ' ped not found')
    end

    -- Handle routing bucket mismatch
    local targetBucket = GetPlayerRoutingBucket(eventData.target)
    local srcBucket = GetPlayerRoutingBucket(adminNetId)
    local sourcePlayerStateBag = Player(adminNetId).state
    if srcBucket ~= targetBucket then
        if sourcePlayerStateBag.__spectateReturnBucket == nil then
            sourcePlayerStateBag.__spectateReturnBucket = srcBucket
        end
        SetPlayerRoutingBucket(adminNetId, targetBucket)
    end

    TxPrint(
        '[webSpectatePlayer] Admin "'
            .. eventData.adminName
            .. '" (#'
            .. adminNetId
            .. ') spectating #'
            .. eventData.target
    )
    TriggerClientEvent('txcl:spectate:start', adminNetId, eventData.target, GetEntityCoords(targetPed))
end

--- Pending screenshot requests mapping requestId -> target serverId
local pendingScreenshots = {}

--- Sends a screenshot result (success or error) to the core via intercom
local function sendScreenshotResult(requestId, payload)
    local intercomUrl = 'http://' .. TX_LUACOMHOST .. '/intercom/screenshotResult'
    payload.txAdminToken = TX_LUACOMTOKEN
    payload.requestId = requestId
    PerformHttpRequest(intercomUrl, function(httpCode)
        if httpCode ~= 200 then
            TxPrintError('[screenshot] intercom responded with HTTP ' .. tostring(httpCode))
        end
    end, 'POST', json.encode(payload), { ['Content-Type'] = 'application/json' })
end

--- Handler for taking a screenshot of a player's screen from the web panel
TX_EVENT_HANDLERS.webScreenshotPlayer = function(eventData)
    if type(eventData.target) ~= 'number' or type(eventData.requestId) ~= 'string' then
        return TxPrintError('[webScreenshotPlayer] invalid eventData', eventData)
    end

    TxPrint('[screenshot] Capturing screenshot of player #' .. eventData.target)
    pendingScreenshots[eventData.requestId] = eventData.target
    TriggerClientEvent('txcl:screenshot:request', eventData.target, eventData.requestId)
end

--- Receives screenshot data from the client via latent event
RegisterNetEvent('txsv:screenshot:result', function(requestId, data, errorMsg)
    local src = source
    if type(requestId) ~= 'string' then
        return
    end

    -- Validate that the source matches the expected target
    local expectedTarget = pendingScreenshots[requestId]
    if not expectedTarget then
        return TxPrintError('[screenshot] Received result for unknown requestId: ' .. requestId)
    end
    pendingScreenshots[requestId] = nil

    if expectedTarget ~= src then
        return TxPrintError('[screenshot] Source mismatch: expected #' .. expectedTarget .. ' got #' .. src)
    end

    if errorMsg then
        TxPrintError('[screenshot] Capture error: ' .. tostring(errorMsg))
        return sendScreenshotResult(requestId, {
            error = translator.t('screenshot_messages.capture_failed', { detail = tostring(errorMsg) }),
        })
    end

    if type(data) ~= 'string' or #data == 0 then
        return sendScreenshotResult(requestId, { error = translator.t('screenshot_messages.no_data') })
    end

    local filename = 'screenshot_' .. requestId .. '.txt'
    SaveResourceFile(GetCurrentResourceName(), filename, data, #data)
    sendScreenshotResult(requestId, { fileName = filename })
end)


-- =============================================
-- MARK: Live Spectate
-- =============================================

--- Active spectate sessions: sessionId -> target serverId
local activeSpectates = {}

--- Handler: start live spectate capture on a player
TX_EVENT_HANDLERS.webLiveSpectateStart = function(eventData)
    if type(eventData.target) ~= 'number' or type(eventData.sessionId) ~= 'string' then
        return TxPrintError('[webLiveSpectateStart] invalid eventData', eventData)
    end

    TxPrint('[spectate] Starting live spectate of player #' .. eventData.target .. ' (session: ' .. eventData.sessionId .. ')')
    activeSpectates[eventData.sessionId] = eventData.target
    TriggerClientEvent('txcl:spectate:stream:start', eventData.target, eventData.sessionId)
end

--- Handler: stop live spectate capture on a player
TX_EVENT_HANDLERS.webLiveSpectateStop = function(eventData)
    if type(eventData.target) ~= 'number' or type(eventData.sessionId) ~= 'string' then
        return TxPrintError('[webLiveSpectateStop] invalid eventData', eventData)
    end

    TxPrint('[spectate] Stopping live spectate of player #' .. eventData.target .. ' (session: ' .. eventData.sessionId .. ')')
    activeSpectates[eventData.sessionId] = nil
    TriggerClientEvent('txcl:spectate:stream:stop', eventData.target, eventData.sessionId)
end

--- Receives captured frames from the client and relays to core via intercom
RegisterNetEvent('txsv:spectate:frame', function(sessionId, frameData)
    local src = source
    if type(sessionId) ~= 'string' or type(frameData) ~= 'string' then return end

    local expectedTarget = activeSpectates[sessionId]
    if not expectedTarget or expectedTarget ~= src then return end

    local intercomUrl = 'http://' .. TX_LUACOMHOST .. '/intercom/spectateFrame'
    PerformHttpRequest(intercomUrl, function(httpCode)
        if httpCode ~= 200 then
            TxPrintError('[spectate] intercom responded with HTTP ' .. tostring(httpCode))
        end
    end, 'POST', json.encode({
        txAdminToken = TX_LUACOMTOKEN,
        sessionId = sessionId,
        frameData = frameData,
    }), { ['Content-Type'] = 'application/json' })
end)

--- Command that receives all incoming tx events and dispatches
--- it to the respective event handler
local function txaEvent(source, args)
    -- sanity check
    if type(args[1]) ~= 'string' or type(args[2]) ~= 'string' then
        return TxPrintError('[txaEvent] invalid argument types', type(args[1]), type(args[2]))
    end

    -- prevent execution from admins or resources
    if source ~= 0 then
        return TxPrintError('[txaEvent] unexpected source', source)
    end
    if GetInvokingResource() ~= nil then
        return TxPrintError('[txaEvent] unexpected invoking resource', GetInvokingResource())
    end

    -- processing event
    local eventName = args[1]
    local eventHandler = TX_EVENT_HANDLERS[eventName]
    if eventHandler == nil then
        return TxPrintError('[txaEvent] No event handler exists for "' .. eventName .. '" event')
    end
    local success, eventData = pcall(json.decode, ReplaceSemicolon(args[2]))
    if not success then
        return TxPrintError('[txaEvent] failed to decode eventData JSON')
    end
    if type(eventData) ~= 'table' then
        return TxPrintError('[txaEvent] invalid eventData', type(eventData))
    end

    -- print('~~~~~~~~~~~~~~~~~~~~~ txaEvent')
    -- print('Name:', eventName)
    -- print('Source:', json.encode(source))
    -- print('Resource:', json.encode(GetInvokingResource()))
    -- print('Data:', json.encode(eventData))
    -- print('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~')

    -- need to trigger the event first, call handler after
    TriggerEvent('txAdmin:events:' .. eventName, eventData)
    if eventHandler ~= false then
        eventHandler(eventData)
    end
end

-- =============================================
-- MARK: Player connecting handler
-- =============================================
local function handleConnections(name, setKickReason, d)
    -- if server is shutting down
    if TX_IS_SERVER_SHUTTING_DOWN then
        CancelEvent()
        setKickReason('[sxPanel] Server is shutting down, try again in a few seconds.')
        return
    end

    local player = source
    if GetConvarBool('txAdmin-checkPlayerJoin') then
        d.defer()
        Wait(0)

        --Preparing vars and making sure we do have indentifiers
        local url = 'http://' .. TX_LUACOMHOST .. '/player/checkJoin'
        local queueJoinUrl = 'http://' .. TX_LUACOMHOST .. '/player/queue/join'
        local queuePollUrl = 'http://' .. TX_LUACOMHOST .. '/player/queue/poll'
        local queueLeaveUrl = 'http://' .. TX_LUACOMHOST .. '/player/queue/leave'

        local function presentQueueCard(payload)
            if type(payload) ~= 'table' then
                return
            end
            if type(payload.adaptiveCard) == 'string' and payload.adaptiveCard ~= '' then
                d.presentCard(payload.adaptiveCard)
            else
                d.update('[sxPanel] Waiting in queue...')
            end
        end
        local exData = {
            txAdminToken = TX_LUACOMTOKEN,
            playerIds = GetPlayerIdentifiers(player),
            playerHwids = GetPlayerTokens(player),
            playerName = name,
        }
        if #exData.playerIds <= 1 then
            d.done(
                '\n[sxPanel] This server has bans or whitelisting enabled, which requires every player to have at least one identifier, but you have none.\nIf you own this server, make sure sv_lan is disabled in your server.cfg.'
            )
            return
        end

        --Attempt to validate the user
        d.update('\n[sxPanel] Checking banlist/whitelist... (0/5)')
        CreateThread(function()
            local attempts = 0
            local isDone = false
            local queueId = nil
            --Do 5 attempts (2.5 mins)
            while isDone == false and attempts < 5 do
                attempts = attempts + 1
                d.update('\n[sxPanel] Checking banlist/whitelist... (' .. attempts .. '/5)')
                PerformHttpRequest(url, function(httpCode, rawData, resultHeaders)
                    if isDone then
                        return
                    end
                    -- rawData = nil
                    -- httpCode = 408

                    if not rawData or httpCode ~= 200 then
                        logError(
                            'Checking banlist/whitelist failed with code '
                                .. httpCode
                                .. ' and message: '
                                .. tostring(rawData)
                        )
                    else
                        local respStr = tostring(rawData)
                        local respObj = json.decode(respStr)
                        if not respObj or type(respObj.allow) ~= 'boolean' then
                            logError('Checking banlist/whitelist failed with invalid response: ' .. respStr)
                        else
                            if respObj.allow == true then
                                -- Optional queue step (separate from whitelist)
                                PerformHttpRequest(queueJoinUrl, function(qCode, qRaw, qHeaders)
                                    if isDone then
                                        return
                                    end
                                    if not qRaw or qCode ~= 200 then
                                        d.done()
                                        isDone = true
                                        return
                                    end

                                    local qObj = json.decode(tostring(qRaw))
                                    if not qObj or type(qObj.status) ~= 'string' then
                                        d.done()
                                        isDone = true
                                        return
                                    end

                                    if qObj.status == 'disabled' or qObj.status == 'bypass' or qObj.status == 'allow' then
                                        d.done()
                                        isDone = true
                                        return
                                    end

                                    if qObj.status ~= 'wait' or type(qObj.id) ~= 'string' then
                                        d.done()
                                        isDone = true
                                        return
                                    end

                                    queueId = qObj.id
                                    local pollMs = tonumber(qObj.pollAfterMs) or 5000
                                    presentQueueCard(qObj)

                                    while isDone == false do
                                        Wait(pollMs)
                                        if isDone then
                                            break
                                        end
                                        PerformHttpRequest(queuePollUrl, function(pCode, pRaw, pHeaders)
                                            if isDone then
                                                return
                                            end
                                            if not pRaw or pCode ~= 200 then
                                                return
                                            end
                                            local pObj = json.decode(tostring(pRaw))
                                            if not pObj or type(pObj.status) ~= 'string' then
                                                return
                                            end
                                            if pObj.status == 'allow' then
                                                d.done()
                                                isDone = true
                                                return
                                            end
                                            if pObj.status == 'not_found' then
                                                d.done()
                                                isDone = true
                                                return
                                            end
                                            if pObj.status == 'wait' then
                                                pollMs = tonumber(pObj.pollAfterMs) or pollMs
                                                presentQueueCard(pObj)
                                            end
                                        end, 'POST', json.encode({ txAdminToken = TX_LUACOMTOKEN, id = queueId }), { ['Content-Type'] = 'application/json' })
                                    end
                                end, 'POST', json.encode(exData), { ['Content-Type'] = 'application/json' })
                            else
                                local reason = respObj.reason or ('\n[sxPanel] ' .. translator.t('kick_messages.unknown_reason'))
                                d.done('\n' .. reason)
                                isDone = true
                            end
                        end
                    end
                end, 'POST', json.encode(exData), { ['Content-Type'] = 'application/json' })
                Wait(30000) --30s
            end

            --Block client if failed
            if not isDone then
                d.done('\n[sxPanel] Failed to validate your banlist/whitelist status. Try again in a few minutes.')
                isDone = true
            end

            if queueId then
                PerformHttpRequest(queueLeaveUrl, function(lCode, lRaw, lHeaders) end, 'POST', json.encode({ txAdminToken = TX_LUACOMTOKEN, id = queueId }), { ['Content-Type'] = 'application/json' })
            end
        end)
    end
end

-- =============================================
-- MARK: Setup threads and commands & main stuff
-- =============================================

-- All commands & handlers
RegisterCommand('txaPing', txaPing, true)
RegisterCommand('txaEvent', txaEvent, true)
RegisterCommand('txaReportResources', txaReportResources, true)
RegisterCommand('txaSetDebugMode', txaSetDebugMode, true)
AddEventHandler('playerConnecting', handleConnections)
SetHttpHandler(handleHttp)

-- HeartBeat functions are separated in case one hangs
CreateThread(function()
    while true do
        HTTPHeartBeat()
        Wait(3000)
    end
end)
CreateThread(function()
    while true do
        FD3HeartBeat()
        Wait(3000)
    end
end)

-- Resource runtime usage tracking
-- Periodically collects which scripting runtimes each resource uses
CreateThread(function()
    -- Initial delay for server to fully boot
    Wait(30000)
    while true do
        local runtimeCounts = {}
        local hasNative = pcall(GetResourceRuntimes, TX_RESOURCE_NAME) ---@diagnostic disable-line: undefined-global
        if hasNative then
            local max = GetNumResources() - 1
            for i = 0, max do
                local resName = GetResourceByFindIndex(i)
                if GetResourceState(resName) == 'started' then
                    local runtimes = GetResourceRuntimes(resName) ---@diagnostic disable-line: undefined-global
                    if runtimes then
                        for _, runtime in pairs(runtimes) do
                            runtimeCounts[runtime] = (runtimeCounts[runtime] or 0) + 1
                        end
                    end
                end
            end
            PrintStructuredTrace(json.encode({
                type = 'txAdminResourceRuntimes',
                runtimes = runtimeCounts,
            }))
        end
        Wait(300000) -- 5 minutes
    end
end)

TxPrint('Resource v' .. TX_VERSION .. ' threads and commands set up. All Ready.')
