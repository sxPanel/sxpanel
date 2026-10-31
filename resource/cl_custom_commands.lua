-- =============================================
--  Client side of the custom chat commands (see sv_custom_commands.lua).
--  The server checks the command permission and then asks this client to run
--  the /tx menu action. Every action goes through the existing menu request
--  events, which re-validate permissions server-side.
--  NOTE: action ids must match shared/customCommands.ts
-- =============================================

-- Request our suggestions once the chat resource had time to start
CreateThread(function()
    Wait(2000)
    TriggerServerEvent('txsv:customCommands:requestSuggestions')
end)

-- Prevent running if menu is disabled
if not TX_MENU_ENABLED then
    return
end

local function snackError(msg)
    SendSnackbarMessage('error', msg, false)
end

local function parsePlayerId(args)
    local id = tonumber(args[1])
    if not id then
        snackError('Usage: provide a valid player ID.')
    end
    return id
end

local function parseNumber(value, min, max)
    local num = tonumber(value)
    if not num or num < min or num > max then
        return nil
    end
    return num
end

--- Each runner receives the command arguments (strings)
local menuActionRunners = {
    -- Teleport
    tpWaypoint = function()
        ExecuteCommand('txAdmin:menu:tpToWaypoint')
    end,
    tpCoords = function(args)
        if #args == 0 then
            return ExecuteCommand('txAdmin:menu:tpToCoords')
        end
        local cleaned = table.concat(args, ' '):gsub(',', ' ')
        local x, y, z = cleaned:match('^%s*(%S+)%s+(%S+)%s*(%S*)')
        x, y, z = tonumber(x), tonumber(y), tonumber(z) or 0
        if not x or not y then
            return snackError('Usage: x y [z] (z = 0 uses the ground height).')
        end
        TriggerServerEvent('txsv:req:tpToCoords', x + 0.0, y + 0.0, z + 0.0)
    end,
    tpBack = function()
        ExecuteCommand('txAdmin:menu:tpBack')
    end,
    bringPlayer = function(args)
        local id = parsePlayerId(args)
        if id then
            TriggerServerEvent('txsv:req:bringPlayer', id)
        end
    end,
    returnPlayer = function(args)
        local id = parsePlayerId(args)
        if id then
            TriggerServerEvent('txsv:req:returnPlayer', id)
        end
    end,

    -- Health
    healSelf = function()
        ExecuteCommand('txAdmin:menu:healMyself')
    end,
    healPlayer = function(args)
        local id = parsePlayerId(args)
        if id then
            TriggerServerEvent('txsv:req:healPlayer', id)
        end
    end,
    healAll = function()
        TriggerServerEvent('txsv:req:healEveryone')
    end,
    healRadius = function(args)
        local radius = parseNumber(args[1], 1, 500)
        if not radius then
            return snackError('Usage: radius between 1 and 500 meters.')
        end
        TriggerServerEvent('txsv:req:healRadius', radius)
    end,

    -- Player mode
    noclip = function()
        ExecuteCommand('txAdmin:menu:noClipToggle')
    end,
    godmode = function()
        TxAskChangePlayerMode('godmode')
    end,
    superjump = function()
        TxAskChangePlayerMode('superjump')
    end,
    normalMode = function()
        TxAskChangePlayerMode('none')
    end,
    toggleInvisible = function()
        TxToggleInvisible()
    end,

    -- Vehicle
    spawnVehicle = function(args)
        if #args == 0 then
            return ExecuteCommand('txAdmin:menu:spawnVehicle')
        end
        TxRequestSpawnVehicle(args[1])
    end,
    fixVehicle = function()
        ExecuteCommand('txAdmin:menu:fixVehicle')
    end,
    deleteVehicle = function()
        ExecuteCommand('txAdmin:menu:deleteVehicle')
    end,
    boostVehicle = function()
        ExecuteCommand('txAdmin:menu:boostVehicle')
    end,

    -- World
    clearArea = function(args)
        if #args == 0 then
            return ExecuteCommand('txAdmin:menu:clearArea')
        end
        if IS_REDM then
            return SendSnackbarMessage('error', 'nui_menu.misc.redm_not_available', true)
        end
        local radius = parseNumber(args[1], 0, 300)
        if not radius then
            return SendSnackbarMessage('error', 'nui_menu.page_main.clear_area.dialog_error', true)
        end
        TriggerServerEvent('txsv:req:clearArea', math.floor(radius))
    end,
    togglePlayerIds = function()
        ExecuteCommand('txAdmin:menu:togglePlayerIDs')
    end,
    toggleMapBlips = function()
        ExecuteCommand('txAdmin:menu:toggleMapBlips')
    end,
    cleanupVehicles = function(args)
        if #args == 0 then
            return TxOpenCleanupVehiclesDialog()
        end
        local radius = parseNumber(args[1], 1, 300)
        if not radius then
            return SendSnackbarMessage('error', 'nui_menu.page_main.cleanup_vehicles.dialog_error', true)
        end
        TriggerServerEvent('txsv:req:cleanupVehicles', math.floor(radius))
    end,

    -- Players
    spectatePlayer = function(args)
        local id = parsePlayerId(args)
        if id then
            TriggerServerEvent('txsv:req:spectate:start', id)
        end
    end,
    freezePlayer = function(args)
        local id = parsePlayerId(args)
        if not id then
            return
        end
        if id == GetPlayerServerId(PlayerId()) then
            return SendSnackbarMessage(
                'error',
                'nui_menu.player_modal.actions.interaction.notifications.freeze_yourself',
                true
            )
        end
        TriggerServerEvent('txsv:req:freezePlayer', id)
    end,
    disarmPlayer = function(args)
        local id = parsePlayerId(args)
        if id then
            TriggerServerEvent('txsv:req:disarmPlayer', id)
        end
    end,
    openPlayersPage = function()
        ExecuteCommand('txAdmin:menu:openPlayersPage')
    end,

    -- Staff tools
    staffChat = function(args)
        TxSendStaffChat(table.concat(args, ' '))
    end,
    toggleCoordsHud = function()
        TxToggleDevTool('coords')
    end,
    toggleInspector = function()
        TxToggleDevTool('inspector')
    end,

    -- Server
    restartServer = function()
        ExecuteCommand('txAdmin:menu:restartServer')
    end,
    stopServer = function()
        ExecuteCommand('txAdmin:menu:stopServer')
    end,
}

RegisterNetEvent('txcl:customCommands:runMenuAction', function(actionId, args)
    if not TX_MENU_ACCESSIBLE then
        return SendSnackbarMessage('error', 'nui_menu.misc.no_perms', true)
    end
    local runner = menuActionRunners[actionId]
    if not runner then
        return DebugPrint('^1[CustomCommands] unknown menu action: ' .. tostring(actionId))
    end
    runner(type(args) == 'table' and args or {})
end)
