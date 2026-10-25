-- Prevent running in monitor mode
if not TX_SERVER_MODE then
    return
end
-- Prevent running if menu is disabled
if not TX_MENU_ENABLED then
    return
end

-- =============================================
--  This file is for general server side handlers
--  related to actions defined within Menu's
--  "Player Modal"
-- =============================================

RegisterNetEvent('txsv:req:tpToPlayer', function(tgtId)
    local src = source

    if type(tgtId) ~= 'number' then
        return
    end

    -- Skip if targeting yourself; server-side ped coords may resolve to 0,0,0
    if tgtId == src then
        return
    end

    local allow = PlayerHasTxPermission(src, 'players.teleport')
    local data = { x = nil, y = nil, z = nil, target = tgtId }

    -- More OneSync dependent code
    if allow then
        -- ensure the player ped exists before touching routing buckets
        -- NOTE: GetPlayerPed returns 0 (truthy in Lua) for invalid/offline players
        local ped = GetPlayerPed(tgtId)
        if ped and ped > 0 then
            -- Check for routing bucket diff
            local tgtBucket = GetPlayerRoutingBucket(tgtId)
            local srcBucket = GetPlayerRoutingBucket(src)

            -- This isn't stored anywhere for reversion,
            -- as TP to player is typically a one sided operation
            if tgtBucket ~= srcBucket then
                SetPlayerRoutingBucket(src, tgtBucket)
            end

            local coords = GetEntityCoords(ped)
            data.x = coords[1]
            data.y = coords[2]
            data.z = coords[3]
            TriggerClientEvent('txcl:tpToCoords', src, data.x, data.y, data.z)
        end
    end

    TriggerEvent('txsv:logger:menuEvent', src, 'teleportPlayer', allow, data)
end)

-- Where each player was before being brought, keyed by their server id (string)
local preBringLocations = {}

RegisterNetEvent('txsv:req:bringPlayer', function(id)
    local src = source
    if type(id) ~= 'number' then
        return
    end
    local allow = PlayerHasTxPermission(src, 'players.teleport')
    if allow then
        -- ensure both peds exist (GetPlayerPed returns 0, truthy in Lua, when invalid)
        local ped = GetPlayerPed(id)
        local srcPed = GetPlayerPed(src)
        if ped and ped > 0 and srcPed and srcPed > 0 then
            local fromCoords = GetEntityCoords(ped)
            preBringLocations[tostring(id)] = {
                x = fromCoords[1],
                y = fromCoords[2],
                z = fromCoords[3],
                bucket = GetPlayerRoutingBucket(id),
            }
            local coords = GetEntityCoords(srcPed)
            TriggerClientEvent('txcl:tpToCoords', id, coords[1], coords[2], coords[3])
        end
    end
    TriggerEvent('txsv:logger:menuEvent', src, 'summonPlayer', allow, id)
end)

--- Sends a player back to where they were before they were last brought
RegisterNetEvent('txsv:req:returnPlayer', function(id)
    local src = source
    if type(id) ~= 'number' then
        return
    end
    local allow = PlayerHasTxPermission(src, 'players.teleport')
    TriggerEvent('txsv:logger:menuEvent', src, 'returnPlayer', allow, id)
    if not allow then
        return
    end

    local ped = GetPlayerPed(id)
    if not ped or ped <= 0 then
        return
    end
    local key = tostring(id)
    local location = preBringLocations[key]
    if not location then
        return TriggerClientEvent('txcl:staffTools:notify', src, 'error', 'nui_menu.player_modal.actions.staff.notifications.return_none')
    end
    preBringLocations[key] = nil

    if GetPlayerRoutingBucket(id) ~= location.bucket then
        SetPlayerRoutingBucket(id, location.bucket)
    end
    TriggerClientEvent('txcl:tpToCoords', id, location.x, location.y, location.z)
    TriggerClientEvent('txcl:staffTools:notify', src, 'success', 'nui_menu.player_modal.actions.staff.notifications.return_player')
end)

AddEventHandler('playerDropped', function()
    preBringLocations[tostring(source)] = nil
end)
