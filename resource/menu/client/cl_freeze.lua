-- Prevent running if menu is disabled
if not TX_MENU_ENABLED then
    return
end

-- =============================================
--  This file contains all player freeze logic
-- =============================================

local function sendFreezeAlert(isFrozen)
    if isFrozen then
        SendPersistentAlert('freeze-status', 'warning', 'nui_menu.frozen.was_frozen', true)
    else
        ClearPersistentAlert('freeze-status')
    end
end

RegisterSecureNuiCallback('togglePlayerFreeze', function(data, cb)
    local targetPlayerId = tonumber(data.id)
    if targetPlayerId == GetPlayerServerId(PlayerId()) then
        SendSnackbarMessage('error', 'nui_menu.player_modal.actions.interaction.notifications.freeze_yourself', true)
        return cb({})
    end

    TriggerServerEvent('txsv:req:freezePlayer', targetPlayerId)
    cb({})
end)

RegisterNetEvent('txcl:freezePlayerOk', function(isFrozen)
    local localeKey = isFrozen and 'nui_menu.frozen.froze_player' or 'nui_menu.frozen.unfroze_player'
    SendSnackbarMessage('info', localeKey, true)
end)

RegisterNetEvent('txcl:setFrozen', function(isFrozen)
    DebugPrint('Frozen: ' .. tostring(isFrozen))
    local playerPed = PlayerPedId()
    if IS_REDM and IsPedOnMount(playerPed) then
        ClearPedTasksImmediately(playerPed)
    else
        TaskLeaveAnyVehicle(playerPed, 0, 16)
    end
    FreezeEntityPosition(playerPed, isFrozen)
    sendFreezeAlert(isFrozen)
end)
