-- Prevent running if menu is disabled
if not TX_MENU_ENABLED then
    return
end

-- =============================================
--  Map blips for all online players (OneSync coords)
-- =============================================

local isMapBlipsEnabled = false
local playerBlips = {}
local onesyncWarned = false

local MAP_BLIPS_POLL_MS = 5000
local BLIP_COLOUR_DEFAULT = 0

-- HUD index → blip palette index (indices are different in GTA; used only when hex is missing).
local HUD_TO_BLIP_COLOUR = {
    [6] = 1,
    [8] = 1,
    [27] = 1,
    [28] = 1,
    [208] = 1,
    [222] = 1,
    [12] = 5,
    [127] = 5,
    [17] = 17,
    [39] = 17,
    [18] = 2,
    [25] = 25,
    [46] = 25,
    [210] = 2,
    [9] = 3,
    [11] = 3,
    [26] = 26,
    [175] = 27,
    [21] = 7,
    [30] = 8,
}

-- Vehicle-type sprite IDs for map blips
local BLIP_SPRITE = {
    default = 1,
    car = 225, -- radar_gang_vehicle
    bike = 348, -- radar_gang_bike
    heli = 422, -- radar_player_heli
    plane = 423, -- radar_player_plane
    boat = 427, -- radar_player_boat
}

-- vType from server plist (see cl_playerlist.lua / sv_playerlist.lua)
local vTypeBlipSprite = {
    ['-1'] = BLIP_SPRITE.default,
    ['0'] = BLIP_SPRITE.default,
    ['1'] = BLIP_SPRITE.car,
    ['2'] = BLIP_SPRITE.bike,
    ['3'] = BLIP_SPRITE.boat,
    ['4'] = BLIP_SPRITE.heli,
    ['5'] = BLIP_SPRITE.plane,
    ['6'] = BLIP_SPRITE.boat,
    ['7'] = BLIP_SPRITE.car,
    ['8'] = BLIP_SPRITE.car,
}

local function getBlipSpriteForVType(vType)
    return vTypeBlipSprite[tostring(vType)] or BLIP_SPRITE.default
end

--- FiveM accepts 0xRRGGBBAA for SetBlipColour (panel hex colours).
local function hexToBlipColour(hex)
    if type(hex) ~= 'string' then
        return nil
    end
    local h = hex:gsub('#', ''):upper()
    if #h == 3 then
        h = h:sub(1, 1) .. h:sub(1, 1) .. h:sub(2, 2) .. h:sub(2, 2) .. h:sub(3, 3) .. h:sub(3, 3)
    end
    if #h ~= 6 then
        return nil
    end
    local r = tonumber(h:sub(1, 2), 16)
    local g = tonumber(h:sub(3, 4), 16)
    local b = tonumber(h:sub(5, 6), 16)
    if not r or not g or not b then
        return nil
    end
    return r * 16777216 + g * 65536 + b * 256 + 255
end

local function hudColorToBlipColour(hudColor)
    if type(hudColor) ~= 'number' then
        return nil
    end
    return HUD_TO_BLIP_COLOUR[hudColor]
end

local function resolveBlipColour(tagHex, tagHudColor)
    return hexToBlipColour(tagHex) or hudColorToBlipColour(tagHudColor) or BLIP_COLOUR_DEFAULT
end

local autoTagHudColors = {
    staff = 6,
    problematic = 17,
    newplayer = 12,
}
local defaultCustomHudColor = 4

local function resolveTagPrefix(def)
    if type(def.prefix) == 'string' and def.prefix ~= '' then
        return def.prefix
    end
    if type(def.label) == 'string' and def.label ~= '' then
        return '[' .. string.upper(string.sub(def.label, 1, 1)) .. '] '
    end
    return ''
end

local tagDisplayConfig = {}
local tagPriority = {}

local function rebuildTagConfig()
    local defs = (type(TX_SERVER_CTX) == 'table' and TX_SERVER_CTX.tagDefinitions) or {}
    local newConfig = {}
    local newPriority = {}

    if #defs > 0 then
        local sorted = {}
        for _, d in ipairs(defs) do
            if d.enabled ~= false then
                sorted[#sorted + 1] = d
            end
        end
        table.sort(sorted, function(a, b) return a.priority < b.priority end)

        for _, d in ipairs(sorted) do
            newConfig[d.id] = {
                prefix = resolveTagPrefix(d),
                hudColor = d.hudColor or autoTagHudColors[d.id] or defaultCustomHudColor,
                color = type(d.color) == 'string' and d.color or nil,
            }
            newPriority[#newPriority + 1] = d.id
        end
    else
        newConfig = {
            staff = { prefix = '[S] ', hudColor = 6, color = '#EF4444' },
            problematic = { prefix = '[!] ', hudColor = 17, color = '#FB923C' },
            newplayer = { prefix = '[N] ', hudColor = 12, color = '#A3E635' },
        }
        newPriority = { 'staff', 'problematic', 'newplayer' }
    end

    tagDisplayConfig = newConfig
    tagPriority = newPriority
end

local function getPlayerTopTag(serverId)
    local pidStr = tostring(serverId)
    local playerEntry = TX_LOCAL_PLAYERLIST[pidStr]
    if playerEntry == nil then
        return nil
    end
    local tags = playerEntry.tags
    if tags == nil and playerEntry.admin == true then
        return 'staff'
    end
    if tags == nil then
        return nil
    end
    local tagSet = {}
    for _, t in ipairs(tags) do
        tagSet[t] = true
    end
    for _, t in ipairs(tagPriority) do
        if tagSet[t] then
            return t
        end
    end
    return tags[1]
end

local function getTagStyleForPlayer(serverId)
    rebuildTagConfig()
    local topTag = getPlayerTopTag(serverId)
    if topTag and tagDisplayConfig[topTag] then
        local cfg = tagDisplayConfig[topTag]
        return cfg.prefix, cfg.color, cfg.hudColor
    end
    return '', nil, nil
end

local function resolvePlayerName(serverId, playerName)
    if type(playerName) == 'string' and playerName ~= '' then
        return playerName
    end
    local entry = TX_LOCAL_PLAYERLIST[tostring(serverId)]
    if entry and type(entry.name) == 'string' and entry.name ~= '' and entry.name ~= 'unknown' then
        return entry.name
    end
    return nil
end

local function resolvePlayerCoords(serverId, xCoord, yCoord)
    local remotePlayer = GetPlayerFromServerId(serverId)
    if remotePlayer ~= -1 then
        local ped = GetPlayerPed(remotePlayer)
        if ped and ped ~= 0 and DoesEntityExist(ped) then
            local coords = GetEntityCoords(ped)
            return coords.x, coords.y, coords.z
        end
    end

    if xCoord == nil or yCoord == nil then
        return nil, nil, nil
    end

    local z = 0.0
    local found, groundZ = GetGroundZFor_3dCoord(xCoord + 0.0, yCoord + 0.0, 1000.0, false)
    if found then
        z = groundZ
    end
    return xCoord + 0.0, yCoord + 0.0, z
end

local function setBlipLabel(blip, serverId, playerName, tagPrefix)
    local name = resolvePlayerName(serverId, playerName)
    local prefix = type(tagPrefix) == 'string' and tagPrefix or ''
    local label
    if name then
        label = prefix .. '[' .. serverId .. ']' .. ' ' .. name
    else
        label = prefix .. '[' .. serverId .. ']'
    end
    BeginTextCommandSetBlipName('STRING')
    AddTextComponentSubstringPlayerName(label)
    EndTextCommandSetBlipName(blip)
end

local function configureBlip(blip, serverId, vType, blipColour)
    SetBlipSprite(blip, getBlipSpriteForVType(vType))
    SetBlipColour(blip, blipColour)
    SetBlipScale(blip, 0.7)
    SetBlipAsShortRange(blip, false)
    SetBlipDisplay(blip, 2)
end

local function removeAllMapBlips()
    for pidStr, blip in pairs(playerBlips) do
        if DoesBlipExist(blip) then
            RemoveBlip(blip)
        end
        playerBlips[pidStr] = nil
    end
end

local function refreshBlipAppearance(blip, serverId, vType, playerName)
    local tagPrefix, tagHex, tagHudColor = getTagStyleForPlayer(serverId)
    local blipColour = resolveBlipColour(tagHex, tagHudColor)
    configureBlip(blip, serverId, vType, blipColour)
    setBlipLabel(blip, serverId, playerName, tagPrefix)
end

local function upsertPlayerBlip(serverId, xCoord, yCoord, vType, playerName)
    local x, y, z = resolvePlayerCoords(serverId, xCoord, yCoord)

    if x == nil then
        local pidStr = tostring(serverId)
        local existing = playerBlips[pidStr]
        if existing and DoesBlipExist(existing) then
            RemoveBlip(existing)
        end
        playerBlips[pidStr] = nil
        return false
    end

    local pidStr = tostring(serverId)
    local blip = playerBlips[pidStr]

    if blip and not DoesBlipExist(blip) then
        blip = nil
        playerBlips[pidStr] = nil
    end

    if not blip then
        blip = AddBlipForCoord(x, y, z)
        playerBlips[pidStr] = blip
    else
        SetBlipCoords(blip, x, y, z)
    end

    refreshBlipAppearance(blip, serverId, vType, playerName)
    return true
end

---@param players table
local function syncBlipsFromDetailed(players)
    if type(players) ~= 'table' then
        return
    end

    local seen = {}
    local anyCoords = false

    for _, playerData in pairs(players) do
        local serverId = playerData[1]
        if type(serverId) == 'number' then
            local pidStr = tostring(serverId)
            seen[pidStr] = true
            local hadCoords = upsertPlayerBlip(
                serverId,
                playerData[4],
                playerData[5],
                playerData[3],
                playerData[6]
            )
            if hadCoords then
                anyCoords = true
            end
        end
    end

    for pidStr, blip in pairs(playerBlips) do
        if not seen[pidStr] then
            if DoesBlipExist(blip) then
                RemoveBlip(blip)
            end
            playerBlips[pidStr] = nil
        end
    end

    if not anyCoords and not onesyncWarned then
        onesyncWarned = true
        SendSnackbarMessage('error', 'nui_menu.page_main.map_blips.alert_onesync', true)
    end
end

local function createMapBlipsPollThread()
    CreateThread(function()
        while isMapBlipsEnabled do
            Wait(MAP_BLIPS_POLL_MS)
            if isMapBlipsEnabled then
                TriggerServerEvent('txsv:req:plist:getDetailed', true)
            end
        end
    end)
end

---@diagnostic disable-next-line: lowercase-global
function toggleMapBlips(enabled, showNotification)
    if not TX_MENU_ACCESSIBLE then
        return
    end

    isMapBlipsEnabled = enabled
    SetStaffStatus('mapBlips', isMapBlipsEnabled)
    local snackMessage

    if isMapBlipsEnabled then
        snackMessage = 'nui_menu.page_main.map_blips.alert_show'
        onesyncWarned = false
        if type(UpdateServerCtx) == 'function' then
            UpdateServerCtx()
        end
        TriggerServerEvent('txsv:req:plist:getDetailed', true)
        createMapBlipsPollThread()
    else
        snackMessage = 'nui_menu.page_main.map_blips.alert_hide'
        removeAllMapBlips()
    end

    if showNotification then
        SendSnackbarMessage('info', snackMessage, true)
    end
    DebugPrint('Show Map Blips Status: ' .. tostring(isMapBlipsEnabled))
end

RegisterNetEvent('txcl:showMapBlips', function(enabled)
    DebugPrint('Received showMapBlips event')
    toggleMapBlips(enabled, true)
end)

RegisterNetEvent('txcl:plist:setDetailed', function(players, _admins, _playerTags)
    if not isMapBlipsEnabled then
        return
    end
    syncBlipsFromDetailed(players)
end)

RegisterNetEvent('txcl:plist:updatePlayerTags', function(netId, _tags)
    if not isMapBlipsEnabled then
        return
    end
    local pidStr = tostring(netId)
    local blip = playerBlips[pidStr]
    if not blip or not DoesBlipExist(blip) then
        return
    end
    local entry = TX_LOCAL_PLAYERLIST[pidStr]
    refreshBlipAppearance(blip, tonumber(netId), nil, entry and entry.name or nil)
end)

RegisterNetEvent('txcl:setServerCtx', function()
    if not isMapBlipsEnabled then
        return
    end
    TriggerServerEvent('txsv:req:plist:getDetailed', true)
end)

local function toggleMapBlipsHandler()
    TriggerServerEvent('txsv:req:showMapBlips', not isMapBlipsEnabled)
end

RegisterSecureNuiCallback('toggleMapBlips', function(_, cb)
    toggleMapBlipsHandler()
    cb({})
end)

RegisterCommand('txAdmin:menu:toggleMapBlips', function()
    if not TX_MENU_ACCESSIBLE then
        return
    end
    if not DoesPlayerHavePerm(TX_MENU_PERMISSIONS, 'menu.mapblips') then
        return SendSnackbarMessage('error', 'nui_menu.misc.no_perms', true)
    end
    toggleMapBlipsHandler()
end, false)

AddEventHandler('onResourceStop', function(resourceName)
    if resourceName ~= GetCurrentResourceName() then
        return
    end
    if isMapBlipsEnabled then
        isMapBlipsEnabled = false
        removeAllMapBlips()
    end
end)
