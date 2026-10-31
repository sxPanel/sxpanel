-- Prevent running in monitor mode
if not TX_SERVER_MODE then
    return
end
-- Prevent running if menu is disabled
if not TX_MENU_ENABLED then
    return
end

-- =============================================
--  Server side handlers for the staff tools: invisibility, developer tools,
--  entity deletion, vehicle clean up, disarm and staff chat.
--  Everything here is game-agnostic (FiveM & RedM).
-- =============================================

local MAX_DELETE_DISTANCE = 300.0
local MAX_CLEANUP_RADIUS = 300
local STAFF_CHAT_MAX_LENGTH = 300
local STAFF_CHAT_COOLDOWN_MS = 1000

local lastStaffChatAt = {} -- [src string] = gameTimer

local function notify(src, level, key, tOptions)
    TriggerClientEvent('txcl:staffTools:notify', src, level, key, tOptions)
end

--- Returns a set of the vehicles currently occupied by any player
---@return table<number, number> vehicle => server id of one occupant
local function getPlayerOccupiedVehicles()
    local occupied = {}
    for _, playerId in ipairs(GetPlayers()) do
        local ped = GetPlayerPed(playerId)
        if ped and ped > 0 then
            local veh = GetVehiclePedIsIn(ped, false)
            if veh and veh > 0 then
                occupied[veh] = tonumber(playerId)
            end
        end
    end
    return occupied
end

-- =============================================
-- MARK: Invisibility
-- =============================================
RegisterNetEvent('txsv:req:setInvisible', function(enabled)
    local src = source
    if type(enabled) ~= 'boolean' then
        return
    end
    -- Becoming visible again is always allowed, so admins who lose the permission are not stuck invisible
    local allow = not enabled or PlayerHasTxPermission(src, 'players.invisible')
    TriggerEvent('txsv:logger:menuEvent', src, 'invisibleChanged', allow, enabled)
    if not allow then
        return
    end
    -- Exposed to other resources (eg. to hide the admin from their own HUDs)
    Player(src).state:set('txAdminInvisible', enabled, true)
    TriggerClientEvent('txcl:setInvisible', src, enabled)
end)

-- =============================================
-- MARK: Developer tools
-- =============================================
local validDevTools = {
    coords = true,
    inspector = true,
}

RegisterNetEvent('txsv:req:devTools', function(tool, enabled)
    local src = source
    if type(tool) ~= 'string' or not validDevTools[tool] or type(enabled) ~= 'boolean' then
        return
    end
    local allow = PlayerHasTxPermission(src, 'menu.devtools')
    TriggerEvent('txsv:logger:menuEvent', src, 'devTools', allow, { tool = tool, enabled = enabled })
    if allow then
        TriggerClientEvent('txcl:devTools', src, tool, enabled)
    end
end)

-- =============================================
-- MARK: Entity deletion
-- =============================================
local entityTypeNames = {
    [1] = 'ped',
    [2] = 'vehicle',
    [3] = 'object',
}

--- Deletes a networked entity the admin is aiming at (entity inspector)
RegisterNetEvent('txsv:req:deleteEntity', function(netId)
    local src = source
    if type(netId) ~= 'number' then
        return
    end
    if not PlayerHasTxPermission(src, 'menu.delete_entities') then
        return TriggerEvent('txsv:logger:menuEvent', src, 'deleteEntity', false)
    end

    local entity = NetworkGetEntityFromNetworkId(netId)
    if not entity or entity <= 0 or not DoesEntityExist(entity) then
        return notify(src, 'error', 'nui_menu.staff_hud.inspector.delete_not_found')
    end

    local entityType = GetEntityType(entity)
    if not entityTypeNames[entityType] then
        return notify(src, 'error', 'nui_menu.staff_hud.inspector.delete_not_found')
    end
    if entityType == 1 and IsPedAPlayer(entity) then
        return notify(src, 'error', 'nui_menu.staff_hud.inspector.delete_player')
    end
    if entityType == 2 then
        local occupant = getPlayerOccupiedVehicles()[entity]
        if occupant and occupant ~= src then
            return notify(src, 'error', 'nui_menu.staff_hud.inspector.delete_occupied')
        end
    end

    -- The admin can only delete what is around them, in their own routing bucket
    local srcPed = GetPlayerPed(src)
    if not srcPed or srcPed <= 0 then
        return
    end
    if GetEntityRoutingBucket(entity) ~= GetPlayerRoutingBucket(src) then
        return notify(src, 'error', 'nui_menu.staff_hud.inspector.delete_not_found')
    end
    if #(GetEntityCoords(srcPed) - GetEntityCoords(entity)) > MAX_DELETE_DISTANCE then
        return notify(src, 'error', 'nui_menu.staff_hud.inspector.delete_too_far')
    end

    local model = GetEntityModel(entity)
    DeleteEntity(entity)
    TriggerEvent('txsv:logger:menuEvent', src, 'deleteEntity', true, {
        entityType = entityTypeNames[entityType],
        model = model,
    })
    notify(src, 'success', 'nui_menu.staff_hud.inspector.delete_success')
end)

--- Deletes every unoccupied vehicle around the admin
RegisterNetEvent('txsv:req:cleanupVehicles', function(radius)
    local src = source
    if type(radius) ~= 'number' or radius < 1 or radius > MAX_CLEANUP_RADIUS then
        return
    end
    radius = math.floor(radius)
    local allow = PlayerHasTxPermission(src, 'menu.delete_entities')
    if not allow then
        return TriggerEvent('txsv:logger:menuEvent', src, 'cleanupVehicles', false)
    end

    local srcPed = GetPlayerPed(src)
    if not srcPed or srcPed <= 0 then
        return
    end
    local srcCoords = GetEntityCoords(srcPed)
    local srcBucket = GetPlayerRoutingBucket(src)
    local occupied = getPlayerOccupiedVehicles()

    local deleted = 0
    ---@diagnostic disable-next-line: param-type-mismatch
    for _, veh in ipairs(GetAllVehicles()) do
        if
            DoesEntityExist(veh)
            and not occupied[veh]
            and GetEntityRoutingBucket(veh) == srcBucket
            and #(srcCoords - GetEntityCoords(veh)) <= radius
            -- trains are usually managed by a resource, deleting them can break it
            and (type(GetVehicleType) ~= 'function' or GetVehicleType(veh) ~= 'train')
        then
            DeleteEntity(veh)
            deleted = deleted + 1
        end
    end

    TriggerEvent('txsv:logger:menuEvent', src, 'cleanupVehicles', true, { radius = radius, count = deleted })
    notify(src, 'success', 'nui_menu.page_main.cleanup_vehicles.success', { count = deleted, radius = radius })
end)

-- =============================================
-- MARK: Disarm
-- =============================================
RegisterNetEvent('txsv:req:disarmPlayer', function(id)
    local src = source
    if type(id) ~= 'number' or not DoesPlayerExist(tostring(id)) then
        return
    end
    local allow = PlayerHasTxPermission(src, 'players.disarm')
    TriggerEvent('txsv:logger:menuEvent', src, 'disarmPlayer', allow, id)
    if allow then
        TriggerClientEvent('txcl:staffTools:disarm', id)
        notify(src, 'success', 'nui_menu.player_modal.actions.staff.notifications.disarm_player')
    end
end)

-- =============================================
-- MARK: Staff chat
-- =============================================
RegisterNetEvent('txsv:req:staffChat', function(message)
    local src = source
    if type(message) ~= 'string' then
        return
    end
    -- strip control characters and collapse surrounding whitespace
    message = message:gsub('%c', ' '):match('^%s*(.-)%s*$')
    if message == '' then
        return
    end
    if #message > STAFF_CHAT_MAX_LENGTH then
        message = message:sub(1, STAFF_CHAT_MAX_LENGTH)
    end

    local allow = PlayerHasTxPermission(src, 'menu.staffchat')
    if not allow then
        return notify(src, 'error', 'nui_menu.misc.no_perms')
    end

    local key = tostring(src)
    local now = GetGameTimer()
    if lastStaffChatAt[key] and now - lastStaffChatAt[key] < STAFF_CHAT_COOLDOWN_MS then
        return notify(src, 'warning', 'nui_menu.staff_chat.rate_limited')
    end
    lastStaffChatAt[key] = now

    TriggerEvent('txsv:logger:menuEvent', src, 'staffChat', true, message)
    local payload = {
        authorId = src,
        author = TxAdminActionAuthor(TX_ADMINS[key]),
        message = message,
    }
    for adminId in pairs(TX_ADMINS) do
        local adminSrc = tonumber(adminId)
        if adminSrc and PlayerHasTxPermission(adminSrc, 'menu.staffchat') then
            TriggerClientEvent('txcl:staffChat:message', adminSrc, payload)
        end
    end
end)

AddEventHandler('playerDropped', function()
    lastStaffChatAt[tostring(source)] = nil
end)
