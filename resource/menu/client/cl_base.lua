-- =============================================
--  This file is for base menu functionality (admin status,
--  visibility, keybinds, focus callbacks's, threads, etc)
-- =============================================

-- Global Variables (TX_ prefix for txAdmin-managed state)
TX_MENU_ACCESSIBLE = false
TX_MENU_VISIBLE = false
TX_LAST_MENU_CLOSE = 0
TX_MENU_PERMISSIONS = {}
TX_LAST_TP_COORDS = false
TX_STAFF_INVISIBLE = false
-- Active staff toggles, mirrored to the NUI status strip (playerMode, invisible, playerIds, etc)
TX_STAFF_STATUS = { playerMode = 'none' }

--- Updates one of the staff toggles shown on the menu status strip
---@param key string
---@param value any
function SetStaffStatus(key, value)
    if TX_STAFF_STATUS[key] == value then
        return
    end
    TX_STAFF_STATUS[key] = value
    SendMenuMessage('setStaffStatus', { [key] = value })
end

-- Locals
local noMenuReason = 'unknown reason'
local awaitingReauth = false

--- Logic to displaying the menu auth rejected snackbar
local function displayAuthRejectedError()
    if noMenuReason == 'nui_admin_not_found' then
        SendSnackbarMessage('error', 'nui_menu.misc.menu_not_admin', true)
    elseif noMenuReason == 'two_factor_required' then
        SendSnackbarMessage('error', 'nui_menu.misc.two_factor_required', true)
    elseif noMenuReason == 'temp_password_change_required' then
        SendSnackbarMessage('error', 'nui_menu.misc.temp_password_required', true)
    else
        SendSnackbarMessage('error', 'nui_menu.misc.menu_auth_failed', true, { reason = noMenuReason })
    end
end

--- Tests for menu accessibility and displays error snackbar if needed
local function checkMenuAccessible()
    if not TX_MENU_ENABLED then
        SendSnackbarMessage('error', 'nui_menu.misc.not_enabled', true)
        return false
    end
    if not TX_MENU_ACCESSIBLE then
        displayAuthRejectedError()
        return false
    end

    return true
end

-- Register txAdmin command
local function txadmin(_, args)
    if not checkMenuAccessible() then
        return
    end

    -- Make visible
    toggleMenuVisibility()

    -- Shortcut to open a specific players profile
    if TX_MENU_VISIBLE and #args >= 1 then
        local targetPlayer = table.concat(args, ' ')
        SendMenuMessage('openPlayerModal', targetPlayer)
    end
end
RegisterCommand('txadmin', txadmin, false)
RegisterCommand('tx', txadmin, false)

-- Shortcut commands for moderation actions
local actionPermMap = {
    ban = 'players.ban',
    kick = 'players.kick',
    warn = 'players.warn',
    dm = 'players.direct_message',
    heal = 'players.heal',
    teleport = 'players.teleport',
    spectate = 'players.spectate',
    freeze = 'players.freeze',
    troll = 'players.troll',
    announce = 'announcement',
    vehicle = 'menu.vehicle',
    clear_area = 'menu.clear_area',
    viewids = 'menu.viewids',
    playermode = 'players.playermode',
    whitelist = 'players.whitelist',
    resources = 'commands.resources',
}
local function makeActionCommand(action)
    return function(_, args)
        if not checkMenuAccessible() then
            return
        end
        local requiredPerm = actionPermMap[action]
        if requiredPerm and not DoesPlayerHavePerm(TX_MENU_PERMISSIONS, requiredPerm) then
            SendSnackbarMessage('error', 'nui_menu.misc.no_perms_action', true, { action = action })
            return
        end
        if #args < 1 then
            SendSnackbarMessage('error', 'nui_menu.misc.usage_action', true, { action = action })
            return
        end
        local targetPlayer = table.concat(args, ' ')
        toggleMenuVisibility(true)
        SetNuiFocus(true, true)
        SendMenuMessage('openPlayerModalAction', { target = targetPlayer, action = action })
    end
end
RegisterCommand('ban', makeActionCommand('ban'), false)
RegisterCommand('kick', makeActionCommand('kick'), false)
RegisterCommand('warn', makeActionCommand('warn'), false)

-- Announce command
RegisterCommand('announce', function(_, args)
    if not checkMenuAccessible() then
        return
    end
    if not DoesPlayerHavePerm(TX_MENU_PERMISSIONS, actionPermMap['announce']) then
        SendSnackbarMessage('error', 'nui_menu.misc.no_perms_action', true, { action = 'announce' })
        return
    end
    if #args < 1 then
        SendSnackbarMessage('error', 'nui_menu.misc.usage_action', true, { action = 'announce' })
        return
    end
    local message = table.concat(args, ' ')
    TriggerServerEvent('txsv:req:sendAnnouncement', message)
end, false)

RegisterCommand('txAdmin:menu:openPlayersPage', function()
    if not checkMenuAccessible() then
        return
    end
    SendMenuMessage('setMenuPage', 1)
    toggleMenuVisibility(true)
    SetNuiFocus(true, true)
end, false)

-- This needs to run even when menu is disabled so the TX_SERVER_CTX
-- is updated for react, needed by the Warn page
RegisterSecureNuiCallback('reactLoaded', function(_, cb)
    DebugPrint('React loaded, requesting TX_SERVER_CTX.')

    CreateThread(function()
        UpdateServerCtx()
        local waitStart = GetGameTimer()
        local timeoutMs = 15000
        while TX_SERVER_CTX == false do
            if GetGameTimer() - waitStart > timeoutMs then
                DebugPrint('^1[ERROR] Timed out waiting for TX_SERVER_CTX after ' .. timeoutMs .. 'ms^0')
                SendSnackbarMessage('error', 'nui_menu.misc.ctx_timeout', true, { ms = timeoutMs })
                return
            end
            Wait(100)
        end
        DebugPrint('TX_SERVER_CTX loaded, sending variables.')
        SendMenuMessage('setGameName', GAME_NAME)
        SendMenuMessage('setDebugMode', TX_DEBUG_MODE)
        SendMenuMessage('setServerCtx', TX_SERVER_CTX)
        SendMenuMessage('setPermissions', TX_MENU_PERMISSIONS)
        SendMenuMessage('setStaffStatus', TX_STAFF_STATUS)
    end)

    cb({})
end)

-- =============================================
--  The rest of the file will only run if menu is enabled
-- =============================================

-- Prevent running if menu is disabled
if not TX_MENU_ENABLED then
    return
end

-- Checking with server if we are an admin
TriggerServerEvent('txsv:checkIfAdmin')

-- Triggered as callback of txsv:checkIfAdmin
RegisterNetEvent('txcl:setAdmin', function(username, perms, rejectReason)
    if type(perms) == 'table' then
        DebugPrint("^2[AUTH] logged in as '" .. username .. "' with perms: " .. json.encode(perms or 'nil'))
        TX_MENU_ACCESSIBLE = true
        TX_MENU_PERMISSIONS = perms
        if type(UpdateServerCtx) == 'function' then
            UpdateServerCtx()
        end
        if IS_FIVEM then
            --NOTE: appending # to the desc so the sorting shows it at the top
            RegisterKeyMapping('txadmin', translator.t('nui_menu.keybinds.open_main'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:openPlayersPage', translator.t('nui_menu.keybinds.open_players'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:clearArea', translator.t('nui_menu.keybinds.clear_area'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:healMyself', translator.t('nui_menu.keybinds.heal_self'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:tpBack', translator.t('nui_menu.keybinds.teleport_back'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:tpToCoords', translator.t('nui_menu.keybinds.teleport_coords'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:tpToWaypoint', translator.t('nui_menu.keybinds.teleport_waypoint'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:noClipToggle', translator.t('nui_menu.keybinds.toggle_noclip'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:togglePlayerIDs', translator.t('nui_menu.keybinds.toggle_player_ids'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:toggleMapBlips', translator.t('nui_menu.keybinds.toggle_map_blips'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:boostVehicle', translator.t('nui_menu.keybinds.vehicle_boost'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:deleteVehicle', translator.t('nui_menu.keybinds.vehicle_delete'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:fixVehicle', translator.t('nui_menu.keybinds.vehicle_fix'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:spawnVehicle', translator.t('nui_menu.keybinds.vehicle_spawn'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:toggleInvisible', translator.t('nui_menu.keybinds.toggle_invisible'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:toggleCoordsHud', translator.t('nui_menu.keybinds.toggle_coords_hud'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:toggleInspector', translator.t('nui_menu.keybinds.toggle_inspector'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:cleanupVehicles', translator.t('nui_menu.keybinds.cleanup_vehicles'), 'KEYBOARD', '')
            RegisterKeyMapping('txAdmin:menu:staffChat', translator.t('nui_menu.keybinds.staff_chat'), 'KEYBOARD', '')
        end
    else
        noMenuReason = tostring(rejectReason)
        DebugPrint('^3[AUTH] rejected (' .. noMenuReason .. ')')
        if awaitingReauth then
            displayAuthRejectedError()
            awaitingReauth = false
        end
        TX_MENU_ACCESSIBLE = false
        TX_MENU_PERMISSIONS = {}
    end
    SendMenuMessage('setPermissions', TX_MENU_PERMISSIONS)
end)

--[[ Debug Events / Commands ]]
-- Command/event to trigger a authentication attempt
local function retryAuthentication()
    DebugPrint('^5[AUTH] Retrying menu authentication.')
    TX_MENU_ACCESSIBLE = false
    TX_MENU_PERMISSIONS = {}
    SendMenuMessage('setPermissions', TX_MENU_PERMISSIONS)
    TriggerServerEvent('txsv:checkIfAdmin')
end
RegisterNetEvent('txcl:reAuth', retryAuthentication)
RegisterCommand('txAdmin-reauth', function()
    SendSnackbarMessage('info', 'nui_menu.misc.auth_retry', true)
    awaitingReauth = true
    retryAuthentication()
end, false)

-- Register chat suggestions
-- txAdmin starts before the chat resource, so we need to wait a bit
CreateThread(function()
    Wait(1000)
    TriggerEvent(
        'chat:addSuggestion',
        '/tx',
        translator.t('nui_menu.chat.tx_description'),
        { { name = 'player ID/name', help = translator.t('nui_menu.chat.tx_arg_help') } }
    )
    TriggerEvent('chat:addSuggestion', '/txAdmin-reauth', translator.t('nui_menu.chat.tx_reauth'))
    TriggerEvent(
        'chat:addSuggestion',
        '/goto',
        translator.t('nui_menu.chat.goto_description'),
        { { name = 'player ID', help = translator.t('nui_menu.chat.goto_arg_help') } }
    )
    TriggerEvent('chat:addSuggestion', '/tpm', translator.t('nui_menu.chat.tpm_description'))
    TriggerEvent(
        'chat:addSuggestion',
        '/ban',
        translator.t('nui_menu.chat.ban_description'),
        { { name = 'player ID/name', help = translator.t('nui_menu.chat.ban_arg_help') } }
    )
    TriggerEvent(
        'chat:addSuggestion',
        '/kick',
        translator.t('nui_menu.chat.kick_description'),
        { { name = 'player ID/name', help = translator.t('nui_menu.chat.kick_arg_help') } }
    )
    TriggerEvent(
        'chat:addSuggestion',
        '/warn',
        translator.t('nui_menu.chat.warn_description'),
        { { name = 'player ID/name', help = translator.t('nui_menu.chat.warn_arg_help') } }
    )
    TriggerEvent(
        'chat:addSuggestion',
        '/announce',
        translator.t('nui_menu.chat.announce_description'),
        { { name = 'message', help = translator.t('nui_menu.chat.announce_arg_help') } }
    )
    TriggerEvent(
        'chat:addSuggestion',
        '/staffchat',
        translator.t('nui_menu.chat.staffchat_description'),
        { { name = 'message', help = translator.t('nui_menu.chat.staffchat_arg_help') } }
    )
end)

-- Will toggle debug logging
RegisterNetEvent('txcl:setDebugMode', function(enabled)
    TX_DEBUG_MODE = enabled
    SendMenuMessage('setDebugMode', TX_DEBUG_MODE)
end)

--[[ NUI Callbacks ]]
-- Triggered whenever we require full focus, cursor and keyboard
RegisterSecureNuiCallback('focusInputs', function(shouldFocus, cb)
    DebugPrint('NUI Focus + Keep Input ' .. tostring(shouldFocus))
    -- Will prevent mouse focus on initial menu mount as the useEffect emits there
    if not TX_MENU_VISIBLE then
        cb({})
        return
    end
    SetNuiFocus(true, shouldFocus)
    SetNuiFocusKeepInput(not shouldFocus)
    cb({})
end)

-- When the escape key is pressed in menu
RegisterSecureNuiCallback('closeMenu', function(_, cb)
    TX_MENU_VISIBLE = false
    TX_LAST_MENU_CLOSE = GetGameTimer()
    DebugPrint('Releasing all NUI Focus')
    SetNuiFocus(false, false)
    SetNuiFocusKeepInput(false)
    playLibrarySound('enter')
    cb({})
end)

-- Audio play callback
RegisterSecureNuiCallback('playSound', function(sound, cb)
    playLibrarySound(sound)
    cb({})
end)

-- Heals local player
RegisterNetEvent('txcl:heal', function()
    DebugPrint('Received heal event, healing to full')
    local ped = PlayerPedId()
    local pos = GetEntityCoords(ped)
    local heading = GetEntityHeading(ped)
    if IsEntityDead(ped) then
        ---@diagnostic disable-next-line: param-type-mismatch
        NetworkResurrectLocalPlayer(pos[1], pos[2], pos[3], heading, false, false)
    end
    ResurrectPed(ped)
    SetEntityHealth(ped, GetEntityMaxHealth(ped))
    ClearPedBloodDamage(ped)
    RestorePlayerStamina(PlayerId(), 100.0)
    if IS_REDM then
        Citizen.InvokeNative(0xC6258F41D86676E0, ped, 0, 100) -- SetAttributeCoreValue
        Citizen.InvokeNative(0xC6258F41D86676E0, ped, 1, 100) -- SetAttributeCoreValue
        Citizen.InvokeNative(0xC6258F41D86676E0, ped, 2, 100) -- SetAttributeCoreValue
    end
end)

CreateThread(function()
    NetworkSetLocalPlayerSyncLookAt(true)
end)

-- Tell the user he is an admin and that /tx is available
AddEventHandler('playerSpawned', function()
    Wait(15000)
    if TX_MENU_ACCESSIBLE then
        SendMenuMessage('showMenuHelpInfo', {})
    end
end)
