-- Prevent running in monitor mode
if not TX_SERVER_MODE then
    return
end

-- =============================================
--  Server PlayerList handler
-- =============================================

local function logError(x)
    TxPrint('^1' .. x)
end
local oneSyncConvar = GetConvar('onesync', 'off')
local onesyncEnabled = oneSyncConvar == 'on' or oneSyncConvar == 'legacy'

-- Optimizations
local floor = math.floor
local min = math.min
local max = math.max
local sub = string.sub
local tonumber = tonumber
local tostring = tostring
local pairs = pairs

-- Variables & Consts
local MAX_PLAYER_NAME_LEN = 75
-- https://www.desmos.com/calculator/dx9f5ko2ge
local refreshMinDelay = 1500
local refreshMaxDelay = 5000
local maxPlayersDelayCeil = 300 --at this number, the delay won't increase more
local intervalYieldLimit = 50
local vTypeMap = {
    ['nil'] = -1,
    ['walking'] = 0,
    ['automobile'] = 1,
    ['bike'] = 2,
    ['boat'] = 3,
    ['heli'] = 4,
    ['plane'] = 5,
    ['submarine'] = 6,
    ['trailer'] = 7,
    ['train'] = 8,
}

-- Players already reported to sxPanel core via FD3 structured traces
local TX_FD3_REPORTED = {}

--- Prefer real server-backed rows when duplicate keys exist.
local function shouldReplaceServerPlayerEntry(candidate, incumbent)
    return incumbent == nil
end

--- Collapses mixed numeric/string keys into canonical string keys.
local function normalizeServerPlayerlist()
    local normalized = {}

    for playerID, playerData in pairs(TX_PLAYERLIST) do
        if type(playerData) ~= 'table' then
            goto continue
        end

        local key = TxPlayerListKey(playerID)
        local existing = normalized[key]
        if existing == nil then
            normalized[key] = playerData
        elseif shouldReplaceServerPlayerEntry(playerData, existing) then
            normalized[key] = playerData
        end

        ::continue::
    end

    TX_PLAYERLIST = normalized
end

--[[ Emit playerJoining to FD3 and relay to in-game admins. No-op if already reported or player gone. ]]
local function emitFd3PlayerJoining(serverID)
    local id = tonumber(serverID)
    if not id or id <= 0 then return false end
    if TX_FD3_REPORTED[id] then return false end

    local playerDetectedName = GetPlayerName(id)
    if type(playerDetectedName) ~= 'string' then return false end

    local playerData = {
        name = sub(playerDetectedName, 1, MAX_PLAYER_NAME_LEN),
        ids = GetPlayerIdentifiers(id),
        hwids = GetPlayerTokens(id),
    }
    PrintStructuredTrace(json.encode({
        type = 'txAdminPlayerlistEvent',
        event = 'playerJoining',
        id = id,
        player = playerData,
    }))

    TX_FD3_REPORTED[id] = true

    for adminID, _ in pairs(TX_ADMINS) do
        TriggerClientEvent('txcl:plist:updatePlayer', adminID, id, playerData.name)
    end

    return true
end

--[[ Emit playerDropped to FD3 and relay to in-game admins. No-op if player was not reported. ]]
local function emitFd3PlayerDropped(serverID, reason, resource, category)
    local id = tonumber(serverID)
    if not id or id <= 0 then return false end
    if not TX_FD3_REPORTED[id] then return false end

    PrintStructuredTrace(json.encode({
        type = 'txAdminPlayerlistEvent',
        event = 'playerDropped',
        id = id,
        reason = reason or 'player_left',
        resource = resource or 'monitor',
        category = category,
    }))

    if type(ClearPlayerTagCache) == 'function' then
        ClearPlayerTagCache(id)
    end

    TX_FD3_REPORTED[id] = nil

    for adminID, _ in pairs(TX_ADMINS) do
        TriggerClientEvent('txcl:plist:updatePlayer', adminID, id, false)
    end

    return true
end

--[[ Wrapper to refresh player list data ]]
local function refreshPlayerList()
    normalizeServerPlayerlist()

    -- For each player
    local players = GetPlayers()
    for yieldCounter, serverID in pairs(players) do
        -- Updating player vehicle/health
        local health = -1
        local vType = -1
        local xCoord = nil
        local yCoord = nil
        if onesyncEnabled == true then
            local ped = GetPlayerPed(serverID)
            if ped and DoesEntityExist(ped) then
                health = GetPedHealthPercent(ped)
                local veh = GetVehiclePedIsIn(ped, false)
                if veh ~= 0 and DoesEntityExist(veh) then
                    vType = vTypeMap[tostring(GetVehicleType(veh))] or -1
                else
                    vType = vTypeMap['walking']
                end
                local coords = GetEntityCoords(ped)
                xCoord = floor(coords.x)
                yCoord = floor(coords.y)
            end
        end

        -- Updating TX_PLAYERLIST (always string keys)
        local key = TxPlayerListKey(serverID)
        if type(TX_PLAYERLIST[key]) ~= 'table' then
            local cachedTags = TX_PLAYER_TAG_CACHE and TX_PLAYER_TAG_CACHE[key] or nil
            TX_PLAYERLIST[key] = {
                name = sub(GetPlayerName(serverID) or 'unknown', 1, MAX_PLAYER_NAME_LEN),
                health = health,
                vType = vType,
                xCoord = xCoord,
                yCoord = yCoord,
                tags = cachedTags,
            }
        else
            TX_PLAYERLIST[key].health = health
            TX_PLAYERLIST[key].vType = vType
            TX_PLAYERLIST[key].xCoord = xCoord
            TX_PLAYERLIST[key].yCoord = yCoord
            if TX_PLAYERLIST[key].tags == nil and TX_PLAYER_TAG_CACHE ~= nil and TX_PLAYER_TAG_CACHE[key] ~= nil then
                TX_PLAYERLIST[key].tags = TX_PLAYER_TAG_CACHE[key]
            end
        end

        -- Mark as refreshed
        TX_PLAYERLIST[key].foundLastCheck = true

        -- Reconcile missed FD3 join events (e.g. playerJoining handler dropped)
        emitFd3PlayerJoining(serverID)

        -- Yield to prevent hitches
        if yieldCounter % intervalYieldLimit == 0 then
            Wait(0)
        end
    end --end for players

    --Check if player disconnected
    local playersOnline = 0
    for playerID, playerData in pairs(TX_PLAYERLIST) do
        if type(playerData) ~= 'table' then
            TX_PLAYERLIST[playerID] = nil
            goto continue_disconnect_check
        end
        if playerData.foundLastCheck == true then
            playersOnline = playersOnline + 1
            playerData.foundLastCheck = false
        else
            emitFd3PlayerDropped(playerID, 'player_left', 'monitor', nil)
            TX_PLAYERLIST[playerID] = nil
        end
        ::continue_disconnect_check::
    end

    return playersOnline
end

--[[ Thread to refresh player list ]]
CreateThread(function()
    while true do
        -- Attempt to refresh player list
        local callSuccess, callOutput = pcall(refreshPlayerList)
        local playersOnline = 0
        if callSuccess then
            playersOnline = callOutput
        else
            logError('failed to update playerlist: ' .. tostring(callOutput))
        end

        -- DEBUG
        -- DebugPrint("====================================")
        -- print(json.encode(TX_PLAYERLIST, {indent = true}))
        -- DebugPrint("====================================")

        -- Refresh interval with linear function
        local hDiff = refreshMaxDelay - refreshMinDelay
        local calcDelay = (hDiff / maxPlayersDelayCeil) * playersOnline + refreshMinDelay
        local delay = floor(min(calcDelay, refreshMaxDelay))
        Wait(delay)
    end --end while true
end)

--[[ Handle player Join or Leave ]]
AddEventHandler('playerJoining', function(srcString, _oldID)
    -- sanity checking source
    if source <= 0 then
        logError('playerJoining event with source ' .. json.encode(source))
        return
    end

    if TX_FD3_REPORTED[source] then return end

    -- checking if the player was not already dropped
    if type(GetPlayerName(source)) ~= 'string' then
        logError(
            'Received a playerJoining for a player that was already dropped. There is some resource dropping the player at the playerJoining event handler without first waiting for the next tick.'
        )
        return
    end

    emitFd3PlayerJoining(source)
end)

AddEventHandler('playerDropped', function(reason, resource, category)
    -- sanity checking source
    if source <= 0 then
        logError('playerDropped event with source ' .. json.encode(source))
        return
    end

    if resource == 'monitor' and TX_IS_SERVER_SHUTTING_DOWN then
        reason = 'server_shutting_down'
    end

    emitFd3PlayerDropped(source, reason, resource, category)
end)

--[[ Handle renames done through the SET_PLAYER_NAME native.
     Server-only event (never registered as a net event), and simply never fires on artifacts without the native. ]]
AddEventHandler('onPlayerNameChanged', function()
    local id = tonumber(source)
    if not id or id <= 0 then return end

    -- Renames during playerConnecting use a temp id; the final name is read at playerJoining
    if not TX_FD3_REPORTED[id] then return end

    -- Don't trust the event args, read the name straight from the server
    local newName = GetPlayerName(id)
    if type(newName) ~= 'string' then return end
    newName = sub(newName, 1, MAX_PLAYER_NAME_LEN)

    local entry = TX_PLAYERLIST[TxPlayerListKey(id)]
    if type(entry) == 'table' then
        if entry.name == newName then return end
        entry.name = newName
    end

    PrintStructuredTrace(json.encode({
        type = 'txAdminPlayerlistEvent',
        event = 'playerNameChanged',
        id = id,
        name = newName,
    }))

    for adminID, _ in pairs(TX_ADMINS) do
        TriggerClientEvent('txcl:plist:updatePlayer', adminID, id, newName)
    end
end)

-- Handle getDetailedPlayerlist
-- This event is only called when the menu "players" tab is opened, and every 5s while the tab is open
RegisterNetEvent('txsv:req:plist:getDetailed', function(getPlayerNames)
    if TX_ADMINS[tostring(source)] == nil then
        DebugPrint('Ignoring unauthenticated getDetailedPlayerlist() by ' .. source)
        return
    end

    normalizeServerPlayerlist()

    local players = {}
    for playerID, playerData in pairs(TX_PLAYERLIST) do
        players[#players + 1] = {
            tonumber(playerID),
            playerData.health,
            playerData.vType,
            playerData.xCoord,
            playerData.yCoord,
        }
        if getPlayerNames then
            players[#players][6] = playerData.name
        end
    end
    local admins = {}
    for adminID in pairs(TX_ADMINS) do
        admins[#admins + 1] = tonumber(adminID)
    end
    local playerTags = {}
    for playerID, playerData in pairs(TX_PLAYERLIST) do
        local key = TxPlayerListKey(playerID)
        local tags = playerData.tags
        if tags == nil and TX_PLAYER_TAG_CACHE ~= nil then
            tags = TX_PLAYER_TAG_CACHE[key]
        end
        if tags ~= nil then
            playerTags[key] = tags
        end
    end
    for _, adminID in pairs(admins) do
        local key = TxPlayerListKey(adminID)
        local tags = playerTags[key]
        if tags == nil and TX_PLAYERLIST[key] ~= nil then
            tags = TX_PLAYERLIST[key].tags
        end
        if tags == nil and TX_PLAYER_TAG_CACHE ~= nil then
            tags = TX_PLAYER_TAG_CACHE[key]
        end
        if type(EnsureStaffInTags) == 'function' then
            playerTags[key] = EnsureStaffInTags(tags or {})
        end
    end
    TriggerClientEvent('txcl:plist:setDetailed', source, players, admins, playerTags)
end)

-- Sends the initial playlist to a specific admin
-- Triggered by the server after admin auth
function SendInitialPlayerlist(adminID)
    normalizeServerPlayerlist()

    local payload = {}
    for playerID, playerData in pairs(TX_PLAYERLIST) do
        payload[#payload + 1] = { tonumber(playerID), playerData.name }
    end

    DebugPrint('Sending initial playerlist to ' .. adminID)
    TriggerClientEvent('txcl:plist:setInitial', adminID, payload)
end
