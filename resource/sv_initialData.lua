-- Prevent running in monitor mode
if not TX_SERVER_MODE then
    return
end

--[[ Helper Functions ]]
--
local function logError(x)
    TxPrint('^1' .. x)
end

local svName = GetConvar('txAdmin-serverName', 'txAdmin')
local hideAdmin = GetConvarBool('txAdmin-hideAdminInPunishments')

--[[ Initial Data Cache ]]
--
local CLEANUP_INTERVAL = 60 * 1000
local MAX_AGE = 5 * 60 * 1000
local initialDataCache = {}
-- Tags keyed by netId (string); survives TX_PLAYERLIST entry not existing yet
TX_PLAYER_TAG_CACHE = TX_PLAYER_TAG_CACHE or {}

local function cacheData(data)
    data.ts = GetGameTimer()
    initialDataCache[data.netId] = data
end

local function popData(netId)
    if not initialDataCache[netId] then
        return nil
    end
    local data = initialDataCache[netId]
    initialDataCache[netId] = nil
    return data
end

CreateThread(function()
    while true do
        local now = GetGameTimer()
        for netId, data in pairs(initialDataCache) do
            if now - data.ts > MAX_AGE then
                initialDataCache[netId] = nil
            end
        end

        Wait(CLEANUP_INTERVAL)
    end
end)

--[[ Handle Commands/Events ]]
--
local function pushTagsToAdmins(netId, tags)
    if type(tags) ~= 'table' then return end
    for adminID, _ in pairs(TX_ADMINS) do
        TriggerClientEvent('txcl:plist:updatePlayerTags', adminID, netId, tags)
    end
end

--- Ensures the staff tag is present (in-game menu admins + panel admin accounts).
function EnsureStaffInTags(tags)
    if type(tags) ~= 'table' then
        tags = {}
    end
    for _, t in ipairs(tags) do
        if t == 'staff' then
            return tags
        end
    end
    local merged = { 'staff' }
    for _, t in ipairs(tags) do
        merged[#merged + 1] = t
    end
    return merged
end

--- Persists tags, applies to TX_PLAYERLIST when present, and syncs to connected admins.
function StorePlayerTags(netId, tags)
    if type(netId) ~= 'number' or type(tags) ~= 'table' then return end
    local key = TxPlayerListKey(netId)
    TX_PLAYER_TAG_CACHE[key] = tags
    if TX_PLAYERLIST[key] ~= nil then
        TX_PLAYERLIST[key].tags = tags
    end
    pushTagsToAdmins(netId, tags)
end

function ClearPlayerTagCache(netId)
    if type(netId) ~= 'number' then return end
    TX_PLAYER_TAG_CACHE[TxPlayerListKey(netId)] = nil
end

local function useInitData(data)
    if not data then
        return
    end
    if data.tags ~= nil then
        StorePlayerTags(data.netId, data.tags)
    end
    -- Send pending warn to the client for local storage.
    -- The client will display it when the player starts walking,
    -- without needing a server round-trip.
    if data.pendingWarn ~= nil then
        local authorName = hideAdmin and svName or data.pendingWarn.author or 'anonym'
        -- Register in the pending warnings table so the ack handler can find it
        TX_PENDING_WARNINGS[tostring(data.netId)] = data.pendingWarn.actionId
        TriggerClientEvent('txcl:setPendingWarn', data.netId, {
            author = authorName,
            reason = data.pendingWarn.reason,
            actionId = data.pendingWarn.actionId,
        })
    end
end

RegisterCommand('txaInitialData', function(source, args)
    -- sanity check
    if type(args[1]) ~= 'string' then
        return TxPrintError('[txaInitialData] invalid argument types', type(args[1]))
    end

    -- prevent execution from admins or resources
    if source ~= 0 then
        return TxPrintError('[txaInitialData] unexpected source', source)
    end
    if GetInvokingResource() ~= nil then
        return TxPrintError('[txaInitialData] unexpected invoking resource', GetInvokingResource())
    end

    -- processing event
    local initialData = json.decode(ReplaceSemicolon(args[1]))
    if not initialData or type(initialData.netId) ~= 'number' then
        return TxPrintError('[txaInitialData] invalid eventData', args[1])
    end

    if initialData.tags ~= nil then
        StorePlayerTags(initialData.netId, initialData.tags)
    end

    cacheData(initialData)
    useInitData(initialData)
    CancelEvent()
end, true)
