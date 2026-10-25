-- Prevent running if menu is disabled
if not TX_MENU_ENABLED then
    return
end

-- =============================================
--  Staff tools: invisibility, developer tools (coords HUD and entity
--  inspector), vehicle clean up, disarm/return and staff chat.
--  Every action is validated server-side (sv_staff_tools.lua), the checks
--  here are only for local feedback. Works on both FiveM and RedM.
-- =============================================

local DELETE_CONTROL = IS_FIVEM and 178 or 0x4AF4D473 -- DELETE key (INPUT_CELLPHONE_OPTION / INPUT_FRONTEND_DELETE)
local INSPECTOR_RANGE = 150.0
local INSPECTOR_RAYCAST_INTERVAL = 100
local INSPECTOR_NUI_INTERVAL = 250
local COORDS_HUD_INTERVAL = 100

-- Natives that are not available (or named differently) in both games
local getCamCoord = GetFinalRenderedCamCoord or GetGameplayCamCoord
local getCamRot = GetFinalRenderedCamRot or GetGameplayCamRot
local canSeeSelfWhileInvisible = IS_FIVEM and type(SetLocalPlayerVisibleLocally) == 'function'

local devTools = {
    coords = false,
    inspector = false,
}

local function snack(level, key, tOptions)
    SendSnackbarMessage(level, key, true, tOptions)
end

--- Local permission check with the default no perms feedback
---@param perm string
---@return boolean
local function checkPerm(perm)
    if not TX_MENU_ACCESSIBLE then
        return false
    end
    if not DoesPlayerHavePerm(TX_MENU_PERMISSIONS, perm) then
        snack('error', 'nui_menu.misc.no_perms')
        return false
    end
    return true
end

RegisterNetEvent('txcl:staffTools:notify', function(level, key, tOptions)
    if type(level) ~= 'string' or type(key) ~= 'string' then
        return
    end
    snack(level, key, type(tOptions) == 'table' and tOptions or nil)
end)

-- =============================================
-- MARK: Invisibility
-- =============================================
local function createInvisibilityThread()
    CreateThread(function()
        local frameCounter = 0
        while TX_STAFF_INVISIBLE do
            -- Re-applied periodically since respawns and other resources can reset it,
            -- only SetLocalPlayerVisibleLocally needs to run every frame
            if frameCounter % 30 == 0 then
                local ped = PlayerPedId()
                SetEntityVisible(ped, false, false)
                if canSeeSelfWhileInvisible then
                    SetEntityAlpha(ped, 120, false)
                end
            end

            if canSeeSelfWhileInvisible then
                frameCounter = frameCounter + 1
                -- noclip hides the ped locally on its own, don't fight it
                if not IsFreecamActive() then
                    SetLocalPlayerVisibleLocally(true)
                end
                Wait(0)
            else
                Wait(500)
            end
        end
    end)
end

local function setInvisible(enabled)
    if TX_STAFF_INVISIBLE == enabled then
        return
    end
    TX_STAFF_INVISIBLE = enabled
    SetStaffStatus('invisible', enabled)

    local ped = PlayerPedId()
    if enabled then
        SetEntityVisible(ped, false, false)
        SendPersistentAlert('invisibleEnabled', 'info', 'nui_menu.page_main.invisible.alert_on', true)
        createInvisibilityThread()
    else
        ClearPersistentAlert('invisibleEnabled')
        ResetEntityAlpha(ped)
        if not IsFreecamActive() then
            SetEntityVisible(ped, true, false)
        end
    end
end

RegisterNetEvent('txcl:setInvisible', function(enabled)
    setInvisible(enabled == true)
end)

--- Asks the server to toggle invisibility (global for cl_custom_commands.lua)
function TxToggleInvisible()
    if not TX_STAFF_INVISIBLE and not checkPerm('players.invisible') then
        return
    end
    TriggerServerEvent('txsv:req:setInvisible', not TX_STAFF_INVISIBLE)
end

RegisterSecureNuiCallback('toggleInvisible', function(_, cb)
    TxToggleInvisible()
    cb({})
end)
RegisterCommand('txAdmin:menu:toggleInvisible', TxToggleInvisible, false)

-- =============================================
-- MARK: Coords HUD
-- =============================================
local function round2(n)
    return math.floor(n * 100 + 0.5) / 100
end

local function createCoordsHudThread()
    CreateThread(function()
        local lastX, lastY, lastZ, lastH
        while devTools.coords do
            local ped = PlayerPedId()
            local pos = GetEntityCoords(ped)
            local x, y, z, h = round2(pos.x), round2(pos.y), round2(pos.z), round2(GetEntityHeading(ped))
            if x ~= lastX or y ~= lastY or z ~= lastZ or h ~= lastH then
                lastX, lastY, lastZ, lastH = x, y, z, h
                SendMenuMessage('setCoordsHud', { x = x, y = y, z = z, heading = h })
            end
            Wait(COORDS_HUD_INTERVAL)
        end
        SendMenuMessage('setCoordsHud', false)
    end)
end

-- =============================================
-- MARK: Entity inspector
-- =============================================
local entityTypeNames = {
    [1] = 'ped',
    [2] = 'vehicle',
    [3] = 'object',
}

local function rotationToDirection(rot)
    local radX = math.rad(rot.x)
    local radZ = math.rad(rot.z)
    local cosX = math.abs(math.cos(radX))
    return vector3(-math.sin(radZ) * cosX, math.cos(radZ) * cosX, math.sin(radX))
end

--- Returns the entity the camera is pointing at, if any
---@return number|nil
local function raycastFromCamera()
    local camCoords = getCamCoord()
    local dest = camCoords + rotationToDirection(getCamRot(2)) * INSPECTOR_RANGE
    local handle = StartShapeTestRay(
        camCoords.x, camCoords.y, camCoords.z,
        dest.x, dest.y, dest.z,
        -1, PlayerPedId(), 0
    )
    local _, hit, _, _, entityHit = GetShapeTestResult(handle)
    if (hit == 1 or hit == true) and entityHit and entityHit > 0 and DoesEntityExist(entityHit) then
        if entityTypeNames[GetEntityType(entityHit)] then
            return entityHit
        end
    end
    return nil
end

-- Reused every frame to avoid allocating tables while drawing
local BOX_EDGES = { { 1, 2 }, { 2, 3 }, { 3, 4 }, { 4, 1 }, { 5, 6 }, { 6, 7 }, { 7, 8 }, { 8, 5 }, { 1, 5 }, { 2, 6 }, { 3, 7 }, { 4, 8 } }
local boxCorners = {}
local boxEntity, boxMin, boxMax

--- Draws the model bounding box of an entity, needs to be called every frame
local function drawEntityBox(entity)
    if entity ~= boxEntity then
        boxEntity = entity
        boxMin, boxMax = GetModelDimensions(GetEntityModel(entity))
    end
    local min, max = boxMin, boxMax
    boxCorners[1] = GetOffsetFromEntityInWorldCoords(entity, min.x, min.y, min.z)
    boxCorners[2] = GetOffsetFromEntityInWorldCoords(entity, max.x, min.y, min.z)
    boxCorners[3] = GetOffsetFromEntityInWorldCoords(entity, max.x, max.y, min.z)
    boxCorners[4] = GetOffsetFromEntityInWorldCoords(entity, min.x, max.y, min.z)
    boxCorners[5] = GetOffsetFromEntityInWorldCoords(entity, min.x, min.y, max.z)
    boxCorners[6] = GetOffsetFromEntityInWorldCoords(entity, max.x, min.y, max.z)
    boxCorners[7] = GetOffsetFromEntityInWorldCoords(entity, max.x, max.y, max.z)
    boxCorners[8] = GetOffsetFromEntityInWorldCoords(entity, min.x, max.y, max.z)
    for i = 1, #BOX_EDGES do
        local edge = BOX_EDGES[i]
        local a, b = boxCorners[edge[1]], boxCorners[edge[2]]
        DrawLine(a.x, a.y, a.z, b.x, b.y, b.z, 59, 130, 246, 255)
    end
end

--- Collects the details shown on the inspector HUD
local function getEntityDetails(entity)
    local entityType = GetEntityType(entity)
    local model = GetEntityModel(entity)
    local coords = GetEntityCoords(entity)
    local isNetworked = NetworkGetEntityIsNetworked(entity)
    local details = {
        entityType = entityTypeNames[entityType],
        model = model,
        modelHex = ('0x%08X'):format(model & 0xFFFFFFFF),
        archetype = type(GetEntityArchetypeName) == 'function' and GetEntityArchetypeName(entity) or false,
        handle = entity,
        netId = isNetworked and NetworkGetNetworkIdFromEntity(entity) or false,
        owner = false,
        playerId = false,
        health = GetEntityHealth(entity),
        maxHealth = GetEntityMaxHealth(entity),
        coords = { x = round2(coords.x), y = round2(coords.y), z = round2(coords.z) },
        heading = round2(GetEntityHeading(entity)),
        distance = round2(#(GetEntityCoords(PlayerPedId()) - coords)),
    }
    if isNetworked then
        local ownerIndex = NetworkGetEntityOwner(entity)
        if ownerIndex and ownerIndex >= 0 then
            details.owner = GetPlayerServerId(ownerIndex)
        end
    end
    if entityType == 1 and IsPedAPlayer(entity) then
        details.playerId = GetPlayerServerId(NetworkGetPlayerIndexFromPed(entity))
    end
    details.canDelete = details.netId ~= false
        and details.playerId == false
        and DoesPlayerHavePerm(TX_MENU_PERMISSIONS, 'menu.delete_entities')
    return details
end

local function requestDeleteEntity(entity)
    if not DoesPlayerHavePerm(TX_MENU_PERMISSIONS, 'menu.delete_entities') then
        return snack('error', 'nui_menu.misc.no_perms')
    end
    if not entity or not DoesEntityExist(entity) then
        return snack('error', 'nui_menu.staff_hud.inspector.delete_no_target')
    end
    if GetEntityType(entity) == 1 and IsPedAPlayer(entity) then
        return snack('error', 'nui_menu.staff_hud.inspector.delete_player')
    end
    if not NetworkGetEntityIsNetworked(entity) then
        return snack('error', 'nui_menu.staff_hud.inspector.delete_not_networked')
    end
    TriggerServerEvent('txsv:req:deleteEntity', NetworkGetNetworkIdFromEntity(entity))
end

local function createInspectorThread()
    CreateThread(function()
        local target
        local nextRaycastAt = 0
        local nextNuiUpdateAt = 0
        ---@type number|false
        local lastSentTarget = false
        while devTools.inspector do
            local now = GetGameTimer()
            if now >= nextRaycastAt then
                nextRaycastAt = now + INSPECTOR_RAYCAST_INTERVAL
                target = raycastFromCamera()
            end
            if target and not DoesEntityExist(target) then
                target = nil
            end

            if target then
                drawEntityBox(target)
                if IsControlJustReleased(0, DELETE_CONTROL) then
                    requestDeleteEntity(target)
                end
            end

            -- Only push to NUI when the target changes or periodically for live values
            if target ~= lastSentTarget or (target and now >= nextNuiUpdateAt) then
                nextNuiUpdateAt = now + INSPECTOR_NUI_INTERVAL
                lastSentTarget = target or false
                SendMenuMessage('setInspectorData', { target = target and getEntityDetails(target) or false })
            end
            Wait(0)
        end
        boxEntity = nil
        SendMenuMessage('setInspectorData', false)
    end)
end

-- =============================================
-- MARK: Developer tools toggles
-- =============================================
local devToolStatusKeys = {
    coords = 'coordsHud',
    inspector = 'inspector',
}

local function setDevTool(tool, enabled)
    if devTools[tool] == nil or devTools[tool] == enabled then
        return
    end
    devTools[tool] = enabled
    SetStaffStatus(devToolStatusKeys[tool], enabled)
    if tool == 'coords' and enabled then
        createCoordsHudThread()
    elseif tool == 'inspector' and enabled then
        createInspectorThread()
    end
end

RegisterNetEvent('txcl:devTools', function(tool, enabled)
    setDevTool(tool, enabled == true)
end)

--- Asks the server to toggle a developer tool (global for cl_custom_commands.lua)
---@param tool 'coords'|'inspector'
function TxToggleDevTool(tool)
    if devTools[tool] == nil then
        return
    end
    -- Turning a tool off is purely local, no need to ask the server
    if devTools[tool] then
        return setDevTool(tool, false)
    end
    if not checkPerm('menu.devtools') then
        return
    end
    TriggerServerEvent('txsv:req:devTools', tool, true)
end

RegisterSecureNuiCallback('toggleDevTool', function(tool, cb)
    TxToggleDevTool(tool)
    cb({})
end)
RegisterCommand('txAdmin:menu:toggleCoordsHud', function()
    TxToggleDevTool('coords')
end, false)
RegisterCommand('txAdmin:menu:toggleInspector', function()
    TxToggleDevTool('inspector')
end, false)

-- =============================================
-- MARK: Vehicle clean up
-- =============================================
RegisterSecureNuiCallback('cleanupVehicles', function(data, cb)
    if type(data) == 'table' and type(data.radius) == 'number' then
        TriggerServerEvent('txsv:req:cleanupVehicles', data.radius)
    end
    cb({})
end)

--- Opens the clean up radius dialog (global for cl_custom_commands.lua)
function TxOpenCleanupVehiclesDialog()
    if not checkPerm('menu.delete_entities') then
        return
    end
    toggleMenuVisibility(true)
    SetNuiFocus(true, true)
    SendMenuMessage('openCleanupVehiclesDialog', {})
end
RegisterCommand('txAdmin:menu:cleanupVehicles', TxOpenCleanupVehiclesDialog, false)

-- =============================================
-- MARK: Player actions (disarm & return)
-- =============================================
RegisterSecureNuiCallback('disarmPlayer', function(data, cb)
    TriggerServerEvent('txsv:req:disarmPlayer', tonumber(data.id))
    cb({})
end)

RegisterSecureNuiCallback('returnPlayer', function(data, cb)
    TriggerServerEvent('txsv:req:returnPlayer', tonumber(data.id))
    cb({})
end)

RegisterNetEvent('txcl:staffTools:disarm', function()
    local ped = PlayerPedId()
    if IS_FIVEM then
        RemoveAllPedWeapons(ped, true)
    else
        ---@diagnostic disable-next-line: redundant-parameter
        RemoveAllPedWeapons(ped, true, true)
    end
    snack('warning', 'nui_menu.player_modal.actions.staff.notifications.disarmed_by_staff')
end)

-- =============================================
-- MARK: Staff chat
-- =============================================
--- Sends a staff chat message (global for cl_custom_commands.lua)
---@param message string
function TxSendStaffChat(message)
    if not checkPerm('menu.staffchat') then
        return
    end
    if type(message) ~= 'string' or not message:find('%S') then
        return snack('error', 'nui_menu.staff_chat.usage')
    end
    TriggerServerEvent('txsv:req:staffChat', message)
end

RegisterSecureNuiCallback('sendStaffChat', function(data, cb)
    if type(data) == 'table' then
        TxSendStaffChat(data.message)
    end
    cb({})
end)

RegisterCommand('staffchat', function(_, args)
    if not TX_MENU_ACCESSIBLE then
        return
    end
    TxSendStaffChat(table.concat(args, ' '))
end, false)

-- Keybind: opens the menu straight into the staff chat dialog
RegisterCommand('txAdmin:menu:staffChat', function()
    if not checkPerm('menu.staffchat') then
        return
    end
    toggleMenuVisibility(true)
    SetNuiFocus(true, true)
    SendMenuMessage('openStaffChatDialog', {})
end, false)

RegisterNetEvent('txcl:staffChat:message', function(payload)
    if type(payload) ~= 'table' or type(payload.message) ~= 'string' then
        return
    end
    SendMenuMessage('staffChatMessage', {
        authorId = tonumber(payload.authorId) or 0,
        author = tostring(payload.author or 'unknown'),
        message = payload.message,
        isSelf = tonumber(payload.authorId) == GetPlayerServerId(PlayerId()),
    })
end)

-- =============================================
-- MARK: Cleanup
-- =============================================
local function disableAllTools()
    setDevTool('coords', false)
    setDevTool('inspector', false)
    if TX_STAFF_INVISIBLE then
        setInvisible(false)
        TriggerServerEvent('txsv:req:setInvisible', false)
    end
end

-- Admin lost menu access (logged out, permissions revoked, etc)
RegisterNetEvent('txcl:setAdmin', function(_, perms)
    if type(perms) ~= 'table' then
        disableAllTools()
    end
end)

AddEventHandler('onResourceStop', function(resourceName)
    if resourceName ~= GetCurrentResourceName() then
        return
    end
    if TX_STAFF_INVISIBLE then
        local ped = PlayerPedId()
        ResetEntityAlpha(ped)
        SetEntityVisible(ped, true, false)
    end
end)
